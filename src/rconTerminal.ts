import * as vscode from 'vscode';
import { RconController } from './rconClient';
import { CommandAutocomplete } from './commandAutocomplete';

export class RconTerminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  onDidWrite: vscode.Event<string> = this.writeEmitter.event;

  private closeEmitter = new vscode.EventEmitter<number>();
  onDidClose: vscode.Event<number> = this.closeEmitter.event;

  public controller: RconController;
  private currentLine: string = '';
  private cursorPosition: number = 0;
  
  // Text selection
  private selectionStart: number = -1;
  private selectionEnd: number = -1;
  
  // Command history
  private history: string[] = [];
  private historyIndex: number = -1;
  private tempLine: string = '';

  // Connection info for reconnection
  private host: string;
  private port: number;
  private password: string;
  private output: vscode.OutputChannel;
  private isConnected: boolean = true;
  private isReconnecting: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 2000;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isExecutingCommand: boolean = false;

  // Autocomplete system
  private autocomplete: CommandAutocomplete;
  private currentSuggestions: string[] = [];
  private suggestionIndex: number = -1;
  private isShowingSuggestions: boolean = false;
  private originalInput: string = '';
  private currentArgumentHelp: string = '';
  private previousCommand: string = '';
  private currentCommandPath: string = '';  // NEW: Track the determined command path
  
  // Cache for full argument patterns per command
  private commandArgumentCache: Map<string, string> = new Map();
  
  // Tab mode tracking for Minecraft-style autocomplete
  private tabMode: boolean = false;
  private lastTabTime: number = 0;
  private suggestionListLines: number = 0;
  
  // Paging for suggestions
  private visibleSuggestionsStart: number = 0;
  private maxVisibleSuggestions: number = 10;
  private currentPage: number = 1;
  
  // Extension context for caching
  private context: vscode.ExtensionContext;
  
  private get totalPages(): number {
    return Math.ceil(this.currentSuggestions.length / this.maxVisibleSuggestions);
  }

  constructor(
    controller: RconController, 
    host: string, 
    port: number, 
    password: string, 
    output: vscode.OutputChannel,
    context: vscode.ExtensionContext
  ) {
    this.controller = controller;
    this.host = host;
    this.port = port;
    this.password = password;
    this.output = output;
    this.context = context;
    
    // Initialize autocomplete with all required parameters
    this.autocomplete = new CommandAutocomplete(
      async (cmd) => {
        const result = await this.controller.send(cmd);
        return result ?? '';
      },
      output,
      context,
      host,
      port
    );
  }

  open(initialDimensions: vscode.TerminalDimensions | undefined): void {
    this.writeEmitter.fire('\x1b[1;36mMinecraft RCON Terminal\x1b[0m\r\n');
    this.writeEmitter.fire('Connected to \x1b[33m' + this.host + ':' + this.port + '\x1b[0m\r\n\r\n');
    this.writeEmitter.fire('\x1b[2mUseful shortcuts:\x1b[0m\r\n');
    this.writeEmitter.fire('  \x1b[2mTab: Autocomplete commands\x1b[0m\r\n');
    this.writeEmitter.fire('  \x1b[2mCtrl+L: Clear screen  |  Ctrl+C: Cancel input\x1b[0m\r\n');
    this.writeEmitter.fire('  \x1b[2mUp/Down: Command history  |  Esc: Clear line\x1b[0m\r\n\r\n');
    
    // Initialize commands in background
    this.initializeCommands();
    
  }

  private async initializeCommands(forceRefresh: boolean = false): Promise<void> {
    const cacheInfo = this.autocomplete.getCacheInfo();
    
    // Determine if we'll be loading from cache
    const willLoadFromCache = !forceRefresh && cacheInfo.exists;
    
    if (!willLoadFromCache) {
      const reason = forceRefresh ? 'Forcing refresh...' : 
                     !cacheInfo.exists ? 'No cache found...' : 
                     'Cache outdated...';
      this.writeEmitter.fire('\r\n\x1b[33mLoading server commands (' + reason + ')\x1b[0m\r\n');
    }
    
    try {
      await this.autocomplete.initialize((progress, message) => {
        // If loading from cache, just show the success message when complete
        if (willLoadFromCache) {
          if (progress >= 100) {
            this.writeEmitter.fire('\r\n\x1b[32m✓ Commands loaded from cache!\x1b[0m\r\n\r\n');
            this.showPrompt();
          }
          return; // Skip all progress bar rendering
        }
        
        // Only show progress bar when NOT loading from cache
        // Clear previous line
        this.writeEmitter.fire('\r\x1b[K');
        
        // Draw progress bar
        const barWidth = 30;
        const filled = Math.round((progress / 100) * barWidth);
        const empty = barWidth - filled;
        
        let progressBar = '\x1b[33m[';
        progressBar += '█'.repeat(filled);
        progressBar += '░'.repeat(empty);
        progressBar += '] ';
        progressBar += Math.round(progress) + '%\x1b[0m';
        
        // Show current phase in gray
        let phase = '';
        if (message.includes('Fetching')) {
          phase = ' Fetching commands...';
        } else if (message.includes('Loading')) {
          phase = ' Processing subcommands...';
        } else if (message.includes('Complete') || message.includes('loaded')) {
          phase = ' Complete!';
        }
        
        this.writeEmitter.fire(progressBar + '\x1b[90m' + phase + '\x1b[0m');
        
        if (progress >= 100) {
          this.writeEmitter.fire('\r\n');
          this.writeEmitter.fire('\x1b[32m✓ Commands loaded and cached!\x1b[0m\r\n\r\n');
          this.showPrompt();
        }
      }, forceRefresh);
    } catch (error) {
      this.writeEmitter.fire('\r\n\x1b[31m✗ Failed to load commands: ' + error + '\x1b[0m\r\n');
      this.writeEmitter.fire('\x1b[33mAutocomplete will be limited.\x1b[0m\r\n\r\n');
      this.showPrompt();
    }
  }


  close(): void {
    // Clear any pending reconnect timeouts
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    // Disconnect controller
    try {
      this.controller.disconnect();
    } catch (err) {
      this.output.appendLine(`Error during close: ${err}`);
    }
  }

  private showPrompt(): void {
    if (this.isExecutingCommand) {
      return; // Don't show prompt while executing
    }
    
    if (this.isReconnecting) {
      this.writeEmitter.fire('\x1b[33m[reconnecting]\x1b[0m > ');
    } else if (!this.isConnected) {
      this.writeEmitter.fire('\x1b[31m[disconnected]\x1b[0m > ');
    } else {
      this.writeEmitter.fire('\x1b[32m>\x1b[0m ');
    }
  }

  private hasSelection(): boolean {
    return this.selectionStart !== -1 && this.selectionEnd !== -1 && this.selectionStart !== this.selectionEnd;
  }

  private clearSelection(): void {
    this.selectionStart = -1;
    this.selectionEnd = -1;
  }

  private getSelectedText(): string {
    if (!this.hasSelection()) {return '';}
    const start = Math.min(this.selectionStart, this.selectionEnd);
    const end = Math.max(this.selectionStart, this.selectionEnd);
    return this.currentLine.slice(start, end);
  }

  private deleteSelection(): void {
    if (!this.hasSelection()) {return;}
    const start = Math.min(this.selectionStart, this.selectionEnd);
    const end = Math.max(this.selectionStart, this.selectionEnd);
    
    this.currentLine = this.currentLine.slice(0, start) + this.currentLine.slice(end);
    this.cursorPosition = start;
    this.clearSelection();
  }

  handleInput(data: string): void {
    // Prevent input during command execution
    if (this.isExecutingCommand) {
      return;
    }

    // Handle Tab for autocomplete
    if (data === '\t') {
      this.handleTabComplete();
      return;
    }
    
    // Handle Shift+Tab for reverse cycling
    if (data === '\x1b[Z') {
      this.handleShiftTab();
      return;
    }

    // Handle Escape - cancel autocomplete or clear line
    if (data === '\x1b') {
      if (this.isShowingSuggestions) {
        // Restore original input if in tab mode
        if (this.tabMode && this.originalInput) {
          this.currentLine = this.originalInput;
          this.cursorPosition = this.originalInput.length;
          this.writeEmitter.fire('\r\x1b[K');
          this.showPrompt();
          this.writeEmitter.fire(this.currentLine);
        }
        this.hideSuggestions();
        return;
      } else if (data.length === 1) {
        this.clearAndResetLine();
        this.showPrompt();
        return;
      }
    }

    // Handle Ctrl+D (disconnect)
    if (data === '\x04') {
      this.handleDisconnect();
      return;
    }

    // Handle Ctrl+A (select all)
    if (data === '\x01') {
      if (this.currentLine.length > 0) {
        this.selectionStart = 0;
        this.selectionEnd = this.currentLine.length;
        this.cursorPosition = this.currentLine.length;
        this.redrawLineWithSelection();
      }
      return;
    }

    // Handle Ctrl+C (copy selected text or cancel current input)
    if (data === '\x03') {
      if (this.hasSelection()) {
        vscode.env.clipboard.writeText(this.getSelectedText());
        this.clearSelection();
        this.redrawLineWithSelection();
      } else if (this.currentLine.length > 0) {
        // Cancel current input
        this.writeEmitter.fire('^C\r\n');
        this.clearAndResetLine();
        this.showPrompt();
      }
      return;
    }

    // Handle Ctrl+X (cut selected text)
    if (data === '\x18') {
      if (this.hasSelection()) {
        const selectedText = this.getSelectedText();
        vscode.env.clipboard.writeText(selectedText);
        
        // Delete the selection
        const start = Math.min(this.selectionStart, this.selectionEnd);
        const end = Math.max(this.selectionStart, this.selectionEnd);
        
        this.currentLine = this.currentLine.slice(0, start) + this.currentLine.slice(end);
        this.cursorPosition = start;
        this.clearSelection();
        
        // Redraw the entire line
        this.writeEmitter.fire('\r\x1b[K');
        this.showPrompt();
        this.writeEmitter.fire(this.currentLine);
        
        // Position cursor
        const moveBack = this.currentLine.length - this.cursorPosition;
        if (moveBack > 0) {
          this.writeEmitter.fire('\x1b[' + moveBack + 'D');
        }
      }
      return;
    }

    // Handle Ctrl+V (paste)
    if (data === '\x16') {
      vscode.env.clipboard.readText().then(text => {
        if (text) {
          this.insertText(text);
        }
      });
      return;
    }

    // Handle Ctrl+L (clear screen)
    if (data === '\x0c') {
      this.writeEmitter.fire('\x1b[2J\x1b[H');
      this.writeEmitter.fire('\x1b[1;36mMinecraft RCON Terminal\x1b[0m\r\n');
      this.writeEmitter.fire('Connected to \x1b[33m' + this.host + ':' + this.port + '\x1b[0m\r\n\r\n');
      this.writeEmitter.fire('\x1b[2mUseful shortcuts:\x1b[0m\r\n');
      this.writeEmitter.fire('  \x1b[2mTab: Autocomplete commands\x1b[0m\r\n');
      this.writeEmitter.fire('  \x1b[2mCtrl+L: Clear screen  |  Ctrl+C: Cancel input\x1b[0m\r\n');
      this.writeEmitter.fire('  \x1b[2mUp/Down: Command history  |  Esc: Clear line\x1b[0m\r\n\r\n');
      this.showPrompt();
      this.writeEmitter.fire(this.currentLine);
      // Position cursor correctly
      if (this.cursorPosition < this.currentLine.length) {
        const moveBack = this.currentLine.length - this.cursorPosition;
        this.writeEmitter.fire('\x1b[' + moveBack + 'D');
      }
      return;
    }

    // Handle Up Arrow
    if (data === '\x1b[A') {
      if (this.isShowingSuggestions) {
        // Navigate suggestions instead of history
        this.navigateSuggestions('up');
        return;
      }
      // Normal history navigation
      if (this.hasSelection()) {
        this.clearSelection();
        this.redrawLineWithSelection();
      }
      this.navigateHistory('up');
      return;
    }

    // Handle Down Arrow
    if (data === '\x1b[B') {
      if (this.isShowingSuggestions) {
        // Navigate suggestions instead of history
        this.navigateSuggestions('down');
        return;
      }
      // Normal history navigation
      if (this.hasSelection()) {
        this.clearSelection();
        this.redrawLineWithSelection();
      }
      this.navigateHistory('down');
      return;
    }
    
    // Handle Page Up for suggestion paging
    if (data === '\x1b[5~') {
      if (this.isShowingSuggestions && this.totalPages > 1) {
        this.previousPage();
        return;
      }
    }
    
    // Handle Page Down for suggestion paging  
    if (data === '\x1b[6~') {
      if (this.isShowingSuggestions && this.totalPages > 1) {
        this.nextPage();
        return;
      }
    }

    // Handle Shift+Left Arrow
    if (data === '\x1b[1;2D') {
      if (this.cursorPosition > 0) {
        if (!this.hasSelection()) {
          this.selectionStart = this.cursorPosition;
          this.selectionEnd = this.cursorPosition;
        }
        this.cursorPosition--;
        this.selectionEnd = this.cursorPosition;
        this.redrawLineWithSelection();
      }
      return;
    }

    // Handle Shift+Right Arrow
    if (data === '\x1b[1;2C') {
      if (this.cursorPosition < this.currentLine.length) {
        if (!this.hasSelection()) {
          this.selectionStart = this.cursorPosition;
          this.selectionEnd = this.cursorPosition;
        }
        this.cursorPosition++;
        this.selectionEnd = this.cursorPosition;
        this.redrawLineWithSelection();
      }
      return;
    }

    // Handle Ctrl+Left Arrow (jump word left)
    if (data === '\x1b[1;5D' || data === '\x1b[5D') {
      const newPos = this.findWordLeft();
      if (newPos !== this.cursorPosition) {
        const hadSelection = this.hasSelection();
        this.clearSelection();
        this.cursorPosition = newPos;
        this.redrawLineWithSelection();
      }
      return;
    }

    // Handle Ctrl+Right Arrow (jump word right)
    if (data === '\x1b[1;5C' || data === '\x1b[5C') {
      const newPos = this.findWordRight();
      if (newPos !== this.cursorPosition) {
        const hadSelection = this.hasSelection();
        this.clearSelection();
        this.cursorPosition = newPos;
        this.redrawLineWithSelection();
      }
      return;
    }

    // Handle Ctrl+Shift+Left Arrow (select word left)
    if (data === '\x1b[1;6D') {
      if (!this.hasSelection()) {
        this.selectionStart = this.cursorPosition;
        this.selectionEnd = this.cursorPosition;
      }
      this.cursorPosition = this.findWordLeft();
      this.selectionEnd = this.cursorPosition;
      this.redrawLineWithSelection();
      return;
    }

    // Handle Ctrl+Shift+Right Arrow (select word right)
    if (data === '\x1b[1;6C') {
      if (!this.hasSelection()) {
        this.selectionStart = this.cursorPosition;
        this.selectionEnd = this.cursorPosition;
      }
      this.cursorPosition = this.findWordRight();
      this.selectionEnd = this.cursorPosition;
      this.redrawLineWithSelection();
      return;
    }

    // Handle Shift+Home
    if (data === '\x1b[1;2H' || data === '\x1b[1;2~') {
      if (this.cursorPosition > 0) {
        if (!this.hasSelection()) {
          this.selectionStart = this.cursorPosition;
          this.selectionEnd = this.cursorPosition;
        }
        this.cursorPosition = 0;
        this.selectionEnd = 0;
        this.redrawLineWithSelection();
      }
      return;
    }

    // Handle Shift+End
    if (data === '\x1b[1;2F' || data === '\x1b[1;2$') {
      if (this.cursorPosition < this.currentLine.length) {
        if (!this.hasSelection()) {
          this.selectionStart = this.cursorPosition;
          this.selectionEnd = this.cursorPosition;
        }
        this.cursorPosition = this.currentLine.length;
        this.selectionEnd = this.currentLine.length;
        this.redrawLineWithSelection();
      }
      return;
    }

    // Handle Left Arrow (normal)
    if (data === '\x1b[D') {
      const hadSelection = this.hasSelection();
      if (hadSelection) {
        this.clearSelection();
      }
      
      if (this.cursorPosition > 0) {
        this.cursorPosition--;
        if (hadSelection) {
          // Need to redraw to clear selection highlighting
          this.redrawLineWithSelection();
        } else {
          // Just move cursor left
          this.writeEmitter.fire('\x1b[D');
        }
      } else if (hadSelection) {
        // At start but had selection, need to redraw
        this.redrawLineWithSelection();
      }
      return;
    }

    // Handle Right Arrow
    if (data === '\x1b[C') {
      // Normal right arrow behavior
      const hadSelection = this.hasSelection();
      if (hadSelection) {
        this.clearSelection();
      }
      
      if (this.cursorPosition < this.currentLine.length) {
        this.cursorPosition++;
        if (hadSelection) {
          this.redrawLineWithSelection();
        } else {
          this.writeEmitter.fire('\x1b[C');
        }
      } else if (hadSelection) {
        this.redrawLineWithSelection();
      }
      return;
    }

    // Handle Home (normal)
    if (data === '\x1b[H' || data === '\x1bOH' || data === '\x1b[1~') {
      // If suggestions are showing, jump to first suggestion
      if (this.isShowingSuggestions) {
        this.jumpToFirstSuggestion();
        return;
      }
      
      const hadSelection = this.hasSelection();
      this.clearSelection();
      if (this.cursorPosition > 0) {
        this.cursorPosition = 0;
        if (hadSelection) {
          this.redrawLineWithSelection();
        } else {
          this.writeEmitter.fire('\r');
          this.showPrompt();
          this.writeEmitter.fire(this.currentLine);
          const moveBack = this.currentLine.length;
          if (moveBack > 0) {
            this.writeEmitter.fire('\x1b[' + moveBack + 'D');
          }
        }
      } else if (hadSelection) {
        this.redrawLineWithSelection();
      }
      return;
    }

    // Handle End (normal) - Fixed: removed \x05 which is Ctrl+E
    if (data === '\x1b[F' || data === '\x1bOF' || data === '\x1b[4~') {
      // If suggestions are showing, jump to last suggestion
      if (this.isShowingSuggestions) {
        this.jumpToLastSuggestion();
        return;
      }
      
      const hadSelection = this.hasSelection();
      this.clearSelection();
      const moveForward = this.currentLine.length - this.cursorPosition;
      if (moveForward > 0) {
        this.cursorPosition = this.currentLine.length;
        if (hadSelection) {
          this.redrawLineWithSelection();
        } else {
          this.writeEmitter.fire('\x1b[' + moveForward + 'C');
        }
      } else if (hadSelection) {
        this.redrawLineWithSelection();
      }
      return;
    }

    // Handle Delete key
    if (data === '\x1b[3~') {
      if (this.hasSelection()) {
        this.deleteSelection();
        this.redrawLineWithSelection();
      } else if (this.cursorPosition < this.currentLine.length) {
        this.currentLine = this.currentLine.slice(0, this.cursorPosition) + 
                          this.currentLine.slice(this.cursorPosition + 1);
        const restOfLine = this.currentLine.slice(this.cursorPosition);
        this.writeEmitter.fire(restOfLine + ' ');
        if (restOfLine.length + 1 > 0) {
          this.writeEmitter.fire('\x1b[' + (restOfLine.length + 1) + 'D');
        }
      }
      return;
    }

    // Handle Ctrl+K (delete from cursor to end)
    if (data === '\x0b') {
      if (this.cursorPosition < this.currentLine.length) {
        this.currentLine = this.currentLine.slice(0, this.cursorPosition);
        this.writeEmitter.fire('\x1b[K');
        this.clearSelection();
      }
      return;
    }

    // Handle Ctrl+U (delete entire line)
    if (data === '\x15') {
      this.clearAndResetLine();
      this.showPrompt();
      return;
    }

    // Handle Ctrl+W (delete word backwards)
    if (data === '\x17') {
      if (this.cursorPosition > 0) {
        const beforeCursor = this.currentLine.slice(0, this.cursorPosition);
        const afterCursor = this.currentLine.slice(this.cursorPosition);
        
        // Find the last word boundary
        let newPos = this.cursorPosition - 1;
        // Skip trailing spaces
        while (newPos > 0 && beforeCursor[newPos] === ' ') {
          newPos--;
        }
        // Skip word characters
        while (newPos > 0 && beforeCursor[newPos - 1] !== ' ') {
          newPos--;
        }
        
        const deletedCount = this.cursorPosition - newPos;
        this.currentLine = beforeCursor.slice(0, newPos) + afterCursor;
        this.cursorPosition = newPos;
        this.clearSelection();
        
        // Redraw the line
        this.writeEmitter.fire('\x1b[' + deletedCount + 'D');
        this.writeEmitter.fire('\x1b[K');
        this.writeEmitter.fire(afterCursor);
        if (afterCursor.length > 0) {
          this.writeEmitter.fire('\x1b[' + afterCursor.length + 'D');
        }
      }
      return;
    }

    // Handle Enter
    if (data === '\r' || data === '\n') {
      this.handleEnter();
      return;
    }

    // Handle Backspace
    if (data === '\x7f' || data === '\b') {
      this.handleBackspace();
      return;
    }

    // Ignore other control characters except tab
    if (data.charCodeAt(0) < 32 && data !== '\t') {
      return;
    }

    // Regular character input
    this.insertText(data);
  }

  private handleTabComplete(): void {
    if (!this.autocomplete.isReady) {return;}

    const now = Date.now();
    const timeSinceLastTab = now - this.lastTabTime;
    this.lastTabTime = now;

    // First tab press or tab after delay - complete the selected suggestion
    if (!this.tabMode || timeSinceLastTab > 500) {
      if (!this.isShowingSuggestions) {
        // Initialize suggestions
        const result = this.autocomplete.getSuggestions(this.currentLine);
        if (result.suggestions.length === 0) {return;}
        
        this.currentSuggestions = result.suggestions;
        this.isShowingSuggestions = true;
        this.suggestionIndex = 0;
        this.originalInput = this.currentLine;
      }
      
      // Enter tab mode and complete first suggestion
      this.tabMode = true;
      this.completeSelectedSuggestion();
    } else {
      // Subsequent tab - cycle and complete next suggestion
      this.suggestionIndex = (this.suggestionIndex + 1) % this.currentSuggestions.length;
      this.completeSelectedSuggestion();
    }
    
    // Update the list display
    this.showSuggestionList();
  }

  private handleShiftTab(): void {
    if (!this.autocomplete.isReady) {return;}
    
    const now = Date.now();
    this.lastTabTime = now;
    
    if (!this.isShowingSuggestions) {
      // Initialize suggestions
      const result = this.autocomplete.getSuggestions(this.currentLine);
      if (result.suggestions.length === 0) {return;}
      
      this.currentSuggestions = result.suggestions;
      this.isShowingSuggestions = true;
      this.suggestionIndex = result.suggestions.length - 1; // Start from end
      this.originalInput = this.currentLine;
      this.tabMode = true;
      this.completeSelectedSuggestion();
    } else {
      // Reverse cycle
      this.tabMode = true;
      this.suggestionIndex--;
      if (this.suggestionIndex < 0) {
        this.suggestionIndex = this.currentSuggestions.length - 1;
      }
      this.completeSelectedSuggestion();
    }
    
    this.showSuggestionList();
  }

  private completeSelectedSuggestion(): void {
    if (!this.isShowingSuggestions || this.suggestionIndex < 0) {return;}
    
    const suggestion = this.currentSuggestions[this.suggestionIndex];
    
    // Apply the suggestion to the input
    const parts = this.originalInput.split(' ');
    
    if (this.originalInput.endsWith(' ')) {
      this.currentLine = this.originalInput + suggestion;
    } else if (parts.length > 0) {
      const lastPart = parts[parts.length - 1];
      if (lastPart.startsWith('/')) {
        parts[parts.length - 1] = '/' + suggestion;
      } else {
        parts[parts.length - 1] = suggestion;
      }
      this.currentLine = parts.join(' ');
    } else {
      this.currentLine = '/' + suggestion;
    }
    
    this.cursorPosition = this.currentLine.length;
    
    // Redraw the line
    this.writeEmitter.fire('\r\x1b[K');
    this.showPrompt();
    this.writeEmitter.fire(this.currentLine);
  }

  private showInlineSuggestions(): void {
    if (!this.autocomplete.isReady) {return;}

    // Get suggestions for current input
    const result = this.autocomplete.getSuggestions(this.currentLine);
    
    // Store the command path from the result
    this.currentCommandPath = result.commandPath || '';
    
    // Extract the command name from the current line
    const commandMatch = this.currentLine.match(/^(\/?\w+)/);
    const commandName = commandMatch ? commandMatch[1] : '';
    
    // Check if we switched to a different command
    if (commandName !== this.previousCommand) {
      this.commandArgumentCache.delete(this.previousCommand); // Clear old cache
      this.currentArgumentHelp = ''; // Clear help when switching commands
      this.previousCommand = commandName;
    }
    
    // Store filtered suggestions
    this.currentSuggestions = result.suggestions;
    
    // Clear previous display
    this.clearSuggestionDisplay();
    
    if (result.suggestions.length === 0) {
      this.isShowingSuggestions = false;
      
      // Handle argument help
      if (result.argumentHelp) {
        // Store the FULL argument help if this is the first time we see it for this command
        // This is the key fix - we cache the full argument list per command
        if (!this.commandArgumentCache.has(commandName)) {
          this.commandArgumentCache.set(commandName, result.argumentHelp);
        }
        // Always use the cached full version if available
        this.currentArgumentHelp = this.commandArgumentCache.get(commandName) || result.argumentHelp;
        
        this.showArgumentsInList();
      } else {
        // Try to use cached argument help for this command
        const cachedHelp = this.commandArgumentCache.get(commandName);
        if (cachedHelp) {
          this.currentArgumentHelp = cachedHelp;
          this.showArgumentsInList();
        } else {
          // No argument help at all
          this.clearArgumentDisplay();
        }
      }
      return;
    }

    // Show suggestions
    this.isShowingSuggestions = true;
    
    // Default to first item selected (index 0)
    if (this.suggestionIndex < 0 || this.suggestionIndex >= result.suggestions.length) {
      this.suggestionIndex = 0;
    }
    
    // Reset paging to show the selected item
    this.visibleSuggestionsStart = 0;
    this.currentPage = 1;
    
    // Store original input if not in tab mode
    if (!this.tabMode) {
      this.originalInput = this.currentLine;
    }
    
    // Show the list below
    this.showSuggestionList();
  }

  private showSuggestionList(): void {
    if (!this.isShowingSuggestions || this.currentSuggestions.length === 0) return;
    
    // Calculate the visible window based on the selected index
    this.updateVisibleWindow();
    
    // Save cursor position
    this.writeEmitter.fire('\x1b7');
    
    // Clear old list area
    for (let i = 0; i < this.suggestionListLines; i++) {
      this.writeEmitter.fire('\r\n\x1b[K');
    }
    if (this.suggestionListLines > 0) {
      this.writeEmitter.fire(`\x1b[${this.suggestionListLines}A`);
    }
    
    // Move to next line for list
    this.writeEmitter.fire('\r\n');
    
    let lineCount = 1;
    
    // Show indicator if there are items above the visible window
    if (this.visibleSuggestionsStart > 0) {
      this.writeEmitter.fire('\x1b[90m  ▲ (' + this.visibleSuggestionsStart + ' more above)\x1b[0m\r\n');
      lineCount++;
    }
    
    // Show visible suggestions in vertical list
    const visibleEnd = Math.min(
      this.visibleSuggestionsStart + this.maxVisibleSuggestions,
      this.currentSuggestions.length
    );
    
    for (let i = this.visibleSuggestionsStart; i < visibleEnd; i++) {
      // Show selection indicator and item
      if (i === this.suggestionIndex) {
        // Yellow for selected item with arrow indicator
        this.writeEmitter.fire('\x1b[93m→ ' + this.currentSuggestions[i] + '\x1b[0m\r\n');
      } else {
        // Gray for other items with space for alignment
        this.writeEmitter.fire('\x1b[90m  ' + this.currentSuggestions[i] + '\x1b[0m\r\n');
      }
      lineCount++;
    }
    
    // Show indicator if there are items below the visible window
    if (visibleEnd < this.currentSuggestions.length) {
      const remaining = this.currentSuggestions.length - visibleEnd;
      this.writeEmitter.fire('\x1b[90m  ▼ (' + remaining + ' more below)\x1b[0m\r\n');
      lineCount++;
    }
    
    // Show current position and page indicator at bottom
    this.writeEmitter.fire('\x1b[90m  [' + (this.suggestionIndex + 1) + '/' + this.currentSuggestions.length + '] ');
    this.writeEmitter.fire('Page ' + this.currentPage + '/' + this.totalPages + '\x1b[0m');
    
    this.suggestionListLines = lineCount;
    
    // Restore cursor position
    this.writeEmitter.fire('\x1b8');
  }
  
  private updateVisibleWindow(): void {
    // Keep a buffer of 2 items above and below the selected item when possible
    const buffer = 2;
    
    // Calculate which page the selected item is on
    const selectedPage = Math.floor(this.suggestionIndex / this.maxVisibleSuggestions) + 1;
    
    // Update current page if it changed
    if (selectedPage !== this.currentPage) {
      this.currentPage = selectedPage;
    }
    
    // Calculate ideal window position
    let idealStart = this.suggestionIndex - buffer;
    let idealEnd = this.suggestionIndex + buffer + 1;
    
    // Adjust if we're near the boundaries
    if (idealStart < 0) {
      idealStart = 0;
      idealEnd = Math.min(this.maxVisibleSuggestions, this.currentSuggestions.length);
    } else if (idealEnd > this.currentSuggestions.length) {
      idealEnd = this.currentSuggestions.length;
      idealStart = Math.max(0, idealEnd - this.maxVisibleSuggestions);
    }
    
    // Update the visible window
    if (this.suggestionIndex < this.visibleSuggestionsStart + buffer) {
      // Scrolling up
      this.visibleSuggestionsStart = Math.max(0, this.suggestionIndex - buffer);
    } else if (this.suggestionIndex >= this.visibleSuggestionsStart + this.maxVisibleSuggestions - buffer) {
      // Scrolling down
      this.visibleSuggestionsStart = Math.min(
        this.suggestionIndex - this.maxVisibleSuggestions + buffer + 1,
        Math.max(0, this.currentSuggestions.length - this.maxVisibleSuggestions)
      );
    }
    
    // Final boundary check
    this.visibleSuggestionsStart = Math.max(0, this.visibleSuggestionsStart);
    this.visibleSuggestionsStart = Math.min(
      this.visibleSuggestionsStart,
      Math.max(0, this.currentSuggestions.length - this.maxVisibleSuggestions)
    );
  }

  private clearSuggestionDisplay(): void {
    // Clear the suggestion list area
    if (this.suggestionListLines > 0) {
      this.writeEmitter.fire('\x1b7'); // Save cursor
      this.writeEmitter.fire('\r\n');
      for (let i = 0; i < this.suggestionListLines; i++) {
        this.writeEmitter.fire('\x1b[K');
        if (i < this.suggestionListLines - 1) {
          this.writeEmitter.fire('\r\n');
        }
      }
      this.writeEmitter.fire(`\x1b[${this.suggestionListLines}A`);
      this.writeEmitter.fire('\x1b8'); // Restore cursor
      this.suggestionListLines = 0;
    }
  }

  private navigateSuggestions(direction: 'up' | 'down'): void {
    if (!this.isShowingSuggestions || this.currentSuggestions.length === 0) {return;}
    
    // Arrow keys don't enter tab mode and don't complete
    this.tabMode = false;
    
    if (direction === 'up') {
      this.suggestionIndex--;
      if (this.suggestionIndex < 0) {
        this.suggestionIndex = this.currentSuggestions.length - 1;
      }
    } else {
      this.suggestionIndex++;
      if (this.suggestionIndex >= this.currentSuggestions.length) {
        this.suggestionIndex = 0;
      }
    }
    
    // Just update the list display, don't change input
    this.showSuggestionList();
  }
  
  private jumpToFirstSuggestion(): void {
    if (!this.isShowingSuggestions || this.currentSuggestions.length === 0) {return;}
    
    this.tabMode = false;
    this.suggestionIndex = 0;
    this.currentPage = 1;
    this.visibleSuggestionsStart = 0;
    this.showSuggestionList();
  }
  
  private jumpToLastSuggestion(): void {
    if (!this.isShowingSuggestions || this.currentSuggestions.length === 0) {return;}
    
    this.tabMode = false;
    this.suggestionIndex = this.currentSuggestions.length - 1;
    this.currentPage = this.totalPages;
    this.visibleSuggestionsStart = (this.currentPage - 1) * this.maxVisibleSuggestions;
    this.showSuggestionList();
  }
  
  private nextPage(): void {
    if (!this.isShowingSuggestions || this.currentSuggestions.length === 0) {return;}
    
    this.tabMode = false;
    
    // Calculate the next page
    const nextPageStart = this.currentPage * this.maxVisibleSuggestions;
    
    if (nextPageStart < this.currentSuggestions.length) {
      this.currentPage++;
      this.visibleSuggestionsStart = nextPageStart;
      this.suggestionIndex = nextPageStart;
      this.showSuggestionList();
    } else {
      // Wrap to first page
      this.currentPage = 1;
      this.visibleSuggestionsStart = 0;
      this.suggestionIndex = 0;
      this.showSuggestionList();
    }
  }
  
  private previousPage(): void {
    if (!this.isShowingSuggestions || this.currentSuggestions.length === 0) {return;}
    
    this.tabMode = false;
    
    if (this.currentPage > 1) {
      this.currentPage--;
      this.visibleSuggestionsStart = (this.currentPage - 1) * this.maxVisibleSuggestions;
      this.suggestionIndex = this.visibleSuggestionsStart;
      this.showSuggestionList();
    } else {
      // Wrap to last page
      this.currentPage = this.totalPages;
      this.visibleSuggestionsStart = (this.currentPage - 1) * this.maxVisibleSuggestions;
      this.suggestionIndex = this.visibleSuggestionsStart;
      this.showSuggestionList();
    }
  }

  private hideSuggestions(): void {
    this.clearSuggestionDisplay();
    this.clearArgumentDisplay(); // This now only clears display, not the help text
    this.isShowingSuggestions = false;
    this.suggestionIndex = -1;
    this.currentSuggestions = [];
    this.originalInput = '';
    this.tabMode = false;
    this.visibleSuggestionsStart = 0; // Reset paging
    this.currentPage = 1; // Reset current page
    // Don't clear currentArgumentHelp or commandArgumentCache here - preserve it for the command
  }

  private insertText(text: string): void {
    // Replace selection if exists
    if (this.hasSelection()) {
      this.deleteSelection();
    }
    
    const filteredText = text.replace(/[\x00-\x08\x0a-\x1f\x7f]/g, '');
    if (filteredText.length === 0) {return;}
    
    // Clear tab mode when typing
    this.tabMode = false;
    
    this.currentLine = this.currentLine.slice(0, this.cursorPosition) + 
                      filteredText + 
                      this.currentLine.slice(this.cursorPosition);
    
    const restOfLine = this.currentLine.slice(this.cursorPosition + filteredText.length);
    this.writeEmitter.fire(filteredText + restOfLine);
    
    this.cursorPosition += filteredText.length;
    
    if (restOfLine.length > 0) {
      this.writeEmitter.fire('\x1b[' + restOfLine.length + 'D');
    }
    
    this.clearSelection();

    // Show suggestions immediately if typing a command
    if (this.currentLine.startsWith('/')) {
      // Use immediate execution instead of setTimeout for instant feedback
      this.showInlineSuggestions();
    } else {
      // Clear suggestions and arguments if not typing a command
      this.hideSuggestions();
    }
  }

  private handleBackspace(): void {
    if (this.hasSelection()) {
      this.deleteSelection();
      this.redrawLineWithSelection();
    } else if (this.cursorPosition > 0) {
      // Clear tab mode
      this.tabMode = false;
      
      this.currentLine = this.currentLine.slice(0, this.cursorPosition - 1) + 
                        this.currentLine.slice(this.cursorPosition);
      this.cursorPosition--;
      
      this.writeEmitter.fire('\b');
      const restOfLine = this.currentLine.slice(this.cursorPosition);
      this.writeEmitter.fire(restOfLine + ' ');
      if (restOfLine.length + 1 > 0) {
        this.writeEmitter.fire('\x1b[' + (restOfLine.length + 1) + 'D');
      }
      
      // Update suggestions immediately
      if (this.currentLine.startsWith('/')) {
        this.showInlineSuggestions();
      } else {
        this.hideSuggestions();
      }
    }
  }

  private showArgumentsInList(): void {
    if (!this.currentArgumentHelp) return;
    
    // Save cursor position
    this.writeEmitter.fire('\x1b7');
    
    // Clear old list area
    for (let i = 0; i < this.suggestionListLines; i++) {
      this.writeEmitter.fire('\r\n\x1b[K');
    }
    if (this.suggestionListLines > 0) {
      this.writeEmitter.fire(`\x1b[${this.suggestionListLines}A`);
    }
    
    // Move to next line for argument display
    this.writeEmitter.fire('\r\n');
    
    let lineCount = 1;
    
    // Parse the current command to determine which argument position we're at
    const parts = this.currentLine.trim().split(' ');
    const commandName = parts[0];
    
    // Count only COMPLETED arguments (those that have been typed and followed by space)
    // If we end with a space, we're ready for the next argument
    // If we don't end with a space and have more than just the command, we're typing an argument
    let currentArgIndex = -1;
    const hasTrailingSpace = this.currentLine.endsWith(' ');
    
    if (parts.length === 1 && !hasTrailingSpace) {
      // Still typing the command itself, no arguments yet
      currentArgIndex = -1;
    } else if (parts.length === 1 && hasTrailingSpace) {
      // Just the command with a space, ready for first argument
      currentArgIndex = 0;
    } else {
      // We have parts beyond the command
      const argCount = parts.length - 1; // Number of space-separated parts after command
      
      if (hasTrailingSpace) {
        // Ended with space, ready for next argument
        currentArgIndex = argCount;
      } else {
        // Still typing current argument
        currentArgIndex = argCount - 1;
      }
    }
    
    // Parse argument help string to get individual arguments
    const argPattern = /(<[^>]+>|\[[^\]]+\]|\|)/g;
    const tokens = this.currentArgumentHelp.match(argPattern) || [];
    
    // Build the complete usage line showing ALL arguments
    let usageLine = '  ';
    
    // Add the command name in gray
    usageLine += '\x1b[90m' + commandName + '\x1b[0m';
    
    // Track argument index (excluding | separators)
    let argIndex = 0;
    
    // Process all tokens (arguments and pipes)
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      
      if (token === '|') {
        // This is an OR separator - add it without incrementing argIndex
        usageLine += '\x1b[90m|\x1b[0m';
        continue;
      }
      
      usageLine += ' '; // Space before each argument
      
      // Check if this is the current argument
      if (argIndex === currentArgIndex) {
        // Currently typing this argument - make it bold
        usageLine += '\x1b[1m\x1b[90m' + token + '\x1b[0m';
      } else {
        // All other arguments in regular gray
        usageLine += '\x1b[90m' + token + '\x1b[0m';
      }
      
      argIndex++;
    }
    
    this.writeEmitter.fire(usageLine + '\r\n');
    lineCount++;
    
    // Show current argument details if available
    if (currentArgIndex >= 0) {
      const relevantTokens = tokens.filter(t => t !== '|');
      if (currentArgIndex < relevantTokens.length) {
        const currentArg = relevantTokens[currentArgIndex];
        
        if (currentArg) {
          const argName = currentArg.replace(/[<>\[\]]/g, '');
          let hint = '';
          
          // Provide helpful hints based on argument name
          if (argName.includes('player') || argName.includes('target')) {
            hint = 'Player name or @selector (@p, @a, @r, @e, @s)';
          } else if (argName.includes('item')) {
            hint = 'Item ID (e.g., minecraft:diamond, stone, iron_sword)';
          } else if (argName.includes('block')) {
            hint = 'Block ID (e.g., minecraft:stone, dirt, oak_planks)';
          } else if (argName.includes('count') || argName.includes('amount')) {
            hint = 'Number (1-64 for most items)';
          } else if (argName.includes('data')) {
            hint = 'Data value or NBT tags';
          } else if (argName.includes('pos') || argName.includes('x') || argName.includes('y') || argName.includes('z')) {
            hint = 'Coordinates (x y z) or relative (~x ~y ~z)';
          } else if (argName.includes('message') || argName.includes('text')) {
            hint = 'Text string (use quotes for spaces)';
          } else if (argName.includes('mode')) {
            hint = 'Game mode option';
          } else if (argName.includes('rule')) {
            hint = 'Game rule name';
          } else if (argName.includes('value')) {
            hint = 'Value for the specified option';
          } else if (argName === 'args' || argName === 'arguments') {
            hint = 'Additional arguments specific to this command';
          }
          
          if (hint) {
            // Italicized hint text in gray
            this.writeEmitter.fire('  \x1b[3m\x1b[90m' + hint + '\x1b[0m\r\n');
            lineCount++;
          }
        }
      }
    }
    
    this.suggestionListLines = lineCount - 1; // Don't count the initial move
    
    // Restore cursor position
    this.writeEmitter.fire('\x1b8');
  }
  
  private clearArgumentDisplay(): void {
    // This clears the display area (same as clearSuggestionDisplay)
    if (this.suggestionListLines > 0) {
      this.writeEmitter.fire('\x1b7'); // Save cursor
      this.writeEmitter.fire('\r\n');
      for (let i = 0; i < this.suggestionListLines; i++) {
        this.writeEmitter.fire('\x1b[K');
        if (i < this.suggestionListLines - 1) {
          this.writeEmitter.fire('\r\n');
        }
      }
      this.writeEmitter.fire(`\x1b[${this.suggestionListLines}A`);
      this.writeEmitter.fire('\x1b8'); // Restore cursor
      this.suggestionListLines = 0;
    }
    // DON'T clear currentArgumentHelp or commandArgumentCache here - we want to preserve it!
  }

  private handleDisconnect(): void {
    this.writeEmitter.fire('^D\r\n');
    this.writeEmitter.fire('Disconnecting...\r\n');
    
    // Clear any pending reconnect
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    try {
      this.controller.disconnect();
    } catch (err) {
      this.output.appendLine(`Error during disconnect: ${err}`);
    }
    
    this.isConnected = false;
    this.isReconnecting = false;
    this.writeEmitter.fire('Connection closed. Type \x1b[33m/reconnect\x1b[0m to reconnect.\r\n\r\n');
    this.showPrompt();
  }

  private handleEnter(): void {
    // Clear suggestions and argument display before processing
    if (this.isShowingSuggestions) {
      this.hideSuggestions();
    }
    this.clearArgumentDisplay();
    
    this.writeEmitter.fire('\r\n');
    
    const command = this.currentLine.trim();
    
    // Clear current line state
    this.currentLine = '';
    this.cursorPosition = 0;
    this.historyIndex = -1;
    this.tempLine = '';
    this.clearSelection();
    
    if (command) {
      // Handle special commands
      if (command === '/reconnect') {
        this.manualReconnect();
      } else if (command === '/disconnect') {
        this.handleDisconnect();
      } else if (command === '/clear') {
        this.writeEmitter.fire('\x1b[2J\x1b[H');
        this.showPrompt();
      } else if (command === '/help') {
        this.showHelp();
      } else if (command === '/reload-commands') {
        this.initializeCommands();
      } else {
        // Add to history if not duplicate
        if (this.history.length === 0 || this.history[this.history.length - 1] !== command) {
          this.history.push(command);
          // Limit history size
          if (this.history.length > 100) {
            this.history.shift();
          }
        }
        this.executeCommand(command);
      }
    } else {
      this.showPrompt();
    }
  }

  private showHelp(): void {
    this.writeEmitter.fire('\x1b[1;36mBuilt-in Commands:\x1b[0m\r\n');
    this.writeEmitter.fire('  \x1b[33m/help\x1b[0m - Show this help message\r\n');
    this.writeEmitter.fire('  \x1b[33m/clear\x1b[0m - Clear the terminal screen\r\n');
    this.writeEmitter.fire('  \x1b[33m/reconnect\x1b[0m - Reconnect to the server\r\n');
    this.writeEmitter.fire('  \x1b[33m/disconnect\x1b[0m - Disconnect from the server\r\n');
    this.writeEmitter.fire('  \x1b[33m/reload-commands\x1b[0m - Reload command database\r\n');
    this.writeEmitter.fire('\r\n');
    this.writeEmitter.fire('\x1b[1;36mKeyboard Shortcuts:\x1b[0m\r\n');
    this.writeEmitter.fire('  \x1b[2mTab - Autocomplete commands and cycle suggestions\x1b[0m\r\n');
    this.writeEmitter.fire('  \x1b[2mUp/Down - Navigate command history\x1b[0m\r\n');
    this.writeEmitter.fire('  \x1b[2mCtrl+L - Clear screen  |  Esc - Clear current line\x1b[0m\r\n');
    this.writeEmitter.fire('  \x1b[2mCtrl+C - Cancel input  |  Ctrl+D - Disconnect\x1b[0m\r\n');
    this.writeEmitter.fire('\r\n');
    this.showPrompt();
  }

  private findWordLeft(): number {
    if (this.cursorPosition === 0) {return 0;}
    
    let pos = this.cursorPosition - 1;
    // Skip whitespace
    while (pos > 0 && this.currentLine[pos] === ' ') {
      pos--;
    }
    // Skip word characters
    while (pos > 0 && this.currentLine[pos - 1] !== ' ') {
      pos--;
    }
    return pos;
  }

  private findWordRight(): number {
    if (this.cursorPosition >= this.currentLine.length) {return this.currentLine.length;}
    
    let pos = this.cursorPosition;
    
    // If we're in whitespace, skip to next word
    if (this.currentLine[pos] === ' ') {
      while (pos < this.currentLine.length && this.currentLine[pos] === ' ') {
        pos++;
      }
    } else {
      // Skip current word
      while (pos < this.currentLine.length && this.currentLine[pos] !== ' ') {
        pos++;
      }
    }
    
    return pos;
  }

  private redrawLineWithSelection(): void {
    // Move cursor to start of line
    this.writeEmitter.fire('\r');
    // Clear entire line
    this.writeEmitter.fire('\x1b[K');
    
    // Redraw prompt
    if (this.isReconnecting) {
      this.writeEmitter.fire('\x1b[33m[reconnecting]\x1b[0m > ');
    } else if (!this.isConnected) {
      this.writeEmitter.fire('\x1b[31m[disconnected]\x1b[0m > ');
    } else {
      this.writeEmitter.fire('\x1b[32m>\x1b[0m ');
    }
    
    if (!this.hasSelection() || this.selectionStart === this.selectionEnd) {
      // No selection, just write the line normally
      this.writeEmitter.fire(this.currentLine);
    } else {
      // Draw with selection highlighting
      const start = Math.min(this.selectionStart, this.selectionEnd);
      const end = Math.max(this.selectionStart, this.selectionEnd);
      
      // Before selection
      if (start > 0) {
        this.writeEmitter.fire(this.currentLine.slice(0, start));
      }
      // Selected text (inverse video)
      this.writeEmitter.fire('\x1b[7m' + this.currentLine.slice(start, end) + '\x1b[27m');
      // After selection
      if (end < this.currentLine.length) {
        this.writeEmitter.fire(this.currentLine.slice(end));
      }
    }
    
    // Move cursor to correct position
    if (this.currentLine.length > this.cursorPosition) {
      const moveBack = this.currentLine.length - this.cursorPosition;
      this.writeEmitter.fire('\x1b[' + moveBack + 'D');
    }
  }

  private clearAndResetLine(): void {
    // Clear any display
    this.clearArgumentDisplay();
    
    // Move to start of input (after prompt)
    this.writeEmitter.fire('\r');
    // Clear entire line
    this.writeEmitter.fire('\x1b[K');
    
    this.currentLine = '';
    this.cursorPosition = 0;
    this.clearSelection();
    // Don't clear commandArgumentCache - preserve it across line clears
  }

  private navigateHistory(direction: 'up' | 'down'): void {
    if (this.history.length === 0) {
      return;
    }

    if (this.historyIndex === -1 && direction === 'up') {
      // Save current line
      this.tempLine = this.currentLine;
    }

    if (direction === 'up') {
      if (this.historyIndex < this.history.length - 1) {
        this.historyIndex++;
        const newLine = this.history[this.history.length - 1 - this.historyIndex];
        this.replaceCurrentLine(newLine);
      }
    } else { // down
      if (this.historyIndex > 0) {
        this.historyIndex--;
        const newLine = this.history[this.history.length - 1 - this.historyIndex];
        this.replaceCurrentLine(newLine);
      } else if (this.historyIndex === 0) {
        this.historyIndex = -1;
        this.replaceCurrentLine(this.tempLine);
      }
    }
  }

  private replaceCurrentLine(newLine: string): void {
    // Clear current line display
    this.writeEmitter.fire('\r');
    this.writeEmitter.fire('\x1b[K');
    
    // Show prompt again
    this.showPrompt();
    
    // Write new line
    this.writeEmitter.fire(newLine);
    
    this.currentLine = newLine;
    this.cursorPosition = newLine.length;
    this.clearSelection();
  }

  private async manualReconnect(): Promise<void> {
    if (this.isReconnecting) {
      this.writeEmitter.fire('\x1b[33mAlready reconnecting...\x1b[0m\r\n\r\n');
      this.showPrompt();
      return;
    }
    
    this.reconnectAttempts = 0;
    this.reconnectDelay = 2000;
    await this.attemptReconnect();
  }

  private async attemptReconnect(): Promise<void> {
    if (this.isReconnecting) {
      return;
    }

    if (this.isConnected) {
      this.writeEmitter.fire('\x1b[32mAlready connected.\x1b[0m\r\n\r\n');
      this.showPrompt();
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    
    const attemptText = this.reconnectAttempts > 1 ? ` (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})` : '';
    this.writeEmitter.fire('\x1b[33mReconnecting to ' + this.host + ':' + this.port + attemptText + '...\x1b[0m\r\n');
    
    try {
      // Disconnect existing controller
      try {
        await this.controller.disconnect();
      } catch (err) {
        // Ignore disconnect errors during reconnect
      }
      
      // Create new controller
      this.controller = new RconController(this.host, this.port, this.password, this.output);
      await this.controller.connect();
      
      this.isConnected = true;
      this.isReconnecting = false;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 2000;
      
      // Clear any pending timeout
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
      
      this.writeEmitter.fire('\x1b[1;32m✓ Reconnected successfully!\x1b[0m\r\n\r\n');
      
      // Reload commands after reconnection
      this.initializeCommands();
    } catch (err: any) {
      this.isReconnecting = false;
      
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.writeEmitter.fire('\x1b[31m✗ Connection failed: ' + (err.message || err) + '\x1b[0m\r\n');
        this.writeEmitter.fire('\x1b[33mRetrying in ' + (this.reconnectDelay / 1000) + ' seconds...\x1b[0m\r\n');
        
        // Clear any existing timeout
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
        }
        
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectTimeout = null;
          this.attemptReconnect();
        }, this.reconnectDelay);
        
        // Exponential backoff with max delay
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 32000);
      } else {
        // Max attempts reached
        this.writeEmitter.fire('\x1b[1;31m✗ Reconnection failed after ' + this.maxReconnectAttempts + ' attempts.\x1b[0m\r\n');
        this.writeEmitter.fire('Type \x1b[33m/reconnect\x1b[0m to try again.\r\n\r\n');
        this.reconnectAttempts = 0;
        this.reconnectDelay = 2000;
        
        // Clear timeout
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = null;
        }
        
        this.showPrompt();
      }
    }
  }

  private async executeCommand(command: string): Promise<void> {
    if (this.isReconnecting) {
      this.writeEmitter.fire('\x1b[33mReconnecting... Please wait.\x1b[0m\r\n\r\n');
      this.showPrompt();
      return;
    }

    if (!this.isConnected) {
      this.writeEmitter.fire('\x1b[31mNot connected. Type \x1b[33m/reconnect\x1b[0m to reconnect.\x1b[0m\r\n\r\n');
      this.showPrompt();
      return;
    }

    this.isExecutingCommand = true;

    try {
      const response = await this.controller.send(command);
      
      if (response && response.trim()) {
        // Apply Minecraft color codes
        const formatted = CommandAutocomplete.formatMinecraftColors(response);
        const lines = formatted.split('\n');
        lines.forEach(line => {
          this.writeEmitter.fire(`${line}\r\n`);
        });
      } else {
        this.writeEmitter.fire('\x1b[2m(no response)\x1b[0m\r\n');
      }
      
      this.writeEmitter.fire('\r\n');
    } catch (err: any) {
      this.writeEmitter.fire(`\x1b[31mError: ${err.message || err}\x1b[0m\r\n`);
      
      const errorMsg = String(err.message || err).toLowerCase();
      if (errorMsg.includes('econnreset') || 
          errorMsg.includes('econnrefused') ||
          errorMsg.includes('epipe') ||
          errorMsg.includes('not connected') ||
          errorMsg.includes('connection closed') ||
          errorMsg.includes('socket') ||
          errorMsg.includes('timeout')) {
        
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 2000;
        
        this.writeEmitter.fire('\x1b[33m⚠ Connection lost. Auto-reconnecting...\x1b[0m\r\n');
        
        // Clear any existing timeout
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
        }
        
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectTimeout = null;
          this.attemptReconnect();
        }, 1000);
      } else {
        this.writeEmitter.fire('\r\n');
      }
    } finally {
      this.isExecutingCommand = false;
      this.showPrompt();
    }
  }
}