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
 * @file preload.js
 * @description This script acts as a secure bridge between the main process and renderer process in Electron.
 * It uses Electron's contextBridge to safely expose IPC (Inter-Process Communication) methods to the renderer,
 * following security best practices by avoiding direct Node.js access in the renderer process.
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Main API bridge for the application's core functionality.
 * Exposes methods for file operations, networking, configuration, and UI state management.
 */
contextBridge.exposeInMainWorld('api', {
  // --- Application Information ---
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getCliHelpReference: () => ipcRenderer.invoke('get-cli-help-reference'),

  // --- File Operations (Renderer to Main) ---
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'), // Opens native file dialog
  readCsvFile: (filePath) => ipcRenderer.invoke('read-csv-file', filePath), // Reads CSV file content
  
  // --- Network Operations (Renderer to Main) ---
  connect: (options) => ipcRenderer.invoke('connect', options), // Establishes TCP/UDP connection
  disconnect: () => ipcRenderer.invoke('disconnect'), // Closes active connection
  sendData: (data) => ipcRenderer.send('send-data', data), // Sends data over active connection
  
  // --- UI and System Operations (Renderer to Main) ---
  showContextMenu: () => ipcRenderer.send('show-context-menu'), // Shows application context menu
  showCommandLineDialog: () => ipcRenderer.send('show-cli-dialog'), // Opens Command Line Interface dialog
  themeApplied: () => ipcRenderer.send('theme-applied'), // Notifies main process that theme was applied
  configThemeApplied: () => ipcRenderer.send('config-theme-applied'), // Notifies main process that config dialog theme was applied
  launchConfigThemeApplied: () => ipcRenderer.send('launch-config-theme-applied'), // Notifies main process that launch config dialog theme was applied
  errorThemeApplied: () => ipcRenderer.send('error-theme-applied'), // Notifies main process that error dialog theme was applied
  showErrorInDialog: (error) => ipcRenderer.send('show-error-in-dialog', { message: error.message, stack: error.stack }), // Shows error dialog
  saveTheme: (theme) => ipcRenderer.send('save-theme', theme), // Saves theme preference
  saveStatusAreaVisibility: (isVisible) => ipcRenderer.send('save-status-area-visibility', isVisible), // Saves status area visibility
  saveFontSettings: (settings) => ipcRenderer.send('save-font-settings', settings), // Saves font settings
  
  // --- Configuration Import/Export (Renderer to Main) ---
  exportConfig: (filePath) => ipcRenderer.invoke('export-config', filePath), // Exports configuration to file
  importConfig: (filePath) => ipcRenderer.invoke('import-config', filePath), // Imports configuration from file
  readConfigFile: (filePath) => ipcRenderer.invoke('read-config-file', filePath), // Reads configuration file without importing
  writeConfigFile: (filePath, config) => ipcRenderer.invoke('write-config-file', filePath, config), // Writes configuration to file
  getConfigPath: () => ipcRenderer.invoke('get-config-path'), // Gets current configuration file path

  // --- Event Listeners (Main to Renderer) ---
  // These methods set up listeners for events sent from the main process
  onLogStatus: (callback) => ipcRenderer.on('log-status', (_event, message) => callback(message)), // Receives log messages
  onConnectionStatusChanged: (callback) => ipcRenderer.on('connection-status-changed', (_event, status, message) => callback(status, message)), // Connection state changes
  onLoadFileOnStartup: (callback) => ipcRenderer.on('load-file-on-startup', (_event, filePath) => callback(filePath)), // File passed as startup argument
  onSetTheme: (callback) => ipcRenderer.on('set-theme', callback), // Theme change notifications
  onLoadSavedTheme: (callback) => ipcRenderer.on('load-saved-theme', (_event, theme) => callback(theme)), // Loads saved theme on startup
  onLoadStatusAreaVisibility: (callback) => ipcRenderer.on('load-status-area-visibility', (_event, isVisible) => callback(isVisible)), // Loads status area visibility on startup
  onSetCompactView: (callback) => ipcRenderer.on('set-compact-view', callback), // View mode change notifications
  onSetFontSize: (callback) => ipcRenderer.on('set-font-size', (_event, fontSize) => callback(fontSize)),
  onSetFontFamily: (callback) => ipcRenderer.on('set-font-family', (_event, fontFamily) => callback(fontFamily)),
  onKeyboardShortcut: (callback) => ipcRenderer.on('keyboard-shortcut', (_event, action) => callback(action)), // Keyboard shortcut notifications
  onToggleCameraSupport: (callback) => ipcRenderer.on('toggle-camera-support', (_event, isEnabled) => callback(isEnabled)), // Camera support toggle notifications
  onToggleMicrophoneSupport: (callback) => ipcRenderer.on('toggle-microphone-support', (_event, isEnabled) => callback(isEnabled)), // Microphone support toggle notifications
  onCliPresets: (callback) => ipcRenderer.on('cli-presets', (_event, presets) => callback(presets)), // CLI presets for UI prepopulation
  onEnterInspectMode: (callback) => ipcRenderer.on('enter-inspect-mode', (_event) => callback()), // Triggers one-shot element pick mode
  onCancelInspectMode: (callback) => ipcRenderer.on('cancel-inspect-mode', (_event) => callback()), // Cancels pick mode from menu toggle off

  // --- Window Management (Renderer to Main) ---
  toggleCompactView: () => ipcRenderer.send('toggle-compact-view'), // Toggles between compact and full view
  saveSplitterPosition: (position) => ipcRenderer.send('save-splitter-position', position), // Saves UI splitter position
  getFullViewDimensions: () => ipcRenderer.invoke('get-full-view-dimensions'), // Gets full view window dimensions
  inspectElement: (x, y) => ipcRenderer.send('inspect-element', { x, y }), // Triggers DevTools inspect at coordinates
  inspectElementDone: () => ipcRenderer.send('inspect-element-done'), // Notifies main that pick mode ended

  // --- Support State Queries (Renderer to Main) ---
  getCameraSupportState: () => ipcRenderer.invoke('get-camera-support-state'), // Gets current camera support state
  getMicrophoneSupportState: () => ipcRenderer.invoke('get-microphone-support-state'), // Gets current microphone support state

  // --- Velocity Login / Feed Picker ---
  openVelocityLogin: () => ipcRenderer.send('velocity:open-login'), // Opens the Velocity Sign-In dialog
  onFeedApplied: (callback) => ipcRenderer.on('velocity:feed-applied', (_event, item) => callback(item)), // Receives applied feed properties
  onTokenRefreshed: (callback) => ipcRenderer.on('velocity:token-refreshed', (_event, token) => callback(token)), // Token refresh notification
  onTokenError: (callback) => ipcRenderer.on('velocity:token-error', (_event, msg) => callback(msg)), // Token refresh failure
});

/**
 * Secondary API bridge specifically for dialog windows (config, error, about).
 * Provides a separate namespace to avoid conflicts and improve security isolation.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // --- Dialog-Specific Event Listeners ---
  onLoadConfigData: (callback) => ipcRenderer.on('load-config-data', (_event, data) => callback(data)), // Config dialog data loading
  onLoadLaunchConfigData: (callback) => ipcRenderer.on('load-launch-config-data', (_event, data) => callback(data)), // Launch config dialog data loading
  onLoadErrorData: (callback) => ipcRenderer.on('load-error-data', (_event, data) => callback(data)), // Error dialog data loading
  
  // --- External Communication ---
  sendErrorTodeveloper: (errorDetails) => ipcRenderer.send('send-error-to-developer', errorDetails), // Opens email client for error reporting
});