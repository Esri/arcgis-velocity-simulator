/**
 * Reference workspace window manager tests.
 * Run with: node test/reference-window-manager.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const {
  createReferenceWindowManager,
  isAllowedExternalUrl,
  resolveReferenceWindowBounds,
} = require('../src/reference-window-manager.js');
const mainSource = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

class MockIpcMain {
  constructor() {
    this.listeners = new Map();
  }

  on(channel, handler) {
    this.listeners.set(channel, handler);
  }

  removeListener(channel, handler) {
    if (this.listeners.get(channel) === handler) this.listeners.delete(channel);
  }

  emit(channel, event) {
    const listener = this.listeners.get(channel);
    assert.ok(listener, `${channel} must be registered`);
    listener(event);
  }
}

class MockBrowserWindow {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.handlers = new Map();
    this.destroyed = false;
    this.minimized = false;
    this.bounds = {
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height,
    };
    this.webContents = {};
    MockBrowserWindow.instances.push(this);
  }

  on(name, handler) {
    this.handlers.set(name, handler);
  }

  emit(name, ...args) {
    const handler = this.handlers.get(name);
    if (handler) handler(...args);
  }

  close() {
    if (this.destroyed) return;
    this.emit('close');
    this.destroyed = true;
    this.emit('closed');
  }

  focus() { this.focusCount = (this.focusCount || 0) + 1; }
  getBounds() { return { ...this.bounds }; }
  isDestroyed() { return this.destroyed; }
  isMinimized() { return this.minimized; }
  loadFile(file, options) { this.loadedFile = file; this.loadOptions = options; }
  restore() { this.minimized = false; this.restored = true; }
  setMenu() {}
  setMenuBarVisibility() {}
  show() { this.shown = true; }
}

function createMainWindow() {
  return {
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    getBounds() { return { x: 100, y: 80, width: 800, height: 600 }; },
  };
}

function createFixture() {
  MockBrowserWindow.instances.length = 0;
  const appConfig = {
    dialogSizes: {
      help: { x: -5000, y: 4000, width: 5000, height: 5000 },
    },
  };
  const saves = [];
  const ipcMain = new MockIpcMain();
  const mainWindow = createMainWindow();
  const screen = {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
  };
  const manager = createReferenceWindowManager({
    BrowserWindow: MockBrowserWindow,
    ipcMain,
    screen,
    path,
    basePath: path.join(__dirname, '..', 'src'),
    getMainWindow: () => mainWindow,
    getAppConfig: () => appConfig,
    saveAppConfig: (config) => saves.push(JSON.parse(JSON.stringify(config))),
  });
  return { appConfig, ipcMain, mainWindow, manager, saves };
}

console.log('reference-window-manager.test.js');

test('reference bounds clamp saved size and position to the selected display', () => {
  const screen = {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } }),
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } }),
  };
  assert.deepStrictEqual(resolveReferenceWindowBounds(screen, createMainWindow(), {
    x: -900, y: 900, width: 5000, height: 5000,
  }, {
    width: 1080, height: 760, minWidth: 720, minHeight: 500,
  }), {
    x: 0, y: 0, width: 1200, height: 800,
    minWidth: 720, minHeight: 500, maxWidth: 1200, maxHeight: 800,
  });
});

test('external links only allow the configured HTTPS documentation prefix', () => {
  const prefix = 'https://github.com/Esri/arcgis-velocity-simulator/blob/main/docs/';
  assert.strictEqual(isAllowedExternalUrl(`${prefix}tls.md`, prefix), true);
  assert.strictEqual(isAllowedExternalUrl('https://example.com/docs/tls.md', prefix), false);
  assert.strictEqual(isAllowedExternalUrl('http://github.com/Esri/arcgis-velocity-simulator/blob/main/docs/tls.md', prefix), false);
});

test('reference windows use framed, secure, non-modal workspace options', () => {
  const fixture = createFixture();
  const window = fixture.manager.open({
    key: 'help',
    title: 'Help - ArcGIS Velocity Simulator',
    file: 'help.html',
    readyChannel: 'help-dialog-ready',
    query: { theme: 'theme-dark' },
    defaults: { width: 1080, height: 760, minWidth: 720, minHeight: 500 },
  });
  assert.strictEqual(window.options.frame, true);
  assert.strictEqual(window.options.modal, false);
  assert.strictEqual(window.options.resizable, true);
  assert.strictEqual(window.options.minimizable, true);
  assert.strictEqual(window.options.maximizable, true);
  assert.strictEqual(window.options.parent, fixture.mainWindow);
  assert.strictEqual(window.options.webPreferences.contextIsolation, true);
  assert.strictEqual(window.options.webPreferences.nodeIntegration, false);
  assert.strictEqual(window.options.webPreferences.sandbox, true);
  assert.strictEqual(window.options.webPreferences.webSecurity, true);
  assert.strictEqual(window.options.webPreferences.allowRunningInsecureContent, false);
  assert.strictEqual(window.loadedFile, path.join(__dirname, '..', 'src', 'help.html'));
  assert.deepStrictEqual(window.loadOptions, { query: { theme: 'theme-dark' } });
});

test('reopening restores and focuses the existing reference window', () => {
  const fixture = createFixture();
  const original = fixture.manager.open({
    key: 'help',
    title: 'Help',
    file: 'help.html',
    defaults: { width: 1080, height: 760 },
  });
  original.minimized = true;
  const reopened = fixture.manager.open({
    key: 'help',
    title: 'Ignored',
    file: 'help.html',
    defaults: { width: 1080, height: 760 },
  });
  assert.strictEqual(reopened, original);
  assert.strictEqual(MockBrowserWindow.instances.length, 1);
  assert.strictEqual(original.restored, true);
  assert.strictEqual(original.focusCount, 1);
});

test('ready lifecycle shows the window and closing persists bounds', () => {
  const fixture = createFixture();
  const window = fixture.manager.open({
    key: 'help',
    title: 'Help',
    file: 'help.html',
    readyChannel: 'help-dialog-ready',
    defaults: { width: 1080, height: 760 },
  });
  fixture.ipcMain.emit('help-dialog-ready', { sender: {} });
  assert.strictEqual(window.shown, undefined);
  fixture.ipcMain.emit('help-dialog-ready', { sender: window.webContents });
  assert.strictEqual(window.shown, true);
  window.bounds = { x: 30, y: 40, width: 980, height: 700 };
  window.close();
  assert.deepStrictEqual(fixture.saves.at(-1).dialogSizes.help, window.bounds);
  assert.strictEqual(fixture.manager.getWindow('help'), null);
  assert.strictEqual(fixture.ipcMain.listeners.has('help-dialog-ready'), false);
});

test('closing the main window can close every reference workspace', () => {
  const fixture = createFixture();
  const help = fixture.manager.open({
    key: 'help', title: 'Help', file: 'help.html', defaults: { width: 1080, height: 760 },
  });
  const cli = fixture.manager.open({
    key: 'commandLine', title: 'CLI', file: 'cli.html', defaults: { width: 1200, height: 760 },
  });
  fixture.manager.closeAll();
  assert.strictEqual(help.destroyed, true);
  assert.strictEqual(cli.destroyed, true);
});

test('the main process delegates Help and CLI to the reference workspace policy', () => {
  assert.ok(mainSource.includes("referenceWindowManager.open({\n    key: 'help'"));
  assert.ok(mainSource.includes("referenceWindowManager.open({\n    key: 'commandLine'"));
  assert.ok(mainSource.includes('referenceWindowManager.closeAll();'));
  assert.ok(/const referenceWindowManager = createReferenceWindowManager\(\{[\s\S]*?\n  shell,\n\}\);/.test(mainSource));
  assert.ok(mainSource.includes('allowedExternalUrlPrefix: documentationUrlPrefix'));
  assert.ok(mainSource.includes('if (!sourceWindow || sourceWindow.isDestroyed() || sourceWindow.webContents.isDestroyed())'));
  assert.ok(mainSource.includes('Could not read the current theme'));
  const aboutWindowSource = mainSource.slice(
    mainSource.indexOf('aboutWindow = new BrowserWindow({'),
    mainSource.indexOf('function createSplashWindow()'),
  );
  assert.ok(!aboutWindowSource.includes('frame: false'));
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log(`All ${passed} reference window manager tests passed.`);
