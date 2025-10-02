# Technical Documentation: RCON Protocol Implementation

## Problem Statement

The Minecraft RCON protocol splits large responses into 4096-byte packets. The previous `rcon-client` library couldn't properly reassemble these fragments, causing commands like `/help` to be truncated. This document explains how our custom implementation solves this problem.

## Solution: Double-Packet Technique

### The Challenge
When receiving fragmented responses, there's no built-in way to know when all fragments have arrived. The protocol doesn't include a "last packet" flag or total size header.

### Our Approach
We use a technique called "double-packet" or "dummy packet" detection:

```typescript
// Pseudocode flow
1. Send actual command (ID: 1) → "help"
2. Send dummy command (ID: 2) → ""
3. Receive fragments with ID: 1 → accumulate
4. Receive response with ID: 2 → we know ID: 1 is complete
5. Return accumulated response for ID: 1
```

### Why This Works
The RCON server processes commands sequentially. When we receive the response to our dummy packet, we're guaranteed that all fragments of the previous command have been sent.

## Packet Structure

Each RCON packet follows this structure:

```
+--------+--------+--------+--------+---------+
| Size   | ID     | Type   | Body   | Padding |
| 4 bytes| 4 bytes| 4 bytes| n bytes| 2 bytes |
+--------+--------+--------+--------+---------+
```

- **Size**: Packet size (little-endian int32) - excludes the size field itself
- **ID**: Request ID for matching responses (little-endian int32)
- **Type**: Packet type (see below)
- **Body**: UTF-8 encoded string
- **Padding**: Two null bytes (0x00 0x00)

### Packet Types

| Type | Name | Direction | Purpose |
|------|------|-----------|---------|
| 3 | SERVERDATA_AUTH | Client→Server | Authentication request |
| 2 | SERVERDATA_AUTH_RESPONSE | Server→Client | Auth response |
| 2 | SERVERDATA_EXECCOMMAND | Client→Server | Execute command |
| 0 | SERVERDATA_RESPONSE_VALUE | Server→Client | Command response |

## Implementation Details

### Key Components

#### 1. Socket Management
```typescript
class RconProtocol {
  private socket: net.Socket;
  private connected: boolean = false;
  private authenticated: boolean = false;
}
```

#### 2. Request Tracking
```typescript
private pendingRequests: Map<number, {
  resolve: (response: string) => void;
  reject: (error: Error) => void;
  fragments: string[];
  timer?: NodeJS.Timeout;
}> = new Map();
```

#### 3. Fragment Accumulation
```typescript
private handlePacket(packet: RconPacket): void {
  const pending = this.pendingRequests.get(packet.id);
  if (pending) {
    if (packet.type === PacketType.RESPONSE_VALUE) {
      pending.fragments.push(packet.body);
    }
  }
}
```

### Connection Flow

1. **Connect**: Establish TCP socket connection
2. **Authenticate**: Send auth packet with password
3. **Verify**: Check auth response (ID = -1 means failure)
4. **Ready**: Can now send commands

### Command Execution Flow

1. **Generate ID**: Create unique request ID
2. **Send Command**: Encode and send command packet
3. **Send Dummy**: Immediately send dummy packet
4. **Accumulate**: Collect response fragments
5. **Detect Complete**: Dummy response signals completion
6. **Return Result**: Concatenate and return fragments

## Error Handling

### Timeout Management
- Connection timeout: 10 seconds
- Command timeout: 5 seconds (30s for help)
- Configurable per command type

### Error Recovery
- Socket errors trigger reconnection
- Pending requests cleaned up on disconnect
- Authentication failures reported clearly

### Edge Cases Handled
- Server closes connection during response
- Malformed packets
- Authentication with empty password
- Concurrent command execution
- Very large responses (>100KB)

## Performance Considerations

### Memory Management
- Fragments accumulated in array
- Cleared after response complete
- Maximum response size limited by available memory

### Network Efficiency  
- TCP Nagle's algorithm disabled for low latency
- Keep-alive enabled for connection stability
- Single socket for all commands

### Concurrency
- Multiple commands can be in-flight
- Responses matched by request ID
- No head-of-line blocking

## Testing Scenarios

### Unit Tests
```typescript
describe('RconProtocol', () => {
  test('handles fragmented response', async () => {
    const response = await protocol.send('help');
    expect(response.length).toBeGreaterThan(4096);
  });
});
```

### Integration Tests
1. **Small Response**: `/time query` - Single packet
2. **Large Response**: `/help` - Multiple fragments
3. **Concurrent**: Multiple commands simultaneously
4. **Error Cases**: Invalid auth, connection loss

### Manual Testing
```bash
# Test fragmentation
/help                    # Should show 300+ commands

# Test special characters  
/say Hello §aWorld§r!    # Color codes preserved

# Test concurrent execution
/time query & /difficulty & /gamemode
```

## Debugging

### Enable Debug Output
```typescript
// In rconProtocol.ts
private debug(message: string): void {
  if (this.output) {
    this.output.appendLine(`[RCON] ${message}`);
  }
}
```

### Common Issues

| Symptom | Likely Cause | Solution |
|---------|-------------|----------|
| Timeout on large commands | Slow server | Increase timeout |
| Auth fails | Wrong password | Check server.properties |
| Partial response | Bug in accumulation | Check debug logs |
| Connection drops | Network issue | Check firewall |

## Comparison with Alternatives

### rcon-client Library
- ❌ Truncates at 4096 bytes
- ❌ No fragmentation support
- ❌ Hardcoded implementation

### Our Implementation
- ✅ Full fragmentation support
- ✅ Configurable timeouts
- ✅ Concurrent commands
- ✅ Better error handling

### Other Approaches Considered
1. **Timeout-based**: Wait X seconds for more packets
   - ❌ Slow and unreliable
   
2. **Size heuristic**: Check if response is exactly 4096 bytes
   - ❌ False positives possible
   
3. **Double-packet**: Send dummy to detect completion
   - ✅ Reliable and efficient (chosen)

## Protocol Quirks

### Minecraft-Specific Behaviors
- Color codes use § character (may be double-encoded)
- Some servers limit RCON command access
- Help output format varies by server type
- Maximum packet size is 4096 bytes payload

### Server Variations
- **Vanilla**: Standard help format
- **Spigot/Paper**: May include plugin commands
- **Forge/Fabric**: Modded commands included
- **Custom**: Unpredictable formats

## Future Improvements

### Potential Enhancements
1. Connection pooling for multiple servers
2. Response caching at protocol level
3. Compression for large responses
4. Binary protocol support
5. WebSocket transport option

### Known Limitations
- No encryption (RCON protocol limitation)
- Password sent in plaintext
- No built-in rate limiting
- Single-threaded processing

## References

- [Source RCON Protocol](https://developer.valvesoftware.com/wiki/Source_RCON_Protocol)
- [Minecraft Wiki: RCON](https://minecraft.wiki/w/RCON)
- [RFC: TCP Socket Options](https://www.rfc-editor.org/rfc/rfc793)

## Code Location

The implementation is in `/src/rconProtocol.ts` with approximately 400 lines of TypeScript code. Key methods:

- `connect()`: Establish connection
- `authenticate()`: Send auth packet
- `send()`: Execute command
- `handleData()`: Process incoming data
- `parsePackets()`: Extract packets from buffer
- `encodePacket()`: Build outgoing packet