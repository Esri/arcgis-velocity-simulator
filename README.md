# ArcGIS Velocity Simulator

![ArcGIS Velocity Simulator Icon](src/assets/icon-64x64.png)

<p style="text-align: center;">
  <img src="src/assets/screenshot-01.png" alt="Screenshot of the ArcGIS Velocity Simulator interface">
</p>

<p style="text-align: center;"><em>Main ArcGIS Velocity Simulator application interface.</em></p>

A cross-platform desktop application for simulating data streams over TCP, UDP,
HTTP/HTTPS, WebSocket, gRPC, and XMPP protocols. Load CSV files and send data at
configurable intervals for testing and development purposes. Every protocol runs
as either a client or a server, so the Simulator can push data to a receiver
such as an ArcGIS Velocity feed or an ArcGIS GeoEvent Server connector, or host
an endpoint the receiver connects to.

## Documentation

Every guide lives in [`docs`](docs/README.md), which is the single documentation
index. The catalog below links the guides you are most likely to need; the index
lists all of them with their intended audience.

| Guide | Summary |
|-------|---------|
| [Documentation index](docs/README.md) | Every guide with its purpose and audience, plus documentation maintenance rules. |
| [Build and release](docs/build-and-release.md) | Prerequisites, local builds, platform packaging, code signing, and release commands. |
| [Command-line reference](docs/command-line.md) | Every CLI parameter, help layout, default, and usage example. |
| [Protocol settings and presets](docs/connection-presets.md) | The connection panel, the Protocol Settings dialog, and the twelve paired Simulator and Logger presets. |
| [Connection summary and protocol settings](docs/connection-summary.md) | The Protocol Settings dialog, its sections, and the three connection summary surfaces. |
| [Configuration](docs/configuration.md) | Configuration file format, settings, themes, fonts, storage locations, and launch configuration samples. |
| [Developer guide](docs/developer-guide.md) | Repository structure, local development, tests, documentation checks, debugging, logging, and extension points. |
| [Headless mode](docs/headless.md) | No-UI replay: parameters, launch configuration workflow, output formats, and the done file. |
| [gRPC transport](docs/grpc.md) | gRPC modes, Protobuf, Kryo, and Text serialization, and TLS. |
| [HTTP and HTTPS transport](docs/http.md) | HTTP modes, JSON, CSV, Esri JSON, GeoJSON, and XML formats, and TLS. |
| [WebSocket transport](docs/websocket.md) | WebSocket modes, formats, TLS, subscription messages, and custom headers. |
| [XMPP transport](docs/xmpp.md) | Client and server roles, Direct and Room conversations, STARTTLS policies, accounts, and explicit limitations. |
| [TLS and SSL security](docs/tls.md) | Certificate formats, operating system trust stores, mutual TLS, self-signed certificates, and the TLS Trust Badge. |
| [ArcGIS Velocity sign-in and feed picker](docs/velocity-login.md) | ArcGIS Velocity sign-in, feed picker, token-based authentication, and auto-configuration. |
| [Keyboard shortcuts](docs/keyboard-shortcuts.md) | Every keyboard shortcut and the context menu reference. |
| [Offline speech recognition](docs/offline-speech.md) | Local voice control: setup, supported commands, and troubleshooting. |

### In-app help

- **`F1`** — Help dialog
- **`F3`** — Command Line Interface dialog (searchable CLI reference, copy/export)
- **Right-click** — Context menu (themes, fonts, opacity, tools)

### Launch configuration samples

Ready-to-copy templates for headless runs live in `docs/examples`:

- [Generic sample](docs/examples/launch-config.sample.json) — every supported section and key
- [Server-mode sample](docs/examples/launch-config.server.sample.json) — binds locally and replays immediately
- [Client-mode sample](docs/examples/launch-config.client.sample.json) — connects to an existing endpoint
- [XMPP sample](docs/examples/launch-config.xmpp.sample.json) — signs in as an XMPP client on port 5222

## Overview

The ArcGIS Velocity Simulator is designed for developers and testers who need to
simulate real-time data streams. It provides a comprehensive solution for:

- **Data Streaming**: Send CSV data over TCP, UDP, HTTP/HTTPS, WebSocket, gRPC, or XMPP in server or client mode
- **Cross-Platform Support**: Native apps for macOS, Windows, and Linux
- **Hands-Free Operation**: Gesture and voice control for accessibility
- **Rich Customization**: 15 themes, 17 fonts, dual view modes, and persistent configuration
- **Developer-Friendly**: Comprehensive debugging tools and testing infrastructure

The application follows a modern Electron architecture with secure IPC
communication, robust error handling, and extensive documentation.

## Key features

- **Data Streaming**: Send CSV data over TCP, UDP, HTTP/HTTPS, WebSocket, gRPC, or XMPP in server or client mode
- **Cross-Platform**: Native apps for macOS, Windows, and Linux
- **Headless Automation**: Run batch streaming sessions with no UI using command-line parameters
- **Interactive Help & Command-Line Reference**: Open `F1` for the general Help dialog and `F3` for the dedicated Command Line Interface dialog with searchable, sortable parameters, quick chips, active-filter pills, and visible-row copy/export in TSV, CSV, Markdown, or JSON
- **Gesture & Voice Control**: Hands-free operation with webcam and microphone
- **15 Themes**: 🔵 Blue, 🟡 Color Blind, 🌙 Dark, 🌫️ Dark Gray, 🟢 Green, ⚫ High Contrast, ☀️ Light, ☁️ Light Gray, 🌌 Midnight, ☕ Mocha, 🌊 Ocean, 🌸 Rose, 🌺 Rose Dark, 🌅 Sunset, 💻 System
- **Dual View Modes**: Full interface or compact minimalist view
- **Configuration Management**: Persistent settings and state across sessions
- **Feature Support Controls**: Enable/disable camera and microphone features as needed
- **Status Log Sorting**: Toggle ascending/descending order for status messages with a single click
- **Granular Logging Controls**: Toggle hand-gesture and microphone command logging for concise or verbose status output

## Feature support controls

The application includes configurable support for camera and microphone
features. These can be enabled or disabled through the application menus:

### Camera support
- **Location**: Configuration menu → Camera Support
- **Controls**: Toggle Camera, Report Camera Gestures, Log Camera Gestures
- **Default**: Disabled (buttons hidden)
- **Safety**: Automatically turns off camera when support is disabled
- **Compact Mode**: Camera buttons are hidden in compact view

### Microphone support
- **Location**: Configuration menu → Microphone Support
- **Controls**: Toggle Microphone (Web Speech API), Toggle Offline Speech Recognition (Web Audio API), Log Microphone Commands
- **Default**: Disabled (buttons hidden)
- **Safety**: Automatically turns off both microphone systems when support is disabled
- **Compact Mode**: Microphone buttons are hidden in compact view
- **Error Handling**: Network errors are logged once per session, microphone remains controllable

### Access methods
- **Main Menu**: Configuration → Camera Support / Microphone Support
- **Context Menu**: Right-click → Camera Support / Microphone Support
- **Persistence**: Settings are saved to configuration file and restored on startup

## Hand gesture controls

Control the simulator hands-free using your webcam and TensorFlow.js for
real-time hand gesture recognition.

### Setup
1. Click the **Cam** button in the header
2. Allow webcam access when prompted
3. Perform gestures in front of the camera

### Supported gestures
| Gesture | Action | Description |
|:---|:---|:---|
| 👍 Thumbs Up | **Connect** | Establishes connection to TCP/UDP endpoint |
| 🤙 Pinky Up | **Disconnect** | Terminates active connection |
| 👊 Closed Fist | **Play / Resume** | Starts or resumes sending data |
| 🖐️ Open Palm | **Pause** | Pauses the data stream |
| ✌️ Victory Sign | **Step** | Sends next single line of data |

## Voice controls

The application supports two voice control systems for hands-free operation:

### 1. Online voice recognition (Web Speech API)
Voice commands using the Web Speech API for internet-connected environments.

#### Setup
1. Click the **Mic** button in the header
2. Allow microphone access when prompted
3. Speak commands clearly

#### Status messages
- **On**: "Microphone (Web Speech API) on. Supported commands: connect, disconnect, play, start, pause, stop, step, switch, toggle view"
- **Off**: "Microphone (Web Speech API) off."
- **Network Error**: "Web Speech API requires internet connection. Use the offline microphone button for local speech recognition." (logged once per session)

#### Supported voice commands
| Command | Action | Description |
| :--- | :--- | :--- |
| "connect" | **Connect** | Establishes connection to TCP/UDP endpoint |
| "disconnect" | **Disconnect** | Terminates active connection |
| "play", "start" | **Play** | Starts or resumes sending data |
| "pause", "stop" | **Pause** | Pauses the data stream |
| "step" | **Step** | Sends next single line of data |
| "switch", "toggle view" | **Switch Views** | Toggles between full and compact interface |

### 2. Offline voice recognition (Web Audio API)
Privacy-focused offline voice recognition using frequency analysis.

#### Setup
1. Click the **Offline Mic** button (checkmark icon) in the header
2. Enable "Log Microphone Commands" for detailed feedback
3. Allow microphone access when prompted
4. Speak commands clearly and distinctly

#### Status messages
- **On**: "Microphone (Web Audio API) Offline Speech Recognition on. Supported commands: connect, disconnect, play, start, pause, stop, step, switch, toggle view"
- **Off**: "Microphone (Web Audio API) Offline Speech Recognition off."

For a complete feature overview, setup tips, and troubleshooting, see the
offline guide: [Offline speech recognition](docs/offline-speech.md).

#### Features
- **100% Offline**: No internet connection required
- **Privacy-Focused**: All processing happens locally
- **Visual Feedback**: Real-time audio visualization
- **Frequency Analysis**: Pattern-based command recognition

#### Supported commands
| Command | Action | Frequency Pattern |
| :--- | :--- | :--- |
| "connect" | **Connect** | Balanced low-mid frequencies |
| "disconnect" | **Disconnect** | Low frequency dominant |
| "play", "start" | **Play** | High frequency dominant |
| "pause", "stop" | **Pause** | Low frequency dominant |
| "step" | **Step** | High-mid frequency mix |
| "switch", "toggle view" | **Switch Views** | Mid frequency dominant |

## Quick reference

### Keyboard shortcuts
- `Ctrl+I` / `Cmd+I` - Open Preferences
- `Ctrl+Shift+C` / `Cmd+Shift+C` - Connect
- `Ctrl+D` / `Cmd+D` - Disconnect
- `Ctrl+Shift+P` / `Cmd+Shift+P` - Protocol Settings
- `Ctrl+Shift+I` / `Cmd+Shift+I` - Connection Summary
- `Ctrl+T` / `Cmd+T` - Toggle View (Full/Compact)
- `F1` - Help, `F2` - About, `F3` - Command Line Interface

Inside the Command Line Interface dialog, you can also use `Ctrl+F` / `Cmd+F`
(or `/`) to focus the command-line filter and `Escape` to close the dialog.

See [Keyboard shortcuts](docs/keyboard-shortcuts.md) for complete list.

### Connection controls
- **Panel**: File, **Preset**, **Mode**, **Connection** (host and port), **Protocol Settings…**, replay rate, and the connection actions.
- **Protocol Settings…**: Opens an in-window dialog holding every setting of the selected protocol, grouped into Basics, Security, and Advanced. Shown for HTTP, WebSocket, gRPC, and XMPP. Edits apply to the next connection; nothing is sent until you select **Connect**.
- **Connection Summary**: A read-only card below the panel and a status-bar chip describe what the current fields add up to, including warnings such as a disabled certificate verification. Passwords are reported only as `Set (hidden)`, `Empty`, or `Not set`.

### Status Log controls
- **Sort Order**: Use the sort button in the Status Log header to switch between **Ascending** and **Descending** order (default: Ascending). The icon changes to reflect the current order.
- **Show/Hide**: Use the status log toggle in the top header to show or hide the panel. Visibility is persisted across sessions.
- **Clear**: Use the trash icon to clear the log and reset counters.

### Context menu (right-click)
- Theme selection (🔵🟡🌙🌫️🟢⚫☀️☁️🌌☕🌊🌸🌺🌅💻 15 themes)
- Opacity control (50%–100% window transparency)
- Font size and family adjustment
- Configuration management
- Developer tools
- View mode switching

## Quick start

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or newer)
- [npm](https://www.npmjs.com/) (comes with Node.js)

### Installation and usage

```bash
npm install
```

**Running the app:**

| Command | Purpose |
|---------|---------|
| `npm start` | Launch in UI mode |
| `npm start -- filename=./example-data.csv` | Launch with a file preloaded |

**Command-line help:**

| Command | Output |
|---------|--------|
| `npm run help:cli` | Compact layout |
| `npm run help:cli:wide` | Wide ASCII table |
| `npm run help:cli:narrow` | Narrow ASCII table |
| `npm start -- help=true` | Compact (via launcher) |
| `npm start -- -h` | Short alias |
| `npm start -- --help` | Bare flag |
| `npm start -- help-table-wide=true` | Wide table (via launcher) |
| `npm start -- --help-table-wide` | Wide table (bare flag) |
| `npm start -- help-table-narrow=true` | Narrow table (via launcher) |
| `npm start -- --help-table-narrow` | Narrow table (bare flag) |

**Headless batch session:**

```bash
npm run start:headless -- filename=./example-data.csv protocol=tcp mode=client ip=127.0.0.1 port=5565 linesPerInterval=1 intervalMs=1000 autoConnect=true autoStart=true loop=false exitOnComplete=true stdout=true
```

### Headless mode

When no parameters are provided, the app starts in the normal UI mode and
preserves saved UI behavior from configuration, including the saved compact/full
view.

The app also supports a true no-UI execution path with `runMode=headless` (or
`runMode=silent`). In this mode the Electron process does not create the splash
screen or the main window; instead, a backend simulation engine loads the file,
establishes the network transport, streams records, and exits when complete if
configured to do so.

Common parameters include:

- `filename=/path/to/file.csv`
- `protocol=tcp|udp|grpc|http|ws|xmpp`
- `mode=server|client`
- `ip=127.0.0.1`
- `port=5565`
- `linesPerInterval=1`
- `intervalMs=1000`
- `loop=true|false`
- `waitForClient=true|false`
- `startLine=1`
- `endLine=500`
- `maxLines=1000`
- `connectTimeoutMs=5000`
- `logLevel=error|warn|info|debug`
- `logFile=/path/to/run.log`
- `doneFile=/path/to/run.done.json`
- `onError=exit|continue|pause`

Only `filename` is required once headless mode has been selected; all other
headless parameters are optional and have defaults.

For `ip`, the default is `127.0.0.1` for local-only testing. In server mode, use
`ip=0.0.0.0` when the simulator should listen on all interfaces so other
machines can connect.

Standard help (`npm run help:cli`, `npm start -- help=true`, `npm start --
h=true`, `npm start -- -h`, or `npm start -- --help`) uses the non-table layout.

Unknown CLI parameters — including bare positional arguments without
`name=value` syntax — abort startup with a clear error message, display the help
text, and exit the app without launching the UI or headless runner.

Headless-only parameters passed in UI mode (e.g. `port=6000`, `protocol=udp`)
are **not** errors. A `CLI warning:` line is logged per parameter explaining why
it has no effect, and the app continues to launch normally. The same applies in
headless mode for parameters that don't apply to the current sub-configuration
(e.g. `connectRetryIntervalMs` when `connectWaitForServer=false`).

By default the app prints a **startup explanation** to the console showing the
resolved run mode, active parameters, and any warnings. Pass `explain=false` to
suppress this output.

The same command-line metadata is also surfaced inside the dedicated in-app
Command Line Interface dialog (`F3`) as a searchable reference with quick
category chips, active-filter pills, sortable columns, and copy/export actions
for visible rows in TSV, CSV, Markdown, or JSON format. The Command Line
Interface dialog and markdown guides use the same six-column CLI schema: Name,
Supported Values, Default, Required in Headless Mode, Example, and Purpose.

If you prefer an ASCII table, use either of these explicit help-layout
parameters:

- `npm run help:cli:wide`, `help-table-wide=true`, or `--help-table-wide` for wider terminals
- `npm run help:cli:narrow`, `help-table-narrow=true`, or `--help-table-narrow` for tighter terminals

When multiple help layouts are requested together, the narrower table layout
takes precedence over the wider table layout, and either table layout takes
precedence over standard help.

For the complete parameter list, defaults, required/optional rules, and
examples, see [Command-line reference](docs/command-line.md) and [Headless
mode](docs/headless.md). Ready-to-copy templates are included in
`docs/examples`: a [generic sample](docs/examples/launch-config.sample.json), a
[server-mode sample](docs/examples/launch-config.server.sample.json), a
[client-mode sample](docs/examples/launch-config.client.sample.json), and an
[XMPP sample](docs/examples/launch-config.xmpp.sample.json).

You can launch the included templates directly:

```bash
npm run start:headless -- config=./docs/examples/launch-config.sample.json
npm run start:headless -- config=./docs/examples/launch-config.server.sample.json
npm run start:headless -- config=./docs/examples/launch-config.client.sample.json
npm run start:headless -- config=./docs/examples/launch-config.xmpp.sample.json
```

You can also override individual values at launch time without editing the file:

```bash
npm run start:headless -- config=./docs/examples/launch-config.client.sample.json ip=192.168.1.25 port=6000 runId=manual-override
```

### First steps
1. **Load Data**: Click "Select File" to load a CSV file
2. **Configure Connection**: Set IP address, port, and connection type (TCP/UDP)
3. **Connect**: Click "Connect" or use gesture/voice control
4. **Start Streaming**: Click "Play" to begin sending data
5. **Monitor**: Watch the status bar for real-time feedback

### Hands-free control
- **Gesture Control**: Click the camera icon and perform hand gestures
- **Online Voice Control**: Click the microphone icon and speak commands (requires internet)
- **Offline Voice Control**: Click the offline microphone icon for privacy-focused voice control
- **Keyboard Shortcuts**: Use keyboard shortcuts for quick access (see [Keyboard shortcuts](docs/keyboard-shortcuts.md))

### Customization
- **Themes**: Right-click to access 15 different themes
- **Fonts**: Choose from 17 font families for the status log
- **View Modes**: Toggle between full and compact interface
- **Configuration**: Persistent settings across sessions


### Configuration
Settings are automatically saved to platform-specific locations:
- **macOS**: `~/Library/Application Support/arcgis-velocity-simulator/config.json`
- **Windows**: `%APPDATA%\arcgis-velocity-simulator\config.json`
- **Linux**: `~/.config/arcgis-velocity-simulator/config.json`

#### Resetting the configuration
You can reset all settings to their defaults from the main menu (Configuration →
Reset Configuration) or the context menu (**Reset Config**). The app will keep
your current view mode (full or compact) after reset.
## Development

### Getting started
1. Clone the repository.
2. Install dependencies: `npm install`
3. Start the application in development mode: `npm start`

### Debugging
For a comprehensive guide on debugging the main and renderer processes, see
[Developer guide](docs/developer-guide.md#debugging).

| Command | Purpose |
|---------|---------|
| `npm run debug-main` | Debug backend (port 9229) |
| `npm run debug-renderer` | Debug frontend (port 9222) |
| `npm run debug-both` | Debug both processes simultaneously |

### Testing
For a detailed guide on the testing infrastructure, see
[Developer guide](docs/developer-guide.md#testing).

| Command | What it tests |
|---------|---------------|
| `npm test` | All test suites |
| `npm run test:config` | Configuration management |
| `npm run test:cli` | Command-line parsing and help |
| `npm run test:engine` | Headless simulation engine |
| `npm run test:headless-runner` | Headless runner entry path |
| `npm run test:help` | Help dialog and CLI Reference dialog |
| `npm run test:renderer` | UI / DOM |
| `npm run test:preload` | Preload API bridge |
| `npm run test:about` | About dialog |

### Building packages
The application uses [electron-builder](https://www.electron.build/) for
creating distributable packages.

| Command | Platforms | Notes |
|---------|-----------|-------|
| `npm run package` | All (parallel) | Same as `package:all` |
| `npm run package:all` | All (parallel) | Alias for `package` |
| `npm run package:mac` | macOS | `.dmg`, `.zip` |
| `npm run package:win` | Windows | `.exe` installer, portable |
| `npm run package:win:zip` | Windows | ZIP archive (x64) |
| `npm run package:linux` | Linux | `.AppImage`, `.deb` |
| `npm run package:seq` | All (sequential) | Includes Windows ZIP |
| `npm run package:seq:clean` | All (sequential) | Cleans `dist/` first |
| `npm run clean` | — | Deletes `dist/` |

For full details on build options, compression, artifact names, code signing,
and publishing a release with `scripts/release.sh`, see [Build and
release](docs/build-and-release.md).

### Code quality
- **Testing**: Comprehensive unit tests with JSDOM.
- **Error Handling**: Multi-level error handling strategy.
- **Security**: Context isolation and secure IPC communication.
- **Documentation**: Extensive inline documentation and guides.
- **Structure**: For the module layout and extension points, review the [Developer guide](docs/developer-guide.md).

## Issues

Find a bug or want to request a new feature? Please [submit an
issue](https://github.com/Esri/arcgis-velocity-simulator/issues).

## Contributing

Esri welcomes contributions from anyone and everyone. Please see our [guidelines
for contributing](https://github.com/esri/contributing).

## License

Copyright 2026 Esri

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.

A copy of the license is available in the repository's [LICENSE](LICENSE) file.


## Project structure

```text
arcgis-velocity-simulator/
├── src/                         # Source code
│   ├── main.js                  # Main process (backend)
│   ├── renderer.js              # Renderer process (frontend)
│   ├── preload.js               # IPC bridge and security
│   ├── config.js                # Configuration management
│   ├── gestures.js              # Hand gesture recognition
│   ├── voice.js                 # Voice command recognition (Web Speech API)
│   ├── simple-offline-speech.js # Offline voice recognition (Web Audio API)
│   ├── assets/                  # Icons and images
│   ├── themes/                  # Individual theme files
│   │   ├── theme-dark.css       # Default theme (fallback)
│   │   ├── theme-light.css      #
│   │   └── ...                  # 13 additional themes
│   ├── themes.css               # Theme loader and imports
│   ├── *.html                   # UI templates
│   └── *.css                    # Styling
├── test/                        # Test suite
└── dist/                        # Build outputs
```

## Technology stack

- **Electron** - Cross-platform desktop framework
- **Node.js** - Backend runtime and networking
- **JavaScript/HTML/CSS** - Frontend technologies
- **TensorFlow.js** - Hand gesture recognition
- **Web Speech API** - Online voice command recognition
- **Web Audio API** - Offline voice command recognition
