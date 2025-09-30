import * as vscode from 'vscode';
import { RconController } from './rconClient';
import { RconTerminal } from './rconTerminal';

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Minecraft RCON');
  let activeTerminals = new Map<vscode.Terminal, RconController>();
  let ptyToController = new Map<RconTerminal, RconController>();

  // Register the terminal profile provider
  context.subscriptions.push(
    vscode.window.registerTerminalProfileProvider('minecraftRcon.terminal', {
      provideTerminalProfile: async (token: vscode.CancellationToken) => {
        const { profile, controller, pty } = await createRconTerminalProfile(output);
        
        // Store the controller with the pty so we can track it later
        ptyToController.set(pty, controller);
        
        return profile;
      }
    })
  );

  // Track when terminals open
  const openListener = vscode.window.onDidOpenTerminal((terminal) => {
    // Check if this terminal has one of our pty instances
    for (const [pty, controller] of ptyToController.entries()) {
      if ((terminal.creationOptions as any).pty === pty) {
        activeTerminals.set(terminal, controller);
        ptyToController.delete(pty);
        output.appendLine(`Terminal opened: ${terminal.name}`);
        break;
      }
    }
  });

  // Keep the original connect command
  const connectCommand = vscode.commands.registerCommand('minecraftRcon.connect', async () => {
    await connectToRcon(output, activeTerminals);
  });

  // Handle terminal close events
  const closeListener = vscode.window.onDidCloseTerminal(async (terminal) => {
    const controller = activeTerminals.get(terminal);
    if (controller) {
      await controller.disconnect();
      activeTerminals.delete(terminal);
      output.appendLine(`Terminal closed: ${terminal.name}`);
    }
  });

  context.subscriptions.push(connectCommand, openListener, closeListener, output);
}

async function createRconTerminalProfile(
  output: vscode.OutputChannel
): Promise<{ profile: vscode.TerminalProfile, controller: RconController, pty: RconTerminal }> {
  // Gather settings or prompt
  const config = vscode.workspace.getConfiguration('minecraftRcon');
  
  const host = await vscode.window.showInputBox({
    prompt: 'RCON Host',
    value: String(config.get('defaultHost') ?? '127.0.0.1'),
    placeHolder: 'e.g., 127.0.0.1 or mc.example.com'
  });
  if (!host) {
    throw new Error('Host is required');
  }

  const portInput = await vscode.window.showInputBox({
    prompt: 'RCON Port',
    value: String(config.get('defaultPort') ?? '25575'),
    placeHolder: 'e.g., 25575'
  });
  if (!portInput) {
    throw new Error('Port is required');
  }
  const port = parseInt(portInput, 10);

  const defaultPassword = String(config.get('defaultPassword') ?? '');
  const password = await vscode.window.showInputBox({ 
    prompt: 'RCON Password', 
    password: true,
    value: defaultPassword,  // Use default password from config
    placeHolder: 'Enter your server RCON password'
  });
  if (password === undefined) {
    throw new Error('Password is required');
  }

  // Create controller and connect
  const controller = new RconController(host, port, password, output);

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Connecting to ${host}:${port}...`,
    cancellable: false
  }, async () => {
    await controller.connect();
  });

  // Create terminal with RCON integration - PASS CONNECTION INFO
  const pty = new RconTerminal(controller, host, port, password, output);
  
  const profile = new vscode.TerminalProfile({
    name: `RCON: ${host}:${port}`,
    pty
  });

  return { profile, controller, pty };
}

async function connectToRcon(
  output: vscode.OutputChannel,
  activeTerminals: Map<vscode.Terminal, RconController>
): Promise<void> {
  try {
    const { profile, controller } = await createRconTerminalProfile(output);
    const terminal = vscode.window.createTerminal(profile.options);
    
    // Store the controller reference
    activeTerminals.set(terminal, controller);
    
    terminal.show();
    vscode.window.showInformationMessage(`Connected to Minecraft server`);
  } catch (err: any) {
    if (err.message && !err.message.includes('required')) {
      output.appendLine('Connection failed: ' + String(err.message ?? err));
      vscode.window.showErrorMessage('RCON connection failed: ' + String(err.message ?? err));
    }
    // If user cancelled, don't show error
  }
}

export function deactivate() {
  // Cleanup will happen automatically
}