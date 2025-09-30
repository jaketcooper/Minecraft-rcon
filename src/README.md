
# Minecraft RCON — VS Code extension (prototype)

This repository contains a minimal prototype VS Code extension that lets you connect to a Minecraft server using RCON and send commands from inside VS Code.

## Features
- Connect to a server by specifying host, port, and password.
- Send ad-hoc RCON commands via a command palette entry.
- Output goes to the "Minecraft RCON" output channel.
- Basic status bar indicator while connected.

## Quickstart
1. Clone into a folder.
2. `npm install` (this will install `rcon-client` and dev deps).
3. `npm run compile`.
4. Press F5 in VS Code to launch the Extension Development Host.
5. Run the command `Minecraft RCON: Connect` from the Command Palette.

## Development notes
- This is intentionally minimal — it demonstrates how to authenticate and send a command via `rcon-client` and surface I/O via the Output Channel.
- Improvements you may add:
  - Persistent servers list in global state.
  - A dedicated WebView with a better console UI, command history, and log filtering.
  - Auto-reconnect and event streaming if you add server-side hooks.

## Packaging
Use `vsce` to package: `npm i -g vsce` then `vsce package`.