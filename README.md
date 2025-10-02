## 🔒 Security Update (<2.1.0)
**If you used versions prior to v2.1.0:** Your password is now automatically migrated to 
secure storage. The old plaintext password is removed from settings.json. 

# Minecraft RCON Terminal - Never Alt-Tab Again

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![VS Code](https://img.shields.io/badge/VS%20Code-^1.95.0-green)
![License](https://img.shields.io/badge/license-MIT-brightgreen)

## 🎮 The Problem
Running a Minecraft server means constantly switching between:
- Fullscreen Minecraft client (for testing)
- Server console (no autocomplete, no history)
- Config editors (separate windows)
- Documentation (wikis, guides)

## ✨ The Solution
Manage EVERYTHING from VS Code:
- Full command autocomplete (better than vanilla!)
- Edit configs and run commands side-by-side
- Persistent command history
- Use VS Code AI to analyze server output
- Never leave your development environment

![demo-gif](images/demo-autocomplete.gif)

## ✨ What's New in v2.0

### 🎉 No More Truncated Commands!
- **BEFORE:** `/help` cut off at ~150 commands
- **AFTER:** `/help` shows ALL 300+ commands properly
- Custom RCON protocol implementation with full fragmentation support
- Commands like `/status`, `/cvarlist` return complete data

## 🚀 Features

### 🎮 Smart Command Autocomplete
- **Intelligent suggestions** - Real-time command completion as you type
- **Tab completion** - Minecraft-style tab cycling through suggestions
- **Argument hints** - Context-aware help showing required and optional arguments
- **Deep command trees** - Full support for subcommands and complex parameters
- **Hyphenated commands** - Commands like `/titanium-rewards` work perfectly
- **Command caching** - Lightning-fast autocomplete after initial load
- **Fallback system** - Common commands available even if server help fails

### 🖥️ Rich Terminal Experience
- **Minecraft color codes** - Full support for all formatting codes (§0-§f, §l, §o, etc.)
- **Command history** - Navigate through previous commands with Up/Down arrows
- **Text selection** - Select, copy, cut, and paste with standard keyboard shortcuts
- **Multi-line output** - Properly formatted server responses of any size
- **Clean rendering** - No artifacts or corruption, even after 1000+ line outputs
- **Connection status** - Visual indicators for connection state

### 🔄 Robust Connection Management
- **Auto-reconnection** - Automatic reconnection with exponential backoff
- **Save credentials** - Store your favorite server connections
- **Multiple connections** - Open multiple RCON terminals simultaneously
- **Connection persistence** - Maintains connection across VS Code restarts
- **Error recovery** - Graceful handling of network issues

## 📦 Installation

### From VS Code Marketplace
1. Open VS Code
2. Press `Ctrl+Shift+X` to open Extensions
3. Search for "Minecraft RCON Terminal"
4. Click Install

### From VSIX Package
1. Download the `.vsix` file from [Releases](https://github.com/jaketcooper/Minecraft-rcon/releases)
2. Open VS Code
3. Press `Ctrl+Shift+P` and run "Extensions: Install from VSIX..."
4. Select the downloaded `.vsix` file

## 🚀 Getting Started

### Enable RCON on Your Server
Add these lines to your `server.properties`:
```properties
enable-rcon=true
rcon.port=25575
rcon.password=your-secure-password
```

### Connect to Your Server

#### Quick Connect (uses saved defaults if available)
1. Press `Ctrl+Shift+P`
2. Run "Minecraft RCON: Connect to Server"
3. Enter credentials if not saved

#### Connect with New Credentials
1. Press `Ctrl+Shift+P`
2. Run "Minecraft RCON: Connect with New Credentials"
3. Enter host, port, and password

#### Save Connection as Default
1. Connect to a server
2. Press `Ctrl+Shift+P`
3. Run "Minecraft RCON: Save Current Connection as Default"

## ⌨️ Keyboard Shortcuts

### Command Navigation
| Shortcut | Action |
|----------|--------|
| `Tab` | Autocomplete command/cycle suggestions |
| `Shift+Tab` | Reverse cycle through suggestions |
| `↑/↓` | Navigate command history or suggestions |
| `Home/End` | Jump to first/last suggestion |
| `Page Up/Down` | Navigate suggestion pages |
| `Esc` | Cancel autocomplete or clear line |

### Text Editing
| Shortcut | Action |
|----------|--------|
| `Ctrl+A` | Select all |
| `Ctrl+C` | Copy selection or cancel input |
| `Ctrl+V` | Paste |
| `Ctrl+X` | Cut selection |
| `Ctrl+←/→` | Jump word left/right |
| `Ctrl+Shift+←/→` | Select word left/right |
| `Shift+Home/End` | Select to start/end of line |

### Terminal Control
| Shortcut | Action |
|----------|--------|
| `Ctrl+L` | Clear screen |
| `Ctrl+W` | Delete word backward |
| `Ctrl+U` | Clear entire line |
| `Ctrl+K` | Delete from cursor to end |
| `Ctrl+D` | Disconnect from server |

## 📋 Built-in Commands

| Command | Description |
|---------|-------------|
| `/help` | Show Minecraft commands (now shows ALL commands!) |
| `/clear` | Clear terminal screen |
| `/reconnect` | Manually reconnect to server |
| `/disconnect` | Disconnect from server |
| `/reload-commands` | Force reload command database from server |
| `/clear-cache` | Clear cached command database |
| `/cache-info` | Show command cache information |

## ⚙️ Configuration

Configure default settings in VS Code (`File` → `Preferences` → `Settings` → Search "Minecraft RCON"):

```json
{
  // Default connection settings
  "minecraftRcon.defaultHost": "localhost",
  "minecraftRcon.defaultPort": 25575,
}
```

## 🎯 Usage Examples

### Basic Commands
```minecraft
/gamemode creative Steve
/give @a diamond 64
/tp @p ~ ~10 ~
/weather clear 1000
/help  # Now shows ALL commands!
```

### Using Autocomplete
1. Type `/` to see all available commands
2. Start typing a command name to filter suggestions
3. Press `Tab` to complete the selected suggestion
4. Continue typing for argument hints

### Command Arguments
When typing commands, you'll see helpful hints:
- `<required>` - Required arguments in angle brackets
- `[optional]` - Optional arguments in square brackets
- `(choice1|choice2)` - Multiple options separated by pipes
- `@selectors` - Target selectors (@p, @a, @r, @e, @s)

## 🔧 Troubleshooting

### After Updating to v2.0
If upgrading from v1.x, run these commands:
```
/clear-cache
/reload-commands
```

### Connection Issues
- **"Connection refused"** - Check if RCON is enabled in server.properties
- **"Authentication failed"** - Verify your RCON password
- **"Timeout"** - Check firewall settings and ensure port is open

### Autocomplete Not Working
1. Clear cache: `/clear-cache`
2. Reload: `/reload-commands`
3. Check output panel: `View → Output → Minecraft RCON`
4. Ensure you have permission to run `/help` on the server

### Large Command Output Issues (Fixed in v2.0!)
- `/help` now returns complete list
- `/status` shows all players
- `/scoreboard` displays everything
- No more truncation at 4096 bytes!

### Visual Issues
- Terminal rendering has been completely fixed in v2.0
- No more duplicate suggestion lists
- No more corrupted displays after large outputs
- If you see any artifacts, use `/clear` to reset

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup.

### Development
```bash
# Clone repository
git clone https://github.com/jaketcooper/minecraft-rcon.git

# Install dependencies
npm install

# Compile and watch
npm run compile

# Run tests
npm test
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Minecraft community for feedback and testing
- VS Code extension developers community

## 📊 Version History

### v2.0.0 (Latest) - The Fragmentation Fix Update
- **Custom RCON protocol** replacing limited rcon-client library
- **Full fragmentation support** - no more truncated responses!
- **Hyphenated command fix** - all command types now work
- **Terminal rendering fixes** - clean display even after huge outputs
- **Fallback commands** - autocomplete works even if help fails
- **Better error handling** - improved connection stability
- See [CHANGELOG.md](CHANGELOG.md) for full details

### v1.1.1
- VS Code compatibility updates
- Repository cleanup

### v1.1.0
- Initial autocomplete system
- Suggestion rendering
- Command caching

### v1.0.0
- Full terminal interface
- Minecraft color support
- Keyboard shortcuts

## 🐛 Known Issues

- None! The v2.0 update fixed all major issues

## 📚 Documentation

- [CHANGELOG.md](CHANGELOG.md) - Detailed version history
- [CONTRIBUTING.md](CONTRIBUTING.md) - Development guide
- [docs/TECHNICAL.md](docs/TECHNICAL.md) - Protocol implementation details

## 💬 Support

- **Issues**: [GitHub Issues](https://github.com/jaketcooper/Minecraft-rcon/issues)
- **Discussions**: [GitHub Discussions](https://github.com/jaketcooper/Minecraft-rcon/discussions)
- **Latest Release**: [v2.0.0](https://github.com/jaketcooper/Minecraft-rcon/releases/latest)

---

Made with ❤️ for the Minecraft community

**Now with 100% less truncation!** 🎉
