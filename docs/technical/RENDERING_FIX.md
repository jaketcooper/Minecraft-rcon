# Terminal Rendering Fix for Large Output

## Problem Description
When a command produces large output (like `/help` with 300+ commands), the terminal rendering breaks when typing a new command and the autocomplete suggestions appear. The symptoms include:
- Multiple duplicate suggestion lists appearing
- Cursor jumping around
- Corrupted display with mixed text
- Suggestion counter showing corrupted values like `[!!a!!/312]`

## Root Cause
The issue stems from:
1. **Cursor position tracking** - After large outputs, the saved cursor position becomes invalid
2. **Buffer overflow** - The terminal buffer gets confused with too many lines
3. **Incomplete line clearing** - Old suggestion displays aren't fully cleared
4. **ANSI escape sequence conflicts** - Save/restore cursor commands fail after buffer scrolling

## Solution Overview
The fix implements:
1. **Output tracking** - Monitor lines of output from commands
2. **Smart clearing** - Clear screen artifacts before showing suggestions
3. **Better line management** - Use `\x1b[2K]` (clear entire line) instead of `\x1b[K]` (clear to end)
4. **Buffer reset detection** - Detect when large outputs have scrolled the buffer

## Key Code Changes

### 1. Add New Class Properties
```typescript
export class RconTerminal implements vscode.Pseudoterminal {
  // ... existing properties ...
  
  // NEW: Track terminal state for better rendering
  private lastCommandOutputLines: number = 0;
  private needsClearBeforeSuggestions: boolean = false;
  private terminalBufferHeight: number = 24; // Default terminal height
}
```

### 2. Track Output in executeCommand
```typescript
private async executeCommand(command: string): Promise<void> {
  // ... existing code ...
  
  let outputLineCount = 0;
  
  try {
    const response = await this.controller.send(command);
    
    if (response && response.trim()) {
      const formatted = CommandAutocomplete.formatMinecraftColors(response);
      const lines = formatted.split('\n');
      outputLineCount = lines.length; // NEW: Track line count
      
      lines.forEach(line => {
        this.writeEmitter.fire(`${line}\r\n`);
      });
    }
    // ... rest of try block ...
  } finally {
    // NEW: Store output lines and set flag if output was large
    this.lastCommandOutputLines = outputLineCount;
    if (outputLineCount > 10) {
      this.needsClearBeforeSuggestions = true;
    }
    
    this.isExecutingCommand = false;
    this.showPrompt();
  }
}
```

### 3. Fix showSuggestionList Method
```typescript
private showSuggestionList(): void {
  if (!this.isShowingSuggestions || this.currentSuggestions.length === 0) {return;}
  
  this.updateVisibleWindow();
  
  // NEW: Handle large previous outputs
  if (this.needsClearBeforeSuggestions) {
    this.writeEmitter.fire('\x1b[J'); // Clear from cursor to end of screen
    this.needsClearBeforeSuggestions = false;
  }
  
  // Save cursor position
  this.writeEmitter.fire('\x1b7');
  
  // Clear old list area first if it exists
  if (this.suggestionListLines > 0) {
    this.writeEmitter.fire('\r\n');
    for (let i = 0; i < this.suggestionListLines; i++) {
      this.writeEmitter.fire('\x1b[2K'); // NEW: Clear ENTIRE line, not just to end
      if (i < this.suggestionListLines - 1) {
        this.writeEmitter.fire('\r\n');
      }
    }
    // Move back up
    if (this.suggestionListLines > 0) {
      this.writeEmitter.fire(`\x1b[${this.suggestionListLines}A`);
    }
    this.writeEmitter.fire('\r');
  }
  
  // ... rest of method ...
  
  // When drawing each line:
  for (let i = this.visibleSuggestionsStart; i < visibleEnd; i++) {
    this.writeEmitter.fire('\x1b[2K'); // NEW: Clear line first
    
    // ... draw the suggestion line ...
  }
}
```

### 4. Fix clearSuggestionDisplay Method
```typescript
private clearSuggestionDisplay(): void {
  if (this.suggestionListLines > 0) {
    this.writeEmitter.fire('\x1b7'); // Save cursor
    this.writeEmitter.fire('\r\n');
    
    // Clear each line properly
    for (let i = 0; i < this.suggestionListLines; i++) {
      this.writeEmitter.fire('\x1b[2K'); // NEW: Clear entire line
      if (i < this.suggestionListLines - 1) {
        this.writeEmitter.fire('\r\n');
      }
    }
    
    // Move back to original position
    if (this.suggestionListLines > 0) {
      this.writeEmitter.fire(`\x1b[${this.suggestionListLines}A`);
    }
    
    this.writeEmitter.fire('\x1b8'); // Restore cursor
    this.suggestionListLines = 0;
  }
}
```

### 5. Fix insertText to Clean After Large Output
```typescript
private insertText(text: string): void {
  // NEW: Clear any rendering artifacts when starting to type after large output
  if (this.lastCommandOutputLines > 10) {
    this.writeEmitter.fire('\x1b[2K'); // Clear current line
    this.writeEmitter.fire('\r'); // Return to start
    this.showPrompt();
    this.writeEmitter.fire(this.currentLine.substring(0, this.cursorPosition));
    this.lastCommandOutputLines = 0; // Reset
  }
  
  // ... rest of existing insertText code ...
}
```

## ANSI Escape Sequences Used

| Sequence | Description | Usage |
|----------|-------------|-------|
| `\x1b[2K` | Clear entire line | Better than `\x1b[K]` for complete clearing |
| `\x1b[J` | Clear from cursor to end of screen | Used after large outputs |
| `\x1b7` | Save cursor position | Before drawing suggestions |
| `\x1b8` | Restore cursor position | After drawing suggestions |
| `\x1b[{n}A` | Move cursor up n lines | Navigate in suggestion area |
| `\r` | Carriage return | Return to start of line |

## Testing the Fix

1. **Generate large output:**
   ```
   /help
   ```
   This should show 300+ commands

2. **Start typing a new command:**
   ```
   /
   ```

3. **Verify no rendering issues:**
   - Single suggestion list appears
   - Counter shows correct values `[1/312] Page 1/32`
   - No duplicate or corrupted text
   - Smooth navigation with arrow keys

4. **Test with different sized outputs:**
   ```
   /list              (small output)
   /help              (large output)
   /gamerule          (medium output)
   ```

## Alternative Approach (If Issues Persist)

If the terminal still has rendering issues, implement a "clear screen" approach:

```typescript
private showInlineSuggestions(): void {
  // If previous command had large output, clear screen first
  if (this.lastCommandOutputLines > 50) {
    this.writeEmitter.fire('\x1b[2J\x1b[H'); // Clear entire screen and move to top
    this.showPrompt();
    this.writeEmitter.fire(this.currentLine);
    this.lastCommandOutputLines = 0;
  }
  
  // ... continue with normal suggestion display ...
}
```

## Benefits of This Fix

1. **No more duplicate suggestions** - Each render properly clears previous displays
2. **Clean line management** - Entire lines are cleared before redrawing
3. **Buffer overflow handling** - Large outputs trigger cleanup
4. **Smoother experience** - No visual glitches or jumping cursor
5. **Maintains functionality** - All autocomplete features still work

## Implementation Notes

- The fix is backward compatible with existing functionality
- No changes to the autocomplete logic, only rendering
- Minimal performance impact (clearing is fast)
- Works with any terminal size
- Handles edge cases like very long command names

## Files to Update

1. **rconTerminal.ts** - Apply all the changes shown above
2. No other files need modification for this fix

## Quick Test Commands

```bash
# Test large output followed by autocomplete
/help
/

# Test medium output
/scoreboard objectives list
/game

# Test clearing after error
/invalid_command_test
/tp

# Test rapid commands
/time query
/difficulty
/
```

All of these should now render correctly without any visual artifacts!
