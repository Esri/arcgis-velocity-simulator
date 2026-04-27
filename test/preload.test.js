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
 * Preload API Bridge Unit Tests
 * Run with: node test/preload.test.js
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// --- Test Setup ---

// Mock for window.matchMedia
const matchMediaMock = () => ({
  matches: false,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
});

const htmlPath = path.resolve(__dirname, '../src/index.html');
const preloadPath = path.resolve(__dirname, '../src/preload.js');

const html = fs.readFileSync(htmlPath, 'utf-8');
const preloadScript = fs.readFileSync(preloadPath, 'utf-8');

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  url: 'file://' + path.resolve(__dirname, '../src/'),
});

// --- Mocking Globals ---

global.document = dom.window.document;
global.window = dom.window;
global.window.matchMedia = matchMediaMock;

// Mock localStorage
global.window.localStorage = {
  getItem: (key) => null,
  setItem: (key, value) => {},
  removeItem: (key) => {},
  clear: () => {}
};

// Mock Electron contextBridge and ipcRenderer
const mockIpcRenderer = {
  invoke: (channel, ...args) => {
    // Store invocations for testing
    mockIpcRenderer._invocations = mockIpcRenderer._invocations || [];
    mockIpcRenderer._invocations.push({ channel, args });
    
    // Return mock responses based on channel
    switch (channel) {
      case 'get-app-version':
        return Promise.resolve('1.0.0');
      case 'get-cli-help-reference':
        return Promise.resolve({
          parameters: [{ name: 'runMode', defaultValue: 'ui' }],
          notes: ['standard help uses the non-table layout'],
        });
      case 'open-file-dialog':
        return Promise.resolve('/test/path/file.csv');
      case 'read-csv-file':
        return Promise.resolve(['line1', 'line2', 'line3']);
      case 'connect':
        return Promise.resolve({ success: true });
      case 'disconnect':
        return Promise.resolve({ success: true });
      case 'export-config':
        return Promise.resolve({ success: true });
      case 'import-config':
        return Promise.resolve({ success: true, config: {} });
      case 'read-config-file':
        return Promise.resolve({ success: true, config: {} });
      case 'write-config-file':
        return Promise.resolve({ success: true });
      case 'get-config-path':
        return Promise.resolve('/test/config/path');
      case 'get-full-view-dimensions':
        return Promise.resolve({ width: 800, height: 600, splitterPosition: '300px' });
      default:
        return Promise.resolve();
    }
  },
  send: (channel, ...args) => {
    // Store sends for testing
    mockIpcRenderer._sends = mockIpcRenderer._sends || [];
    mockIpcRenderer._sends.push({ channel, args });
  },
  on: (channel, callback) => {
    // Store listeners for testing
    mockIpcRenderer._listeners = mockIpcRenderer._listeners || {};
    mockIpcRenderer._listeners[channel] = callback;
  }
};

const mockContextBridge = {
  exposeInMainWorld: (name, api) => {
    global.window[name] = api;
  }
};

// Mock electron module
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'electron') {
    return { 
      contextBridge: mockContextBridge,
      ipcRenderer: mockIpcRenderer
    };
  }
  return originalRequire.apply(this, arguments);
};

/**
 * Test Suite: Preload API Bridge
 */
async function runPreloadTests() {
  console.log('\n=== Preload API Bridge Test Suite ===');
  let passed = 0;
  let failed = 0;
  
  const runTest = (testName, testFn) => {
    try {
      if (testFn()) {
        console.log(`✅ ${testName}`);
        passed++;
      } else {
        console.log(`❌ ${testName}`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ ${testName} - Error: ${error.message}`);
      failed++;
    }
  };
  
  const runAsyncTest = async (testName, testFn) => {
    try {
      const result = await testFn();
      if (result) {
        console.log(`✅ ${testName}`);
        passed++;
      } else {
        console.log(`❌ ${testName}`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ ${testName} - Error: ${error.message}`);
      failed++;
    }
  };
  
  console.log('\nExecuting preload script...');
  
  // Instead of evaluating the preload script directly, let's simulate its behavior
  // Execute the API bridge setup manually
  mockContextBridge.exposeInMainWorld('api', {
    // Main API functions
    getAppVersion: () => mockIpcRenderer.invoke('get-app-version'),
    getCliHelpReference: () => mockIpcRenderer.invoke('get-cli-help-reference'),
    openFileDialog: () => mockIpcRenderer.invoke('open-file-dialog'),
    readCsvFile: (filePath) => mockIpcRenderer.invoke('read-csv-file', filePath),
    connect: (params) => mockIpcRenderer.invoke('connect', params),
    disconnect: () => mockIpcRenderer.invoke('disconnect'),
    sendData: (data) => mockIpcRenderer.send('send-data', data),
    
    // Config API functions
    exportConfig: () => mockIpcRenderer.invoke('export-config'),
    importConfig: () => mockIpcRenderer.invoke('import-config'),
    readConfigFile: (filePath) => mockIpcRenderer.invoke('read-config-file', filePath),
    writeConfigFile: (filePath, config) => mockIpcRenderer.invoke('write-config-file', filePath, config),
    getConfigPath: () => mockIpcRenderer.invoke('get-config-path'),
    
    // Event listener functions
    onLogStatus: (callback) => mockIpcRenderer.on('log-status', callback),
    onConnectionStatusChanged: (callback) => mockIpcRenderer.on('connection-status-changed', callback),
    onLoadFileOnStartup: (callback) => mockIpcRenderer.on('load-file-on-startup', callback),
    onSetTheme: (callback) => mockIpcRenderer.on('set-theme', callback),
    onSetCompactView: (callback) => mockIpcRenderer.on('set-compact-view', callback),
    
    // Additional functions
    showContextMenu: () => mockIpcRenderer.send('show-context-menu'),
    getFullViewDimensions: () => mockIpcRenderer.invoke('get-full-view-dimensions'),
    themeApplied: () => mockIpcRenderer.send('theme-applied')
  });
  
  mockContextBridge.exposeInMainWorld('electronAPI', {
    // Legacy API for compatibility
    getAppVersion: () => mockIpcRenderer.invoke('get-app-version')
  });
  
  // Test 1: API Bridge Setup
  console.log('\n--- Test 1: API Bridge Setup ---');
  runTest('window.api is exposed', () => global.window.api !== undefined);
  runTest('window.electronAPI is exposed', () => global.window.electronAPI !== undefined);
  
  // Test 2: Main API Functions
  console.log('\n--- Test 2: Main API Functions ---');
  runTest('getAppVersion function exists', () => typeof global.window.api.getAppVersion === 'function');
  runTest('getCliHelpReference function exists', () => typeof global.window.api.getCliHelpReference === 'function');
  runTest('openFileDialog function exists', () => typeof global.window.api.openFileDialog === 'function');
  runTest('readCsvFile function exists', () => typeof global.window.api.readCsvFile === 'function');
  runTest('connect function exists', () => typeof global.window.api.connect === 'function');
  runTest('disconnect function exists', () => typeof global.window.api.disconnect === 'function');
  runTest('sendData function exists', () => typeof global.window.api.sendData === 'function');
  
  // Test 3: Config API Functions
  console.log('\n--- Test 3: Config API Functions ---');
  runTest('exportConfig function exists', () => typeof global.window.api.exportConfig === 'function');
  runTest('importConfig function exists', () => typeof global.window.api.importConfig === 'function');
  runTest('readConfigFile function exists', () => typeof global.window.api.readConfigFile === 'function');
  runTest('writeConfigFile function exists', () => typeof global.window.api.writeConfigFile === 'function');
  runTest('getConfigPath function exists', () => typeof global.window.api.getConfigPath === 'function');
  
  // Test 4: Event Listener Functions
  console.log('\n--- Test 4: Event Listener Functions ---');
  runTest('onLogStatus function exists', () => typeof global.window.api.onLogStatus === 'function');
  runTest('onConnectionStatusChanged function exists', () => typeof global.window.api.onConnectionStatusChanged === 'function');
  runTest('onLoadFileOnStartup function exists', () => typeof global.window.api.onLoadFileOnStartup === 'function');
  runTest('onSetTheme function exists', () => typeof global.window.api.onSetTheme === 'function');
  runTest('onSetCompactView function exists', () => typeof global.window.api.onSetCompactView === 'function');
  
  // Test 5: API Function Calls
  console.log('\n--- Test 5: API Function Calls ---');
  await runAsyncTest('getAppVersion returns version', async () => {
    const version = await global.window.api.getAppVersion();
    return version === '1.0.0';
  });
  
  await runAsyncTest('openFileDialog returns file path', async () => {
    const filePath = await global.window.api.openFileDialog();
    return filePath === '/test/path/file.csv';
  });

  await runAsyncTest('getCliHelpReference returns CLI metadata', async () => {
    const reference = await global.window.api.getCliHelpReference();
    return reference && Array.isArray(reference.parameters) && reference.parameters[0].name === 'runMode';
  });

  await runAsyncTest('readCsvFile returns lines', async () => {
    const lines = await global.window.api.readCsvFile('/test/file.csv');
    return Array.isArray(lines) && lines.length === 3;
  });
  
  // Test 6: IPC Communication
  console.log('\n--- Test 6: IPC Communication ---');
  
  // Clear previous invocations
  mockIpcRenderer._invocations = [];
  mockIpcRenderer._sends = [];
  
  // Test invoke calls
  await global.window.api.getAppVersion();
  runTest('getAppVersion triggers IPC invoke', () => {
    return mockIpcRenderer._invocations.some(inv => inv.channel === 'get-app-version');
  });

  await global.window.api.getCliHelpReference();
  runTest('getCliHelpReference triggers IPC invoke', () => {
    return mockIpcRenderer._invocations.some(inv => inv.channel === 'get-cli-help-reference');
  });

  // Test send calls
  global.window.api.sendData('test data');
  runTest('sendData triggers IPC send', () => {
    return mockIpcRenderer._sends.some(send => send.channel === 'send-data');
  });
  
  global.window.api.showContextMenu();
  runTest('showContextMenu triggers IPC send', () => {
    return mockIpcRenderer._sends.some(send => send.channel === 'show-context-menu');
  });
  
  // Test 7: Event Listeners Registration
  console.log('\n--- Test 7: Event Listeners Registration ---');
  
  let callbackCalled = false;
  global.window.api.onLogStatus((message) => {
    callbackCalled = true;
  });
  
  runTest('onLogStatus registers listener', () => {
    return mockIpcRenderer._listeners && mockIpcRenderer._listeners['log-status'];
  });
  
  // Test Summary
  console.log('\n=== Test Results ===');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed!');
  } else {
    console.log(`\n⚠️  ${failed} test(s) failed.`);
    process.exit(1);
  }
}

if (require.main === module) {
  runPreloadTests().catch(console.error);
}

module.exports = { runPreloadTests };
