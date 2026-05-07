# Configuration Guide

The ArcGIS Velocity Simulator uses two separate configuration systems:

- **App Config** (`config.json`) — Persisted UI preferences: theme, font, window geometry, opacity, dialog sizes, and feature toggles. Saved automatically and restored on every launch.
- **Launch Config** (`launch-config*.json`) — Runtime behavior parameters: connection protocol, address, streaming rate, and output settings. Passed via `config=<path>` on the CLI for headless runs, or applied interactively through the **Apply Launch Config From…** menu action.

App Config controls how the application _looks_. Launch Config controls what the application _does_.

| Aspect | App Config | Launch Config |
|--------|-----------|---------------|
| **File** | `config.json` (platform data dir) | `launch-config*.json` (any path) |
| **Loaded** | Automatically on every startup | Explicitly via CLI `config=<path>` or menu action |
| **Saved** | Automatically on every UI change | Manually via **Save Launch Config To…** menu action |
| **Scope** | Persistent across sessions | Single run or on-demand application |
| **Contents** | Theme, font, window size/position, opacity, dialog sizes, feature toggles | Protocol, mode, IP, port, streaming rate, loop, output settings |
| **Menu actions** | Show / Apply / Save App Config | Show / Apply / Save Launch Config |

> See [HEADLESS.md](./HEADLESS.md) for headless launch-config examples and [COMMAND-LINE.md](./COMMAND-LINE.md) for the full CLI reference.

## File Location

- **macOS**: `~/Library/Application Support/arcgis-velocity-simulator/config.json`
- **Windows**: `%APPDATA%\arcgis-velocity-simulator\config.json`
- **Linux**: `~/.config/arcgis-velocity-simulator/config.json`

## Configuration Structure

```json
{
  "windowState": {
    "fullView": { "width": 1365, "height": 395, "x": 195, "y": 168, "splitterPosition": "285px" },
    "compactView": { "width": 249, "height": 285, "x": 380, "y": 205, "splitterPosition": "198.5px" },
    "currentView": "full"
  },
  "theme": "dark",
  "opacity": 1.0,
  "font": { "size": "16px", "family": "monospace" },
  "statusAreaVisible": true,
  "menuBarVisible": false,
  "cameraSupport": false,
  "microphoneSupport": false,
  "dialogSizes": {
    "appConfig": { "width": 660, "height": 400, "x": null, "y": null },
    "launchConfig": { "width": 500, "height": 400, "x": null, "y": null },
    "velocityLogin": { "width": 590, "height": 840, "x": null, "y": null }
  }
}
```

## Configuration Options

### Window State
- **fullView/compactView**: Window dimensions, position, and splitter position for each view mode
- **currentView**: Current view mode (`"full"` or `"compact"`)

When the application is started with no command-line parameters, it launches in normal UI mode and restores saved UI behavior from configuration, including `windowState.currentView`.

### Appearance
- **theme**: Selected theme name (see available themes below)
- **opacity**: Window transparency (0.5 to 1.0, default: 1.0)
- **font**: Status log font settings (size: 6px-25px, family)
- **statusAreaVisible**: Show/hide status area
- **menuBarVisible**: Show/hide menu bar (Windows/Linux)

### Feature Support
- **cameraSupport**: Enable/disable camera-related features (default: false)
  - Controls visibility of camera buttons - Toggle Camera, Report Camera Gestures, Log Camera Gestures
  - When disabled, automatically turns off camera if active
  - In compact mode, camera buttons are hidden regardless of support state
- **microphoneSupport**: Enable/disable microphone-related features (default: false)
  - Controls visibility of microphone buttons - Toggle Microphone, Toggle Offline Speech Recognition (Web Audio API), Log Microphone Commands
  - When disabled, automatically turns off both Web Speech API and Offline Speech Recognition if active
  - In compact mode, microphone buttons are hidden regardless of support state
  - Network errors are logged only once per session to reduce spam

### Dialog Sizes
- **dialogSizes.appConfig**: Remembered width, height, and position (x, y) of the App Config dialog
- **dialogSizes.launchConfig**: Remembered width, height, and position (x, y) of the Launch Config dialog
- **dialogSizes.velocityLogin**: Remembered width, height, and position (x, y) of the Velocity Login & Feed Picker dialog (default: 590 x 840)

Size and position are saved automatically when the user resizes or moves either dialog, and restored on next open. When `x` and `y` are `null` (the default), the dialog is centered by the OS.

## Available Fonts

The application supports 17 different font families for the status log:

| Font | Description | Category |
|------|-------------|----------|
| **Default (Monospace)** | System monospace font | Monospace |
| **Arial** | Clean, readable sans-serif | Sans-serif |
| **Brush Script MT** | Decorative script font | Script |
| **Comic Sans MS** | Casual, friendly font | Sans-serif |
| **Courier New** | Classic monospace font | Monospace |
| **cursive** | Generic cursive font | Cursive |
| **Garamond** | Classic serif font | Serif |
| **Georgia** | Elegant serif font | Serif |
| **Helvetica** | Modern sans-serif | Sans-serif |
| **Lucida Console** | Console-style monospace | Monospace |
| **Monospace** | Generic monospace font | Monospace |
| **Palatino** | Traditional serif font | Serif |
| **Segoe UI** | Modern UI font | Sans-serif |
| **Tahoma** | Compact sans-serif | Sans-serif |
| **Times New Roman** | Classic serif font | Serif |
| **Trebuchet MS** | Modern sans-serif | Sans-serif |
| **Verdana** | Readable sans-serif | Sans-serif |

### Font Categories
- **Sans-serif**: Clean, modern fonts (Arial, Helvetica, Segoe UI, etc.)
- **Serif**: Traditional fonts with decorative strokes (Times New Roman, Georgia, etc.)
- **Monospace**: Fixed-width fonts for code and data (Courier New, Lucida Console, etc.)
- **Script/Cursive**: Decorative fonts (Brush Script MT, cursive)

## Available Themes

| Theme | ID | Description |
|-------|----|-----------|
| 🔵 Blue | `"blue"` | Professional blue theme |
| 🟡 Color Blind | `"color-blind"` | High contrast accessibility theme |
| 🌙 Dark | `"dark"` | Classic dark theme (default) |
| 🌫️ Dark Gray | `"dark-gray"` | Softer dark theme |
| 🟢 Green | `"green"` | Nature-inspired green theme |
| ⚫ High Contrast | `"high-contrast"` | Maximum contrast for accessibility |
| ☀️ Light | `"light"` | Clean, bright light theme |
| ☁️ Light Gray | `"light-gray"` | Subtle light theme |
| 🌌 Midnight | `"midnight"` | Deep, rich dark theme |
| ☕ Mocha | `"mocha"` | Warm brown coffee-inspired theme |
| 🌊 Ocean | `"ocean"` | Cool blue-green aquatic theme |
| 🌸 Rose | `"rose"` | Elegant pink and rose theme |
| 🌺 Rose Dark | `"rose-dark"` | Dark variant of rose theme |
| 🌅 Sunset | `"sunset"` | Warm orange and yellow theme |
| 💻 System | `"system"` | Matches OS light/dark mode |

## Automatic Saving

Configuration is automatically saved when:
- Window is resized or moved
- View mode is toggled (full ↔ compact)
- Splitter is moved
- Theme is changed
- Status area visibility is toggled
- Window opacity is changed
- Font size or family is changed
- Camera support is toggled
- Microphone support is toggled
- App Config or Launch Config dialog is resized or moved
- Application exits

## Manual Editing

To manually edit the configuration:
1. Close the application
2. Edit the JSON file with any text editor
3. Ensure valid JSON format
4. Restart the application

## Import/Export

The application provides methods for configuration backup and restore:

### Available Methods
- `exportConfig(filePath, config)` - Export current configuration
- `importConfig(filePath)` - Import and apply configuration
- `readConfigFile(filePath)` - Read configuration without importing
- `writeConfigFile(filePath, config)` - Write configuration data
- `getConfigPath()` - Get current configuration file path

### Usage Examples
```javascript
// Export current configuration
const result = await window.api.exportConfig('/path/to/backup.json');

// Import configuration
const result = await window.api.importConfig('/path/to/backup.json');

// Get current config path
const configPath = await window.api.getConfigPath();
```

## Headless Run Configuration

Headless mode also accepts an optional `config=/path/to/launch-config.json` command-line parameter. This file is separate from the UI settings file and is intended for automation or scheduled runs.

CLI values always override values loaded from the headless launch-config file.

A ready-to-copy template is available at [`docs/launch-config.sample.json`](./launch-config.sample.json).
Mode-specific examples are also available at [`docs/launch-config.server.sample.json`](./launch-config.server.sample.json) and [`docs/launch-config.client.sample.json`](./launch-config.client.sample.json).

For the full consolidated parameter table, help-layout options, and mirrored headless examples, see [`COMMAND-LINE.md`](./COMMAND-LINE.md) and [`HEADLESS.md`](./HEADLESS.md).

### Supported Headless Keys

- `autoConnect`
- `autoStart`
- `config`
- `connectRetryIntervalMs`
- `connectTimeoutMs`
- `connectWaitForServer`
- `doneFile`
- `endLine`
- `exitOnComplete`
- `explain`
- `filename`
- `grpcHeaderPath`
- `grpcHeaderPathKey`
- `grpcSerialization`
- `intervalMs`
- `ip`
- `linesPerInterval`
- `logFile`
- `logLevel`
- `loop`
- `maxLines`
- `mode`
- `onError`
- `port`
- `protocol`
- `runId`
- `runMode`
- `startLine`
- `stdout`
- `waitForClient`

### IP Default and Binding Behavior

The default headless `ip` value is **`127.0.0.1`**.

- **`127.0.0.1`** is the loopback/local-only address. It is the default because it is the safest option for local testing.
- **`0.0.0.0`** is typically used in **server** mode when the simulator should bind to all local interfaces and accept connections from other machines.

In other words:

- use `127.0.0.1` for same-machine testing
- use `0.0.0.0` for server-mode listening beyond localhost

### Supported Shapes

The launch-config file can use either top-level keys or grouped sections such as `connection`, `headless`, `output`, and `streaming`.

```json
{
  "connection": {
    "connectRetryIntervalMs": 1000,
    "connectTimeoutMs": 30000,
    "connectWaitForServer": false,
    "ip": "0.0.0.0",
    "mode": "server",
    "port": 5565,
    "protocol": "tcp",
    "waitForClient": false
  },
  "headless": {
    "filename": "./data.csv",
    "runMode": "headless"
  },
  "output": {
    "doneFile": "./run.done.json",
    "logLevel": "info",
    "stdout": true
  },
  "streaming": {
    "endLine": 100,
    "intervalMs": 1000,
    "linesPerInterval": 1,
    "startLine": 1,
    "waitForClient": true
  }
}
```

See [HEADLESS.md](./HEADLESS.md) for full command examples.

## Troubleshooting


### Resetting Configuration

You can reset all configuration settings to their default values using the application's main menu (Configuration → Reset Configuration) or the context menu (**Reset Config**). When you reset the configuration:

- **All settings are restored to their default values** (window size, position, theme, font, etc.)
- **The current view mode (full or compact) is preserved**. This means if you are in compact view, you will remain in compact view after the reset, and vice versa.

#### Manual Reset (Legacy)
1. Close the application
2. Delete the configuration file
3. Restart the application (creates new config with defaults)

### Backup Configuration
```bash
# macOS
cp ~/Library/Application\ Support/arcgis-velocity-simulator/config.json ~/Desktop/backup.json

# Windows
copy "%APPDATA%\arcgis-velocity-simulator\config.json" "%USERPROFILE%\Desktop\backup.json"

# Linux
cp ~/.config/arcgis-velocity-simulator/config.json ~/Desktop/backup.json
```

### Common Issues
- **Settings not loading**: Check file exists, valid JSON format, file permissions
- **Invalid JSON**: Use JSON validator to check syntax
- **Permission errors**: Ensure app has read/write access to config directory

## Technical Details

- **ConfigManager class**: `src/config.js` - Handles all file operations and validation
- **IPC communication**: Secure context bridge for main/renderer communication
- **Automatic saving**: Debounced saves prevent excessive file writes
- **Theme system**: 15 themes with CSS variables in `src/themes.css`
- **Testing**: Comprehensive unit tests in `test/config.test.js`