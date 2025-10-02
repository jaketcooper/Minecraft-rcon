# Contributing to Minecraft RCON Extension

## Development Setup

### Prerequisites
- Node.js 14+ 
- VS Code
- Git

### Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/jaketcooper/minecraft-rcon.git
   cd minecraft-rcon
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Compile TypeScript**
   ```bash
   npm run compile
   ```

4. **Run in development mode**
   - Open the project in VS Code
   - Press `F5` to launch Extension Development Host
   - A new VS Code window opens with the extension loaded

### Project Structure

```
minecraft-rcon/
├── src/
│   ├── extension.ts          # Extension entry point
│   ├── rconClient.ts         # RCON client wrapper
│   ├── rconProtocol.ts       # Custom RCON protocol implementation
│   ├── rconTerminal.ts       # Terminal interface
│   └── commandAutocomplete.ts # Command autocomplete system
├── package.json              # Extension manifest
└── tsconfig.json            # TypeScript configuration
```

## Making Changes

### Code Style
- Use TypeScript strict mode
- Follow existing code patterns
- Add JSDoc comments for public methods
- Keep functions focused and small

### Testing Your Changes

1. **Manual Testing**
   - Connect to a test Minecraft server
   - Verify basic commands work
   - Test edge cases (large outputs, disconnections)

2. **Common Test Commands**
   ```
   /help              # Tests fragmentation
   /status            # Tests player list parsing  
   /gamemode          # Tests autocomplete
   /titanium-rewards  # Tests hyphenated commands
   ```

3. **Debug Output**
   - View → Output → Select "Minecraft RCON"
   - Check for error messages and warnings

### Submitting Changes

1. Create a feature branch
2. Make your changes
3. Test thoroughly
4. Commit with clear messages
5. Submit a pull request

## Architecture Overview

### RCON Protocol Layer
The custom `RconProtocol` class handles:
- Socket communication
- Packet encoding/decoding
- Fragmentation handling
- Response accumulation

### Terminal Interface
The `RconTerminal` class provides:
- Pseudoterminal implementation
- Command history
- Autocomplete UI
- ANSI color support

### Command Autocomplete
The `CommandAutocomplete` class manages:
- Command discovery via help
- Parameter parsing
- Suggestion generation
- Cache management

## Common Development Tasks

### Adding a New Built-in Command
Edit `rconTerminal.ts` in the `handleEnter()` method:
```typescript
} else if (command === '/your-command') {
    this.handleYourCommand();
}
```

### Modifying Autocomplete Behavior
See `commandAutocomplete.ts`:
- `parseHelpResponse()` - How help output is parsed
- `getSuggestions()` - How suggestions are generated

### Changing Terminal Rendering
Edit `rconTerminal.ts`:
- `showSuggestionList()` - Suggestion display
- `showArgumentsInList()` - Argument hints

## Debugging Tips

- Set breakpoints in VS Code
- Use `this.output.appendLine()` for debug logging
- Check the Extensions view for runtime errors
- Use Developer Tools (Help → Toggle Developer Tools)

## Questions?

Open an issue on GitHub or join the discussion!