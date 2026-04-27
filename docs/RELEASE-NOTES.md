# Release Notes

## Latest Updates (April 2026)

### 🆕 Help & Command-Line Improvements
- **Dedicated Command Line Interface Dialog**: The searchable, sortable command-line reference now lives in its own `F3` Command Line Interface dialog, separate from the `F1` Help dialog, while still being generated from the same metadata used by terminal help and the markdown docs.
- **Three Terminal Help Layouts**: Standard help now stays in the original non-table layout, while `help-table-wide` and `help-table-narrow` provide explicit ASCII-table variants for wider or narrower terminals.
- **Quick CLI Filters**: Added All, Required, Optional, Headless-only, and Help-related chips with live result counts and removable active-filter pills.
- **Visible-Row Copy/Export Actions**: The Command Line Interface dialog can copy or export the currently visible command-line rows as `TSV`, `CSV`, `Markdown`, or `JSON`.
- **Command Line Interface Keyboard Shortcuts**: Added `Ctrl+F` / `Cmd+F` and `/` to focus the CLI filter, plus `Escape` to close the dialog.
- **Unified CLI Table Schema**: The terminal docs, headless guide, and Command Line Interface dialog now use the same six-column reference model: Name, Supported Values, Default, Required in Headless Mode, Example, and Purpose.

### 📚 Documentation Updates
- Updated the README, command-line guide, headless guide, keyboard shortcut reference, testing guide, documentation indexes, and architecture/development summaries so the split Help (`F1`) and Command Line Interface (`F3`) workflows are documented everywhere users are likely to look.

### 🔧 Build & Packaging
- **Windows ZIP isolated**: Removed `.zip` from the default `package:win` build targets (which now produces only NSIS installer + portable). Use `npm run package:win:zip` to explicitly build a Windows zip archive.
- **Compression set to normal**: Changed electron-builder compression from `maximum` to `normal` to prevent the Windows zip step from hanging.

## Latest Updates (August 2025)

### 🆕 New Features
- **Status Log Sort Order**: Added a new sort toggle in the Status Log header to switch between Ascending and Descending order (default: Ascending). New icons: ascending/descending.
- **Granular Logging Controls**: Toggle hand-gesture and microphone command logging to control status verbosity (defaults OFF)
- **Camera and Microphone Support Controls**: Added configurable support for camera and microphone features
  - Camera Support: Control visibility of camera buttons - Toggle Camera, Report Camera Gestures, Log Camera Gestures)
  - Microphone Support: Control visibility of microphone buttons - Toggle Microphone, Toggle Offline Speech Recognition (Web Audio API), Log Microphone Commands
  - Default: Both features disabled (buttons hidden) for cleaner interface
  - Safety: Automatically turns off active cameras/microphones when support is disabled
  - Access: Available in both main Configuration menu and context menu
  - Persistence: Settings saved to configuration file and restored on startup

### 🎯 Compact Mode Enhancements
- **Smart Button Hiding**: Camera and microphone buttons are automatically hidden in compact mode
- **Automatic Cleanup**: Camera and microphone are automatically turned off when switching to compact mode
- **State Preservation**: Button visibility is properly restored when returning to full mode

### 🎤 Improved Microphone Functionality
- **Enhanced Error Handling**: Network errors are logged only once per session to reduce spam
- **Better User Control**: Microphone remains controllable even during error states
- **Clear Status Messages**: Added "(Web Speech API)" and "(Web Audio API)" identifiers to distinguish microphone systems
- **Offline Speech Logging**: Added status messages for offline speech recognition on/off events

### 🐛 Bug Fixes
- **SpeechRecognition Race Conditions**: Fixed "recognition already started" errors with proper state management
- **Repeated Error Messages**: Prevented network error message spam in status log
- **Microphone Control Issues**: Fixed microphone button becoming unresponsive during errors

### 🐛 Critical Bug Fixes
- **Fixed IPC Handler Registration Error**: Resolved "export-config" handler registration error
- **Fixed Spacebar Text Input**: Removed global spacebar shortcut preventing text input
- **Improved Error Handling**: Enhanced config import/export and IPC communication stability

### ⚙️ User Experience Improvements
- **Modernized UI**: Polished header, inputs, buttons, and panels with consistent radii, shadows, and subtle blur for a cleaner, professional look.
- **Enhanced Font Readability**: Increased default font size from 13px to 16px
- **Updated Keyboard Shortcuts**:
  - Save Config: `Ctrl+S` → `Ctrl+Alt+S` (avoid conflicts)
  - Preferences: `Ctrl+,` → `Ctrl+I` (better accessibility)
- **Improved Status Bar**: Enhanced layout with perfect centering
 - **Context Menu Opacity**: Added Opacity submenu (50%–100%) with immediate apply and persistence

### 📚 Documentation Updates
- **Streamlined Documentation**: Cleaned up all docs to be more concise and focused
- **Updated README.md**: More scannable with essential information only
- **Enhanced Guides**: Improved DEBUGGING.md, TESTING.md, and CONFIG.md for clarity
 - **Offline Speech Docs**: Linked the offline speech guide (OFFLINE-SPEECH-README.md) and speech integration summary from README for better discoverability

## Previous Major Features

### Core Features
- **Window Opacity Control**: Adjustable transparency (50%-100%) with 11 opacity levels
- **Comprehensive Help System**: Detailed user guide with 12 sections, fully themed
- **Enhanced Voice Recognition**: Improved microphone handling and error recovery
- **Professional Testing**: 50+ unit tests covering all major components
- **Developer Tools**: Complete debugging setup with VSCode and Chrome DevTools integration

### UI Enhancements
- **Responsive UI**: Dynamic adaptation to different window sizes
- **Unified Status Bar**: Consolidated app state with emoji indicators (🔴🟢▶️⏸️)
- **Enhanced Gesture Interface**: Real-time feedback with confidence indicators
- **Improved Styling**: Theme-aware components across 15 themes (🔵🟡🌙🌫️🟢⚫☀️☁️🌌☕🌊🌸🌺🌅💻)
- **Gesture Report Toggle**: User-controlled visibility of gesture displays

### Additional Features
- **Status Area Toggle**: Show/hide status area with persistent state
- **Context Menu Enhancements**: Theme selection, font customization, config management
- **Improved Dialogs**: Responsive layout with better UX

### Bug Fixes
- **Camera Closing Error**: Fixed texture size crash when closing camera
- **Repetitive Log Messages**: Prevented log spam for "No clients connected"

### Technical Improvements
- **Code Organization**: Refactored styles and UI logic separation
- **State Management**: Centralized app state display and management
- **Configuration**: Improved font settings organization with backward compatibility

---

## Version History

### Version 1.0.0 - Initial Release
- Core data streaming functionality over TCP/UDP
- Cross-platform UI with 15 themes (🔵🟡🌙🌫️🟢⚫☀️☁️🌌☕🌊🌸🌺🌅💻)
- Hand gesture and voice controls
- Configuration management system