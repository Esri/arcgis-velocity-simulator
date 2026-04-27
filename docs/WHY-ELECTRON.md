# Why Electron Was Chosen

## Project Requirements

- **Cross-Platform**: Single codebase for Windows, macOS, and Linux
- **Rich UI**: Themes, dialogs, font/opacity controls, responsive layout
- **Networking**: TCP, UDP, and gRPC (client and server modes)
- **Rapid Development**: Web technologies enable fast UI iteration

## Decision Summary

| Framework | Pros | Cons |
|-----------|------|------|
| **Electron** ✓ | True cross-platform, rapid UI dev, vast npm ecosystem | Higher memory, larger app size |
| Qt | Native performance, mature | Steep learning curve, licensing complexity |
| JavaFX | JVM portable | UI inconsistencies, smaller community |
| .NET | Great Windows integration | Not truly cross-platform |

Electron was chosen because it satisfies all requirements from a single JavaScript codebase. Node.js handles networking (TCP/UDP/gRPC, file I/O) and the renderer handles UI — no context switching between languages.

Key features it enables: 15 themes via a dynamic CSS-variable loader, persistent layouts, headless mode with no UI overhead, and a responsive single-row header.

## Packaging and Distribution

**electron-builder** produces distributable packages for all platforms. See [BUILD.md](./BUILD.md) for all package scripts and compression options.

- **macOS**: `.dmg` and `.zip`
- **Windows**: NSIS installer (`.exe`) and portable executable
- **Linux**: `.AppImage` and `.deb`

## Notable Apps Built with Electron

VS Code, GitHub Desktop, Slack, Discord, Microsoft Teams, Postman, Notion, Figma, 1Password, WhatsApp Desktop.
