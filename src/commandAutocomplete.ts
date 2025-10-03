// src/commandAutocomplete.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

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

// Parameter types - Now includes SUBCOMMAND
export enum ParameterType {
  ARGUMENT = 'argument',          // <n>
  LITERAL = 'literal',            // literal text  
  CHOICE_LIST = 'choice_list',    // (option1|option2)
  SUBCOMMAND = 'subcommand'        // NEW: subcommand with its own members
}

export interface Parameter {
  type: ParameterType;
  name?: string;                  // For arguments and subcommands
  literal?: string;                // For literal text
  optional: boolean;
  choices?: Parameter[];           // For choice lists
  position: number;                // Order in parameter list
  members?: Parameter[];           // NEW: For subcommand's parameters
  isComplete?: boolean;            // NEW: For subcommands - whether we've fetched all its members
  rawHelp?: string;                // NEW: For subcommands - the raw help text
}

export interface CommandNode {
  name: string;
  parameters: Parameter[];         // Now includes subcommands as parameters
  // NO MORE subcommands Map!
  rawHelp?: string;
  isComplete: boolean;
}

// Serializable version for caching
interface SerializedCommandNode {
  name: string;
  parameters: Parameter[];
  rawHelp?: string;
  isComplete: boolean;
}

interface CommandCache {
  version: string;
  serverIdentifier: string;
  lastUpdated: string;
  commands: { [key: string]: SerializedCommandNode };
  aliases: { [key: string]: string };
}

export interface SuggestionResult {
  suggestions: string[];
  argumentHelp?: string;
  commandPath?: string;           // NEW: The actual command path determined
}

export class CommandAutocomplete {
  private rootCommands: Map<string, CommandNode> = new Map();
  private commandAliases: Map<string, string> = new Map();
  private isLoading: boolean = false;
  private loadingProgress: number = 0;
  private totalCommands: number = 0;
  public isReady: boolean = false;
  
  // Cache configuration
  private cacheDir: string;
  private cacheFile: string;
  private cacheVersion: string = '2.1.0'; // Bumped version for protocol changes
  private serverIdentifier: string;
  
  constructor(
    private sendCommand: (command: string) => Promise<string>,
    private output: vscode.OutputChannel,
    private context: vscode.ExtensionContext,
    serverHost: string,
    serverPort: number
  ) {
    this.serverIdentifier = `${serverHost}:${serverPort}`;
    this.cacheDir = path.join(context.globalStorageUri.fsPath, 'command-cache');
    this.cacheFile = path.join(this.cacheDir, `${serverHost}_${serverPort}.json`);
    
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Convert Minecraft color codes to ANSI escape sequences
   */
  public static formatMinecraftColors(text: string): string {
    let result = text;
    for (const [code, ansi] of Object.entries(COLOR_MAP)) {
      result = result.replace(new RegExp(code.replace('§', '\\§'), 'g'), ansi);
    }
    if (!result.endsWith('\x1b[0m')) {
      result += '\x1b[0m';
    }
    return result;
  }

  /**
   * Remove Minecraft color codes for parsing
   */
  private stripColors(text: string): string {
    // Handle both § and Â§ encodings (UTF-8 issues)
    return text.replace(/[§Â]§[0-9a-fklmnor]/g, '')
               .replace(/§[0-9a-fklmnor]/g, '');
  }

  /**
   * Parse command help output to extract parameters
   */
  private parseCommandHelp(helpText: string): Parameter[] {
    const parameters: Parameter[] = [];
    const stripped = this.stripColors(helpText).trim();
    
    // Remove the command name from the beginning if present
    const syntaxMatch = stripped.match(/^\/?\w+\s+(.*)/);
    const paramString = syntaxMatch ? syntaxMatch[1] : stripped;
    
    // Split into tokens - handle nested brackets/parens
    const tokens = this.tokenizeParameterString(paramString);
    
    tokens.forEach((token, index) => {
      const param = this.parseParameter(token, index);
      if (param) {
        parameters.push(param);
      }
    });
    
    return parameters;
  }

  /**
   * Tokenize parameter string handling nested structures
   */
  private tokenizeParameterString(str: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let depth = 0;
    let inBrackets = false;
    
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      
      if ((char === '<' || char === '[' || char === '(')) {
        if (depth === 0) {
          if (current.trim()) {
            // This is a literal
            tokens.push(current.trim());
            current = '';
          }
          inBrackets = true;
        }
        depth++;
        current += char;
      } else if ((char === '>' || char === ']' || char === ')')) {
        depth--;
        current += char;
        if (depth === 0) {
          tokens.push(current.trim());
          current = '';
          inBrackets = false;
        }
      } else if (char === ' ' && depth === 0 && !inBrackets) {
        if (current.trim()) {
          tokens.push(current.trim());
          current = '';
        }
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      tokens.push(current.trim());
    }
    
    return tokens;
  }

  /**
   * Parse a single parameter token
   */
  private parseParameter(token: string, position: number): Parameter | null {
    // Check for choice list (option1|option2|...)
    if (token.startsWith('(') && token.endsWith(')')) {
      const choicesStr = token.slice(1, -1);
      const choices = choicesStr.split('|').map((choice, idx) => ({
        type: ParameterType.LITERAL,
        literal: choice.trim(),
        optional: false,
        position: idx
      } as Parameter));
      
      return {
        type: ParameterType.CHOICE_LIST,
        choices,
        optional: false,
        position
      };
    }
    
    // Check for optional argument [name] or [<name>]
    if (token.startsWith('[') && token.endsWith(']')) {
      let name = token.slice(1, -1); // Remove [ and ]
      // Also remove inner angle brackets if present
      if (name.startsWith('<') && name.endsWith('>')) {
        name = name.slice(1, -1); // Remove < and >
        return {
          type: ParameterType.ARGUMENT,
          name,
          optional: true,
          position
        };
      }  
      // For [literal] without angle brackets, this could be an optional subcommand
      // Return as LITERAL but we'll handle it specially in loadCommandDetails
      return {
        type: ParameterType.LITERAL,
        literal: name,  // Store WITHOUT the brackets
        optional: true,
        position
      };
    }
    
    // Check for required argument <name>
    if (token.startsWith('<') && token.endsWith('>')) {
      const name = token.slice(1, -1);
      return {
        type: ParameterType.ARGUMENT,
        name,
        optional: false,
        position
      };
    }
    
    // Otherwise it's a literal (could be a subcommand name)
    // We'll determine if it's actually a subcommand later when we see it has members
    return {
      type: ParameterType.LITERAL,
      literal: token,
      optional: false,
      position
    };
  }

  /**
   * Initialize command database
   */
  async initialize(
    onProgress?: (progress: number, message: string) => void,
    forceRefresh: boolean = false
  ): Promise<void> {
    if (this.isLoading) {return;}
    
    this.isLoading = true;
    this.loadingProgress = 0;
    
    try {
      // Try to load from cache first
      if (!forceRefresh && this.loadFromCache()) {
        onProgress?.(100, 'Commands loaded from cache');
        this.isReady = true;
        return;
      }
      
      // Fetch commands from server
      onProgress?.(10, 'Fetching root commands...');
      await this.fetchRootCommands();
      
      // Load details for each command
      const commands = Array.from(this.rootCommands.keys());
      this.output.appendLine(`Loading details for ${commands.length} commands...`);
      
      for (let i = 0; i < commands.length; i++) {
        const progress = 10 + (80 * (i / commands.length));
        onProgress?.(progress, `Loading ${commands[i]}...`);
        
        const node = this.rootCommands.get(commands[i])!;
        try {
          await this.loadCommandDetails(node, node.parameters);
        } catch (error) {
          this.output.appendLine(`Warning: Failed to load details for ${commands[i]}: ${error}`);
          // Continue with other commands even if one fails
        }
      }
      
      // Save to cache
      this.saveToCache();
      onProgress?.(100, 'Commands loaded and cached');
      this.isReady = true;
      
    } catch (error) {
      this.output.appendLine(`Error initializing commands: ${error}`);
      
      // Try to provide basic functionality even if initialization fails
      this.isReady = true; // Mark as ready with whatever we have
      throw error;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Fetch root commands from server
   */
  private async fetchRootCommands(): Promise<void> {
    try {
      this.output.appendLine('Fetching root commands with /help...');
      const response = await this.sendCommand('help');
      
      // Debug: Log response info
      this.output.appendLine(`Help response received: ${response.length} bytes`);
      
      if (!response || response.length === 0) {
        this.output.appendLine('Warning: Empty response from help command');
        // Try alternative help format
        const altResponse = await this.sendCommand('?');
        if (altResponse && altResponse.length > 0) {
          this.output.appendLine('Using alternative help command (?)');
          this.parseHelpResponse(altResponse);
        } else {
          throw new Error('Unable to fetch command list from server');
        }
      } else {
        this.parseHelpResponse(response);
      }
      
    } catch (error) {
      this.output.appendLine(`Error fetching root commands: ${error}`);
      // Provide fallback common commands if help fails
      this.addFallbackCommands();
      throw error;
    }
  }

  /**
   * Parse help response to extract commands
   */
  private parseHelpResponse(response: string): void {
    const lines = response.split('\n');
    this.output.appendLine(`Processing ${lines.length} lines from help response`);
    
    let commandCount = 0;
    for (const line of lines) {
      const stripped = this.stripColors(line).trim();
      
      // Skip empty lines and headers
      if (!stripped || stripped.startsWith('---') || stripped.startsWith('===')) {
        continue;
      }
      
      // Try multiple patterns to match commands
      // Pattern 1: /command (with or without hyphens/underscores)
      // Pattern 2: command: (with or without hyphens/underscores)
      // Pattern 3: - command or * command
      // Pattern 4: just the command name at start of line
      const patterns = [
        /^\/([a-zA-Z0-9_-]+)/,           // /command or /command-with-hyphens
        /^([a-zA-Z0-9_-]+):/,            // command: or command-with-hyphens:
        /^[-*]\s*([a-zA-Z0-9_-]+)/,      // - command or * command
        /^([a-zA-Z0-9_-]+)\s+[-<\[\(]/   // command followed by args
      ];
      
      let matched = false;
      for (const pattern of patterns) {
        const match = stripped.match(pattern);
        if (match) {
          const commandName = match[1];
          
          // Skip common non-command words
          if (['usage', 'help', 'example', 'description', 'syntax'].includes(commandName.toLowerCase())) {
            continue;
          }
          
          // Debug: Log hyphenated commands specifically
          if (commandName.includes('-')) {
            this.output.appendLine(`  Found hyphenated command: ${commandName}`);
          }
          
          // Create root command node
          this.rootCommands.set(commandName, {
            name: commandName,
            parameters: [],
            rawHelp: line,
            isComplete: false
          });
          commandCount++;
          matched = true;
          break;
        }
      }
    }
    
    this.output.appendLine(`Found ${commandCount} root commands`);
    
    // Debug: List all commands with hyphens
    const hyphenatedCommands = Array.from(this.rootCommands.keys()).filter(cmd => cmd.includes('-'));
    if (hyphenatedCommands.length > 0) {
      this.output.appendLine(`Hyphenated commands found: ${hyphenatedCommands.join(', ')}`);
    }
    
    if (commandCount === 0) {
      this.output.appendLine('Warning: No commands found in help response');
      this.output.appendLine('First few lines of response:');
      lines.slice(0, 10).forEach(line => {
        this.output.appendLine(`  > ${this.stripColors(line)}`);
      });
      
      // Add fallback commands
      this.addFallbackCommands();
    }
  }

  /**
   * Add fallback commands if help parsing fails
   */
  private addFallbackCommands(): void {
    this.output.appendLine('Adding common Minecraft commands as fallback...');
    
    const commonCommands = [
      'gamemode', 'give', 'tp', 'teleport', 'kill', 'kick', 'ban', 'pardon',
      'op', 'deop', 'whitelist', 'reload', 'save-all', 'save-on', 'save-off',
      'stop', 'list', 'say', 'tell', 'msg', 'w', 'me', 'trigger', 'scoreboard',
      'effect', 'enchant', 'xp', 'experience', 'clear', 'difficulty', 'gamerule',
      'defaultgamemode', 'setworldspawn', 'spawnpoint', 'time', 'weather', 'worldborder',
      'locate', 'particle', 'playsound', 'stopsound', 'title', 'tellraw', 'help',
      'seed', 'clone', 'fill', 'setblock', 'summon', 'testfor', 'testforblock',
      'testforblocks', 'execute', 'blockdata', 'entitydata', 'replaceitem', 'stats',
      'achievement', 'recipe', 'advancement', 'reload', 'function', 'tag', 'team',
      'bossbar', 'data', 'datapack', 'debug', 'forceload', 'locatebiome', 'loot',
      'publish', 'schedule', 'spreadplayers', 'spectate'
    ];
    
    for (const cmd of commonCommands) {
      if (!this.rootCommands.has(cmd)) {
        this.rootCommands.set(cmd, {
          name: cmd,
          parameters: [],
          rawHelp: `/${cmd}`,
          isComplete: false
        });
      }
    }
    
    this.output.appendLine(`Added ${commonCommands.length} fallback commands`);
  }

  /**
   * Load details for a command or subcommand
   */
  private async loadCommandDetails(parent: CommandNode | Parameter, parameters: Parameter[]): Promise<void> {
    // Build the command path
    let commandPath = '';
    if ('name' in parent && parent.name) {
      commandPath = parent.name;
    } else if ('literal' in parent && parent.literal) {
      commandPath = parent.literal;
    }
    
    try {
      const helpResponse = await this.sendCommand(`help ${commandPath}`);
      
      // Check if we got a valid response
      if (!helpResponse || helpResponse.length === 0) {
        this.output.appendLine(`Empty help response for: ${commandPath}`);
        return;
      }
      
      this.output.appendLine(`Loading details for command: ${commandPath}`);
      const lines = helpResponse.split('\n');
      
      // Track variants of this command (different syntax lines)
      const variants: Map<string, Parameter[]> = new Map();
      let hasDirectParameters = false;
      
      for (const line of lines) {
        const stripped = this.stripColors(line).trim();
        if (!stripped || stripped.startsWith('---')) {continue;}
        
        // Match command pattern - allow hyphens and underscores in names
        // Also handle potential spaces or different formats
        const cmdPatterns = [
          /^\/([a-zA-Z0-9_-]+)(?:\s+(.+))?$/,  // Standard format: /command args
          /^([a-zA-Z0-9_-]+)(?:\s+(.+))?$/,     // Without slash: command args
          /^\/([a-zA-Z0-9_-]+):?\s*(.*)$/       // With optional colon: /command: args
        ];
        
        let match = null;
        for (const pattern of cmdPatterns) {
          match = stripped.match(pattern);
          if (match) {break;}
        }
        
        if (match) {
          const matchedCommand = match[1];
          
          // Normalize command names for comparison (case-insensitive, trim)
          const normalizedMatch = matchedCommand.toLowerCase().trim();
          const normalizedPath = commandPath.toLowerCase().trim();
          
          // Debug output
          this.output.appendLine(`  Checking: "${matchedCommand}" vs "${commandPath}"`);
          
          if (normalizedMatch === normalizedPath) {
            const afterCommand = match[2] || '';
            this.output.appendLine(`  Found match! Parameters: "${afterCommand}"`);
            
            if (afterCommand) {
              // Tokenize everything after the command
              const tokens = this.tokenizeParameterString(afterCommand);
              this.output.appendLine(`  Tokens: ${JSON.stringify(tokens)}`);
              
              if (tokens.length > 0) {
                const firstToken = tokens[0];

                // Determine if first token is a literal/subcommand or an argument
                // FIXED: Better detection for optional subcommands vs optional arguments
                let isArgument = false;
                if (firstToken.startsWith('<')) {
                  // <arg> - required argument
                  isArgument = true;
                } else if (firstToken.startsWith('[') && firstToken.endsWith(']')) {
                  // Could be [<arg>] or [subcommand]
                  const inner = firstToken.slice(1, -1);
                  if (inner.startsWith('<') && inner.endsWith('>')) {
                    // [<arg>] - optional argument
                    isArgument = true;
                  } else {
                    // [subcommand] - optional subcommand, treat as subcommand
                    isArgument = false;
                  }
                } else if (firstToken.startsWith('(') && firstToken.endsWith(')')) {
                  // (choice1|choice2) - choice list, treat as argument
                  isArgument = true;
                }
                
                if (!isArgument) {
                  // First token is a literal/subcommand - this is a subcommand variant
                  let subcommandName = firstToken;
                  
                  // Strip optional brackets if present
                  if (subcommandName.startsWith('[') && subcommandName.endsWith(']')) {
                    subcommandName = subcommandName.slice(1, -1); // Remove [ and ]
                  }
                  
                  // Create parameter list for this variant
                  const variantParams: Parameter[] = [];
                  
                  // Parse remaining tokens as the subcommand's parameters
                  for (let i = 1; i < tokens.length; i++) {
                    const param = this.parseParameter(tokens[i], i - 1);
                    if (param) {
                      variantParams.push(param);
                    }
                  }
                  
                  // Store this variant
                  variants.set(subcommandName, variantParams);
                  
                } else {
                  // First token is an argument - these are direct parameters
                  // IMPORTANT: Parse ALL tokens as parameters for this command
                  hasDirectParameters = true;
                  
                  // Clear and rebuild parameters to ensure we get ALL of them
                  parameters.length = 0; // Clear existing
                  
                  for (let i = 0; i < tokens.length; i++) {
                    const param = this.parseParameter(tokens[i], i);
                    if (param) {
                      parameters.push(param);
                      this.output.appendLine(`    Added parameter: ${JSON.stringify(param)}`);
                    }
                  }
                }
              }
            } else {
              // Command with no parameters
              this.output.appendLine(`  Command has no parameters`);
            }
          }
        }
      }
      
      // Build final parameter structure only if we haven't already set direct parameters
      if (!hasDirectParameters) {
        parameters.length = 0; // Clear existing parameters
        
        // If we have variants (subcommands), create proper structure
        if (variants.size > 0) {
          const subcommandChoices: Parameter[] = [];
          
          for (const [subcommandName, subParams] of variants) {
            // Create a SUBCOMMAND parameter for each variant
            const subcommandParam: Parameter = {
              type: ParameterType.SUBCOMMAND,
              name: subcommandName,
              literal: subcommandName,
              optional: false,
              position: subcommandChoices.length,
              members: subParams,
              isComplete: false
            };
            subcommandChoices.push(subcommandParam);
          }
          
          // If there's only one variant, add it directly
          // Otherwise, create a choice list
          if (subcommandChoices.length === 1) {
            parameters.push(subcommandChoices[0]);
          } else {
            // Create a CHOICE_LIST parameter containing all subcommands
            const choiceParam: Parameter = {
              type: ParameterType.CHOICE_LIST,
              optional: false,
              position: 0,
              choices: subcommandChoices
            };
            parameters.push(choiceParam);
          }
        }
      }
      
      // Debug: Log final parameters
      this.output.appendLine(`  Final parameters for ${commandPath}: ${JSON.stringify(parameters.map(p => ({
        type: p.type,
        name: p.name,
        literal: p.literal,
        optional: p.optional
      })))}`);
      
      // Mark as complete
      if ('isComplete' in parent) {
        parent.isComplete = true;
      }
      
      // Recursively load details for all subcommands
      for (const param of parameters) {
        if (param.type === ParameterType.CHOICE_LIST && param.choices) {
          // For choice lists, recurse into each subcommand choice
          for (const choice of param.choices) {
            if (choice.type === ParameterType.SUBCOMMAND && !choice.isComplete) {
              await this.loadSubcommandDetails(commandPath, choice);
            }
          }
        } else if (param.type === ParameterType.SUBCOMMAND && !param.isComplete) {
          // Direct subcommand parameter
          await this.loadSubcommandDetails(commandPath, param);
        }
      }
      
    } catch (error) {
      this.output.appendLine(`Error loading details for ${commandPath}: ${error}`);
      // Mark as complete even on error to avoid infinite loops
      if ('isComplete' in parent) {
        parent.isComplete = true;
      }
    }
  }

  /**
   * Load details for a subcommand by fetching its help
   */
  private async loadSubcommandDetails(parentPath: string, subcommand: Parameter): Promise<void> {
    if (subcommand.type !== ParameterType.SUBCOMMAND || !subcommand.name) {return;}
    
    // Build the full command path for this subcommand
    const fullPath = `${parentPath} ${subcommand.name}`;
    
    try {
      // Get help for this specific subcommand path
      const helpResponse = await this.sendCommand(`help ${fullPath}`);
      
      // Check for valid response
      if (!helpResponse || helpResponse.length === 0) {
        subcommand.isComplete = true;
        return;
      }
      
      const lines = helpResponse.split('\n');
      
      // Clear existing members to avoid duplicates
      if (!subcommand.members) {
        subcommand.members = [];
      }
      
      // Track variants of this subcommand (different syntax lines)
      const variants: Map<string, Parameter[]> = new Map();
      let hasDirectParameters = false;
      
      // Parse ALL lines to collect ALL variants (not just the first one!)
      for (const line of lines) {
        const stripped = this.stripColors(line).trim();
        if (!stripped || stripped.startsWith('---')) {continue;}
        
        // Look for lines that match this specific subcommand path
        const pattern = new RegExp(`^/${fullPath.replace(' ', '\\s+')}\\s+(.+)$`);
        const match = stripped.match(pattern);
        
        if (match) {
          const afterSubcommand = match[1];
          const tokens = this.tokenizeParameterString(afterSubcommand);
          
          if (tokens.length > 0) {
            const firstToken = tokens[0];
            
            // Determine if first token is a literal/subcommand or an argument
            // FIXED: Better detection for optional subcommands vs optional arguments
            let isArgument = false;
            if (firstToken.startsWith('<')) {
              isArgument = true;
            } else if (firstToken.startsWith('[') && firstToken.endsWith(']')) {
              const inner = firstToken.slice(1, -1);
              if (inner.startsWith('<') && inner.endsWith('>')) {
                isArgument = true;
              } else {
                isArgument = false;
              }
            } else if (firstToken.startsWith('(') && firstToken.endsWith(')')) {
              isArgument = true;
            }
            
            if (!isArgument) {
              // First token is a literal - this is a nested subcommand variant
              let nestedSubcommandName = firstToken;
              
              // Strip optional brackets if present
              if (nestedSubcommandName.startsWith('[') && nestedSubcommandName.endsWith(']')) {
                nestedSubcommandName = nestedSubcommandName.slice(1, -1);
              }
              
              // Create parameter list for this variant
              const variantParams: Parameter[] = [];
              
              // Parse remaining tokens as the nested subcommand's parameters
              for (let i = 1; i < tokens.length; i++) {
                const param = this.parseParameter(tokens[i], i - 1);
                if (param) {
                  variantParams.push(param);
                }
              }
              
              // Store this variant - CONTINUE to find more variants!
              variants.set(nestedSubcommandName, variantParams);
              
            } else {
              // First token is an argument - these are direct parameters
              hasDirectParameters = true;
              
              // Clear and rebuild members for direct parameters
              subcommand.members.length = 0;
              
              // Parse ALL tokens as parameters for this subcommand
              for (let i = 0; i < tokens.length; i++) {
                const param = this.parseParameter(tokens[i], i);
                if (param) {
                  subcommand.members.push(param);
                }
              }
              
              // For direct parameters, we can break after finding them
              break;
            }
          }
        }
      }
      
      // Build final parameter structure
      if (!hasDirectParameters) {
        subcommand.members.length = 0; // Clear existing members
        
        // If we have variants (nested subcommands), create proper structure
        if (variants.size > 0) {
          const nestedSubcommandChoices: Parameter[] = [];
          
          for (const [nestedName, nestedParams] of variants) {
            // Create a SUBCOMMAND parameter for each variant
            const nestedSubcommand: Parameter = {
              type: ParameterType.SUBCOMMAND,
              name: nestedName,
              literal: nestedName,
              optional: false,
              position: nestedSubcommandChoices.length,
              members: nestedParams,
              isComplete: false
            };
            nestedSubcommandChoices.push(nestedSubcommand);
          }
          
          // If there's only one variant, add it directly
          // Otherwise, create a choice list
          if (nestedSubcommandChoices.length === 1) {
            subcommand.members.push(nestedSubcommandChoices[0]);
          } else {
            // Create a CHOICE_LIST parameter containing all nested subcommands
            const choiceParam: Parameter = {
              type: ParameterType.CHOICE_LIST,
              optional: false,
              position: 0,
              choices: nestedSubcommandChoices
            };
            subcommand.members.push(choiceParam);
          }
        }
      }
      
      subcommand.isComplete = true;
      
      // Recursively load any nested subcommands
      if (subcommand.members) {
        for (const member of subcommand.members) {
          if (member.type === ParameterType.CHOICE_LIST && member.choices) {
            // For choice lists, recurse into each subcommand choice
            for (const choice of member.choices) {
              if (choice.type === ParameterType.SUBCOMMAND && !choice.isComplete) {
                await this.loadSubcommandDetails(fullPath, choice);
              }
            }
          } else if (member.type === ParameterType.SUBCOMMAND && !member.isComplete) {
            // Direct subcommand parameter
            await this.loadSubcommandDetails(fullPath, member);
          }
        }
      }
      
    } catch (error) {
      // Subcommand might not have its own help, that's okay
      subcommand.isComplete = true;
    }
  }

  /**
   * Get suggestions based on current input
   */
  getSuggestions(input: string): SuggestionResult {
    if (!this.isReady) {
      return { suggestions: [], argumentHelp: undefined, commandPath: undefined };
    }
    
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return { suggestions: [], argumentHelp: undefined, commandPath: undefined };
    }
    
    const hasTrailingSpace = input.endsWith(' ');
    const parts = trimmed.slice(1).split(' ').filter(p => p.length > 0);
    const commandName = parts[0];
    
    // Handle root command suggestions
    if (parts.length === 0 || (parts.length === 1 && !hasTrailingSpace)) {
      const suggestions = Array.from(this.rootCommands.keys())
        .filter(cmd => cmd.startsWith(commandName || ''))
        .sort();
      return { suggestions, argumentHelp: undefined, commandPath: '/' + (commandName || '') };
    }
    
    // Find the command node
    const rootNode = this.rootCommands.get(commandName);
    if (!rootNode) {
      return { suggestions: [], argumentHelp: undefined, commandPath: '/' + commandName };
    }
    
    // Navigate through the parameter tree
    let currentParameters = rootNode.parameters;
    let commandPath = '/' + commandName;
    let paramIndex = 1; // Start after the command name
    
    // Navigate through completed parts (not including what we're currently typing)
    const partsToNavigate = hasTrailingSpace ? parts.length : parts.length - 1;
    
    while (paramIndex < partsToNavigate && currentParameters.length > 0) {
      const currentPart = parts[paramIndex];
      let navigated = false;
      
      // Get the first parameter at this position
      const firstParam = currentParameters[0];
      
      if (firstParam.type === ParameterType.SUBCOMMAND) {
        // Direct subcommand
        if (firstParam.name === currentPart || firstParam.literal === currentPart) {
          commandPath += ' ' + currentPart;
          currentParameters = firstParam.members || [];
          navigated = true;
        }
      } else if (firstParam.type === ParameterType.CHOICE_LIST && firstParam.choices) {
        // Choice list - find matching choice and navigate into it
        for (const choice of firstParam.choices) {
          if (choice.type === ParameterType.SUBCOMMAND && 
              (choice.name === currentPart || choice.literal === currentPart)) {
            commandPath += ' ' + currentPart;
            // IMPORTANT: Navigate into the selected choice's members
            currentParameters = choice.members || [];
            navigated = true;
            break;
          } else if (choice.type === ParameterType.LITERAL && choice.literal === currentPart) {
            commandPath += ' ' + currentPart;
            // For literal choices, move to next parameter position
            currentParameters = currentParameters.slice(1);
            navigated = true;
            break;
          }
        }
      } else if (firstParam.type === ParameterType.LITERAL && firstParam.literal === currentPart) {
        // Literal parameter
        commandPath += ' ' + currentPart;
        currentParameters = currentParameters.slice(1);
        navigated = true;
      }
      
      paramIndex++;
      if (!navigated) {
        // It's an argument value, skip to next position
        currentParameters = currentParameters.slice(1);
      }
    }
    
    // Build argument help from current position
    const argumentHelp = this.buildArgumentHelp(currentParameters);
    
    // Generate suggestions based on current position
    let suggestions: string[] = [];
    
    if (hasTrailingSpace) {
      // We want suggestions for the NEXT parameter
      suggestions = this.generateSuggestionsForNextPosition(currentParameters);
    } else {
      // We're typing something, get matching suggestions
      const currentPart = parts[parts.length - 1] || '';
      suggestions = this.generateSuggestionsForCurrentPart(currentParameters, currentPart);
    }
    
    return { suggestions, argumentHelp, commandPath };
  }

  /**
   * Generate suggestions for what we're currently typing
   * Must handle CHOICE_LIST parameters properly
   */
  private generateSuggestionsForCurrentPart(
    parameters: Parameter[],
    currentPart: string
  ): string[] {
    const suggestions: string[] = [];
    
    for (const param of parameters) {
      if (param.type === ParameterType.SUBCOMMAND) {
        // Direct subcommand
        const name = param.name || param.literal || '';
        if (name.startsWith(currentPart)) {
          suggestions.push(name);
        }
      } else if (param.type === ParameterType.CHOICE_LIST && param.choices) {
        // Choice list - add all matching choices
        for (const choice of param.choices) {
          if (choice.type === ParameterType.SUBCOMMAND) {
            const name = choice.name || choice.literal || '';
            if (name.startsWith(currentPart)) {
              suggestions.push(name);
            }
          } else if (choice.type === ParameterType.LITERAL) {
            const literal = choice.literal || '';
            if (literal.startsWith(currentPart)) {
              suggestions.push(literal);
            }
          }
        }
      } else if (param.type === ParameterType.LITERAL) {
        const literal = param.literal || '';
        if (literal.startsWith(currentPart)) {
          suggestions.push(literal);
        }
      }
      // We only process the first parameter position
      break;
    }
    
    return suggestions.sort();
  }

  /**
   * Generate suggestions for the next parameter position
   * Must handle CHOICE_LIST parameters properly
   */
  private generateSuggestionsForNextPosition(
    parameters: Parameter[]
  ): string[] {
    const suggestions: string[] = [];
    
    if (parameters.length === 0) {return suggestions;}
    
    const firstParam = parameters[0];
    
    if (firstParam.type === ParameterType.SUBCOMMAND) {
      // Direct subcommand
      suggestions.push(firstParam.name || firstParam.literal || '');
    } else if (firstParam.type === ParameterType.CHOICE_LIST && firstParam.choices) {
      // Choice list - add all choices as suggestions
      for (const choice of firstParam.choices) {
        if (choice.type === ParameterType.SUBCOMMAND) {
          suggestions.push(choice.name || choice.literal || '');
        } else if (choice.type === ParameterType.LITERAL) {
          suggestions.push(choice.literal || '');
        }
      }
    } else if (firstParam.type === ParameterType.LITERAL) {
      suggestions.push(firstParam.literal || '');
    }
    // Don't suggest anything for ARGUMENT types
    
    return suggestions.sort();
  }

  /**
   * Build argument help string from parameters
   */
  private buildArgumentHelp(parameters: Parameter[]): string {
    if (parameters.length === 0) {return '';}
    
    return parameters.map(param => {
      if (param.type === ParameterType.ARGUMENT) {
        return param.optional ? `[<${param.name}>]` : `<${param.name}>`;
      } else if (param.type === ParameterType.CHOICE_LIST && param.choices) {
        const choices = param.choices.map(c => c.literal).join('|');
        return `(${choices})`;
      } else if (param.type === ParameterType.LITERAL) {
        return param.literal;
      } else if (param.type === ParameterType.SUBCOMMAND) {
        return param.name; // Show subcommand name
      }
      return '';
    }).join(' ');
  }

  /**
   * Save commands to cache
   */
  private saveToCache(): void {
    try {
      const cache: CommandCache = {
        version: this.cacheVersion,
        serverIdentifier: this.serverIdentifier,
        lastUpdated: new Date().toISOString(),
        commands: {},
        aliases: {}
      };
      
      // Convert Map to object for serialization
      this.rootCommands.forEach((node, name) => {
        cache.commands[name] = this.serializeNode(node);
      });
      
      this.commandAliases.forEach((target, alias) => {
        cache.aliases[alias] = target;
      });
      
      fs.writeFileSync(this.cacheFile, JSON.stringify(cache, null, 2));
      this.output.appendLine(`Command cache saved to ${this.cacheFile}`);
    } catch (error) {
      this.output.appendLine(`Error saving cache: ${error}`);
    }
  }

  /**
   * Serialize a command node for caching
   */
  private serializeNode(node: CommandNode): SerializedCommandNode {
    return {
      name: node.name,
      parameters: node.parameters, // Parameters are already serializable
      rawHelp: node.rawHelp,
      isComplete: node.isComplete
    };
  }

  /**
   * Load commands from cache
   */
  private loadFromCache(): boolean {
    try {
      if (!fs.existsSync(this.cacheFile)) {
        return false;
      }
      
      const cacheContent = fs.readFileSync(this.cacheFile, 'utf-8');
      const cache: CommandCache = JSON.parse(cacheContent);
      
      // Check cache validity
      if (cache.version !== this.cacheVersion || 
          cache.serverIdentifier !== this.serverIdentifier) {
        this.output.appendLine('Cache version or server mismatch, will refresh');
        return false;
      }
      
      // Check age (optional - could add max age check here)
      const cacheAge = Date.now() - new Date(cache.lastUpdated).getTime();
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
      if (cacheAge > maxAge) {
        this.output.appendLine('Cache too old, will refresh');
        return false;
      }
      
      // Load commands
      this.rootCommands.clear();
      Object.entries(cache.commands).forEach(([name, serialized]) => {
        this.rootCommands.set(name, this.deserializeNode(serialized));
      });
      
      // Load aliases
      this.commandAliases.clear();
      Object.entries(cache.aliases).forEach(([alias, target]) => {
        this.commandAliases.set(alias, target);
      });
      
      this.output.appendLine(`Commands loaded from cache (${this.rootCommands.size} commands)`);
      return true;
      
    } catch (error) {
      this.output.appendLine(`Error loading cache: ${error}`);
      return false;
    }
  }

  /**
   * Deserialize a command node from cache
   */
  private deserializeNode(serialized: SerializedCommandNode): CommandNode {
    return {
      name: serialized.name,
      parameters: serialized.parameters,
      rawHelp: serialized.rawHelp,
      isComplete: serialized.isComplete
    };
  }

  /**
   * Get cache information
   */
  getCacheInfo(): { exists: boolean; age: string; lastUpdated?: Date } {
    try {
      if (!fs.existsSync(this.cacheFile)) {
        return { exists: false, age: 'No cache' };
      }
      
      const stats = fs.statSync(this.cacheFile);
      const ageMs = Date.now() - stats.mtime.getTime();
      
      let age: string;
      if (ageMs < 60000) {
        age = 'Less than a minute';
      } else if (ageMs < 3600000) {
        age = `${Math.floor(ageMs / 60000)} minutes`;
      } else if (ageMs < 86400000) {
        age = `${Math.floor(ageMs / 3600000)} hours`;
      } else {
        age = `${Math.floor(ageMs / 86400000)} days`;
      }
      
      return {
        exists: true,
        age,
        lastUpdated: stats.mtime
      };
    } catch {
      return { exists: false, age: 'Error checking cache' };
    }
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    try {
      if (fs.existsSync(this.cacheFile)) {
        fs.unlinkSync(this.cacheFile);
        this.output.appendLine('Command cache cleared');
      }
    } catch (error) {
      this.output.appendLine(`Error clearing cache: ${error}`);
    }
  }
}