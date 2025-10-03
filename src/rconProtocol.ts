// src/rconProtocol.ts
import * as net from 'net';
import * as vscode from 'vscode';
import { EventEmitter } from 'events';

// RCON packet types
enum PacketType {
  AUTH = 3,
  AUTH_RESPONSE = 2,
  COMMAND = 2,
  RESPONSE = 0
}

// RCON packet structure
interface RconPacket {
  size: number;
  id: number;
  type: number;
  body: string;
}

export class RconProtocol extends EventEmitter {
  private socket: net.Socket | null = null;
  private host: string;
  private port: number;
  private password: string;
  private output: vscode.OutputChannel;
  
  private authenticated: boolean = false;
  private requestId: number = 0;
  private responseBuffer: Buffer = Buffer.alloc(0);
  
  // For tracking requests and responses
  private pendingRequests: Map<number, {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    command: string;
    fragments: string[];
    timeout?: NodeJS.Timeout;
  }> = new Map();
  
  // Configuration
  private readonly RESPONSE_TIMEOUT = 10000; // 10 seconds for command responses
  private readonly MAX_PACKET_SIZE = 4096;
  
  constructor(host: string, port: number, password: string, output: vscode.OutputChannel) {
    super();
    this.host = host;
    this.port = port;
    this.password = password;
    this.output = output;
  }

  /**
   * Connect to the RCON server
   */
  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      
      // Enable TCP keepalive to prevent idle connection drops
      // This sends periodic probes to keep the connection alive through NAT/firewalls
      this.socket.setKeepAlive(true, 60000); // Send keepalive probes every 60 seconds
      
      // Don't set a socket timeout - let the connection stay open indefinitely
      // The keepalive will handle detecting dead connections
      
      // Handle connection
      this.socket.once('connect', async () => {
        this.output.appendLine(`Connected to ${this.host}:${this.port}`);
        
        try {
          await this.authenticate();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      
      // Handle data
      this.socket.on('data', (data: Buffer) => {
        this.handleData(data);
      });
      
      // Handle errors
      this.socket.on('error', (error: Error) => {
        this.output.appendLine(`Socket error: ${error.message}`);
        this.emit('error', error);
        reject(error);
      });
      
      // Handle timeout (shouldn't happen now that we removed setTimeout)
      this.socket.on('timeout', () => {
        const error = new Error('Connection timeout');
        this.output.appendLine('Socket timeout');
        this.emit('error', error);
        this.disconnect();
      });
      
      // Handle close
      this.socket.on('close', () => {
        this.output.appendLine('Connection closed');
        this.authenticated = false;
        this.emit('close');
        
        // Reject all pending requests
        for (const [id, request] of this.pendingRequests) {
          if (request.timeout) {
            clearTimeout(request.timeout);
          }
          request.reject(new Error('Connection closed'));
        }
        this.pendingRequests.clear();
      });
      
      // Connect
      this.socket.connect(this.port, this.host);
    });
  }

  /**
   * Authenticate with the RCON server
   */
  private async authenticate(): Promise<void> {
    if (!this.socket) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      const authId = this.getNextRequestId();
      
      // Set up auth response handler
      const authTimeout = setTimeout(() => {
        this.pendingRequests.delete(authId);
        reject(new Error('Authentication timeout'));
      }, 5000);
      
      this.pendingRequests.set(authId, {
        resolve: (response: string) => {
          clearTimeout(authTimeout);
          this.authenticated = true;
          this.output.appendLine('Authentication successful');
          resolve();
        },
        reject: (error: Error) => {
          clearTimeout(authTimeout);
          reject(error);
        },
        command: 'auth',
        fragments: [],
        timeout: authTimeout
      });
      
      // Send auth packet
      const packet = this.createPacket(authId, PacketType.AUTH, this.password);
      if (this.socket) {
        this.socket.write(packet);
      }
    });
  }

  /**
   * Send a command to the server
   */
  public async send(command: string): Promise<string> {
    if (!this.socket || !this.authenticated) {
      throw new Error('Not connected or authenticated');
    }

    return new Promise((resolve, reject) => {
      const requestId = this.getNextRequestId();
      
      // Use the double-packet technique for detecting end of fragmented responses
      // We'll send the actual command, then immediately send a dummy command
      const dummyId = this.getNextRequestId();
      
      // Set up response handler for the actual command
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.pendingRequests.delete(dummyId);
        reject(new Error(`Command timeout: ${command}`));
      }, this.RESPONSE_TIMEOUT);
      
      // Track the main request
      this.pendingRequests.set(requestId, {
        resolve: (response: string) => {
          clearTimeout(timeout);
          this.pendingRequests.delete(requestId);
          this.pendingRequests.delete(dummyId);
          resolve(response);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          this.pendingRequests.delete(requestId);
          this.pendingRequests.delete(dummyId);
          reject(error);
        },
        command: command,
        fragments: [],
        timeout: timeout
      });
      
      // Track the dummy request (used to detect end of fragmented response)
      this.pendingRequests.set(dummyId, {
        resolve: () => {
          // When dummy response arrives, we know the main response is complete
          const mainRequest = this.pendingRequests.get(requestId);
          if (mainRequest) {
            const fullResponse = mainRequest.fragments.join('');
            mainRequest.resolve(fullResponse);
          }
        },
        reject: () => {},
        command: 'dummy',
        fragments: []
      });
      
      // Send the actual command
      const commandPacket = this.createPacket(requestId, PacketType.COMMAND, command);
      if (this.socket) {
        this.socket.write(commandPacket);
      }
      
      // Send dummy command to detect end of fragmentation
      // Using an invalid type should generate a small, predictable response
      const dummyPacket = this.createPacket(dummyId, PacketType.COMMAND, '');
      if (this.socket) {
        this.socket.write(dummyPacket);
      }
    });
  }

  /**
   * Handle incoming data from the socket
   */
  private handleData(data: Buffer): void {
    // Append to buffer
    this.responseBuffer = Buffer.concat([this.responseBuffer, data]);
    
    // Process complete packets
    while (this.responseBuffer.length >= 4) {
      // Read packet size (first 4 bytes, little-endian)
      const size = this.responseBuffer.readInt32LE(0);
      
      // Check if we have the complete packet
      if (this.responseBuffer.length < size + 4) {
        // Wait for more data
        break;
      }
      
      // Extract the packet
      const packetBuffer = this.responseBuffer.slice(0, size + 4);
      this.responseBuffer = this.responseBuffer.slice(size + 4);
      
      // Parse the packet
      try {
        const packet = this.parsePacket(packetBuffer);
        this.handlePacket(packet);
      } catch (error) {
        this.output.appendLine(`Error parsing packet: ${error}`);
      }
    }
  }

  /**
   * Handle a parsed packet
   */
  private handlePacket(packet: RconPacket): void {
    // Special handling for auth responses
    if (packet.id === -1) {
      // Authentication failed
      for (const [id, request] of this.pendingRequests) {
        if (request.command === 'auth') {
          request.reject(new Error('Authentication failed'));
          this.pendingRequests.delete(id);
          break;
        }
      }
      return;
    }
    
    // Find the corresponding request
    const request = this.pendingRequests.get(packet.id);
    if (!request) {
      // Might be an auth response packet (they send two packets)
      // Check if this is following an auth request
      for (const [id, req] of this.pendingRequests) {
        if (req.command === 'auth' && packet.type === PacketType.AUTH_RESPONSE) {
          // This is the auth response
          req.resolve('');
          this.pendingRequests.delete(id);
          return;
        }
      }
      
      this.output.appendLine(`Received packet with unknown request ID: ${packet.id}`);
      return;
    }
    
    // Handle based on packet type
    if (packet.type === PacketType.RESPONSE) {
      // Accumulate response fragments
      request.fragments.push(packet.body);
      
      // For single-packet responses (< 4096 bytes), resolve immediately
      // unless we're expecting fragmentation (body length is near max)
      if (packet.body.length < this.MAX_PACKET_SIZE - 100) {
        // This is likely not fragmented or is the last fragment
        // But we'll let the dummy packet technique confirm
        // For immediate commands like simple queries, this helps responsiveness
        
        // If this is a dummy request, trigger completion of the main request
        if (request.command === 'dummy' || request.command === '') {
          request.resolve('');
        }
      }
    } else if (packet.type === PacketType.AUTH_RESPONSE) {
      // Auth response
      if (request.command === 'auth') {
        request.resolve('');
      }
    }
  }

  /**
   * Create an RCON packet
   */
  private createPacket(id: number, type: PacketType, body: string): Buffer {
    // Calculate size (4 bytes ID + 4 bytes type + body + 2 null terminators)
    const bodyLength = Buffer.byteLength(body, 'utf8');
    const size = 4 + 4 + bodyLength + 2;
    
    // Create buffer (size field + packet content)
    const buffer = Buffer.alloc(4 + size);
    
    // Write size (little-endian)
    buffer.writeInt32LE(size, 0);
    
    // Write ID (little-endian)
    buffer.writeInt32LE(id, 4);
    
    // Write type (little-endian)
    buffer.writeInt32LE(type, 8);
    
    // Write body
    buffer.write(body, 12, bodyLength, 'utf8');
    
    // Null terminators are already 0 from Buffer.alloc
    
    return buffer;
  }

  /**
   * Parse a packet from a buffer
   */
  private parsePacket(buffer: Buffer): RconPacket {
    if (buffer.length < 14) {
      throw new Error('Packet too small');
    }
    
    const size = buffer.readInt32LE(0);
    const id = buffer.readInt32LE(4);
    const type = buffer.readInt32LE(8);
    
    // Read body (from byte 12 to size + 2, excluding null terminators)
    const bodyEnd = Math.min(12 + size - 10, buffer.length - 2);
    const body = buffer.toString('utf8', 12, bodyEnd);
    
    return { size, id, type, body };
  }

  /**
   * Get the next request ID
   */
  private getNextRequestId(): number {
    return ++this.requestId;
  }

  /**
   * Disconnect from the server
   */
  public async disconnect(): Promise<void> {
    if (this.socket) {
      this.authenticated = false;
      
      // Clear pending requests
      for (const [id, request] of this.pendingRequests) {
        if (request.timeout) {
          clearTimeout(request.timeout);
        }
        request.reject(new Error('Disconnected'));
      }
      this.pendingRequests.clear();
      
      // Close socket
      this.socket.destroy();
      this.socket = null;
    }
  }

  /**
   * Check if connected
   */
  public isConnected(): boolean {
    return this.socket !== null && this.authenticated;
  }
}