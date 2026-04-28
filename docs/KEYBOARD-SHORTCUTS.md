# Keyboard Shortcuts

Complete list of keyboard shortcuts for the ArcGIS Velocity Simulator.

## File Operations

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+O` (Windows/Linux)<br>`Cmd+O` (macOS) | **Apply App Config From...** | Opens file dialog to apply app configuration from a JSON file |
| `Ctrl+Alt+S` (Windows/Linux)<br>`Cmd+Alt+S` (macOS) | **Save App Config** | Saves current app configuration to the default location |
| `Ctrl+Shift+S` (Windows/Linux)<br>`Cmd+Shift+S` (macOS) | **Save App Config To...** | Opens file dialog to save app configuration to a specific location |

## View and Interface

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+T` (Windows/Linux)<br>`Cmd+T` (macOS) | **Toggle View** | Switches between compact and full view modes |
| `Ctrl+I` (Windows/Linux)<br>`Cmd+I` (macOS) | **App Configuration** | Opens the app configuration dialog |
| `Ctrl+0` (Windows/Linux)<br>`Cmd+0` (macOS) | **Actual Size** | Resets zoom to 100% |
| `Ctrl+Plus` (Windows/Linux)<br>`Cmd+Plus` (macOS) | **Zoom In** | Increases zoom level |
| `Ctrl+-` (Windows/Linux)<br>`Cmd+-` (macOS) | **Zoom Out** | Decreases zoom level |

## Application Controls

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+Shift+C` (Windows/Linux)<br>`Cmd+Shift+C` (macOS) | **Connect** | Initiates connection with current settings |
| `Ctrl+D` (Windows/Linux)<br>`Cmd+D` (macOS) | **Disconnect** | Disconnects from current connection |
| `Ctrl+Delete` (Windows/Linux)<br>`Cmd+Delete` (macOS) | **Clear Status Log** | Clears the status/log area |
| `Ctrl+Shift+O` (Windows/Linux)<br>`Cmd+Shift+O` (macOS) | **Toggle Status Log Sort Order** | Switch between Ascending and Descending order (default: Ascending) |

## Standard Text Editing

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+Z` (Windows/Linux)<br>`Cmd+Z` (macOS) | **Undo** | Undoes the last action |
| `Ctrl+Shift+Z` (Windows/Linux)<br>`Cmd+Shift+Z` (macOS) | **Redo** | Redoes the last undone action |
| `Ctrl+X` (Windows/Linux)<br>`Cmd+X` (macOS) | **Cut** | Cuts selected text |
| `Ctrl+C` (Windows/Linux)<br>`Cmd+C` (macOS) | **Copy** | Copies selected text |
| `Ctrl+V` (Windows/Linux)<br>`Cmd+V` (macOS) | **Paste** | Pastes clipboard content |
| `Ctrl+A` (Windows/Linux)<br>`Cmd+A` (macOS) | **Select All** | Selects all text |

## Help and Information

| Shortcut | Action | Description |
|----------|--------|-------------|
| `F1` | **Help** | Opens the help dialog |
| `F2` | **About** | Opens the about dialog |
| `F3` | **Command Line Interface** | Opens the dedicated command-line reference dialog |

### Command Line Interface Dialog Shortcuts

These shortcuts apply while the Command Line Interface dialog is open. They are most useful in the interactive command-line reference, which includes quick chips, sortable columns, active-filter pills, and visible-row copy/export tools.

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+F` (Windows/Linux)<br>`Cmd+F` (macOS) | **Focus CLI Filter** | Moves focus to the Command Line Interface dialog search box |
| `/` | **Focus CLI Filter** | Quick single-key shortcut for the command-line filter when focus is not already in a text field |
| `Escape` | **Close Dialog** | Closes the Command Line Interface dialog |

## Developer Tools

| Shortcut | Action | Description |
|----------|--------|-------------|
| `F12` | **Toggle Developer Tools** | Opens/closes the developer tools. Shown as a checkbox — checked when DevTools is open. The checkbox is kept in sync with all ways DevTools can be opened or closed (F12, Inspect Element Mode, keyboard shortcut). |
| `F11` | **Inspect Element Mode** | Toggles inspect-element pick mode (checkbox). When active, the cursor changes to a crosshair; click any UI element to open it in the DevTools Elements panel. Enabling this also checks the Developer Tools entry automatically. Press `Escape` or toggle again to cancel. |
| `Ctrl+R` (Windows/Linux)<br>`Cmd+R` (macOS) | **Reload** | Reloads the application |
| `Ctrl+Shift+R` (Windows/Linux)<br>`Cmd+Shift+R` (macOS) | **Force Reload** | Force reloads the application (ignores cache) |

## Application Management

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+Q` (Windows/Linux)<br>`Cmd+Q` (macOS) | **Quit** | Exits the application |
| `Ctrl+H` (Windows/Linux)<br>`Cmd+H` (macOS) | **Hide Application** | Hides the application window |
| `Ctrl+Alt+H` (Windows/Linux)<br>`Cmd+Alt+H` (macOS) | **Hide Others** | Hides all other applications |

## Customization Options

### Context Menu (Right-click)
The application provides extensive customization through the context menu:
- **Theme Selection**: 15 themes available (🔵🟡🌙🌫️🟢⚫☀️☁️🌌☕🌊🌸🌺🌅💻)
- **Font Customization**: 17 fonts available (see [CONFIG.md](./CONFIG.md) for complete list)
- **Font Size**: 6px to 25px range
- **Window Opacity**: 50% to 100% transparency
- **Configuration Management**: App Config and Launch Config import/export
- **View Mode Switching**: Toggle between full and compact views

### Available Fonts
The application supports 17 font families including:
- **Sans-serif**: Arial, Helvetica, Segoe UI, Tahoma, Trebuchet MS, Verdana, Comic Sans MS
- **Serif**: Times New Roman, Georgia, Garamond, Palatino
- **Monospace**: Default (Monospace), Courier New, Lucida Console, Monospace
- **Script/Cursive**: Brush Script MT, cursive

## Notes

- **macOS**: `Cmd` = Command key (⌘), **Windows/Linux**: `Ctrl` = Control key
- Shortcuts are case-insensitive
- Some shortcuts may not work when input fields have focus
- Spacebar is **not** a global shortcut (allows normal text input)