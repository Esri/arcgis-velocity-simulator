/**
 * Copyright 2026 Esri
 *
 * Licensed under the Apache License Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @file main.js
 * @description This is the main process for the Electron application.
 * It handles window management, application lifecycle events, native OS interactions (like dialogs and menus),
 * backend logic for networking (TCP/UDP), file system access, and inter-process communication (IPC) with renderer processes.
 */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const dgram = require('dgram');
const readline = require('readline');
// Enable Web Speech API (SpeechRecognition)
app.commandLine.appendSwitch('enable-speech-dispatcher');

// Define a base path for all resources to ensure they are found correctly.
const basePath = __dirname;
const { ConfigManager } = require(path.join(basePath, 'config.js'));
const { APP_DEFAULTS, DEFAULT_LOG_LEVEL, formatCliStartupErrorOutput, formatExplainOutput, getCommandLineReferenceData, parseCommandLineArgs } = require(path.join(basePath, 'cli-options.js'));
const { EXIT_CODES, runHeadlessSession } = require(path.join(basePath, 'headless-runner.js'));

function requestGracefulCliExit(exitCode) {
  process.exitCode = exitCode;
  app.once('will-quit', () => {
    process.exit(exitCode);
  });

  if (app.isReady()) {
    app.quit();
    return;
  }

  app.once('ready', () => {
    app.quit();
  });
}

const cliOptions = parseCommandLineArgs(process.argv, { isPackaged: app.isPackaged });
const startupFilePathFromCli = cliOptions.ui.startupFilePath;

cliOptions.warnings.forEach((warning) => console.warn(`CLI warning: ${warning}`));

if (cliOptions.explain && cliOptions.mode !== 'help') {
  console.log(formatExplainOutput(cliOptions));
}

if (cliOptions.mode === 'help') {
  console.log(cliOptions.helpText);
  requestGracefulCliExit(EXIT_CODES.success);
}

if (cliOptions.mode === 'error') {
  console.error(formatCliStartupErrorOutput(cliOptions));
  requestGracefulCliExit(EXIT_CODES.configurationError);
}

// Import speech recognition handler (commented out due to Vosk compatibility issues)
// const SpeechRecognitionHandler = require(path.join(basePath, 'speech-recognition-handler.js'));

// Set a dedicated user data path to ensure write permissions
const userDataPath = path.join(app.getPath('appData'), 'arcgis-velocity-simulator');
// Create the user data directory if it doesn't exist
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
  console.log('User data directory created:', userDataPath);
}
// Set the user data path to the dedicated directory
app.setPath('userData', userDataPath);
//console.log('User data path set to:', userDataPath);

// --- Global Variables ---
let mainWindow; // The main application window instance.
let aboutWindow = null; // The "About" window instance.
let helpWindow = null; // The "Help" window instance.
let commandLineWindow = null; // The "Command Line Interface" window instance.
let configWindow = null; // The configuration dialog instance.
let errorWindow = null; // The error dialog instance.
let connection = null; // Holds the active server or client socket.
let tcpClientSockets = []; // Array of connected TCP client sockets (when in server mode).
let udpServerClients = new Set(); // Set of known UDP clients (when in server mode).
let grpcTransport = null; // Holds active gRPC transport (GrpcClientTransport or GrpcServerTransport).
let inspectModeActive = false; // Tracks whether Inspect Element pick mode is active.
let devToolsOpen = false; // Tracks whether DevTools is currently open (synced via devtools-opened/closed events).
let httpTransport = null; // Holds active HTTP transport (HttpClientTransport or HttpServerTransport).
let wsTransport = null; // Holds active WebSocket transport (WsClientTransport or WsServerTransport).
let velocityLoginWindow = null; // Holds the Velocity Login dialog window.
const { createGrpcClientTransport, createGrpcServerTransport } = require(path.join(basePath, 'grpc-transport.js'));
const { createHttpClientTransport, createHttpServerTransport, FORMAT_CONTENT_TYPES } = require(path.join(basePath, 'http-transport.js'));
const { createWsClientTransport, createWsServerTransport } = require(path.join(basePath, 'ws-transport.js'));
const { generateToken, generateOAuthToken, getVelocityApiUrl, listFeeds, getFeedDetails, TokenManager } = require(path.join(basePath, 'velocity-api.js'));
const velocityTokenManager = new TokenManager();

// ─── Application Logger (works in both UI and headless modes) ────────────────
const { RunLogger } = require(path.join(basePath, 'run-logger.js'));

const appLogFile = cliOptions.logFile || (() => {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
  const logDir = path.resolve('./logs');
  fs.mkdirSync(logDir, { recursive: true });
  return path.join(logDir, `velocity-simulator-${ts}.log`);
})();

const appLogger = new RunLogger({
  logLevel: cliOptions.logLevel,
  logFile: appLogFile,
  stdout: true,
});

function velocityLog(level, ...args) {
  const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  appLogger.write(level, message);
}

velocityLog('info', '[Startup] Log file: ' + appLogFile);
velocityLog('info', '[Startup] Log level: ' + cliOptions.logLevel);
// ─────────────────────────────────────────────────────────────────────────────

// Make mainWindow globally accessible for speech recognition
global.mainWindow = null;

// Flag to prevent repeated "No clients connected" logging
let hasLoggedNoClients = false;

// --- Configuration ---
let configManager; // Manages loading and saving of the application configuration.
let appConfig; // The loaded application configuration object.

// --- Splash Screen ---
let splashWindow; // The splash screen window instance.

// --- Global Error Handling ---
// Catches unhandled promise rejections throughout the application.
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  const error = new Error(reason.message || 'Unhandled Promise Rejection');
  error.stack = reason.stack || 'No stack trace available';
  if (mainWindow) {
    showErrorDialog(error);
  }
});

// Catches all other uncaught exceptions.
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  if (mainWindow) {
    showErrorDialog(error);
  }
});

/**
 * Opens the application configuration dialog.
 * If the dialog is already open, it focuses the existing window.
 * The dialog is modal and displays settings from the configuration file.
 */
async function showConfigDialog() {
  if (configWindow) {
    configWindow.focus();
    return;
  }

  const currentTheme = await mainWindow.webContents.executeJavaScript('localStorage.getItem("theme");', true);

  const appConfigDialog = (appConfig.dialogSizes && appConfig.dialogSizes.appConfig) || {};
  configWindow = new BrowserWindow({
    width: appConfigDialog.width || 660,
    height: appConfigDialog.height || 400,
    x: appConfigDialog.x || undefined,
    y: appConfigDialog.y || undefined,
    parent: mainWindow,
    modal: process.platform !== 'darwin',
    show: false, // Keep hidden until theme is applied
    resizable: true,
    minimizable: false,
    maximizable: false,
    icon: path.join(basePath, 'assets/icon.png'),
    webPreferences: {
      preload: path.join(basePath, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const saveConfigDialogBounds = () => {
    if (configWindow && !configWindow.isDestroyed()) {
      const [width, height] = configWindow.getSize();
      const [x, y] = configWindow.getPosition();
      if (!appConfig.dialogSizes) appConfig.dialogSizes = {};
      appConfig.dialogSizes.appConfig = { width, height, x, y };
      configManager.saveConfig(appConfig);
    }
  };
  configWindow.on('resize', saveConfigDialogBounds);
  configWindow.on('move', saveConfigDialogBounds);

  // Wait for the theme to be applied before showing the window
  ipcMain.once('config-theme-applied', () => {
    if (configWindow) {
      configWindow.show();
    }
  });

  configWindow.setMenuBarVisibility(false);
  configWindow.setMenu(null);
  configWindow.loadFile(path.join(basePath, 'config.html'));

  // Send config data and theme to the dialog once its content has loaded
  configWindow.webContents.on('did-finish-load', () => {
    const configData = {
      config: appConfig,
      configPath: configManager.getConfigPath(),
      theme: currentTheme || appConfig.theme
    };
    configWindow.webContents.send('load-config-data', configData);
  });

  configWindow.on('closed', () => {
    ipcMain.removeAllListeners('config-theme-applied');
    configWindow = null;
  });
}

/**
 * Displays a modal dialog with error information.
 * @param {Error} error - The error object to display.
 */
async function showErrorDialog(error) {
  if (errorWindow) {
    errorWindow.focus();
    return;
  }

  const currentTheme = await mainWindow.webContents.executeJavaScript('localStorage.getItem("theme");', true);
  const errorInfo = `Error: ${error.message}\n\nStack Trace:\n${error.stack}`;

  errorWindow = new BrowserWindow({
    width: 600,
    height: 400,
    parent: mainWindow,
    modal: true,
    show: false, // Keep hidden until theme is applied
    resizable: true,
    minimizable: false,
    maximizable: false,
    icon: path.join(basePath, 'assets/installerIcon.ico'),
    webPreferences: {
      preload: path.join(basePath, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Wait for the theme to be applied before showing the window
  ipcMain.once('error-theme-applied', () => {
    if (errorWindow) {
      errorWindow.show();
    }
  });

  errorWindow.setMenuBarVisibility(false);
  errorWindow.setMenu(null);
  errorWindow.loadFile(path.join(basePath, 'error.html'));

  // Send error data and theme to the dialog once its content has loaded
  errorWindow.webContents.on('did-finish-load', () => {
    const errorData = {
      message: 'An unexpected error occurred. You can help us improve the application by sending the error details to the developer.',
      details: errorInfo,
      theme: currentTheme || appConfig.theme
    };
    errorWindow.webContents.send('load-error-data', errorData);
  });

  errorWindow.on('closed', () => {
    ipcMain.removeAllListeners('error-theme-applied');
    errorWindow = null;
  });
}

/**
 * Creates and displays the 'Help' dialog window.
 */
async function showHelpDialog() {
  if (helpWindow) {
    helpWindow.focus();
    return;
  }

  const currentTheme = await mainWindow.webContents.executeJavaScript('localStorage.getItem("theme");', true);

  helpWindow = new BrowserWindow({
    width: 960,
    height: 720,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    alwaysOnTop: true,
    icon: path.join(basePath, 'assets/icon.png'),
    modal: true,
    parent: mainWindow,
    show: false, // Keep hidden until theme is applied
    title: 'Help - ArcGIS Velocity Simulator',
    webPreferences: {
      preload: path.join(basePath, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Wait for the theme to be applied before showing the window
  ipcMain.once('theme-applied', () => {
    if (helpWindow) {
      helpWindow.show();
    }
  });

  helpWindow.setMenuBarVisibility(false);
  helpWindow.setMenu(null);
  helpWindow.loadFile(path.join(basePath, 'help.html'));

  // Send theme to the dialog once its content has loaded
  helpWindow.webContents.on('did-finish-load', () => {
    helpWindow.webContents.send('set-theme', currentTheme);
  });

  helpWindow.on('closed', () => {
    ipcMain.removeAllListeners('theme-applied');
    helpWindow = null;
  });
}

/**
 * Creates and displays the dedicated 'Command Line Interface' dialog window.
 */
async function showCommandLineDialog() {
  if (commandLineWindow) {
    commandLineWindow.focus();
    return;
  }

  const currentTheme = await mainWindow.webContents.executeJavaScript('localStorage.getItem("theme");', true);

  commandLineWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    alwaysOnTop: true,
    icon: path.join(basePath, 'assets/icon.png'),
    modal: true,
    parent: mainWindow,
    show: false,
    title: 'Command Line Interface - ArcGIS Velocity Simulator',
    webPreferences: {
      preload: path.join(basePath, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  ipcMain.once('theme-applied', () => {
    if (commandLineWindow) {
      commandLineWindow.show();
    }
  });

  commandLineWindow.setMenuBarVisibility(false);
  commandLineWindow.setMenu(null);
  commandLineWindow.loadFile(path.join(basePath, 'cli.html'));

  commandLineWindow.webContents.on('did-finish-load', () => {
    commandLineWindow.webContents.send('set-theme', currentTheme);
  });

  commandLineWindow.on('closed', () => {
    ipcMain.removeAllListeners('theme-applied');
    commandLineWindow = null;
  });
}

/**
 * Creates and displays the 'About' dialog window.
 */
async function showAboutDialog() {
  if (aboutWindow) {
    aboutWindow.focus();
    return;
  }

  const currentTheme = await mainWindow.webContents.executeJavaScript('localStorage.getItem("theme");', true);

  aboutWindow = new BrowserWindow({
    width: 430,
    height: 310,
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent: mainWindow,
    modal: true,
    show: false, // Keep hidden until theme is applied
    icon: path.join(basePath, 'assets/icon.png'),
    title: 'About ArcGIS Velocity Simulator',
    webPreferences: {
      preload: path.join(basePath, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Wait for the theme to be applied before showing the window
  ipcMain.once('theme-applied', () => {
    if (aboutWindow) {
      aboutWindow.show();
    }
  });

  aboutWindow.setMenuBarVisibility(false);
  aboutWindow.setMenu(null);
  aboutWindow.loadFile(path.join(basePath, 'about.html'));

  // Send theme to the dialog once its content has loaded
  aboutWindow.webContents.on('did-finish-load', () => {
    aboutWindow.webContents.send('set-theme', currentTheme);
  });

  aboutWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape') {
      aboutWindow.close();
      event.preventDefault();
    }
  });

  aboutWindow.on('closed', () => {
    ipcMain.removeAllListeners('theme-applied');
    aboutWindow = null;
  });
}

/**
 * Creates and displays the splash screen window.
 * The splash screen is shown during application startup.
 */
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 320,
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    show: true,
    icon: path.join(basePath, 'assets/installerIcon.ico'),

    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  splashWindow.setMenuBarVisibility(false);
  splashWindow.setMenu(null);
  splashWindow.loadFile(path.join(basePath, 'splash.html'));
  
  // Send the current theme to the splash screen once it's loaded
  splashWindow.webContents.once('did-finish-load', () => {
    if (appConfig && appConfig.theme) {
      splashWindow.webContents.send('splash-set-theme', appConfig.theme);
    }
  });
  
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

ipcMain.on('show-error-in-dialog', (event, errorDetails) => {
  const error = new Error(errorDetails.message);
  error.stack = errorDetails.stack;
  showErrorDialog(error);
});

/**
 * Creates the main application window.
 * It restores saved UI behavior from configuration, including compact/full view,
 * window size, position, and other persisted settings.
 */
function createWindow() {
  const isCompact = appConfig.windowState.currentView === 'compact';
  // Set initial dimensions and position based on the last known view
  const initialViewState = isCompact ? appConfig.windowState.compactView : appConfig.windowState.fullView;

  mainWindow = new BrowserWindow({
    x: initialViewState.x,
    y: initialViewState.y,
    width: initialViewState.width,
    height: initialViewState.height,
    show: false, // Hide until ready
    icon: path.join(basePath, 'assets/installerIcon.ico'),
    webPreferences: {
      preload: path.join(basePath, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false,
    },
  });

  // Set global reference for speech recognition
  global.mainWindow = mainWindow;

  // Set the compact view state
  mainWindow.isCompact = isCompact;

  mainWindow.loadFile(path.join(basePath, 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    const position = mainWindow.isCompact ? appConfig.windowState.compactView.splitterPosition : appConfig.windowState.fullView.splitterPosition;
    mainWindow.webContents.send('set-compact-view', mainWindow.isCompact, position);
    
    // Send the saved theme to renderer
    mainWindow.webContents.send('load-saved-theme', appConfig.theme);
    // Send the saved status area visibility to renderer
    mainWindow.webContents.send('load-status-area-visibility', appConfig.statusAreaVisible);
    // Send the saved font settings to renderer
    mainWindow.webContents.send('set-font-size', appConfig.font.size);
    mainWindow.webContents.send('set-font-family', appConfig.font.family);
  });

  // Simulate staged loading progress for demo (replace with real progress as needed)
  const loadingStages = [
    { percent: 15, text: 'Initializing...' },
    { percent: 35, text: 'Loading modules...' },
    { percent: 65, text: 'Preparing UI...' },
    { percent: 90, text: 'Finalizing...' },
    { percent: 100, text: 'Ready!' },
  ];

  function sendSplashProgress(percent, text) {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('splash-progress', { percent, text });
    }
  }

  mainWindow.webContents.on('did-finish-load', () => {
    // Final progress and close splash
    sendSplashProgress(100, 'Launching app...');
    setTimeout(() => {
      if (splashWindow) splashWindow.close();
      // Apply saved window opacity
      mainWindow.setOpacity(appConfig.opacity || 1.0);
      mainWindow.setMenuBarVisibility(appConfig.menuBarVisible);
      mainWindow.show();
      
      // Send the saved support flags to renderer after window is shown
      mainWindow.webContents.send('toggle-camera-support', appConfig.cameraSupport);
      mainWindow.webContents.send('toggle-microphone-support', appConfig.microphoneSupport);
    }, 400);

    if (startupFilePathFromCli) {
      if (fs.existsSync(startupFilePathFromCli)) {
        mainWindow.webContents.send('load-file-on-startup', startupFilePathFromCli);
      } else {
        logStatus(`Startup file not found: ${startupFilePathFromCli}`);
      }
    }

    // Send CLI presets for UI prepopulation
    if (cliOptions.ui && cliOptions.ui.presets) {
      mainWindow.webContents.send('cli-presets', cliOptions.ui.presets);
    }
  });

  // Animate splash progress as main loads
  let stageIdx = 0;
  function nextStage() {
    if (stageIdx < loadingStages.length) {
      const { percent, text } = loadingStages[stageIdx++];
      sendSplashProgress(percent, text);
      setTimeout(nextStage, 600);
    }
  }
  nextStage();

  mainWindow.on('close', () => {
    saveAppState();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Unregister global shortcuts when main window closes
    globalShortcut.unregisterAll();
  });

  // Keep devToolsOpen flag and menu checkboxes in sync regardless of how DevTools was opened/closed.
  mainWindow.webContents.on('devtools-opened', () => {
    devToolsOpen = true;
    const applicationMenu = createMainMenu();
    Menu.setApplicationMenu(applicationMenu);
  });
  mainWindow.webContents.on('devtools-closed', () => {
    devToolsOpen = false;
    // Also clear inspect pick mode if DevTools was closed externally
    if (inspectModeActive) {
      inspectModeActive = false;
      mainWindow && mainWindow.webContents.send('cancel-inspect-mode');
    }
    const applicationMenu = createMainMenu();
    Menu.setApplicationMenu(applicationMenu);
  });

  // --- Debounced State Saving for Window Changes ---
  let saveStateTimeout;
  const debouncedSaveAppState = () => {
    clearTimeout(saveStateTimeout);
    saveStateTimeout = setTimeout(saveAppState, 500); // Debounce for 500ms
  };

  let isMoving = false;

  // On macOS, use the 'will-resize' event to prevent the window from being resized by the OS
  // when moving between monitors with different DPIs. This prevents the flickering effect.
  if (process.platform === 'darwin') {
    mainWindow.on('will-resize', (event) => {
      if (isMoving) {
        event.preventDefault();
      }
    });
  }

  // Remember window size when resized and save to config
  mainWindow.on('resize', () => {
    // Ignore resize events that happen during a move.
    // This is a fallback for non-macOS and for edge cases.
    // Manual resizes will still be saved correctly when not moving.
    if (!mainWindow || isMoving) {
      return;
    }

    const [width, height] = mainWindow.getSize();
    if (mainWindow.isCompact) {
      appConfig.windowState.compactView.width = width;
      appConfig.windowState.compactView.height = height;
    } else {
      appConfig.windowState.fullView.width = width;
      appConfig.windowState.fullView.height = height;
    }
    debouncedSaveAppState();
  });

  // Remember window position when moved and save to config
  mainWindow.on('move', () => {
    if (!mainWindow) return;

    isMoving = true;
    clearTimeout(mainWindow.moveTimeout);
    mainWindow.moveTimeout = setTimeout(() => {
      isMoving = false;
    }, 200); // Reset the flag after the move is likely complete.

    const [x, y] = mainWindow.getPosition();
    if (mainWindow.isCompact) {
      appConfig.windowState.compactView.x = x;
      appConfig.windowState.compactView.y = y;
    } else {
      appConfig.windowState.fullView.x = x;
      appConfig.windowState.fullView.y = y;
    }
    debouncedSaveAppState();
  });
}

function registerAppSpecificShortcuts() {
  if (!mainWindow) return;

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      switch (input.key) {
        case 'F1':
          showHelpDialog();
          event.preventDefault();
          break;
        case 'F3':
          showCommandLineDialog();
          event.preventDefault();
          break;
        case 'I':
          if (input.control || input.meta) {
            showConfigDialog();
            event.preventDefault();
          }
          break;
        // Add more shortcuts as needed
      }
    }
  });
}

/**
 * Creates the main application menu to enable global keyboard shortcuts.
 */
function createMainMenu() {
    const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{
      label: 'ArcGIS Velocity Simulator',
      submenu: [
        { label: 'Hide', accelerator: 'CmdOrCtrl+H', role: 'hide' },
        { label: 'Hide Others', accelerator: 'CmdOrCtrl+Alt+H', role: 'hideothers' },
        { label: 'Show All', role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    }] : []),
    {
      // File
      label: 'File',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        ...(!isMac ? [{ type: 'separator' }, { label: 'Exit', accelerator: 'Alt+F4', click: () => app.quit() }] : [])
      ]
    },
    {
      // Edit
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectall' }
      ]
    },
    {
      // View
      label: 'View',
      submenu: [
        {
          label: 'Toggle Compact/Full View',
          accelerator: 'CmdOrCtrl+T',
          click: () => {
            if (mainWindow) toggleCompactView();
          }
        },

        { type: 'separator' },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        {
          label: 'Toggle Status Log Sort Order',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('keyboard-shortcut', 'toggle-sort-order');
            }
          }
        },
        { label: 'Toggle Fullscreen', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      // Action
      label: 'Action',
      submenu: [
        {
          label: 'Clear Status Log',
          accelerator: 'CmdOrCtrl+Delete',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('keyboard-shortcut', 'clear-status');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Connect',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('keyboard-shortcut', 'connect');
            }
          }
        },
        {
          label: 'Disconnect',
          accelerator: 'CmdOrCtrl+D',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('keyboard-shortcut', 'disconnect');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Play/Pause',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('keyboard-shortcut', 'play-pause');
            }
          }
        }
      ]
    },

    {
      // Settings
      label: 'Settings',
      submenu: [
        {
          label: 'Show App Configuration',
          accelerator: 'CmdOrCtrl+I',
          click: () => {
            showConfigDialog();
          }
        },
        {
          label: 'Save App Configuration',
          accelerator: 'CmdOrCtrl+Alt+S',
          click: () => {
            if (mainWindow) {
              saveAppState();
              logStatus('App configuration saved.');
            }
          }
        },
        {
          label: 'Save App Configuration To...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: async () => {
            if (mainWindow) {
              const { filePath } = await dialog.showSaveDialog({
                title: 'Save App Configuration',
                defaultPath: 'velocity-simulator-config.json',
                filters: [{ name: 'JSON Files', extensions: ['json'] }]
              });
              if (filePath) {
                configManager.exportConfig(filePath, appConfig);
                logStatus(`App configuration saved to ${filePath}`);
              }
            }
          }
        },
        {
          label: 'Apply App Configuration From...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const { filePaths } = await dialog.showOpenDialog({
              title: 'Apply App Configuration',
              filters: [{ name: 'JSON Files', extensions: ['json'] }],
              properties: ['openFile']
            });
            if (filePaths && filePaths.length > 0) {
              const result = configManager.importConfig(filePaths[0]);
              if (result.success) {
                appConfig = result.config;
                if (mainWindow) {
                  const shouldBeCompact = appConfig.windowState.currentView === 'compact';
                  if (mainWindow.isCompact !== shouldBeCompact) {
                    toggleCompactView();
                  } else {
                    const dimensions = shouldBeCompact ? appConfig.windowState.compactView : appConfig.windowState.fullView;
                    mainWindow.setBounds(dimensions);
                    mainWindow.webContents.send('set-compact-view', shouldBeCompact, dimensions.splitterPosition);
                  }
                  mainWindow.webContents.send('load-saved-theme', appConfig.theme);
                  mainWindow.webContents.send('load-status-area-visibility', appConfig.statusAreaVisible);
                }
                logStatus(`App configuration applied from ${filePaths[0]}`);
              } else {
                logStatus(`Error applying app configuration: ${result.error}`);
              }
            }
          }
        },
        {
          label: 'Reset App Configuration',
          accelerator: 'Shift+R',
          click: () => {
            resetToDefaultConfig();
          }
        },
        { type: 'separator' },
        {
          label: 'Show Launch Configuration',
          click: showLaunchConfigDialog
        },
        {
          label: 'Save Launch Configuration To...',
          click: saveLaunchConfigAs
        },
        {
          label: 'Apply Launch Configuration From...',
          click: applyLaunchConfigFrom
        },
        {
          label: 'Reset Launch Configuration',
          click: resetLaunchConfig
        },
        { type: 'separator' },
        {
          label: 'Camera Support',
          type: 'checkbox',
          checked: appConfig.cameraSupport,
          click: () => {
            appConfig.cameraSupport = !appConfig.cameraSupport;
            if (mainWindow) {
              mainWindow.webContents.send('toggle-camera-support', appConfig.cameraSupport);
            }
            saveAppState();
            // Update the main menu to reflect the new state
            const applicationMenu = createMainMenu();
            Menu.setApplicationMenu(applicationMenu);
          }
        },
        {
          label: 'Microphone Support',
          type: 'checkbox',
          checked: appConfig.microphoneSupport,
          click: () => {
            appConfig.microphoneSupport = !appConfig.microphoneSupport;
            if (mainWindow) {
              mainWindow.webContents.send('toggle-microphone-support', appConfig.microphoneSupport);
            }
            saveAppState();
            // Update the main menu to reflect the new state
            const applicationMenu = createMainMenu();
            Menu.setApplicationMenu(applicationMenu);
          }
        }
      ]
    },
    {
      // Help
      label: 'Help',
      submenu: [
        { 
          label: 'Help',
          accelerator: 'F1',
          click: () => { if (mainWindow) showHelpDialog(); }
        },
        {
          label: 'Command Line Interface',
          accelerator: 'F3',
          click: () => { if (mainWindow) showCommandLineDialog(); }
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'F12',
          type: 'checkbox',
          checked: devToolsOpen,
          click: () => {
            if (mainWindow) mainWindow.webContents.toggleDevTools();
          }
        },
        {
          label: 'Inspect Element Mode',
          accelerator: 'F11',
          type: 'checkbox',
          checked: inspectModeActive,
          click: () => {
            if (!mainWindow) return;
            inspectModeActive = !inspectModeActive;
            if (inspectModeActive) {
              if (!mainWindow.webContents.isDevToolsOpened()) {
                mainWindow.webContents.openDevTools({ mode: 'detach' });
              }
              mainWindow.webContents.send('enter-inspect-mode');
            } else {
              mainWindow.webContents.send('cancel-inspect-mode');
            }
            const applicationMenu = createMainMenu();
            Menu.setApplicationMenu(applicationMenu);
          }
        },
        {
          label: 'Log Level',
          submenu: buildLogLevelSubmenu()
        },
        {
          label: 'About',
          accelerator: 'F2',
          click: () => showAboutDialog()
        }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}

/**
 * Resets the launch configuration to default values, restoring the app
 * to the same state as if no launch config had been applied.
 */
function resetLaunchConfig() {
  // Map null paths to empty strings for UI compatibility
  const defaults = {};
  for (const [key, value] of Object.entries(APP_DEFAULTS)) {
    defaults[key] = value === null ? '' : value;
  }
  if (mainWindow) {
    mainWindow.webContents.send('cli-presets', defaults);
    appLogger.logLevel = DEFAULT_LOG_LEVEL;
    logStatus('Launch configuration reset to defaults.');
  }
}

/**
 * Change the runtime log level, persist it in app config, and rebuild menus.
 */
function setLogLevel(level) {
  appLogger.logLevel = level;
  if (appConfig) {
    appConfig.logLevel = level;
    if (configManager) configManager.saveConfig(appConfig);
  }
  const applicationMenu = createMainMenu();
  Menu.setApplicationMenu(applicationMenu);
  velocityLog('info', `[Config] Log level changed to: ${level}`);
}

/**
 * Build a submenu array of radio items for selecting the log level.
 */
function buildLogLevelSubmenu() {
  const current = (appConfig && appConfig.logLevel) || DEFAULT_LOG_LEVEL;
  return ['error', 'warn', 'info', 'debug'].map(level => ({
    label: level,
    type: 'radio',
    checked: current === level,
    click: () => setLogLevel(level),
  }));
}


app.on('ready', async () => {
  if (cliOptions.mode === 'help') {
    return;
  }

  if (cliOptions.mode === 'error') {
    return;
  }

  if (cliOptions.mode === 'headless') {
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide();
    }
    await runHeadlessSession(cliOptions.headless, { app, logger: appLogger });
    return;
  }

  // Initialize configuration manager and load the saved application configuration.
  configManager = new ConfigManager();
  appConfig = configManager.loadConfig();

  // Restore persisted log level
  if (appConfig.logLevel) {
    appLogger.logLevel = appConfig.logLevel;
  }

  // Command-line default behavior: when the user provides no parameters, start in
  // normal UI mode and preserve saved UI behavior from configuration, including
  // the saved compact/full view.

  // Force set app name and about panel for macOS menu
  app.setName('ArcGIS Velocity Simulator');
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: 'ArcGIS Velocity Simulator',
      applicationVersion: app.getVersion(),
      copyright: 'Copyright 2025 Esri',
      credits: 'ArcGIS Velocity Simulator'
    });
  }

  // Create the splash screen first
  createSplashWindow();

  // Use a timeout to ensure the splash screen is visible before loading the main application
  setTimeout(() => {
    // Create the main window
    createWindow();

    // Now that the window exists, create and set the main menu
    const applicationMenu = createMainMenu();
    Menu.setApplicationMenu(applicationMenu);

    // Register shortcuts
    registerAppSpecificShortcuts();

    // Set the app icon for macOS dock
    if (process.platform === 'darwin') {
      app.dock.setIcon(path.join(basePath, 'assets/icon.png'));
    }
  }, 500); // Delay allows splash to be seen
});

app.on('before-quit', () => {
  // Ensure cleanup happens before app quits
  cleanupConnections();
  // Unregister all global shortcuts
  globalShortcut.unregisterAll();
});

// IPC: Toggle compact/full view from renderer (e.g. double-click header)
ipcMain.on('toggle-compact-view', () => {
  toggleCompactView();
});

// IPC: Save splitter position from renderer
ipcMain.on('save-splitter-position', (event, position) => {
  updateSplitterPosition(position);
});

// IPC: Expose full view dimensions to renderer
ipcMain.handle('get-full-view-dimensions', () => {
  return appConfig.windowState.fullView;
});

// IPC: Save theme selection from renderer
ipcMain.on('save-theme', (event, theme) => {
  if (!appConfig) return;
  appConfig.theme = theme;
  saveAppState();
});

ipcMain.on('save-status-area-visibility', (event, isVisible) => {
  if (!appConfig) return;
  appConfig.statusAreaVisible = isVisible;
  saveAppState();
});

ipcMain.on('save-font-settings', (event, { fontSize, fontFamily }) => {
  if (!appConfig) return;
  if (fontSize) {
    appConfig.font.size = fontSize;
  }
  if (fontFamily) {
    appConfig.font.family = fontFamily;
  }
  saveAppState();
});

// --- Helper Functions ---

/**
 * Saves the current application state to the configuration file.
 * This includes window size, position, and other user settings.
 */
function saveAppState() {
  if (!configManager || !appConfig) return;
  
  // Update appConfig with the latest view mode before creating a copy for saving
  appConfig.windowState.currentView = mainWindow && mainWindow.isCompact ? 'compact' : 'full';

  // Create a copy of the state to be saved


  // Save to file
  configManager.saveConfig(appConfig);
}

/**
 * Resets the application configuration to default values.
 * Uses the defaultConfig from config.js, applies it to all views, and saves it to the config file.
 */
function resetToDefaultConfig() {
  try {
    // Cancel any pending debounced saves to prevent race conditions
    if (typeof saveStateTimeout !== 'undefined') {
      clearTimeout(saveStateTimeout);
    }

    // Dynamically re-require both ConfigManager and defaultConfig to guarantee freshness
    const configPath = path.join(basePath, 'config.js');
    delete require.cache[require.resolve(configPath)];
    const { ConfigManager, defaultConfig } = require(configPath);

    // Create a new ConfigManager instance for the reset, ensuring it uses the latest defaultConfig
    configManager = new ConfigManager();
    const resetResult = configManager.resetConfig();

    if (!resetResult.success) {
      logStatus(`Error resetting configuration: ${resetResult.error}`);
      return;
    }

    // Use the freshly imported defaultConfig for applying to the app
    if (mainWindow) {
      applyConfigToWindow(defaultConfig);
    }

    // Update appConfig in memory with the reset values
    appConfig = { ...defaultConfig };

    // If the login dialog is open/hidden, resize and re-center it to match reset defaults
    if (velocityLoginWindow && !velocityLoginWindow.isDestroyed()) {
      const defaults = defaultConfig.dialogSizes && defaultConfig.dialogSizes.velocityLogin;
      const w = (defaults && defaults.width) || 590;
      const h = (defaults && defaults.height) || 840;
      velocityLoginWindow.setSize(w, h);
      velocityLoginWindow.center();
    }

    // Force an immediate save to ensure the reset config is persisted
    saveAppState();

    // Update the main menu to reflect the reset state
    const applicationMenu = createMainMenu();
    Menu.setApplicationMenu(applicationMenu);

    logStatus('Configuration reset to default values');
  } catch (error) {
    console.error('Error in resetToDefaultConfig:', error);
    logStatus(`Error resetting configuration: ${error.message}`);
  }
}

/**
 * Applies configuration settings to the main window and renderer process.
 * @param {object} config - The configuration object to apply
 */
function applyConfigToWindow(config) {
  if (!mainWindow || !config) return;
  
  try {
    // Reset window state and view mode
    const shouldBeCompact = config.windowState.currentView === 'compact';
    
    // Reset to correct view mode if needed
    if (mainWindow.isCompact !== shouldBeCompact) {
      toggleCompactView();
    }
    
    // Reset window dimensions and splitter position
    const dimensions = shouldBeCompact ? config.windowState.compactView : config.windowState.fullView;
    mainWindow.setBounds(dimensions);
    mainWindow.webContents.send('set-compact-view', shouldBeCompact, dimensions.splitterPosition);
    
    // Apply all UI settings to the renderer process
    mainWindow.webContents.send('load-saved-theme', config.theme);
    mainWindow.webContents.send('load-status-area-visibility', config.statusAreaVisible);
    mainWindow.webContents.send('set-font-size', config.font.size);
    mainWindow.webContents.send('set-font-family', config.font.family);
    mainWindow.webContents.send('toggle-camera-support', config.cameraSupport);
    mainWindow.webContents.send('toggle-microphone-support', config.microphoneSupport);
    
    // Reset menu bar visibility if needed
    if (config.menuBarVisible !== mainWindow.isMenuBarVisible()) {
      toggleMenuBar();
    }
    
    // Apply window opacity
    mainWindow.setOpacity(config.opacity);
  } catch (error) {
    console.error('Error applying config to window:', error);
  }
}

/**
 * Toggles the main window between compact and full view modes.
 * It resizes and repositions the window based on saved settings.
 */
function toggleCompactView() {
  if (!mainWindow) return;

  const targetView = mainWindow.isCompact ? 'fullView' : 'compactView';
  const { x, y, width, height } = appConfig.windowState[targetView];

  // Set the state BEFORE resizing
  mainWindow.isCompact = !mainWindow.isCompact;

  // Animate the window to the new position and size
  mainWindow.setBounds({ x, y, width, height }, true);

  // Send the new state and splitter position to the renderer
  const position = mainWindow.isCompact ? appConfig.windowState.compactView.splitterPosition : appConfig.windowState.fullView.splitterPosition;
  mainWindow.webContents.send('set-compact-view', mainWindow.isCompact, position);

  saveAppState();
}

/**
 * Toggles the visibility of the menu bar.
 * Updates the appConfig and saves the state.
 */
function toggleMenuBar() {
  if (!mainWindow) return;
  const newVisibility = !mainWindow.isMenuBarVisible();
  mainWindow.setMenuBarVisibility(newVisibility);
  appConfig.menuBarVisible = newVisibility;
  saveAppState();
}

/**
 * Updates and saves the position of the UI splitter.
 * @param {string} position - The new splitter position (e.g., '300px').
 */
function updateSplitterPosition(position) {
  if (!mainWindow) return;
  if (mainWindow.isCompact) {
    appConfig.windowState.compactView.splitterPosition = position;
  } else {
    appConfig.windowState.fullView.splitterPosition = position;
  }
  saveAppState();
}

/**
 * Sends a log message to the renderer process to be displayed in the status log.
 * @param {string} message - The message to log.
 */
const logStatus = (message) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-status', message);
  }
};

/**
 * Emits a connection status change event to the renderer process.
 * @param {string} status - The new connection status (e.g., 'connected', 'disconnected', 'error').
 * @param {string} message - A descriptive message about the status change.
 */
const emitConnectionStatus = (status, message) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('connection-status-changed', status, message);
  }
};

/**
 * Cleans up all active network connections.
 * This is called before the application quits to ensure graceful shutdown.
 */
const cleanupConnections = () => {
  if (!connection) return;
  
  try {
    if (connection instanceof net.Server) { // TCP Server
      tcpClientSockets.forEach((socket) => {
        if (!socket.destroyed) socket.destroy();
      });
      tcpClientSockets = [];
      // Reset flag when clearing all clients
      hasLoggedNoClients = false;
      if (!connection.listening) return;
      connection.close();
    } else if (connection instanceof net.Socket) { // TCP Client
      if (!connection.destroyed) connection.destroy();
    } else if (connection.socket) { // UDP
      connection.socket.close();
    }
  } catch (err) {
    console.error('Error during connection cleanup:', err.message);
  } finally {
    connection = null;
  }
};

/**
 * The set of keys that belong to the launch config (runtime/connection behavior).
 */
/**
 * Opens a dialog to apply a launch configuration from a JSON file.
 * The file uses the sectioned structure (connection, streaming, output)
 * matching the launch-config sample files. Values are extracted from
 * each section and sent as flat presets to the renderer via 'cli-presets'.
 */
async function applyLaunchConfigFrom() {
  const { filePaths } = await dialog.showOpenDialog({
    title: 'Apply Launch Configuration',
    properties: ['openFile'],
    filters: [{ name: 'JSON files', extensions: ['json'] }]
  });
  if (filePaths && filePaths.length > 0) {
    try {
      const data = fs.readFileSync(filePaths[0], 'utf8');
      const parsed = JSON.parse(data);
      const presets = {};
      // Walk each section and collect non-comment, non-undefined values
      for (const section of Object.values(parsed)) {
        if (section && typeof section === 'object' && !Array.isArray(section)) {
          for (const [key, value] of Object.entries(section)) {
            if (!key.startsWith('_') && value !== undefined) {
              presets[key] = value;
            }
          }
        }
      }
      if (Object.keys(presets).length > 0 && mainWindow) {
        mainWindow.webContents.send('cli-presets', presets);
        logStatus(`Launch configuration applied from ${filePaths[0]}`);
      }
    } catch (error) {
      logStatus(`Error applying launch config: ${error.message}`);
    }
  }
}

/**
 * Reads the current launch configuration values from the renderer UI
 * and returns a sectioned object matching the launch-config sample file
 * structure: { connection, streaming, output }.
 * All properties are included, using current UI state or defaults.
 */
async function getCurrentLaunchConfig() {
  if (!mainWindow) return {};
  const currentSettings = await mainWindow.webContents.executeJavaScript(`
    (function() {
      const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
      const getChecked = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };
      const connType = getVal('connection-type') || 'tcp-server';
      const parts = connType.split('-');
      const loopBtn = document.getElementById('toggle-loop-button');
      const isLooping = loopBtn ? loopBtn.classList.contains('active') : false;
      return JSON.stringify({
        grpcHeaderPath: getVal('grpc-header-path') || 'replace.with.dedicated.uid',
        grpcHeaderPathKey: getVal('grpc-header-path-key') || 'grpc-path',
        grpcSendMethod: getVal('grpc-send-method') || 'stream',
        grpcSerialization: getVal('grpc-serialization') || 'protobuf',
        httpFormat: getVal('http-format') || 'delimited',
        httpPath: getVal('http-path') || '/',
        httpTls: getChecked('http-tls'),
        httpTlsCaPath: getVal('http-tls-ca-path') || null,
        httpTlsCertPath: getVal('http-tls-cert-path') || null,
        httpTlsKeyPath: getVal('http-tls-key-path') || null,
        intervalMs: parseInt(getVal('rate-ms'), 10) || 1000,
        ip: getVal('ip-address') || '127.0.0.1',
        linesPerInterval: parseInt(getVal('lines-per-interval'), 10) || 1,
        loop: isLooping,
        mode: parts[1] || 'server',
        port: parseInt(getVal('port'), 10) || 5565,
        protocol: parts[0] || 'tcp',
        sliderMax: parseInt(document.getElementById('line-slider').max, 10) || 0,
        sliderValue: parseInt(getVal('line-slider'), 10) || 0,
        tlsCaPath: getVal('grpc-tls-ca-path') || null,
        tlsCertPath: getVal('grpc-tls-cert-path') || null,
        tlsKeyPath: getVal('grpc-tls-key-path') || null,
        useTls: getChecked('grpc-tls'),
        wsFormat: getVal('ws-format') || 'delimited',
        wsHeaders: getVal('ws-headers') || null,
        wsIgnoreFirstMsg: getChecked('ws-ignore-first-msg'),
        wsPath: getVal('ws-path') || '/',
        wsSubscriptionMsg: getVal('ws-subscription-msg') || null,
        wsTls: getChecked('ws-tls'),
        wsTlsCaPath: getVal('ws-tls-ca-path') || null,
        wsTlsCertPath: getVal('ws-tls-cert-path') || null,
        wsTlsKeyPath: getVal('ws-tls-key-path') || null,
      });
    })()
  `);
  const s = JSON.parse(currentSettings);
  return {
    connection: {
      connectRetryIntervalMs: 1000,
      connectTimeoutMs: 0,
      connectWaitForServer: false,
      grpcHeaderPath: s.grpcHeaderPath,
      grpcHeaderPathKey: s.grpcHeaderPathKey,
      grpcSendMethod: s.grpcSendMethod,
      grpcSerialization: s.grpcSerialization,
      httpFormat: s.httpFormat,
      httpPath: s.httpPath,
      httpTls: s.httpTls,
      httpTlsCaPath: s.httpTlsCaPath,
      httpTlsCertPath: s.httpTlsCertPath,
      httpTlsKeyPath: s.httpTlsKeyPath,
      intervalMs: s.intervalMs,
      ip: s.ip,
      linesPerInterval: s.linesPerInterval,
      loop: s.loop,
      mode: s.mode,
      port: parseInt(s.port, 10) || 5565,
      protocol: s.protocol,
      tlsCaPath: s.tlsCaPath,
      tlsCertPath: s.tlsCertPath,
      tlsKeyPath: s.tlsKeyPath,
      useTls: s.useTls,
      waitForClient: false,
      wsFormat: s.wsFormat,
      wsHeaders: s.wsHeaders,
      wsIgnoreFirstMsg: s.wsIgnoreFirstMsg,
      wsPath: s.wsPath,
      wsSubscriptionMsg: s.wsSubscriptionMsg,
      wsTls: s.wsTls,
      wsTlsCaPath: s.wsTlsCaPath,
      wsTlsCertPath: s.wsTlsCertPath,
      wsTlsKeyPath: s.wsTlsKeyPath,
    },
    output: {
      doneFile: null,
      logFile: null,
      logLevel: (appConfig && appConfig.logLevel) || DEFAULT_LOG_LEVEL,
      runId: null,
      stdout: true,
    },
    streaming: {
      autoConnect: true,
      autoStart: true,
      endLine: s.sliderMax > 0 ? s.sliderMax + 1 : null,
      exitOnComplete: true,
      intervalMs: s.intervalMs,
      linesPerInterval: s.linesPerInterval,
      loop: s.loop,
      maxLines: null,
      onError: 'exit',
      startLine: s.sliderValue + 1,
    },
  };
}

let launchConfigWindow = null;

/**
 * Creates and displays the launch configuration dialog window.
 * Shows the current launch config as a well-structured JSON document,
 * matching the same format that is loaded from and saved to disk.
 */
async function showLaunchConfigDialog() {
  if (launchConfigWindow) {
    launchConfigWindow.focus();
    return;
  }
  if (!mainWindow) return;

  const currentTheme = await mainWindow.webContents.executeJavaScript('localStorage.getItem("theme");', true);

  const launchConfigDialog = (appConfig.dialogSizes && appConfig.dialogSizes.launchConfig) || {};
  launchConfigWindow = new BrowserWindow({
    width: launchConfigDialog.width || 500,
    height: launchConfigDialog.height || 400,
    x: launchConfigDialog.x || undefined,
    y: launchConfigDialog.y || undefined,
    parent: mainWindow,
    modal: process.platform !== 'darwin',
    show: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    icon: path.join(basePath, 'assets/icon.png'),
    webPreferences: {
      preload: path.join(basePath, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const saveLaunchConfigDialogBounds = () => {
    if (launchConfigWindow && !launchConfigWindow.isDestroyed()) {
      const [width, height] = launchConfigWindow.getSize();
      const [x, y] = launchConfigWindow.getPosition();
      if (!appConfig.dialogSizes) appConfig.dialogSizes = {};
      appConfig.dialogSizes.launchConfig = { width, height, x, y };
      configManager.saveConfig(appConfig);
    }
  };
  launchConfigWindow.on('resize', saveLaunchConfigDialogBounds);
  launchConfigWindow.on('move', saveLaunchConfigDialogBounds);

  // Wait for the theme to be applied before showing the window
  ipcMain.once('launch-config-theme-applied', () => {
    if (launchConfigWindow) {
      launchConfigWindow.show();
    }
  });

  launchConfigWindow.setMenuBarVisibility(false);
  launchConfigWindow.setMenu(null);
  launchConfigWindow.loadFile(path.join(basePath, 'launch-config.html'));

  // Send launch config data once content has loaded
  launchConfigWindow.webContents.on('did-finish-load', async () => {
    try {
      const launchConfig = await getCurrentLaunchConfig();
      const data = {
        config: launchConfig,
        theme: currentTheme || appConfig.theme,
      };
      launchConfigWindow.webContents.send('load-launch-config-data', data);
    } catch (error) {
      logStatus(`Error loading launch config for dialog: ${error.message}`);
    }
  });

  launchConfigWindow.on('closed', () => {
    ipcMain.removeAllListeners('launch-config-theme-applied');
    launchConfigWindow = null;
  });
}

/**
 * Opens a dialog to save the current launch configuration to a JSON file.
 * Requests current connection settings from the renderer, then writes
 * only launch-relevant keys.
 */
async function saveLaunchConfigAs() {
  if (!mainWindow) return;
  try {
    const launchConfig = await getCurrentLaunchConfig();
    const { filePath } = await dialog.showSaveDialog({
      title: 'Save Launch Configuration',
      defaultPath: 'launch-config.json',
      filters: [{ name: 'JSON files', extensions: ['json'] }]
    });
    if (filePath) {
      fs.writeFileSync(filePath, JSON.stringify(launchConfig, null, 2));
      logStatus(`Launch configuration saved to ${filePath}`);
    }
  } catch (error) {
    logStatus(`Error saving launch config: ${error.message}`);
  }
}

// --- IPC Handlers (Inter-Process Communication) ---

/**
 * Builds and returns the application's context menu.
 * @param {boolean} isCompact - Whether the application is in compact view.
 * @returns {Menu} The constructed context menu.
 */
function buildContextMenu(isCompact) {
  const isMac = process.platform === 'darwin';

  const themes = [
    { label: 'Default (🌙 Dark)', value: 'dark' },
    { label: '🔵 Blue', value: 'blue' },
    { label: '🟡 Color Blind', value: 'color-blind' },
    { label: '🌙 Dark', value: 'dark' },
    { label: '🌫️ Dark Gray', value: 'dark-gray' },
    { label: '🟢 Green', value: 'green' },
    { label: '⚫ High Contrast', value: 'high-contrast' },
    { label: '☀️ Light', value: 'light' },
    { label: '☁️ Light Gray', value: 'light-gray' },
    { label: '🌌 Midnight', value: 'midnight' },
    { label: '☕ Mocha', value: 'mocha' },
    { label: '🌊 Ocean', value: 'ocean' },
    { label: '🌸 Rose', value: 'rose' },
    { label: '🌺 Rose Dark', value: 'rose-dark' },
    { label: '🌅 Sunset', value: 'sunset' },
    { label: '💻 System', value: 'system' }
  ];

  const themeSubmenu = themes.flatMap((theme, index) => {
    const menuItem = {
      label: theme.label,
      type: 'radio',
      checked: appConfig.theme === theme.value,
      click: () => {
        mainWindow.webContents.send('set-theme', theme.value);
      }
    };
    if (index === 0) {
      return [menuItem, { type: 'separator' }];
    }
    return menuItem;
  });

  // Create opacity submenu with options from 100% to 50% in 5% decrements
  const opacitySubmenu = [];
  for (let opacity = 100; opacity >= 50; opacity -= 5) {
    const opacityValue = opacity / 100;
    opacitySubmenu.push({
      label: `${opacity}%`,
      type: 'radio',
      checked: Math.abs((appConfig.opacity || 1.0) - opacityValue) < 0.01,
      click: () => {
        if (mainWindow) {
          mainWindow.setOpacity(opacityValue);
          appConfig.opacity = opacityValue;
          saveAppState();
        }
      }
    });
  }

  const fontSizes = ['Default (13px)', ...Array.from({ length: 20 }, (_, i) => `${i + 6}px`)];
  const fontSizeSubmenu = fontSizes.flatMap((size, index) => {
    const newSize = size.startsWith('Default') ? '13px' : size;
    const menuItem = {
      label: size,
      type: 'radio',
      checked: appConfig.font.size === newSize,
      click: () => {
        mainWindow.webContents.send('set-font-size', newSize);
      }
    };
    if (index === 0) {
      return [menuItem, { type: 'separator' }];
    }
    return menuItem;
  });

  const fonts = [
    'Default (Monospace)',
    'Arial',
    'Brush Script MT',
    'Comic Sans MS',
    'Courier New',
    'cursive',
    'Garamond',
    'Georgia',
    'Helvetica',
    'Lucida Console',
    'Monospace',
    'Palatino',
    'Segoe UI',
    'Tahoma',
    'Times New Roman',
    'Trebuchet MS',
    'Verdana'
  ];
  const fontFamilySubmenu = fonts.flatMap((font, index) => {
    const fontValue = (font === 'Default (Monospace)' || font === 'Monospace') ? 'monospace' : font;
    const menuItem = {
      label: font,
      type: 'radio',
      checked: appConfig.font.family === fontValue,
      click: () => {
        mainWindow.webContents.send('set-font-family', fontValue);
      }
    };
    if (index === 0) {
      return [menuItem, { type: 'separator' }];
    }
    return menuItem;
  });

  const template = [
    {
      label: 'Help',
      accelerator: 'F1',
      click: () => {
        showHelpDialog();
      }
    },
    {
      label: 'Command Line Interface',
      accelerator: 'F3',
      click: () => {
        showCommandLineDialog();
      }
    },
    { type: 'separator' },
    {
      label: 'Theme',
      submenu: themeSubmenu
    },
    {
      label: 'Opacity',
      submenu: opacitySubmenu
    },
    {
      label: 'Font Size',
      submenu: fontSizeSubmenu
    },
    {
      label: 'Font Family',
      submenu: fontFamilySubmenu
    },
    { type: 'separator' },
    {
      label: 'Show App Configuration',
      accelerator: 'CmdOrCtrl+I',
      click: () => {
        showConfigDialog();
      }
    },
    {
      label: 'Save App Configuration',
      accelerator: 'CmdOrCtrl+Alt+S',
      click: () => {
        saveAppState();
        logStatus('App configuration saved.');
      }
    },
    {
      label: 'Save App Configuration To...',
      accelerator: 'CmdOrCtrl+Shift+S',
      click: async () => {
        const { filePath } = await dialog.showSaveDialog({
          title: 'Save App Configuration',
          defaultPath: 'velocity-simulator-config.json',
          filters: [{ name: 'JSON Files', extensions: ['json'] }]
        });
        if (filePath) {
          configManager.exportConfig(filePath, appConfig);
          logStatus(`App configuration saved to ${filePath}`);
        }
      }
    },
    {
      label: 'Apply App Configuration From...',
      accelerator: 'CmdOrCtrl+O',
      click: async () => {
        const { filePaths } = await dialog.showOpenDialog({
          title: 'Apply App Configuration',
          filters: [{ name: 'JSON Files', extensions: ['json'] }],
          properties: ['openFile']
        });
        if (filePaths && filePaths.length > 0) {
          const result = configManager.importConfig(filePaths[0]);
          if (result.success) {
            appConfig = result.config;
            // Apply the imported settings
            if (mainWindow) {
              const shouldBeCompact = appConfig.windowState.currentView === 'compact';
              if (mainWindow.isCompact !== shouldBeCompact) {
                toggleCompactView();
              } else {
                const dimensions = shouldBeCompact ? appConfig.windowState.compactView : appConfig.windowState.fullView;
                mainWindow.setBounds(dimensions);
                mainWindow.webContents.send('set-compact-view', shouldBeCompact, dimensions.splitterPosition);
              }
              mainWindow.webContents.send('load-saved-theme', appConfig.theme);
              mainWindow.webContents.send('load-status-area-visibility', appConfig.statusAreaVisible);
            }
            logStatus(`App configuration applied from ${filePaths[0]}`);
          } else {
            logStatus(`Error applying app configuration: ${result.error}`);
          }
        }
      }
    },
    {
      label: 'Reset App Configuration',
      accelerator: 'Shift+R',
      click: () => {
        resetToDefaultConfig();
      }
    },
    { type: 'separator' },
    {
      label: 'Show Launch Configuration',
      click: showLaunchConfigDialog
    },
    {
      label: 'Save Launch Configuration To...',
      click: saveLaunchConfigAs
    },
    {
      label: 'Apply Launch Configuration From...',
      click: applyLaunchConfigFrom
    },
    {
      label: 'Reset Launch Configuration',
      click: resetLaunchConfig
    },
    { type: 'separator' },
    {
      label: 'Camera Support',
      type: 'checkbox',
      checked: appConfig.cameraSupport,
      click: () => {
        appConfig.cameraSupport = !appConfig.cameraSupport;
        if (mainWindow) {
          mainWindow.webContents.send('toggle-camera-support', appConfig.cameraSupport);
        }
        saveAppState();
        // Update the main menu to reflect the new state
        const applicationMenu = createMainMenu();
        Menu.setApplicationMenu(applicationMenu);
      }
    },
    {
      label: 'Microphone Support',
      type: 'checkbox',
      checked: appConfig.microphoneSupport,
      click: () => {
        appConfig.microphoneSupport = !appConfig.microphoneSupport;
        if (mainWindow) {
          mainWindow.webContents.send('toggle-microphone-support', appConfig.microphoneSupport);
        }
        saveAppState();
        // Update the main menu to reflect the new state
        const applicationMenu = createMainMenu();
        Menu.setApplicationMenu(applicationMenu);
      }
    },
    { type: 'separator' },
    {
      label: 'Toggle Developer Tools',
      accelerator: 'F12',
      type: 'checkbox',
      checked: devToolsOpen,
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.toggleDevTools();
        }
      }
    },
    {
      label: 'Inspect Element Mode',
      accelerator: 'F11',
      type: 'checkbox',
      checked: inspectModeActive,
      click: () => {
        if (!mainWindow) return;
        inspectModeActive = !inspectModeActive;
        if (inspectModeActive) {
          if (!mainWindow.webContents.isDevToolsOpened()) {
            mainWindow.webContents.openDevTools({ mode: 'detach' });
          }
          mainWindow.webContents.send('enter-inspect-mode');
        } else {
          mainWindow.webContents.send('cancel-inspect-mode');
        }
        const applicationMenu = createMainMenu();
        Menu.setApplicationMenu(applicationMenu);
      }
    },
    {
      label: 'Test Error',
      click: () => {
        throw new Error('This is a test error to verify the global error handler.');
      }
    },
    {
      label: 'Log Level',
      submenu: buildLogLevelSubmenu()
    },
    { type: 'separator' },
    {
      label: isCompact ? 'Switch to Full View' : 'Switch to Compact View',
      accelerator: 'CmdOrCtrl+T',
      click: () => {
        toggleCompactView();
      }
    },
    ...(!isMac ? [{
        label: 'Toggle Menu Bar',
        type: 'checkbox',
        checked: mainWindow.isMenuBarVisible(),
        click: () => toggleMenuBar()
      }
    ] : []),
    { type: 'separator' },
    {
      label: 'About ArcGIS Velocity Simulator',
      accelerator: 'F2',
      click: () => showAboutDialog()
    }
  ];
  return Menu.buildFromTemplate(template);
}

// Handles a request from the renderer to show the context menu.
ipcMain.on('show-context-menu', (event) => {
  // Track compact/full state
  if (!mainWindow) return;
  const isCompact = mainWindow.isCompact || false;
  const menu = buildContextMenu(isCompact);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

// Inspect element at the coordinates reported by the renderer's pick-mode click.
ipcMain.on('inspect-element', (event, { x, y }) => {
  event.sender.inspectElement(x, y);
  // Clear active state once the pick completes, then sync both menus.
  inspectModeActive = false;
  const applicationMenu = createMainMenu();
  Menu.setApplicationMenu(applicationMenu);
});

// Renderer cancelled inspect mode (Escape key or explicit cancel).
ipcMain.on('inspect-element-done', () => {
  inspectModeActive = false;
  const applicationMenu = createMainMenu();
  Menu.setApplicationMenu(applicationMenu);
});

// Exposes the application's version to the renderer process (for the "About" dialog).
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-cli-help-reference', () => getCommandLineReferenceData());

// Opens the default mail client to send an error report.
ipcMain.on('send-error-to-developer', (event, errorDetails) => {
  const body = encodeURIComponent(`Hello, I encountered an error in the ArcGIS Velocity Simulator:\n\n${errorDetails}`);
  const mailtoUrl = `mailto:hkalmanovich@esri.com?subject=ArcGIS%20Velocity%20Simulator%20Error%20Report&body=${body}`;
  shell.openExternal(mailtoUrl);
});

// Shows an "Open File" dialog and returns the selected file path to the renderer.
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'CSV Files', extensions: ['csv', 'txt'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

// Reads a CSV file line by line and returns the lines as an array of strings.
ipcMain.handle('read-csv-file', (event, filePath) => {
  return new Promise((resolve, reject) => {
    // Validate file path
    if (!filePath || typeof filePath !== 'string') {
      reject(new Error('Invalid file path'));
      return;
    }

    const lines = [];
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      if (line.trim() !== '') {
        lines.push(line);
      }
    });

    rl.on('close', () => {
      rl.removeAllListeners();
      resolve(lines);
    });

    rl.on('error', (err) => {
      logStatus(`Error reading file: ${err.message}`);
      rl.removeAllListeners();
      reject(err);
    });

    stream.on('error', (err) => {
      logStatus(`Error reading file stream: ${err.message}`);
      rl.removeAllListeners();
      reject(err);
    });
  });
});

// IPC handlers for config import/export
ipcMain.handle('export-config', async (event, filePath) => {
  if (!configManager) {
    return { success: false, error: 'Config manager not initialized' };
  }
  return configManager.exportConfig(filePath, appConfig);
});

ipcMain.handle('import-config', async (event, filePath) => {
  if (!configManager) {
    return { success: false, error: 'Config manager not initialized' };
  }
  
  const result = configManager.importConfig(filePath);
  if (result.success) {
    // Update the current app config and apply changes
    appConfig = result.config;
    
    // Apply the imported view state if window exists
    if (mainWindow) {
      const shouldBeCompact = appConfig.windowState.currentView === 'compact';
      if (mainWindow.isCompact !== shouldBeCompact) {
        toggleCompactView();
      } else {
        // Just resize to match imported dimensions
        const dimensions = shouldBeCompact ? appConfig.windowState.compactView : appConfig.windowState.fullView;
        mainWindow.setSize(dimensions.width, dimensions.height);
        mainWindow.webContents.send('set-compact-view', shouldBeCompact, dimensions.splitterPosition);
      }
      
      // Apply imported theme
      mainWindow.webContents.send('load-saved-theme', appConfig.theme);
    }
  }
  
  return result;
});

ipcMain.handle('read-config-file', async (event, filePath) => {
  if (!configManager) {
    return { success: false, error: 'Config manager not initialized' };
  }
  return configManager.readConfigFile(filePath);
});

ipcMain.handle('write-config-file', async (event, filePath, config) => {
  if (!configManager) {
    return { success: false, error: 'Config manager not initialized' };
  }
  return configManager.writeConfigFile(filePath, config);
});

ipcMain.handle('get-config-path', async () => {
  if (!configManager) {
    return null;
  }
  return configManager.getConfigPath();
});

// Get current camera support state
ipcMain.handle('get-camera-support-state', () => {
  return appConfig.cameraSupport;
});

// Get current microphone support state
ipcMain.handle('get-microphone-support-state', () => {
  return appConfig.microphoneSupport;
});

// Establishes a TCP or UDP connection based on the provided parameters.
ipcMain.handle('connect', (event, { protocol, mode, ip, port, grpcSerialization, grpcSendMethod, headerPathKey, headerPath, useTls, tlsCaPath, tlsCertPath, tlsKeyPath, httpFormat, httpTls, httpTlsCaPath, httpTlsCertPath, httpTlsKeyPath, httpPath, wsFormat, wsTls, wsTlsCaPath, wsTlsCertPath, wsTlsKeyPath, wsPath, wsSubscriptionMsg, wsIgnoreFirstMsg, wsHeaders }) => {
  if (connection) {
    logStatus('Error: A connection is already active.');
    return { success: false, error: 'Connection already active' };
  }

  // Validate input parameters
  if (!protocol || !mode) {
    logStatus('Error: Protocol and mode are required.');
    return { success: false, error: 'Invalid parameters' };
  }

  if (!port || port < 1 || port > 65535) {
    logStatus('Error: Valid port number required (1-65535).');
    return { success: false, error: 'Invalid port' };
  }

  if (mode === 'client' && (!ip || ip.trim() === '')) {
    logStatus('Error: IP address required for client mode.');
    return { success: false, error: 'IP address required' };
  }

  try {
    if (protocol === 'tcp') {
      if (mode === 'server') {
        const server = net.createServer((socket) => {
          logStatus(`Client connected: ${socket.remoteAddress}:${socket.remotePort}`);
          tcpClientSockets.push(socket);
          // Reset flag when client connects
          hasLoggedNoClients = false;
          socket.on('data', (data) => logStatus(`Received from client: ${data.toString()}`));
          socket.on('close', () => {
            logStatus('Client disconnected.');
            tcpClientSockets = tcpClientSockets.filter((s) => s !== socket);
            // Reset flag when client disconnects so message can be logged again if needed
            hasLoggedNoClients = false;
          });
          socket.on('error', (err) => logStatus(`Socket error: ${err.message}`));
        });
        server.on('error', (err) => {
          emitConnectionStatus('disconnected', `TCP Server error: ${err.message}`);
          connection = null;
        });
        server.listen(port, ip, () => {
          connection = server;
          const address = server.address();
          emitConnectionStatus('connected', `TCP Server listening on ${address.address}:${address.port}`);
        });
      } else { // TCP Client
        const client = net.createConnection({ host: ip, port }, () => {
          connection = client;
          emitConnectionStatus('connected', `TCP client connected to ${ip}:${port} from local port ${client.localPort}`);
        });
        client.on('error', (err) => {
          emitConnectionStatus('disconnected', `TCP Client error: ${err.message}`);
          connection = null;
        });
        client.on('close', () => {
          emitConnectionStatus('disconnected', 'Disconnected from TCP server.');
          connection = null;
        });
      }
    } else if (protocol === 'udp') {
      const socket = dgram.createSocket('udp4');
      if (mode === 'server') {
        udpServerClients = new Set();
        socket.on('error', (err) => {
          emitConnectionStatus('disconnected', `UDP Server error: ${err.message}`);
          socket.close();
          connection = null;
        });
        socket.on('listening', () => {
          const address = socket.address();
          connection = { socket, protocol, mode };
          logStatus(`UDP Server successfully bound and listening on ${address.address}:${address.port}`);
          emitConnectionStatus('connected', `UDP Server listening on ${address.address}:${address.port}`);
        });
        socket.on('message', (msg, rinfo) => {
          const clientKey = `${rinfo.address}:${rinfo.port}`;
          if (!udpServerClients.has(clientKey)) {
            udpServerClients.add(clientKey);
            logStatus(`New UDP client detected: ${clientKey}`);
          }
          logStatus(`Received from ${clientKey}: ${msg}`);
        });
        socket.bind(port, ip);
      } else { // UDP Client
        socket.bind(() => {
          const localAddress = socket.address();
          connection = { socket, protocol, mode, ip, port };
          emitConnectionStatus('connected', `UDP Client ready to send to ${ip}:${port} from local port ${localAddress.port}`);
        });
      }
    } else if (protocol === 'grpc') {
      const ser = grpcSerialization || 'protobuf';
      const authToken = velocityTokenManager.token || null;
      if (mode === 'client') {
        grpcTransport = createGrpcClientTransport({ ip, port, grpcSerialization, useStreaming: grpcSendMethod !== 'unary', headerPathKey, headerPath, useTls, tlsCaPath, tlsCertPath, tlsKeyPath, authToken });
        grpcTransport.connect().then((result) => {
          connection = grpcTransport;
          emitConnectionStatus('connected', `gRPC client connected to ${ip}:${port} [${ser}] ${headerPathKey}=${headerPath}\n  ${result.tlsInfo || 'tls=off'}`);
        }).catch((err) => {
          grpcTransport = null;
          emitConnectionStatus('disconnected', `gRPC Client error: ${err.message}`);
        });
      } else { // gRPC Server
        grpcTransport = createGrpcServerTransport({ ip, port, grpcSerialization, headerPathKey, headerPath, useTls, tlsCaPath, tlsCertPath, tlsKeyPath });
        grpcTransport.connect().then((result) => {
          connection = grpcTransport;
          emitConnectionStatus('connected', `gRPC server listening on ${result.address.address}:${result.address.port} [${ser}]\n  ${result.tlsInfo || 'tls=off'}`);
        }).catch((err) => {
          grpcTransport = null;
          emitConnectionStatus('disconnected', `gRPC Server error: ${err.message}`);
        });
      }
    } else if (protocol === 'http') {
      const authToken = velocityTokenManager.token || null;
      if (mode === 'client') {
        httpTransport = createHttpClientTransport({ ip, port, httpFormat, httpPath, httpTls, httpTlsCaPath, httpTlsCertPath, httpTlsKeyPath, authToken });
        httpTransport.connect().then((result) => {
          connection = httpTransport;
          const contentType = FORMAT_CONTENT_TYPES[httpFormat] || 'text/plain';
          emitConnectionStatus('connected', `HTTP client connected to ${result.address} [${httpFormat}] Content-Type: ${contentType}\n  ${result.tlsInfo || 'tls=off'}`);
        }).catch((err) => {
          httpTransport = null;
          emitConnectionStatus('disconnected', `HTTP Client error: ${err.message}`);
        });
      } else { // HTTP Server
        httpTransport = createHttpServerTransport({ ip, port, httpFormat, httpPath, httpTls, httpTlsCaPath, httpTlsCertPath, httpTlsKeyPath });
        httpTransport.connect().then((result) => {
          connection = httpTransport;
          const contentType = FORMAT_CONTENT_TYPES[httpFormat] || 'text/plain';
          emitConnectionStatus('connected', `HTTP server listening on ${result.address.address}:${result.address.port} [${httpFormat}] Content-Type: ${contentType}\n  ${result.tlsInfo || 'tls=off'}`);
        }).catch((err) => {
          httpTransport = null;
          emitConnectionStatus('disconnected', `HTTP Server error: ${err.message}`);
        });
      }
    } else if (protocol === 'ws') {
      const { FORMAT_CONTENT_TYPES: WS_CT } = require(path.join(basePath, 'format-utils.js'));
      const authToken = velocityTokenManager.token || null;
      if (mode === 'client') {
        wsTransport = createWsClientTransport({ ip, port, wsFormat, wsPath, wsTls, wsTlsCaPath, wsTlsCertPath, wsTlsKeyPath, wsSubscriptionMsg, wsIgnoreFirstMsg, wsHeaders, authToken });
        wsTransport.connect().then((result) => {
          connection = wsTransport;
          const contentType = WS_CT[wsFormat] || 'text/plain';
          emitConnectionStatus('connected', `WebSocket client connected to ${result.address} [${wsFormat}] Content-Type: ${contentType}\n  ${result.tlsInfo || 'tls=off'}`);
        }).catch((err) => {
          wsTransport = null;
          emitConnectionStatus('disconnected', `WebSocket Client error: ${err.message}`);
        });
      } else { // WS Server
        wsTransport = createWsServerTransport({ ip, port, wsFormat, wsPath, wsTls, wsTlsCaPath, wsTlsCertPath, wsTlsKeyPath });
        wsTransport.connect().then((result) => {
          connection = wsTransport;
          const contentType = WS_CT[wsFormat] || 'text/plain';
          emitConnectionStatus('connected', `WebSocket server listening on ${result.url} [${wsFormat}] Content-Type: ${contentType}\n  ${result.tlsInfo || 'tls=off'}`);
        }).catch((err) => {
          wsTransport = null;
          emitConnectionStatus('disconnected', `WebSocket Server error: ${err.message}`);
        });
      }
    }
    return { success: true };
  } catch (err) {
    logStatus(`Connection error: ${err.message}`);
    connection = null;
    return { success: false, error: err.message };
  }
});

// Disconnects any active TCP or UDP connection.
ipcMain.handle('disconnect', () => {
  if (!connection) return { success: false, error: 'No active connection' };
  
  try {
    if (connection instanceof net.Server) { // TCP Server
      tcpClientSockets.forEach((socket) => {
        if (!socket.destroyed) socket.destroy();
      });
      tcpClientSockets = [];
      // Reset flag when disconnecting all clients
      hasLoggedNoClients = false;
      connection.close(() => {
        emitConnectionStatus('disconnected', 'TCP Server has been shut down.');
        connection = null;
      });
    } else if (connection instanceof net.Socket) { // TCP Client
      if (!connection.destroyed) connection.destroy();
      emitConnectionStatus('disconnected', 'TCP Client disconnected.');
      connection = null;
    } else if (connection.socket) { // UDP
      connection.socket.close(() => {
        emitConnectionStatus('disconnected', 'UDP connection has been closed.');
        connection = null;
      });
    } else if (grpcTransport) { // gRPC
      grpcTransport.disconnect().then(() => {
        emitConnectionStatus('disconnected', 'gRPC connection has been closed.');
        connection = null;
        grpcTransport = null;
      });
    } else if (httpTransport) { // HTTP
      httpTransport.disconnect().then(() => {
        emitConnectionStatus('disconnected', 'HTTP connection has been closed.');
        connection = null;
        httpTransport = null;
      });
    } else if (wsTransport) { // WebSocket
      wsTransport.disconnect();
      emitConnectionStatus('disconnected', 'WebSocket connection has been closed.');
      connection = null;
      wsTransport = null;
    }
    return { success: true };
  } catch (err) {
    logStatus(`Disconnect error: ${err.message}`);
    connection = null;
    return { success: false, error: err.message };
  }
});

// Receives data from the renderer and sends it over the active connection.
ipcMain.on('send-data', (event, data) => {
  if (!connection) {
    logStatus('Error: No active connection to send data.');
    return;
  }

  if (!data || typeof data !== 'string') {
    logStatus('Error: Invalid data to send.');
    return;
  }

  try {
    const message = data + '\n';
    if (connection instanceof net.Server) { // TCP Server
      if (tcpClientSockets.length > 0) {
        tcpClientSockets.forEach((socket) => {
          if (!socket.destroyed) {
            socket.write(message);
          }
        });
        // Reset flag when we have clients
        hasLoggedNoClients = false;
      } else {
        // Only log once until state changes
        if (!hasLoggedNoClients) {
          logStatus('No clients connected to send data to.');
          hasLoggedNoClients = true;
        }
      }
    } else if (connection instanceof net.Socket) { // TCP Client
      if (!connection.destroyed) {
        connection.write(message);
      } else {
        logStatus('TCP connection is closed.');
      }
    } else if (connection.socket && connection.mode === 'client') { // UDP Client
      const buffer = Buffer.from(data);
      connection.socket.send(buffer, connection.port, connection.ip, (err) => {
        if (err) logStatus(`UDP send error: ${err.message}`);
      });
    } else if (connection.socket && connection.mode === 'server') { // UDP Server
      if (udpServerClients.size === 0) {
        logStatus('No UDP clients to send data to.');
      } else {
        const buffer = Buffer.from(data);
        udpServerClients.forEach((clientKey) => {
          const [host, port] = clientKey.split(':');
          connection.socket.send(buffer, parseInt(port, 10), host, (err) => {
            if (err) logStatus(`UDP server send error to ${clientKey}: ${err.message}`);
          });
        });
      }
    } else if (grpcTransport) { // gRPC
      grpcTransport.send(data).catch((err) => {
        logStatus(`gRPC send error: ${err.message}`);
      });
    } else if (httpTransport) { // HTTP
      httpTransport.send(data).catch((err) => {
        logStatus(`HTTP send error: ${err.message}`);
      });
    } else if (wsTransport) { // WebSocket
      try {
        wsTransport.send(data);
      } catch (err) {
        logStatus(`WebSocket send error: ${err.message}`);
      }
    }
  } catch (err) {
    logStatus(`Send data error: ${err.message}`);
  }
});

// ─── Velocity Login / Feed Picker IPC ────────────────────────────────────────

const velocityCredsFile = path.join(userDataPath, 'velocity-credentials.json');

/**
 * Opens the Velocity Login dialog as a modal child window.
 */
async function showVelocityLoginDialog() {
  if (velocityLoginWindow && !velocityLoginWindow.isDestroyed()) {
    velocityLoginWindow.show();
    velocityLoginWindow.focus();
    return;
  }
  if (!mainWindow) return;

  const currentTheme = await mainWindow.webContents.executeJavaScript('localStorage.getItem("theme");', true);

  const loginDialogSaved = (appConfig.dialogSizes && appConfig.dialogSizes.velocityLogin) || {};

  velocityLoginWindow = new BrowserWindow({
    width: loginDialogSaved.width || 590,
    height: loginDialogSaved.height || 840,
    x: loginDialogSaved.x || undefined,
    y: loginDialogSaved.y || undefined,
    parent: mainWindow,
    modal: process.platform !== 'darwin',
    show: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    icon: path.join(basePath, 'assets/icon.png'),
    title: 'Sign In to ArcGIS Velocity',
    webPreferences: {
      preload: path.join(basePath, 'velocity-login-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  velocityLoginWindow.setMenuBarVisibility(false);
  velocityLoginWindow.setMenu(null);
  velocityLoginWindow.loadFile(path.join(basePath, 'velocity-login.html'));

  velocityLoginWindow.webContents.on('did-finish-load', () => {
    if (currentTheme) {
      velocityLoginWindow.webContents.executeJavaScript(`document.documentElement.setAttribute('data-theme', '${currentTheme}');`);
    }
  });

  const saveLoginDialogBounds = () => {
    if (velocityLoginWindow && !velocityLoginWindow.isDestroyed()) {
      const [width, height] = velocityLoginWindow.getSize();
      const [x, y] = velocityLoginWindow.getPosition();
      if (!appConfig.dialogSizes) appConfig.dialogSizes = {};
      appConfig.dialogSizes.velocityLogin = { width, height, x, y };
      configManager.saveConfig(appConfig);
    }
  };
  velocityLoginWindow.on('resize', saveLoginDialogBounds);
  velocityLoginWindow.on('move', saveLoginDialogBounds);

  // Hide instead of destroy when closed — preserves state for next open
  velocityLoginWindow.on('close', (e) => {
    if (velocityLoginWindow && !velocityLoginWindow.isDestroyed()) {
      e.preventDefault();
      velocityLoginWindow.hide();
    }
  });

  velocityLoginWindow.on('closed', () => {
    velocityLoginWindow = null;
  });
}

// Hide the login dialog without destroying it (preserves all state)
ipcMain.on('velocity:hide-login', () => {
  if (velocityLoginWindow && !velocityLoginWindow.isDestroyed()) {
    velocityLoginWindow.hide();
  }
});

// Open the Velocity login dialog from the renderer
ipcMain.on('velocity:open-login', () => {
  showVelocityLoginDialog();
});

// Login with username/password
ipcMain.handle('velocity:login', async (event, { portalUrl, username, password }) => {
  velocityLog('info', `[Auth] Sign-in attempt (password) to ${portalUrl} as "${username}"`);
  try {
    const tokenResult = await generateToken(portalUrl, username, password);
    const velocityUrl = await getVelocityApiUrl(portalUrl, tokenResult.token);
    // Start the token manager session
    await velocityTokenManager.loginWithPassword(portalUrl, username, password);
    velocityLog('info', `[Auth] Sign-in successful. Velocity URL: ${velocityUrl}`);
    velocityLog('debug', `[Auth] Token: ${tokenResult.token}`);
    velocityLog('debug', `[Auth] Query feeds URL: ${velocityUrl}/iot/feeds?f=json&token=${tokenResult.token}&num=1000`);
    velocityLog('debug', `[Auth] Request headers: Authorization: token=${tokenResult.token}`);
    return { token: tokenResult.token, expires: tokenResult.expires, velocityUrl };
  } catch (err) {
    velocityLog('error', `[Auth] Sign-in failed: ${err.message}`);
    return { error: err.message };
  }
});

// Login with OAuth 2.0
ipcMain.handle('velocity:login-oauth', async (event, { portalUrl, clientId, clientSecret }) => {
  velocityLog('info', `[Auth] OAuth sign-in attempt to ${portalUrl} with client "${clientId}"`);
  try {
    const tokenResult = await generateOAuthToken(portalUrl, clientId, clientSecret);
    const velocityUrl = await getVelocityApiUrl(portalUrl, tokenResult.token);
    await velocityTokenManager.loginWithOAuth(portalUrl, clientId, clientSecret);
    velocityLog('info', `[Auth] OAuth sign-in successful. Velocity URL: ${velocityUrl}`);
    velocityLog('debug', `[Auth] Token: ${tokenResult.token}`);
    velocityLog('debug', `[Auth] Query feeds URL: ${velocityUrl}/iot/feeds?f=json&token=${tokenResult.token}&num=1000`);
    velocityLog('debug', `[Auth] Request headers: Authorization: token=${tokenResult.token}`);
    return { token: tokenResult.token, expires: tokenResult.expires, velocityUrl };
  } catch (err) {
    velocityLog('error', `[Auth] OAuth sign-in failed: ${err.message}`);
    return { error: err.message };
  }
});

// List feeds (for feed picker)
ipcMain.handle('velocity:list-items', async (event, { velocityUrl, token, adminScope }) => {
  velocityLog('info', `[API] Listing feeds from ${velocityUrl} (scope: ${adminScope ? 'org' : 'my'})`);
  try {
    const results = await listFeeds(velocityUrl, token, adminScope);
    velocityLog('info', `[API] Listed ${Array.isArray(results) ? results.length : 0} feed(s)`);
    return results;
  } catch (err) {
    velocityLog('error', `[API] List feeds failed: ${err.message}`);
    return { error: err.message };
  }
});

// Get details for a single feed
ipcMain.handle('velocity:get-item-details', async (event, { velocityUrl, feedId, token }) => {
  try {
    return await getFeedDetails(velocityUrl, feedId, token);
  } catch (err) {
    return { error: err.message };
  }
});

// Store credentials (portal URL + username only)
ipcMain.handle('velocity:store-credentials', async (event, creds) => {
  try {
    fs.writeFileSync(velocityCredsFile, JSON.stringify(creds, null, 2));
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

// Retrieve stored credentials
ipcMain.handle('velocity:get-stored-credentials', async () => {
  try {
    if (fs.existsSync(velocityCredsFile)) {
      return JSON.parse(fs.readFileSync(velocityCredsFile, 'utf8'));
    }
    return null;
  } catch (err) {
    return null;
  }
});

// Apply a selected feed — forward to main renderer
ipcMain.on('velocity:apply-item', (event, item) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('velocity:feed-applied', item);
  }
});

// Forward token refresh events to all renderer processes
velocityTokenManager.on('refreshed', (token) => {
  // Hot-swap token on active client transports
  if (grpcTransport && grpcTransport.authToken !== undefined) {
    grpcTransport.authToken = token;
  }
  if (httpTransport && httpTransport.authToken !== undefined) {
    httpTransport.authToken = token;
  }
  // WS transport doesn't support mid-session header changes (token used at connect time only)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('velocity:token-refreshed', token);
  }
});

velocityTokenManager.on('error', (err) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('velocity:token-error', err.message);
  }
});

