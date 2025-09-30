import { connect, RCON } from 'rcon-client';
import * as vscode from 'vscode';

export class RconController {
  private host: string;
  private port: number;
  private password: string;
  private client: RCON | null = null;
  private output: vscode.OutputChannel;

  constructor(host: string, port: number, password: string, output: vscode.OutputChannel) {
    this.host = host;
    this.port = port;
    this.password = password;
    this.output = output;
  }

  public async connect(): Promise<void> {
    this.client = await connect({ host: this.host, port: this.port, password: this.password });

    // Hook simple event logging if available
    if (this.client) {
      this.output.appendLine('RCON session established.');
    }
  }

  public async send(cmd: string): Promise<string | undefined> {
    if (!this.client) { throw new Error('Not connected'); }
    try {
      const res = await this.client.send(cmd);
      return typeof res === 'string' ? res : JSON.stringify(res);
    } catch (err: any) {
      this.output.appendLine('Error sending command: ' + String(err.message ?? err));
      throw err;
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.client) { return; }
    try {
      await this.client.end();
    } catch (e) {
      // ignore
    }
    this.client = null;
  }

  public isConnected(): boolean {
    return this.client !== null;
  }
}
