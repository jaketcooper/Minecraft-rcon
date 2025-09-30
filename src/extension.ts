import * as vscode from 'vscode';
import { RconController } from './rconClient';

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Minecraft RCON');
  let controller: RconController | undefined;

  const disposable = vscode.commands.registerCommand('minecraftRcon.connect', async () => {
    // gather settings or prompt
    const config = vscode.workspace.getConfiguration('minecraftRcon');
    const host = await vscode.window.showInputBox({
      prompt: 'RCON Host',
      value: String(config.get('defaultHost') ?? '127.0.0.1')
    });
    if (!host) { return; }

    const portInput = await vscode.window.showInputBox({
      prompt: 'RCON Port',
      value: String(config.get('defaultPort') ?? '25575')
    });
    if (!portInput) { return; }
    const port = parseInt(portInput, 10);

    const password = await vscode.window.showInputBox({ prompt: 'RCON Password', password: true });
    if (password === undefined) { return; }

    output.show(true);
    output.appendLine(`Connecting to ${host}:${port} …`);

    controller = new RconController(host, port, password, output);

    try {
      await controller.connect();
      output.appendLine('Connected. Use the command "Minecraft RCON: Send Command" or type commands when prompted.');

      // Register command to send RCON commands while connected
      const sendCmd = vscode.commands.registerCommand('minecraftRcon.sendCommand', async () => {
        if (!controller || !controller.isConnected()) {
          vscode.window.showErrorMessage('Not connected to RCON. Re-run Minecraft RCON: Connect.');
          return;
        }
        const command = await vscode.window.showInputBox({ prompt: 'RCON Command' });
        if (command === undefined) { return; }
        const res = await controller.send(command);
        output.appendLine(`> ${command}`);
        output.appendLine(res ?? '<no response>');
      });

      context.subscriptions.push(sendCmd);

      // show quick access via status bar
      const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
      status.text = 'RCON: Connected';
      status.tooltip = `${host}:${port}`;
      status.show();
      context.subscriptions.push(status);

      // auto-register a disconnect command
      const disc = vscode.commands.registerCommand('minecraftRcon.disconnect', async () => {
        await controller?.disconnect();
        output.appendLine('Disconnected.');
        status.dispose();
        disc.dispose();
      });
      context.subscriptions.push(disc);

    } catch (err: any) {
      output.appendLine('Connection failed: ' + String(err.message ?? err));
      vscode.window.showErrorMessage('RCON connection failed: ' + String(err.message ?? err));
      controller = undefined;
    }
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {
  // nothing explicit: controller will be garbage collected
}