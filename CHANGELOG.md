# Changelog

All notable changes to the Minecraft RCON VS Code extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.2.0] - 2025-10-03

### 🐛 Fixed
- `rconTerminal.ts` use TCP keepalive and increase command response timeout
- `commandAutocomplete.ts` improve parsing of optional subcommands and arguments in autocomplete

---

## [2.1.0] - 2025-10-02

### ⚠️ Security Update
- `extension.ts` now stores `defaultPassword` using VS Code secure storage
- Added functionality to `extension.ts` that automatically migrates previously stored plain-text passwords to secure storage
- Removed `defaultPassword` section from `package.json`

---

## [2.0.5] - 2025-10-02

### Added
- Add extension icon `images/icon.png`

### 🔧 Changed
- `package.json` now references the new icon

---

## [2.0.0] - 2025-10-02

### 🚀 Major Changes

#### Custom RCON Protocol Implementation
- **Replaced `rcon-client` library** with a native TypeScript implementation
- **Full fragmentation support** - Properly handles responses larger than 4096 bytes using double-packet technique
- **No more truncated responses** - Commands like `/help`, `/status`, `/cvarlist` now return complete data
- **Concurrent command execution** - Support for multiple simultaneous commands with request ID tracking

### ✨ Added

#### Protocol & Networking
- Custom `RconProtocol` class with proper packet structure handling
- Double-packet fragmentation detection for reliable response completion
- Event-based error handling with 'error' and 'close' events
- Configurable timeout management (default 5s, extended 30s for help commands)
- Request queue management with proper cleanup on disconnect

#### Command Autocomplete Improvements
- **Fallback command system** - Common Minecraft commands available even if help parsing fails
- **Multiple help format support** - Works with vanilla, Bukkit/Spigot/Paper, and custom servers
- **Hyphenated command support** - Commands like `/titanium-rewards` now properly show parameters
- **Alternative help commands** - Tries `?` if `/help` returns empty
- **Case-insensitive command matching** - More robust parsing
- **UTF-8 color code handling** - Fixed double-byte encoding issues (Â§ sequences)

#### Terminal Rendering Fixes
- **Large output handling** - Fixed rendering corruption after commands with 300+ lines
- **Smart clearing** - Prevents duplicate suggestion lists and visual artifacts
- **Buffer overflow prevention** - Proper handling when terminal buffer scrolls
- **Full-line clearing** - Uses `\x1b[2K]` for complete line clearing
- **Cursor position tracking** - Better management after large outputs

#### Error Handling & Resilience
- Individual command failures don't break initialization
- Empty help response handling with fallbacks
- Graceful degradation when server limits RCON commands
- Continued operation with partial command lists
- Better socket error recovery

### 🔧 Changed

#### Core Architecture
- `rconClient.ts` now uses internal `RconProtocol` instead of external library
- Cache version bumped to 2.1.0 (incompatible with v1.x caches)
- Improved lifecycle management with proper cleanup on disconnect
- Better state tracking throughout the connection lifecycle

#### Command Parsing
- Enhanced `parseHelpResponse()` with multiple regex patterns:
  - Standard format: `/command <args>`
  - No-slash format: `command <args>`
  - Colon format: `/command: <args>`
  - List formats: `- command`
- Normalized command comparison (case-insensitive, trim whitespace)
- Special handling for commands with hyphens and underscores
- Better tokenization of nested brackets and complex parameter structures

#### Debug & Diagnostics
- Extensive logging to VS Code output channel
- Command discovery metrics (bytes received, commands found)
- Parameter parsing debug output
- Token analysis for troubleshooting
- Connection state logging

#### Terminal Improvements
- Added `lastCommandOutputLines` tracking
- Implemented `needsClearBeforeSuggestions` flag
- Better suggestion list positioning after scrolling
- Improved argument hint display with proper line clearing
- Fixed cursor save/restore sequences

### 🐛 Fixed

#### Critical Issues
- **Fragmentation bug** - Responses no longer truncated at 4096 bytes
- **Help command truncation** - `/help` now returns all commands (typically 10-20KB)
- **Hyphenated commands** - Parameters now display correctly for commands with hyphens
- **Rendering corruption** - Fixed duplicate suggestion lists after large outputs
- **UTF-8 encoding** - Color codes now stripped correctly regardless of encoding

#### Terminal Issues  
- Cursor jumping after large command outputs
- Mixed text in suggestion displays
- Corrupted suggestion counter (was showing `[!!a!!/312]`)
- Incomplete line clearing causing artifacts
- ANSI escape sequence conflicts after buffer scrolling

#### Autocomplete Issues
- Empty help response crashes
- Partial command lists from fragmented responses
- Case-sensitive matching failures
- Silent initialization failures
- Missing parameters for special character commands

### ⚠️ Breaking Changes

- **Removed `rcon-client` dependency** - Now using internal implementation
- **Cache format incompatible** - Version 2.1.0 cache not compatible with v1.x
- **Minimum Node.js version** - Requires Node.js 14+ for socket handling
- **Clear cache required** - Users must run `/clear-cache` after update

### 📝 Technical Details

#### Packet Structure
```
+--------+--------+--------+--------+
| Size   | ID     | Type   | Body   |
| 4 bytes| 4 bytes| 4 bytes| n bytes|
+--------+--------+--------+--------+
```

#### Fragmentation Algorithm
1. Send command packet with unique ID
2. Send dummy packet immediately after
3. Accumulate all response fragments with matching ID
4. When dummy response arrives, concatenate accumulated fragments
5. Return complete response

#### Performance Metrics
- First command load: 5-10 seconds (server dependent)
- Cached load: <1 second
- Maximum response size: Unlimited (was 4096 bytes)
- Concurrent commands: Supported
- Cache validity: 7 days

### 📚 Documentation

- Updated `README.md` to include v2.0.0 information
- Updated `.gitignore` and `.vscodeignore` to streamline file & package management
- Updated inline code documentation
- Added comprehensive `docs/TECHNICAL.md` with protocol specifications
- Added `docs/technical/` folder with detailed fix documentation
- Added test suite in `src/test/rconProtocolTest.ts`
- Added `LICENSE`
- Added `CONTRIBUTING.md`

---

## [1.1.1] - 2025-10-01

### Changed
- Updated VS Code engine requirement to ^1.95.0 for better compatibility
- Updated @types/vscode to ^1.95.0

### Fixed
- Cleaned up repository by removing development files from version control
- Fixed .gitignore to properly exclude VS Code specific files

### Removed
- Removed .vscode directory from repository
- Removed .vscode-test.mjs, .vscodeignore, and vsc-extension-quickstart.md files

## [1.1.0] - 2025-10-01

### Added
- **Command Autocomplete System** - Complete rewrite with intelligent parameter parsing
  - Real-time command suggestions as you type
  - Tab completion with Minecraft-style cycling
  - Context-aware argument hints showing required/optional parameters
  - Support for subcommands and deep command trees
  - Command caching for fast autocomplete after initial load
  - Cache management commands (`/reload-commands`, `/clear-cache`, `/cache-info`)
- **Enhanced Connection Management**
  - Save connection settings as defaults
  - Connect with saved credentials (automatic)
  - Connect with new credentials (manual prompt)
  - Improved error handling with retry options
- **Visual Improvements**
  - Custom terminal icons (light/dark theme support)
  - Progress bars for command loading
  - Concealed text alignment in suggestion lists
  - Paginated suggestion display with indicators
  - Color-coded argument highlighting


### Changed
- Improved suggestion list rendering with better alignment
- Enhanced argument hint display with context-aware help
- Optimized command database initialization with cache awareness
- Better handling of CHOICE_LIST parameters
- Improved tokenization for complex command structures

### Fixed
- Fixed subcommand variant collection (no longer breaking after first variant)
- Defensive early returns and guards throughout terminal code
- Proper handling of nested command structures

## [1.0.1] - 2025-09-30

### Changed
- Updated package.json metadata
- Repository URL configuration

### Fixed
- Minor configuration adjustments

## [1.0.0] - 2025-09-30

### Added
- **Full Terminal Interface** - Complete RCON terminal implementation
  - Custom pseudoterminal with full ANSI support
  - Minecraft color code support (§0-§f, §l, §o, etc.)
  - Command history navigation (Up/Down arrows)
  - Text selection, copy, cut, and paste functionality
  - Multi-line output formatting
- **Connection Features**
  - Auto-reconnection with exponential backoff
  - Manual reconnect command (`/reconnect`)
  - Connection status indicators
  - Disconnect command (`/disconnect`)
- **Keyboard Shortcuts**
  - Ctrl+L - Clear screen
  - Ctrl+C - Copy/Cancel
  - Ctrl+V - Paste
  - Ctrl+A - Select all
  - Ctrl+←/→ - Jump word
  - Ctrl+W - Delete word backward
  - Ctrl+U - Clear line
  - Ctrl+D - Disconnect
  - Esc - Clear line
- **Built-in Commands**
  - `/help` - Show command help
  - `/clear` - Clear terminal
  - `/reconnect` - Reconnect to server
  - `/disconnect` - Disconnect from server
- **Terminal Profile Integration**
  - VS Code terminal profile provider
  - Multiple concurrent RCON sessions
  - Terminal lifecycle management

### Changed
- Complete rewrite from prototype to production-ready extension
- Migrated from simple output channel to full terminal interface
- Improved error handling and connection management

## [0.1.0] - 2025-09-30

### Added
- Initial prototype release
- Basic RCON connection functionality
- Simple command execution via command palette
- Output channel for server responses
- Connection status bar indicator
- Configuration for default host and port

### Dependencies
- rcon-client ^4.2.5
- TypeScript ^5.9.2

---

## Migration Guide

### Upgrading to v2.0.0

1. **Clear command cache**
   ```
   /clear-cache
   ```

2. **Reload commands after update**
   ```
   /reload-commands
   ```

3. **Check output channel for issues**
   - View → Output → Minecraft RCON
   - Look for initialization messages

4. **Test fragmentation fix**
   ```
   /help
   ```
   Should return complete list without truncation

### Compatibility

- ✅ Minecraft Java Edition 1.7+
- ✅ Vanilla servers
- ✅ Bukkit/Spigot/Paper
- ✅ Forge/Fabric servers
- ✅ Custom server software with RCON support

[2.1.0]: https://github.com/jaketcooper/minecraft-rcon/compare/2.0.5...2.1.0
[2.0.5]: https://github.com/jaketcooper/minecraft-rcon/compare/2.0.0...2.0.5
[2.0.0]: https://github.com/jaketcooper/minecraft-rcon/compare/1.1.1...2.0.0
[1.1.1]: https://github.com/jaketcooper/minecraft-rcon/compare/1.1.0...1.1.1
[1.1.0]: https://github.com/jaketcooper/minecraft-rcon/compare/1.0.1...1.1.0
[1.0.1]: https://github.com/jaketcooper/minecraft-rcon/compare/1.0.0...1.0.1
[1.0.0]: https://github.com/jaketcooper/minecraft-rcon/compare/0.1.0...1.0.0
[0.1.0]: https://github.com/jaketcooper/minecraft-rcon/releases/tag/0.1.0