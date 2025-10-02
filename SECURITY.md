# Security Policy

## Supported Versions

We take security seriously and will patch security vulnerabilities in all recent versions of the Minecraft RCON extension.

| Version | Supported          |
| ------- | ------------------ |
| 2.0.x   | :white_check_mark: |
| 1.1.x   | :white_check_mark: |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

### Where to Report

**DO NOT** create a public GitHub issue for security vulnerabilities.

Instead, please report security issues via one of these methods:

1. **GitHub Security Advisory** (Preferred)
   - Go to https://github.com/jaketcooper/minecraft-rcon/security/advisories
   - Click "New draft security advisory"
   - Fill out the form with details

2. **Email**
   - Send details to the repository maintainer via GitHub profile contact
   - Use subject line: `[SECURITY] Minecraft RCON Extension`

### What to Include

Please provide as much information as possible:

- **Description** of the vulnerability
- **Steps to reproduce** the issue
- **Affected versions** 
- **Impact** - what can an attacker do?
- **Suggested fix** (if you have one)
- **Your contact information** for follow-up questions

### What to Expect

1. **Acknowledgment** - Within 48 hours of report
2. **Initial Assessment** - Within 1 week
3. **Fix Development** - Priority based on severity
4. **Security Advisory** - Published after fix is available
5. **Credit** - Security researchers will be credited (unless you prefer to remain anonymous)

## Security Considerations

### RCON Protocol Limitations

The RCON protocol itself has inherent security limitations:

- **No encryption** - RCON traffic is unencrypted
- **Plaintext passwords** - Authentication uses plaintext
- **No rate limiting** - Protocol doesn't include rate limiting

### Best Practices for Users

1. **Use strong passwords**
   - Don't use default or simple passwords
   - Use unique passwords per server

2. **Network security**
   - Don't expose RCON port to the internet
   - Use VPN or SSH tunneling for remote access
   - Configure firewall rules to limit access

3. **Credential storage**
   - Be cautious with saved credentials
   - Don't commit `.env` files with passwords
   - Use VS Code's secure storage when possible

4. **Server configuration**
   ```properties
   # In server.properties
   enable-rcon=true
   rcon.port=25575  # Consider changing default port
   rcon.password=USE_A_STRONG_PASSWORD_HERE
   broadcast-rcon-to-ops=false  # Don't broadcast to ops
   ```

### Extension Security Features

The extension implements several security measures:

- **Secure credential storage** - Uses VS Code's credential manager
- **No credential logging** - Passwords never written to logs
- **Connection timeouts** - Prevents hanging connections
- **Input validation** - Commands are validated before sending

### Known Security Considerations

1. **Saved Connections** - Stored in VS Code settings (use with caution on shared computers)
2. **Command History** - Previous commands stored in memory during session
3. **Cache Files** - Command cache doesn't contain credentials but shows server structure
4. **Debug Output** - May contain server information (but never passwords)

## Vulnerability Disclosure Policy

We follow responsible disclosure practices:

1. Security issues are fixed as highest priority
2. Patches developed privately before disclosure
3. Security advisory published when fix is available
4. Users notified via GitHub and VS Code Marketplace
5. 30-day disclosure timeline for most issues

## Security Updates

Stay informed about security updates:

- **Watch** the GitHub repository for releases
- **Subscribe** to security advisories
- **Enable** VS Code extension auto-updates
- **Check** CHANGELOG.md for security fixes

## Scope

### In Scope

Security issues in:
- The extension's TypeScript code
- RCON protocol implementation
- Credential handling
- Command execution
- Terminal rendering

### Out of Scope

- Minecraft server vulnerabilities
- RCON protocol design flaws
- VS Code platform issues
- Third-party dependencies (report to respective projects)
- Social engineering attacks

## Recognition

We appreciate security researchers who help keep our users safe. Contributors who report valid security issues will be acknowledged in our Hall of Fame (unless they prefer to remain anonymous).

### Hall of Fame
- *Your name could be here!*

## Contact

For non-security questions:
- GitHub Issues: https://github.com/jaketcooper/minecraft-rcon/issues
- Discussions: https://github.com/jaketcooper/minecraft-rcon/discussions

---

*This security policy is adapted from best practices recommended by GitHub and the Open Source Security Foundation.*

**Last updated**: October 2025  
**Policy version**: 1.0
