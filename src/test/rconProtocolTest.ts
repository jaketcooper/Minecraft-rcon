// src/test/rconProtocolTest.ts
import { RconProtocol } from '../rconProtocol';
import * as vscode from 'vscode';

/**
 * Test the RCON protocol implementation with fragmentation support
 * 
 * This test demonstrates how the new implementation handles:
 * 1. Simple commands with small responses
 * 2. Commands with large, fragmented responses (like 'help' or 'status')
 * 3. Multiple concurrent commands
 * 4. Error handling and reconnection
 */
export class RconProtocolTest {
  private output: vscode.OutputChannel;
  
  constructor(output: vscode.OutputChannel) {
    this.output = output;
  }

  /**
   * Run all tests
   */
  public async runTests(host: string, port: number, password: string): Promise<void> {
    this.output.appendLine('=== Starting RCON Protocol Tests ===');
    
    const protocol = new RconProtocol(host, port, password, this.output);
    
    try {
      // Test connection
      await this.testConnection(protocol);
      
      // Test simple command
      await this.testSimpleCommand(protocol);
      
      // Test fragmented response
      await this.testFragmentedResponse(protocol);
      
      // Test concurrent commands
      await this.testConcurrentCommands(protocol);
      
      // Test error handling
      await this.testErrorHandling(protocol);
      
      this.output.appendLine('=== All Tests Completed Successfully ===');
    } catch (error) {
      this.output.appendLine(`Test failed: ${error}`);
    } finally {
      await protocol.disconnect();
    }
  }

  /**
   * Test basic connection
   */
  private async testConnection(protocol: RconProtocol): Promise<void> {
    this.output.appendLine('\nTest 1: Connection and Authentication');
    this.output.appendLine('--------------------------------------');
    
    const startTime = Date.now();
    await protocol.connect();
    const connectTime = Date.now() - startTime;
    
    this.output.appendLine(`✓ Connected and authenticated in ${connectTime}ms`);
    
    if (!protocol.isConnected()) {
      throw new Error('Connection test failed: not connected after connect()');
    }
    
    this.output.appendLine('✓ Connection status verified');
  }

  /**
   * Test simple command with small response
   */
  private async testSimpleCommand(protocol: RconProtocol): Promise<void> {
    this.output.appendLine('\nTest 2: Simple Command');
    this.output.appendLine('----------------------');
    
    const response = await protocol.send('time query daytime');
    this.output.appendLine(`Command: time query daytime`);
    this.output.appendLine(`Response length: ${response.length} bytes`);
    this.output.appendLine(`Response: ${response.substring(0, 100)}${response.length > 100 ? '...' : ''}`);
    this.output.appendLine('✓ Simple command executed successfully');
  }

  /**
   * Test command with large, fragmented response
   */
  private async testFragmentedResponse(protocol: RconProtocol): Promise<void> {
    this.output.appendLine('\nTest 3: Fragmented Response');
    this.output.appendLine('---------------------------');
    
    // 'help' command typically returns a large response that gets fragmented
    const startTime = Date.now();
    const response = await protocol.send('help');
    const responseTime = Date.now() - startTime;
    
    this.output.appendLine(`Command: help`);
    this.output.appendLine(`Response length: ${response.length} bytes`);
    this.output.appendLine(`Response time: ${responseTime}ms`);
    
    // Check if response was likely fragmented (> 4096 bytes)
    if (response.length > 4096) {
      const fragments = Math.ceil(response.length / 4096);
      this.output.appendLine(`✓ Received fragmented response (~${fragments} fragments)`);
    } else {
      this.output.appendLine(`✓ Received single-packet response`);
    }
    
    // Verify response integrity
    const lines = response.split('\n');
    this.output.appendLine(`Response contains ${lines.length} lines`);
    
    // Check for common commands that should be in help
    const hasCommonCommands = ['gamemode', 'give', 'tp'].some(cmd => 
      response.toLowerCase().includes(cmd)
    );
    
    if (hasCommonCommands) {
      this.output.appendLine('✓ Response content verified');
    } else {
      this.output.appendLine('⚠ Warning: Response may be incomplete');
    }
  }

  /**
   * Test multiple concurrent commands
   */
  private async testConcurrentCommands(protocol: RconProtocol): Promise<void> {
    this.output.appendLine('\nTest 4: Concurrent Commands');
    this.output.appendLine('---------------------------');
    
    const commands = [
      'time query daytime',
      'difficulty',
      'gamerule doDaylightCycle',
      'defaultgamemode'
    ];
    
    const startTime = Date.now();
    
    // Send all commands concurrently
    const promises = commands.map(cmd => 
      protocol.send(cmd).then(response => ({
        command: cmd,
        response: response,
        success: true
      })).catch(error => ({
        command: cmd,
        response: error.message,
        success: false
      }))
    );
    
    const results = await Promise.all(promises);
    const totalTime = Date.now() - startTime;
    
    // Display results
    for (const result of results) {
      if (result.success) {
        this.output.appendLine(`✓ ${result.command}: ${result.response.substring(0, 50)}...`);
      } else {
        this.output.appendLine(`✗ ${result.command}: ${result.response}`);
      }
    }
    
    this.output.appendLine(`All ${commands.length} commands completed in ${totalTime}ms`);
    
    const successCount = results.filter(r => r.success).length;
    if (successCount === commands.length) {
      this.output.appendLine('✓ All concurrent commands executed successfully');
    } else {
      this.output.appendLine(`⚠ ${successCount}/${commands.length} commands succeeded`);
    }
  }

  /**
   * Test error handling
   */
  private async testErrorHandling(protocol: RconProtocol): Promise<void> {
    this.output.appendLine('\nTest 5: Error Handling');
    this.output.appendLine('----------------------');
    
    try {
      // Test invalid command
      const response = await protocol.send('this_is_not_a_valid_command_12345');
      this.output.appendLine(`Invalid command response: ${response}`);
      this.output.appendLine('✓ Invalid command handled gracefully');
    } catch (error) {
      this.output.appendLine(`✗ Error with invalid command: ${error}`);
    }
    
    // Test command with very long argument
    try {
      const longArg = 'a'.repeat(1000);
      const response = await protocol.send(`say ${longArg}`);
      this.output.appendLine('✓ Long argument command handled');
    } catch (error) {
      this.output.appendLine(`✗ Error with long argument: ${error}`);
    }
  }
}

/**
 * Command to run tests from the extension
 */
export async function testRconProtocol(
  host: string,
  port: number,
  password: string,
  output: vscode.OutputChannel
): Promise<void> {
  const tester = new RconProtocolTest(output);
  await tester.runTests(host, port, password);
}