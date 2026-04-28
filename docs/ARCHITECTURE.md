# Architecture Documentation

## Overview

The ArcGIS Velocity Simulator is a cross-platform desktop application built with Electron that simulates data streams over TCP, UDP, HTTP/HTTPS, WebSocket, and gRPC protocols. The application follows a multi-process architecture with clear separation between the main process (backend) and renderer process (frontend).

## System Architecture

### High-Level Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                    ArcGIS Velocity Simulator                  │
├───────────────────────────────────────────────────────────────┤
│  Main Process (Node.js)           │  Renderer Process         │
│  ┌─────────────────────────────┐  │  ┌─────────────────────┐  │
│  │ • Window Management         │  │  │ • User Interface    │  │
│  │ • File System Operations    │◄─┼──┤ • Theme Management  │  │
│  │ • Network Operations        │  │  │ • Gesture Detection │  │
│  │ • Configuration Management  │  │  │ • Voice Recognition │  │
│  │ • IPC Communication         │  │  │ • State Management  │  │
│  └─────────────────────────────┘  │  └─────────────────────┘  │
│                                   │                           │
│  ┌─────────────────────────────┐  │  ┌─────────────────────┐  │
│  │ • TCP/UDP/HTTP/WS/gRPC      │  │  │ • CSV Data Loading  │  │
│  │ • File I/O Operations       │  │  │ • Data Streaming    │  │
│  │ • System Integration        │  │  │ • UI Event Handling │  │
│  └─────────────────────────────┘  │  └─────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

### Process Communication

The application uses Electron's Inter-Process Communication (IPC) with a secure context bridge:

```
Renderer Process ←→ Preload Script ←→ Main Process
     (UI)              (Bridge)         (Backend)
```

### Headless Execution Path

The application also supports a no-UI path for automation and batch replay scenarios:

```
Command Line → Main Process → Simulation Engine → Transport Manager → TCP/UDP/HTTP/WS/gRPC Endpoint
```

In headless mode:

- no splash screen is created
- no main window is created
- CSV loading, range control, looping, and scheduling are handled by a backend simulation engine
- TCP/UDP/HTTP/WebSocket/gRPC connection lifecycle is handled by a backend transport manager
- logs can be written to stdout and/or a file
- an optional done-file can be written for orchestration or CI workflows

## Core Components

### 1. Main Process (`src/main.js`)

**Responsibilities:**
- Application lifecycle management
- Window creation and management
- File system operations
- Network operations (TCP/UDP/HTTP/WebSocket/gRPC)
- Configuration management
- IPC communication with renderer
- Global shortcuts and menus
- Error handling and logging
- CLI parsing and headless bootstrap

**Key Features:**
- **Window Management**: Creates and manages main window, dialogs (config, about, help, error)
- **Network Layer**: Implements TCP/UDP/HTTP/WebSocket/gRPC server and client modes
- **File Operations**: CSV file reading, configuration file management
- **IPC Handlers**: Secure communication bridge with renderer process
- **Global Shortcuts**: Keyboard shortcuts for application control
- **Error Handling**: Comprehensive error catching and user notification

**Architecture Patterns:**
- Event-driven architecture
- Singleton pattern for configuration management
- Observer pattern for IPC communication
- Factory pattern for window creation

### 2. Renderer Process (`src/renderer.js`)

**Responsibilities:**
- User interface management
- Event handling and user interactions
- Data visualization and state display
- Theme application and management
- Gesture and voice control integration
- CSV data processing and streaming

**Key Features:**
- **UI State Management**: Tracks application state (connected, playing, paused, etc.)
- **Data Streaming**: Controls CSV data transmission timing and flow
- **Responsive Design**: Adapts UI to different screen sizes
- **Theme Integration**: Applies and manages 15 different themes
- **Gesture/Voice Control**: Integrates with TensorFlow.js and Web Speech API

**Architecture Patterns:**
- Observer pattern for UI updates
- State machine for application states
- Event delegation for DOM interactions
- Module pattern for feature organization

### 3. Preload Script (`src/preload.js`)

**Responsibilities:**
- Secure IPC bridge between main and renderer processes
- API exposure with context isolation
- Security boundary enforcement

**Key Features:**
- **Context Bridge**: Exposes safe APIs to renderer process
- **Security**: Prevents direct Node.js access from renderer
- **API Organization**: Structured API methods for different functionalities

### 4. Configuration Management (`src/config.js`)

**Responsibilities:**
- Configuration file loading and saving
- Default configuration management
- Configuration import/export functionality
- Configuration validation and merging

**Key Features:**
- **Persistent Storage**: Saves user preferences across sessions
- **Cross-Platform Paths**: Handles different OS file system conventions
- **Error Recovery**: Graceful handling of corrupted configuration files
- **Migration Support**: Handles configuration format changes

### 4a. Headless CLI Parsing (`src/cli-options.js`)

**Responsibilities:**
- Parse `name=value` command-line arguments
- Print command help output in standard, wide-table, or narrow-table layouts
- Provide shared command-line reference metadata to the Help dialog and markdown docs
- Validate headless run parameters
- Merge optional JSON launch-config files with CLI overrides

**Key Design Note:**
- `src/cli-options.js` acts as the single source of truth for CLI parameter metadata so terminal help output, the `F1` Help dialog reference, and the Markdown command-line guides stay in sync, including the shared six-column schema used by the docs and Help dialog.

### 4b. Simulation Engine (`src/simulation-engine.js`)

**Responsibilities:**
- Load CSV/TXT data through a backend file reader
- Apply line-range, loop, and max-line limits
- Schedule timed sends without renderer dependencies
- Enforce `waitForClient`, `onError`, and completion semantics

### 4c. Transport Manager (`src/transport-manager.js`)

**Responsibilities:**
- Own TCP/UDP/HTTP/WebSocket/gRPC server and client connections
- Track recipients for server mode
- Send data to the correct target(s)
- Provide status and connection events to the simulation engine

**gRPC specifics:**
- In **gRPC Client** mode: wraps `GrpcClientTransportProtobuf` or `GrpcClientTransportInternal` and calls `send()` to push features via `Send`/`Stream` or `execute`/`executeMulti` RPCs
- In **gRPC Server** mode: wraps `GrpcServerTransportProtobuf` or `GrpcServerTransportInternal`, which maintain a set of active `Watch`/`watch` subscribers; `send()` pushes data to all subscribers simultaneously via server-streaming RPCs; `onClientConnected` fires `resolveRecipientWaiters()` so `waitForClient=true` headless runs hold until the first subscriber (e.g. the Logger in gRPC Client mode) connects

**Configuration Structure:**
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
    "launchConfig": { "width": 500, "height": 400, "x": null, "y": null }
  }
}
```

**Supported Fonts:**
The application supports 17 font families organized into categories:

- **Sans-serif**: Arial, Helvetica, Segoe UI, Tahoma, Trebuchet MS, Verdana, Comic Sans MS
- **Serif**: Times New Roman, Georgia, Garamond, Palatino
- **Monospace**: Default (Monospace), Courier New, Lucida Console, Monospace
- **Script/Cursive**: Brush Script MT, cursive

Font selection is available through the context menu and configuration dialog, with real-time preview and persistent storage.

### 5. Gesture Recognition (`src/gestures.js`)

**Responsibilities:**
- Hand gesture detection using TensorFlow.js
- Real-time camera feed processing
- Gesture-to-action mapping
- Confidence scoring and filtering

**Key Features:**
- **TensorFlow.js Integration**: Uses handpose model for hand landmark detection
- **Custom Gestures**: Defines 5 specific gestures (thumbs up, pinky up, victory, open palm, closed fist)
- **Real-time Processing**: Continuous gesture detection loop
- **Confidence Filtering**: Prevents false positives with confidence thresholds

**Supported Gestures:**
- 👍 Thumbs Up → Connect
- 🤙 Pinky Up → Disconnect
- 👊 Closed Fist → Play
- 🖐️ Open Palm → Pause
- ✌️ Victory Sign → Step

### 6. Voice Recognition (`src/voice.js`)

**Responsibilities:**
- Voice command recognition using Web Speech API
- Microphone stream management
- Voice-to-action mapping
- Continuous listening and error handling

**Key Features:**
- **Web Speech API**: Browser-native speech recognition
- **Continuous Listening**: Maintains active listening session
- **Command Mapping**: Maps spoken words to application actions
- **Error Recovery**: Handles microphone permissions and API errors

**Supported Commands:**
- "connect", "disconnect", "play", "start", "pause", "stop", "step", "switch", "toggle view"

### 7. Offline Speech Recognition (`src/simple-offline-speech.js`)

**Responsibilities:**
- Offline voice command recognition using Web Audio API
- Frequency analysis and pattern matching
- Real-time audio visualization
- Privacy-focused local processing

**Key Features:**
- **Web Audio API**: Browser-native audio processing
- **Frequency Analysis**: Pattern-based command detection
- **Visual Feedback**: Real-time audio visualizer and confidence display
- **Privacy-Focused**: 100% offline processing, no external dependencies
- **Configurable Sensitivity**: Adjustable thresholds for recognition accuracy

**Supported Commands:**
- "connect", "disconnect", "play", "start", "pause", "stop", "step", "switch", "toggle view"

**Technical Approach:**
- Analyzes frequency bands (low: 85-255Hz, mid: 255-2000Hz, high: 2000-8000Hz)
- Uses frequency ratio patterns to distinguish commands
- Provides confidence scoring and visual feedback
- Respects microphone logging settings for console output

## Data Flow

### 1. Application Startup

```
1. Main Process Starts
   ↓
2. Load Configuration (config.js)
   ↓
3. Create Splash Window
   ↓
4. Initialize Main Window
   ↓
5. Load Renderer Process
   ↓
6. Apply Saved Theme/State
   ↓
7. Register IPC Handlers
   ↓
8. Application Ready
```

### 2. File Loading Process

```
1. User Selects File (UI)
   ↓
2. Renderer → IPC → Main Process
   ↓
3. Main Process Reads CSV File
   ↓
4. Parse and Validate Data
   ↓
5. Main Process → IPC → Renderer
   ↓
6. Update UI with File Info
   ↓
7. Enable Data Streaming Controls
```

### 3. Data Streaming Process

```
1. User Initiates Connection
   ↓
2. Renderer → IPC → Main Process
   ↓
3. Main Process Creates TCP/UDP/HTTP/WebSocket/gRPC Connection
   ↓
4. Connection Status → IPC → Renderer
   ↓
5. User Starts Data Streaming
   ↓
6. Renderer Controls Timing
   ↓
7. Data Lines → IPC → Main Process
   ↓
8. Main Process Sends Over Network
   ↓
9. Status Updates → IPC → Renderer
```

### 4. Gesture/Voice Control Flow

```
1. User Enables Camera/Microphone
   ↓
2. Initialize TensorFlow.js/Web Speech API
   ↓
3. Start Detection/Listening Loop
   ↓
4. Detect Gesture/Voice Command
   ↓
5. Map to Application Action
   ↓
6. Dispatch Custom Event
   ↓
7. Renderer Handles Action
   ↓
8. Update UI State
```

## Security Architecture

### Context Isolation

The application implements strict security boundaries:

- **Renderer Process**: No direct Node.js access
- **Preload Script**: Secure API exposure only
- **Main Process**: Full system access with validation

### IPC Security

- **Validated Input**: All IPC messages are validated
- **Limited API**: Only necessary functions exposed
- **Error Handling**: Secure error propagation

### File System Security

- **Sandboxed Access**: Limited to user data directory
- **Path Validation**: Prevents directory traversal
- **Permission Checks**: Validates file access permissions

## Performance Considerations

### Memory Management

- **Streaming Data**: Processes CSV data in chunks
- **Event Cleanup**: Proper event listener removal
- **Resource Disposal**: Camera and microphone stream cleanup

### Network Optimization

- **Connection Pooling**: Efficient TCP/UDP/HTTP/WebSocket/gRPC connection management
- **Data Buffering**: Optimized data transmission
- **Error Recovery**: Graceful network failure handling

### UI Performance

- **Debounced Updates**: Prevents excessive UI updates
- **Efficient Rendering**: Minimal DOM manipulation
- **Theme Optimization**: CSS variables for fast theme switching

## Error Handling Strategy

### Multi-Level Error Handling

1. **Process Level**: Global error handlers for uncaught exceptions
2. **Component Level**: Try-catch blocks in critical functions
3. **User Level**: User-friendly error dialogs and notifications
4. **Recovery Level**: Automatic retry and fallback mechanisms

### Error Categories

- **Network Errors**: Connection failures, timeout handling
- **File System Errors**: Permission issues, corrupted files
- **UI Errors**: Rendering issues, event handling failures
- **Configuration Errors**: Invalid settings, migration issues

## Testing Architecture

### Test Structure

```
test/
├── about.test.js            # About dialog tests
├── cli-options.test.js      # Command-line parsing/help tests
├── config.test.js           # Configuration system tests
├── headless-runner.test.js  # Headless entry-path tests
├── help.test.js             # Help and Command Line Interface dialog tests
├── preload.test.js          # API bridge tests
├── renderer.test.js         # UI and renderer tests
├── simulation-engine.test.js # Headless replay engine tests
└── run-all-tests.js         # Unified test runner
```

### Testing Strategy

- **Unit Tests**: Individual component testing
- **Integration Tests**: IPC communication testing
- **CLI/Docs Parity Tests**: Shared metadata validation for terminal help and Command Line Interface dialog reference data
- **Mock Testing**: External dependency isolation
- **Error Testing**: Comprehensive error scenario coverage

## Build and Distribution

### Electron Builder Configuration

- **Multi-Platform**: macOS, Windows, Linux support
- **Code Signing**: Platform-specific signing requirements
- **Auto-Updates**: Built-in update mechanism support
- **Asset Management**: Icon and installer asset handling

### Package Structure

```
dist/
├── mac/                # macOS packages (.dmg, .zip)
├── win/                # Windows packages (.exe installer, portable; .zip via package:win:zip)
└── linux/              # Linux packages (.AppImage, .deb)
```

## Future Architecture Considerations

### Design Principles

- **DRY (Don't Repeat Yourself)**: Shared logic must be extracted into dedicated utility modules. For example, TLS/certificate-store operations are centralized in `src/tls-utils.js` and data format constants are centralized in `src/format-utils.js` — both consumed by `grpc-transport.js`, `http-transport.js`, and `ws-transport.js` rather than duplicated.

### Scalability

- **Plugin System**: Extensible architecture for additional protocols
- **Modular Components**: Component-based architecture for feature additions
- **API Extensions**: Extensible IPC API for third-party integrations

### Performance Improvements

- **Web Workers**: Background processing for heavy operations
- **Streaming Architecture**: Real-time data processing capabilities
- **Caching Strategy**: Intelligent data caching for large files

### Security Enhancements

- **Content Security Policy**: Stricter CSP implementation
- **Sandboxing**: Enhanced process isolation
- **Code Signing**: Comprehensive code signing strategy 