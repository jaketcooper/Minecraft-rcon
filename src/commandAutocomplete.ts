import * as vscode from 'vscode';

// Minecraft color codes to ANSI escape sequences
const COLOR_MAP: { [key: string]: string } = {
  '§0': '\x1b[30m',    // Black
  '§1': '\x1b[34m',    // Dark Blue
  '§2': '\x1b[32m',    // Dark Green
  '§3': '\x1b[36m',    // Dark Aqua
  '§4': '\x1b[31m',    // Dark Red
  '§5': '\x1b[35m',    // Dark Purple
  '§6': '\x1b[33m',    // Gold
  '§7': '\x1b[37m',    // Gray
  '§8': '\x1b[90m',    // Dark Gray
  '§9': '\x1b[94m',    // Blue
  '§a': '\x1b[92m',    // Green
  '§b': '\x1b[96m',    // Aqua
  '§c': '\x1b[91m',    // Red
  '§d': '\x1b[95m',    // Light Purple
  '§e': '\x1b[93m',    // Yellow
  '§f': '\x1b[97m',    // White
  '§r': '\x1b[0m',     // Reset
  '§l': '\x1b[1m',     // Bold
  '§o': '\x1b[3m',     // Italic
  '§n': '\x1b[4m',     // Underline
  '§m': '\x1b[9m',     // Strikethrough
  '§k': '\x1b[5m',     // Obfuscated (blinking)
};

export interface CommandArgument {
  name: string;
  required: boolean;
  choices?: string[];
  description?: string;
}

export interface CommandNode {
  name: string;
  description?: string;
  arguments: CommandArgument[];
  subcommands: Map<string, CommandNode>;
  isComplete: boolean;  // Whether we've fetched all subcommands
  rawHelp?: string;      // Raw help text for this command
}

export class CommandAutocomplete {
  private rootCommands: Map<string, CommandNode> = new Map();
  private commandAliases: Map<string, string> = new Map();
  private isLoading: boolean = false;
  private loadingProgress: number = 0;
  private totalCommands: number = 0;
  
  constructor(
    private sendCommand: (command: string) => Promise<string>,
    private output: vscode.OutputChannel
  ) {}

  /**
   * Convert Minecraft color codes to ANSI escape sequences
   */
  public static formatMinecraftColors(text: string): string {
    let result = text;
    for (const [code, ansi] of Object.entries(COLOR_MAP)) {
      result = result.replace(new RegExp(code.replace('§', '\\§'), 'g'), ansi);
    }
    // Ensure we reset at the end
    if (!result.endsWith('\x1b[0m')) {
      result += '\x1b[0m';
    }
    return result;
  }

  /**
   * Remove Minecraft color codes for parsing
   */
  private stripColors(text: string): string {
    return text.replace(/§[0-9a-fklmnor]/g, '');
  }

  /**
   * Parse command syntax from help output
   */
  private parseCommandSyntax(line: string): CommandNode {
    const stripped = this.stripColors(line).trim();
    
    // Match command pattern: /command [args] (choices)
    const match = stripped.match(/^\/(\S+)\s*(.*)/);
    if (!match) {
      return {
        name: stripped,
        arguments: [],
        subcommands: new Map(),
        isComplete: false
      };
    }

    const [, commandName, argString] = match;
    const node: CommandNode = {
      name: commandName,
      arguments: [],
      subcommands: new Map(),
      isComplete: false,
      rawHelp: line
    };

    if (!argString) {
      return node;
    }

    // Parse arguments and choices
    const argPattern = /(\[<[^>]+>\]|<[^>]+>|\[[^\]]+\]|\([^)]+\))/g;
    let match2;
    
    while ((match2 = argPattern.exec(argString)) !== null) {
      const arg = match2[1];
      
      if (arg.startsWith('(') && arg.endsWith(')')) {
        // Choices: (option1|option2|...)
        const choices = arg.slice(1, -1).split('|').map(c => c.trim());
        
        // These are subcommands
        choices.forEach(choice => {
          node.subcommands.set(choice, {
            name: choice,
            arguments: [],
            subcommands: new Map(),
            isComplete: false
          });
        });
      } else if (arg.startsWith('[') && arg.endsWith(']')) {
        // Optional argument: [<n>] or [value]
        const inner = arg.slice(1, -1);
        if (inner.startsWith('<') && inner.endsWith('>')) {
          node.arguments.push({
            name: inner.slice(1, -1),
            required: false
          });
        } else {
          // Literal optional value
          node.arguments.push({
            name: inner,
            required: false
          });
        }
      } else if (arg.startsWith('<') && arg.endsWith('>')) {
        // Required argument: <n>
        node.arguments.push({
          name: arg.slice(1, -1),
          required: true
        });
      }
    }

    return node;
  }

  /**
   * Parse /help output and build command tree
   */
  private parseHelpOutput(helpText: string, parentCommand?: string[]): void {
    const lines = helpText.split('\n');
    
    for (const line of lines) {
      const stripped = this.stripColors(line).trim();
      if (!stripped || !stripped.startsWith('/')) {continue;}

      // Check for command aliases (e.g., "/tp -> teleport")
      const aliasMatch = stripped.match(/^\/(\S+)\s+->\s+(\S+)/);
      if (aliasMatch) {
        this.commandAliases.set(aliasMatch[1], aliasMatch[2]);
        continue;
      }

      const node = this.parseCommandSyntax(line);
      
      if (parentCommand && parentCommand.length > 0) {
        // This is a subcommand
        let current = this.rootCommands.get(parentCommand[0]);
        if (!current) {continue;}

        for (let i = 1; i < parentCommand.length; i++) {
          const nextCurrent: CommandNode | undefined = current.subcommands.get(parentCommand[i]);
          if (!nextCurrent) {break;}
          current = nextCurrent;
        }

        if (current) {
          // Update the subcommand info
          const subName = node.name.split(' ').pop() || node.name;
          const existing = current.subcommands.get(subName);
          if (existing) {
            existing.arguments = node.arguments;
            existing.rawHelp = line;
            existing.isComplete = node.arguments.length > 0 || node.subcommands.size === 0;
          }
        }
      } else {
        // Root command
        const existing = this.rootCommands.get(node.name);
        if (existing) {
          // Update existing node
          existing.arguments = node.arguments;
          existing.rawHelp = line;
          if (node.subcommands.size > 0) {
            node.subcommands.forEach((sub, key) => {
              if (!existing.subcommands.has(key)) {
                existing.subcommands.set(key, sub);
              }
            });
          }
        } else {
          this.rootCommands.set(node.name, node);
        }
      }
    }
  }

  /**
   * Recursively fetch subcommand help
   */
  private async fetchSubcommandHelp(commandPath: string[], maxDepth: number = 7): Promise<void> {
    if (commandPath.length > maxDepth) {return;}

    const helpCommand = `help ${commandPath.join(' ')}`;
    
    try {
      const response = await this.sendCommand(helpCommand);
      
      // Check if this is a valid help response
      if (!response.includes('Unknown or incomplete command') && 
          !response.includes('Incorrect argument')) {
        
        this.parseHelpOutput(response, commandPath);
        
        // Get the node for this command
        let node: CommandNode | undefined = this.rootCommands.get(commandPath[0]);
        if (!node) {return;}

        for (let i = 1; i < commandPath.length; i++) {
          node = node.subcommands.get(commandPath[i]);
          if (!node) {return;}
        }

        // Recursively fetch help for subcommands
        for (const [subName, subNode] of node.subcommands) {
          if (!subNode.isComplete) {
            await this.fetchSubcommandHelp([...commandPath, subName], maxDepth);
            
            // Small delay to avoid overwhelming the server
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        node.isComplete = true;
      }
    } catch (error) {
      this.output.appendLine(`Error fetching help for ${helpCommand}: ${error}`);
    }
  }

  /**
   * Initialize command database by fetching from server
   */
  public async initialize(onProgress?: (progress: number, message: string) => void): Promise<void> {
    if (this.isLoading) {return;}
    
    this.isLoading = true;
    this.rootCommands.clear();
    this.commandAliases.clear();

    try {
      onProgress?.(0, 'Fetching command list...');
      
      // Get initial command list
      const helpResponse = await this.sendCommand('help');
      this.parseHelpOutput(helpResponse);
      
      this.totalCommands = this.rootCommands.size;
      let processed = 0;

      // Fetch detailed help for each root command with subcommands
      for (const [cmdName, cmdNode] of this.rootCommands) {
        if (cmdNode.subcommands.size > 0) {
          onProgress?.(
            (processed / this.totalCommands) * 100, 
            `Loading ${cmdName} subcommands...`
          );
          
          await this.fetchSubcommandHelp([cmdName], 3);
          processed++;
          
          // Small delay between commands
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      onProgress?.(100, 'Command loading complete!');
      this.output.appendLine(`Loaded ${this.rootCommands.size} commands with ${this.countTotalCommands()} total variations`);
      
    } catch (error) {
      this.output.appendLine(`Error initializing commands: ${error}`);
      throw error;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Count total number of commands including subcommands
   */
  private countTotalCommands(): number {
    let count = 0;
    
    const countNode = (node: CommandNode) => {
      count++;
      node.subcommands.forEach(sub => countNode(sub));
    };

    this.rootCommands.forEach(cmd => countNode(cmd));
    return count;
  }

  /**
   * Get autocomplete suggestions for current input
   */
  public getSuggestions(input: string): {
    suggestions: string[];
    hint?: string;
    argumentHelp?: string;
  } {
    const trimmed = input.trim();
    
    // Remove leading slash if present
    const normalized = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
    const hasTrailingSpace = input.endsWith(' ');
    const parts = normalized.split(' ').filter(p => p.length > 0);
    
    // Handle aliases for the first part
    if (parts.length > 0 && this.commandAliases.has(parts[0])) {
      parts[0] = this.commandAliases.get(parts[0])!;
    }

    // If no input or just starting to type a root command
    if (parts.length === 0 || (parts.length === 1 && !hasTrailingSpace)) {
      // Suggest root commands
      const prefix = parts[0] || '';
      const suggestions = Array.from(this.rootCommands.keys())
        .filter(cmd => cmd.startsWith(prefix))
        .sort();

      // Also include aliases
      this.commandAliases.forEach((target, alias) => {
        if (alias.startsWith(prefix)) {
          suggestions.push(alias);
        }
      });

      return { suggestions };
    }

    // Navigate to the current command node
    let currentNode = this.rootCommands.get(parts[0]);
    if (!currentNode) {
      return { suggestions: [] };
    }

    // Navigate through subcommands
    let argIndex = 0;
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      
      // Check if this matches a subcommand
      const subNode: CommandNode | undefined = currentNode.subcommands.get(part);
      if (subNode) {
        currentNode = subNode;
        argIndex = 0;
      } else {
        // This is an argument
        argIndex++;
      }
    }

    // Determine what to suggest based on whether we have trailing space
    if (hasTrailingSpace) {
      // User has finished typing something and pressed space - suggest next options
      if (!currentNode) {
        return { suggestions: [] };
      }
      const suggestions = Array.from(currentNode.subcommands.keys()).sort();
      
      return {
        suggestions,
        argumentHelp: this.getArgumentHelp(currentNode, argIndex)
      };
    } else {
      // User is in the middle of typing - filter suggestions based on partial match
      const lastPart = parts[parts.length - 1];
      
      // If we're at a node that has the last part as a subcommand, move to it
      const exactMatch = currentNode.subcommands.get(lastPart);
      if (exactMatch && parts.length > 1) {
        // Exact match for a subcommand - suggest its children
        const suggestions = Array.from(exactMatch.subcommands.keys()).sort();
        return {
          suggestions,
          argumentHelp: this.getArgumentHelp(exactMatch, 0)
        };
      }
      
      // Otherwise filter current level's subcommands
      const suggestions = Array.from(currentNode.subcommands.keys())
        .filter(cmd => cmd.startsWith(lastPart))
        .sort();

      return {
        suggestions,
        argumentHelp: this.getArgumentHelp(currentNode, argIndex)
      };
    }
  }

  /**
   * Get help text for current argument position
   */
  private getArgumentHelp(node: CommandNode, argIndex: number): string | undefined {
    // Always show current argument and all remaining arguments
    const remainingArgs = node.arguments.slice(argIndex);
    if (remainingArgs.length > 0) {
      return remainingArgs.map(arg => 
        arg.required ? `<${arg.name}>` : `[${arg.name}]`
      ).join(' ');
    }

    return undefined;
  }

  /**
   * Get detailed help for a command
   */
  public getCommandHelp(commandPath: string): string | undefined {
    const parts = commandPath.trim().replace(/^\//, '').split(' ');
    
    let node: CommandNode | undefined = this.rootCommands.get(parts[0]);
    if (!node) {return undefined;}

    for (let i = 1; i < parts.length; i++) {
      node = node.subcommands.get(parts[i]);
      if (!node) {return undefined;}
    }

    return node.rawHelp;
  }

  /**
   * Get all commands as a flat list for command palette
   */
  public getAllCommands(): { command: string; description: string }[] {
    const commands: { command: string; description: string }[] = [];

    const addNode = (node: CommandNode, prefix: string) => {
      const fullCommand = prefix ? `${prefix} ${node.name}` : node.name;
      
      if (node.rawHelp) {
        commands.push({
          command: '/' + fullCommand,
          description: this.stripColors(node.rawHelp)
        });
      } else {
        commands.push({
          command: '/' + fullCommand,
          description: node.arguments.map(a => 
            a.required ? `<${a.name}>` : `[${a.name}]`
          ).join(' ')
        });
      }

      // Add subcommands
      node.subcommands.forEach(sub => {
        addNode(sub, fullCommand);
      });
    };

    this.rootCommands.forEach(cmd => addNode(cmd, ''));
    
    // Add aliases
    this.commandAliases.forEach((target, alias) => {
      commands.push({
        command: '/' + alias,
        description: `Alias for /${target}`
      });
    });

    return commands.sort((a, b) => a.command.localeCompare(b.command));
  }

  /**
   * Check if commands are loaded
   */
  public get isReady(): boolean {
    return !this.isLoading && this.rootCommands.size > 0;
  }
}