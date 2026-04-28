# Documentation

This folder contains all technical and user-facing documentation for the ArcGIS Velocity Simulator. Each guide is self-contained and cross-linked where relevant.

## Guides

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design: process topology, component responsibilities, IPC communication, data flow, security model, and testing architecture |
| [BUILD.md](./BUILD.md) | All build and packaging scripts — per-platform builds, sequential and parallel multi-platform builds, compression options, output artifacts, and code-signing notes |
| [COMMAND-LINE.md](./COMMAND-LINE.md) | Complete CLI parameter reference: all parameters, supported values, defaults, required/optional rules, help layouts, and usage examples |
| [CONFIG.md](./CONFIG.md) | Configuration file format, all settings, themes, fonts, and platform-specific storage locations |
| [DEBUGGING.md](./DEBUGGING.md) | Debug commands, Chrome DevTools and VSCode setup, headless mode debugging, common issues, and production log file locations |
| [DEVELOPMENT-SUMMARY.md](./DEVELOPMENT-SUMMARY.md) | Technical implementation details, recent changes, and development decisions |
| [DOCUMENTATION.md](./DOCUMENTATION.md) | Full documentation index with audience classification, maintenance schedule, and contribution guidelines |
| [GRPC.md](./GRPC.md) | gRPC transport: modes (client/server), serialization formats (Protobuf, Kryo, Text), TLS, and metadata |
| [HTTP.md](./HTTP.md) | HTTP/HTTPS transport: modes (client/server), data formats (JSON, CSV, Esri JSON, GeoJSON, XML), TLS, and metadata |
| [WEBSOCKET.md](./WEBSOCKET.md) | WebSocket (ws/wss) transport: modes, formats, TLS, subscription messages, custom headers |
| [HEADLESS.md](./HEADLESS.md) | No-UI automation: running headless sessions, all headless-specific parameters, config file workflow, output formats, and the `doneFile` artifact |
| [KEYBOARD-SHORTCUTS.md](./KEYBOARD-SHORTCUTS.md) | All keyboard shortcuts, context menu reference, and in-app Command Line Interface dialog shortcuts |
| [OFFLINE-SPEECH-README.md](./OFFLINE-SPEECH-README.md) | Offline speech recognition: setup, supported commands, frequency-analysis internals, and troubleshooting |
| [RELEASE-NOTES.md](./RELEASE-NOTES.md) | User-facing features, changes, and fixes by release |
| [RELEASE.md](./RELEASE.md) | Release process: GitHub Actions workflow, version tagging, and code signing for macOS, Windows, and Linux |
| [SPEECH-INTEGRATION-SUMMARY.md](./SPEECH-INTEGRATION-SUMMARY.md) | Architecture and integration summary for the offline Web Audio API speech recognition system |
| [TESTING.md](./TESTING.md) | Test commands, test suite descriptions, manual smoke tests, and troubleshooting |
| [THEME-REFACTORING.md](./THEME-REFACTORING.md) | Details of the theme system refactoring: per-file CSS, dynamic loader, and migration notes |
| [WHY-ELECTRON.md](./WHY-ELECTRON.md) | Rationale for choosing Electron: framework comparison, packaging overview, and trade-off analysis |

## Config Templates

| File | Purpose |
|------|---------|
| [`launch-config.sample.json`](./launch-config.sample.json) | Generic headless session template |
| [`launch-config.server.sample.json`](./launch-config.server.sample.json) | Server-mode headless template |
| [`launch-config.client.sample.json`](./launch-config.client.sample.json) | Client-mode headless template |

---

Back to project root: [README.md](../README.md)

