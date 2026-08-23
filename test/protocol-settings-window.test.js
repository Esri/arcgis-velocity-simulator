/**
 * Detached Protocol Settings window, IPC, and DOM mirror tests.
 * Run with: node test/protocol-settings-window.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const {
  CHANNELS,
  createProtocolSettingsWindowManager,
  resolveWindowBounds,
  sanitizeStatePayload,
  sanitizeWindowEvent,
} = require('../src/protocol-settings-window-manager.js');

const SRC = path.join(__dirname, '..', 'src');
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

  emit(channel, event, payload) {
    const handler = this.listeners.get(channel);
    assert.ok(handler, `${channel} must be registered`);
    handler(event, payload);
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
    this.webContents = {
      sent: [],
      send: (channel, payload) => this.webContents.sent.push({ channel, payload }),
    };
    MockBrowserWindow.instances.push(this);
  }

  on(name, callback) {
    this.handlers.set(name, callback);
  }

  emit(name, ...args) {
    const callback = this.handlers.get(name);
    if (callback) callback(...args);
  }

  isDestroyed() { return this.destroyed; }
  isMinimized() { return this.minimized; }
  restore() { this.minimized = false; this.restored = true; }
  focus() { this.focused = (this.focused || 0) + 1; }
  show() { this.shown = true; }
  setMenuBarVisibility(value) { this.menuBarVisible = value; }
  setMenu(value) { this.menu = value; }
  setTitle(value) { this.title = value; }
  loadFile(value) { this.loadedFile = value; }
  getBounds() { return { ...this.bounds }; }

  close() {
    if (this.destroyed) return;
    this.emit('close');
    this.destroyed = true;
    this.emit('closed');
  }
}

function createMainWindow() {
  return {
    destroyed: false,
    focusCount: 0,
    webContents: {
      sent: [],
      send(channel, payload) {
        this.sent.push({ channel, payload });
      },
    },
    isDestroyed() { return this.destroyed; },
    getBounds() { return { x: 100, y: 80, width: 820, height: 480 }; },
    focus() { this.focusCount += 1; },
  };
}

function createManagerFixture() {
  MockBrowserWindow.instances.length = 0;
  const ipcMain = new MockIpcMain();
  const mainWindow = createMainWindow();
  const appConfig = {
    dialogSizes: {
      protocolSettings: { x: -5000, y: 5000, width: 2200, height: 1800 },
    },
  };
  const saves = [];
  const screen = {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
  };
  const manager = createProtocolSettingsWindowManager({
    BrowserWindow: MockBrowserWindow,
    ipcMain,
    screen,
    path,
    basePath: SRC,
    getMainWindow: () => mainWindow,
    getAppConfig: () => appConfig,
    saveAppConfig: (config) => saves.push(JSON.parse(JSON.stringify(config))),
  });
  return { ipcMain, mainWindow, appConfig, saves, manager };
}

console.log('protocol-settings-window.test.js');

test('saved bounds are clamped to the selected screen work area', () => {
  const screen = {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } }),
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } }),
  };
  const bounds = resolveWindowBounds(screen, createMainWindow(), {
    x: 0, y: 0, width: 5000, height: 5000,
  });
  assert.deepStrictEqual(bounds, {
    x: 0, y: 0, width: 1200, height: 800,
    minWidth: 420, minHeight: 260, maxWidth: 1200, maxHeight: 800,
  });
});

test('the manager creates one secure resizable BrowserWindow and focuses it on reopen', () => {
  const fixture = createManagerFixture();
  fixture.ipcMain.emit(CHANNELS.open, { sender: {} }, { title: 'rogue' });
  assert.strictEqual(MockBrowserWindow.instances.length, 0, 'a foreign sender must be ignored');

  fixture.ipcMain.emit(CHANNELS.open, { sender: fixture.mainWindow.webContents }, {
    title: 'HTTP Client settings',
  });
  assert.strictEqual(MockBrowserWindow.instances.length, 1);
  const settingsWindow = MockBrowserWindow.instances[0];
  assert.strictEqual(settingsWindow.options.width, 1440);
  assert.strictEqual(settingsWindow.options.height, 900);
  assert.strictEqual(settingsWindow.options.resizable, true);
  assert.strictEqual(settingsWindow.options.modal, false);
  assert.strictEqual(settingsWindow.options.parent, fixture.mainWindow);
  assert.strictEqual(settingsWindow.options.webPreferences.contextIsolation, true);
  assert.strictEqual(settingsWindow.options.webPreferences.nodeIntegration, false);
  assert.strictEqual(settingsWindow.options.webPreferences.sandbox, true);
  assert.strictEqual(settingsWindow.options.webPreferences.webSecurity, true);
  assert.strictEqual(settingsWindow.options.webPreferences.allowRunningInsecureContent, false);
  assert.strictEqual(settingsWindow.options.show, false);
  assert.strictEqual(settingsWindow.loadedFile, path.join(SRC, 'protocol-settings.html'));

  settingsWindow.minimized = true;
  fixture.ipcMain.emit(CHANNELS.open, { sender: fixture.mainWindow.webContents }, {
    title: 'ignored because the window already exists',
  });
  assert.strictEqual(MockBrowserWindow.instances.length, 1);
  assert.strictEqual(settingsWindow.restored, true);
  assert.strictEqual(settingsWindow.focused, 1);
});

test('ready, state, command, and event channels validate both sender and payload', () => {
  const fixture = createManagerFixture();
  fixture.ipcMain.emit(CHANNELS.open, { sender: fixture.mainWindow.webContents }, {});
  const settingsWindow = MockBrowserWindow.instances[0];

  fixture.ipcMain.emit(CHANNELS.ready, { sender: {} });
  assert.strictEqual(settingsWindow.shown, undefined);
  fixture.ipcMain.emit(CHANNELS.ready, { sender: settingsWindow.webContents });
  assert.strictEqual(settingsWindow.shown, true);
  assert.ok(fixture.mainWindow.webContents.sent.some((message) =>
    message.channel === 'protocol-settings:ready'));

  fixture.ipcMain.emit(CHANNELS.sync, { sender: fixture.mainWindow.webContents }, {
    meta: {
      title: 'gRPC Server settings',
      bodyClass: 'theme-dark',
      themeHref: 'https://invalid.example/theme.css',
    },
    patches: [
      { path: '', html: '<div id="field"></div>' },
      { path: '../bad', html: '<script>bad()</script>' },
    ],
    entries: [
      { p: '0', e: { a: { id: 'field', onclick: 'bad()', 'aria-label': 'Field' }, v: 'abc', d: true } },
      { p: 'not-a-path', e: { a: {} } },
    ],
  });
  const state = settingsWindow.webContents.sent.find((message) =>
    message.channel === 'protocol-settings:state').payload;
  assert.strictEqual(settingsWindow.title, 'gRPC Server settings');
  assert.strictEqual(state.meta.themeHref, '');
  assert.strictEqual(state.patches.length, 1);
  assert.strictEqual(state.entries.length, 1);
  assert.deepStrictEqual(state.entries[0].e.a, { id: 'field', 'aria-label': 'Field' });
  assert.strictEqual(state.entries[0].e.v, 'abc');
  assert.strictEqual(state.entries[0].e.d, true);

  const beforeCommands = settingsWindow.webContents.sent.length;
  fixture.ipcMain.emit(CHANNELS.command, { sender: fixture.mainWindow.webContents }, {
    type: 'focus', path: '../bad',
  });
  assert.strictEqual(settingsWindow.webContents.sent.length, beforeCommands);
  fixture.ipcMain.emit(CHANNELS.command, { sender: fixture.mainWindow.webContents }, {
    type: 'focus', path: '2.1',
  });
  assert.deepStrictEqual(settingsWindow.webContents.sent.at(-1), {
    channel: 'protocol-settings:command',
    payload: { type: 'focus', path: '2.1' },
  });

  const beforeEvents = fixture.mainWindow.webContents.sent.length;
  fixture.ipcMain.emit(CHANNELS.event, { sender: settingsWindow.webContents }, {
    type: 'keydown', id: 'protocol-settings-tablist', key: 'Delete',
  });
  fixture.ipcMain.emit(CHANNELS.event, { sender: settingsWindow.webContents }, {
    type: 'click', id: '<invalid>',
  });
  assert.strictEqual(fixture.mainWindow.webContents.sent.length, beforeEvents);
  fixture.ipcMain.emit(CHANNELS.event, { sender: settingsWindow.webContents }, {
    type: 'input', id: 'http-path', value: '/receiver',
  });
  assert.deepStrictEqual(fixture.mainWindow.webContents.sent.at(-1), {
    channel: 'protocol-settings:event',
    payload: { type: 'input', id: 'http-path', value: '/receiver' },
  });
});

test('bounds persist, title-bar close restores main focus, and main close ends the window', () => {
  const fixture = createManagerFixture();
  fixture.ipcMain.emit(CHANNELS.open, { sender: fixture.mainWindow.webContents }, {});
  let settingsWindow = MockBrowserWindow.instances[0];
  settingsWindow.bounds = { x: 25, y: 30, width: 700, height: 720 };
  settingsWindow.emit('resize');
  assert.strictEqual(fixture.saves.length, 0);
  fixture.ipcMain.emit(CHANNELS.windowClose, { sender: settingsWindow.webContents });
  assert.deepStrictEqual(fixture.mainWindow.webContents.sent.at(-1), {
    channel: 'protocol-settings:event',
    payload: { type: 'close' },
  });
  settingsWindow.close();
  assert.deepStrictEqual(
    fixture.saves.at(-1).dialogSizes.protocolSettings,
    settingsWindow.bounds,
  );

  assert.strictEqual(fixture.mainWindow.focusCount, 1);
  assert.ok(fixture.mainWindow.webContents.sent.some((message) =>
    message.channel === 'protocol-settings:closed'));

  fixture.ipcMain.emit(CHANNELS.open, { sender: fixture.mainWindow.webContents }, {});
  settingsWindow = MockBrowserWindow.instances[1];
  fixture.manager.close({ restoreFocus: false });
  assert.strictEqual(settingsWindow.destroyed, true);
  assert.strictEqual(fixture.mainWindow.focusCount, 1);
});

test('payload sanitizers reject unknown event types, ids, keys, and malformed state', () => {
  assert.strictEqual(sanitizeWindowEvent({ type: 'execute', id: 'field' }), null);
  assert.strictEqual(sanitizeWindowEvent({ type: 'click', id: '<field>' }), null);
  assert.strictEqual(sanitizeWindowEvent({
    type: 'keydown', id: 'protocol-settings-tablist', key: 'Enter',
  }), null);
  assert.strictEqual(sanitizeStatePayload(null), null);
  assert.deepStrictEqual(sanitizeWindowEvent({
    type: 'change', id: 'xmpp-allow-remote', checked: true, extra: 'discarded',
  }), { type: 'change', id: 'xmpp-allow-remote', checked: true });
});

test('the dedicated preload exposes only the narrow allowlisted API', () => {
  const preloadSource = fs.readFileSync(path.join(SRC, 'protocol-settings-preload.js'), 'utf8');
  const sends = [];
  const listeners = new Map();
  let exposed;
  const ipcRenderer = {
    send: (channel, payload) => sends.push({ channel, payload }),
    on: (channel, callback) => listeners.set(channel, callback),
    removeListener: (channel, callback) => {
      if (listeners.get(channel) === callback) listeners.delete(channel);
    },
  };
  const contextBridge = {
    exposeInMainWorld: (name, api) => {
      assert.strictEqual(name, 'protocolSettingsClient');
      exposed = api;
    },
  };
  Function('require', preloadSource)((name) => {
    assert.strictEqual(name, 'electron');
    return { contextBridge, ipcRenderer };
  });

  assert.deepStrictEqual(Object.keys(exposed).sort(), [
    'emit', 'onCommand', 'onState', 'ready', 'requestClose',
  ]);
  exposed.emit({ type: 'execute', id: 'field' });
  exposed.emit({ type: 'click', id: '<bad>' });
  assert.strictEqual(sends.length, 0);
  exposed.emit({ type: 'change', id: 'grpc-tls', checked: true, extra: 'discarded' });
  assert.deepStrictEqual(sends.at(-1), {
    channel: 'protocol-settings:window-event',
    payload: {
      type: 'change',
      id: 'grpc-tls',
      value: undefined,
      checked: true,
      key: undefined,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    },
  });
  let received;
  const unsubscribe = exposed.onState((payload) => { received = payload; });
  listeners.get('protocol-settings:state')({}, { entries: [] });
  assert.deepStrictEqual(received, { entries: [] });
  unsubscribe();
  assert.strictEqual(listeners.has('protocol-settings:state'), false);
});

test('the DOM mirror preserves properties, attributes, text, and structural changes', () => {
  const mirror = require('../src/protocol-settings-mirror.js');
  const sourceDom = new JSDOM('<dialog id="source" data-read-only="true"><select id="format"><option value="csv">CSV</option><option value="json">JSON</option></select><input id="tls" type="checkbox"><button id="done">Done</button></dialog>');
  const targetDom = new JSDOM('<div id="target"></div>');
  const sourceRoot = sourceDom.window.document.getElementById('source');
  const targetRoot = targetDom.window.document.getElementById('target');
  sourceRoot.querySelector('#format').value = 'json';
  sourceRoot.querySelector('#tls').checked = true;
  sourceRoot.querySelector('#done').disabled = true;
  sourceRoot.querySelector('#tls').hidden = true;
  sourceRoot.querySelector('#format').setAttribute('aria-label', 'Format');
  const source = mirror.createProtocolSettingsSource(sourceRoot);
  mirror.applyProtocolSettingsPayload(targetRoot, source.capture());

  assert.strictEqual(targetRoot.dataset.readOnly, 'true');
  assert.strictEqual(targetRoot.querySelector('#format').value, 'json');
  assert.strictEqual(targetRoot.querySelector('#format').getAttribute('aria-label'), 'Format');
  assert.strictEqual(targetRoot.querySelector('#tls').checked, true);
  assert.strictEqual(targetRoot.querySelector('#tls').hidden, true);
  assert.strictEqual(targetRoot.querySelector('#done').disabled, true);

  sourceRoot.querySelector('#format').value = 'csv';
  sourceRoot.querySelector('#format').removeAttribute('aria-label');
  sourceRoot.querySelector('#done').textContent = 'Keep edits';
  sourceRoot.appendChild(sourceDom.window.document.createElement('textarea')).id = 'headers';
  mirror.applyProtocolSettingsPayload(targetRoot, source.capture());
  assert.strictEqual(targetRoot.querySelector('#format').value, 'csv');
  assert.strictEqual(targetRoot.querySelector('#format').hasAttribute('aria-label'), false);
  assert.strictEqual(targetRoot.querySelector('#done').textContent, 'Keep edits');
  assert.ok(targetRoot.querySelector('#headers'));
});

test('the detached renderer applies state and reports edits, tabs, buttons, focus, and Escape', () => {
  const html = fs.readFileSync(path.join(SRC, 'protocol-settings.html'), 'utf8')
    .replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const emitted = [];
  let stateListener;
  let commandListener;
  let closeRequests = 0;
  let readyCalls = 0;
  window.protocolSettingsClient = {
    ready: () => { readyCalls += 1; },
    emit: (message) => emitted.push(message),
    requestClose: () => { closeRequests += 1; },
    onState: (callback) => { stateListener = callback; },
    onCommand: (callback) => { commandListener = callback; },
  };
  window.eval(fs.readFileSync(path.join(SRC, 'protocol-settings-mirror.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(SRC, 'protocol-settings-window.js'), 'utf8'));
  assert.strictEqual(readyCalls, 1);

  const sourceDom = new JSDOM('<dialog id="protocol-settings-dialog"><div id="protocol-settings-tablist" role="tablist"><button id="tab" role="tab">Basics</button></div><input id="field" value="old"><button id="done">Done</button></dialog>');
  const sourceRoot = sourceDom.window.document.getElementById('protocol-settings-dialog');
  const source = window.ProtocolSettingsMirror.createProtocolSettingsSource(sourceRoot);
  stateListener({
    meta: { title: 'Protocol Settings test', bodyClass: 'theme-dark', themeHref: '' },
    ...source.capture(),
  });
  assert.strictEqual(window.document.title, 'Protocol Settings test');
  assert.ok(window.document.body.classList.contains('theme-dark'));

  const field = window.document.getElementById('field');
  field.focus();
  field.value = 'new';
  field.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.strictEqual(emitted.at(-1).type, 'input');
  assert.strictEqual(emitted.at(-1).id, 'field');
  assert.strictEqual(emitted.at(-1).value, 'new');
  assert.strictEqual(emitted.at(-1).revision, 1);
  stateListener({
    ackRevision: 0,
    entries: [{ p: '1', e: { a: { id: 'field', value: 'old' }, h: false, v: 'old', d: false } }],
  });
  assert.strictEqual(window.document.getElementById('field').value, 'new');
  assert.strictEqual(window.document.activeElement, field);
  stateListener({
    ackRevision: 1,
    entries: [{ p: '1', e: { a: { id: 'field', value: 'old' }, h: false, v: 'new', d: false } }],
  });
  assert.strictEqual(window.document.getElementById('field').value, 'new');
  window.document.getElementById('done').click();
  assert.strictEqual(emitted.at(-1).type, 'click');
  assert.strictEqual(emitted.at(-1).id, 'done');
  window.document.getElementById('tab').dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'ArrowRight', bubbles: true,
  }));
  assert.strictEqual(emitted.at(-1).type, 'keydown');
  assert.strictEqual(emitted.at(-1).id, 'protocol-settings-tablist');
  assert.strictEqual(emitted.at(-1).key, 'ArrowRight');

  const root = window.document.getElementById('protocol-settings-dialog');
  commandListener({
    type: 'focus',
    path: window.ProtocolSettingsMirror.describePath(root, field),
  });
  assert.strictEqual(window.document.activeElement, field);
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.strictEqual(closeRequests, 1);
  window.close();
});

test('main and renderer production wiring keeps the fallback and closes with the main window', () => {
  const mainSource = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
  const rendererSource = fs.readFileSync(path.join(SRC, 'renderer.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(SRC, 'preload.js'), 'utf8');
  assert.match(mainSource, /createProtocolSettingsWindowManager/);
  assert.match(mainSource, /protocolSettingsWindowManager\.close\(\{ restoreFocus: false \}\)/);
  assert.match(rendererSource, /window\.protocolSettingsHost \|\| null/);
  assert.match(rendererSource, /createProtocolSettingsSource\(protocolSettingsDialog\)/);
  assert.match(rendererSource, /handleProtocolSettingsWindowEvent/);
  assert.match(preloadSource, /exposeInMainWorld\('protocolSettingsHost'/);
});

console.log(`\n${passed} passed`);
if (process.exitCode) console.error('protocol settings window tests failed');
