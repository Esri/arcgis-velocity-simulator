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

'use strict';

const { EventEmitter } = require('events');
const path = require('path');
const os = require('os');
const { StringDecoder } = require('string_decoder');
const metadata = require('../package.json');
const { isAllowedChannel, windowFiles } = require('./tauri-policy');
const { encodeFrames, MAX_FRAME } = require('./tauri-wire');

const cli = process.env.VELOCITY_TAURI_CLI === '1';
const writeProtocol = process.stdout.write.bind(process.stdout);
if (!cli) process.stdout.write = process.stderr.write.bind(process.stderr);
const windows = new Map();
const pending = new Map();
const handlers = new Map();
const menuCallbacks = new Map();
let sequence = 0;
let ready = false;
let quitting = false;
let displays = [];
const pathOverrides = new Map();
let readyResolve;
const readyPromise = new Promise(resolve => { readyResolve = resolve; });

function send(message) {
  if (cli) throw new Error(`Native desktop operation ${message.op || message.type} requested in headless mode`);
  // Synchronous frame writes keep chunks of one backend response contiguous.
  for (const frame of encodeFrames(message)) writeProtocol(frame);
}

function request(op, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = op === 'dialog' ? null : setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Native desktop operation timed out: ${op}`));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    try { send({ type: 'native', id, op, ...payload }); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}

function report(error) {
  console.error(`[Tauri] ${error.stack || error.message || error}`);
  for (const window of windows.values()) {
    if (window.loaded && !window.destroyed) window.webContents.send('desktop-runtime-error', String(error.message || error));
  }
}

function fire(op, payload) { request(op, payload).catch(report); }

const app = new EventEmitter();
Object.assign(app, {
  runtime: 'tauri',
  isPackaged: true,
  name: metadata.name,
  isReady: () => ready,
  whenReady: () => readyPromise,
  getVersion: () => metadata.version,
  setName(name) { this.name = name; },
  getPath(name) {
    if (pathOverrides.has(name)) return pathOverrides.get(name);
    const home = os.homedir();
    const appData = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
      : process.platform === 'win32' ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
        : process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    const paths = { home, appData, userData: path.join(appData, `${metadata.name}-tauri`), temp: os.tmpdir(),
      documents: path.join(home, 'Documents'), downloads: path.join(home, 'Downloads'),
      exe: process.env.VELOCITY_TAURI_EXE || process.execPath };
    if (!paths[name]) throw new Error(`Unsupported desktop path: ${name}`);
    return paths[name];
  },
  setPath(name, value) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Desktop paths must be absolute');
    this.getPath(name);
    pathOverrides.set(name, value);
  },
  setAboutPanelOptions(options) { if (!cli) fire('about', { options }); },
  quit() {
    if (quitting) return;
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    app.emit('before-quit', event);
    if (event.defaultPrevented) return;
    quitting = true;
    app.emit('will-quit', event);
    if (event.defaultPrevented) { quitting = false; return; }
    app.exit(process.exitCode || 0);
  },
  exit(code = 0) {
    if (!cli) send({ type: 'exit', code });
    process.exit(code);
  },
});
if (process.platform === 'darwin' && !cli) {
  app.dock = { hide: () => fire('dock', { visible: false }), show: () => fire('dock', { visible: true }),
    setIcon: icon => fire('dock-icon', { icon }) };
}

const nativeTheme = new EventEmitter();
nativeTheme.shouldUseDarkColors = false;
const ipcMain = new EventEmitter();
ipcMain.handle = (channel, handler) => {
  if (handlers.has(channel)) throw new Error(`Duplicate IPC handler: ${channel}`);
  handlers.set(channel, handler);
};
ipcMain.removeHandler = channel => handlers.delete(channel);

class WebContents extends EventEmitter {
  constructor(window) { super(); this.window = window; this.id = window.id; this.devTools = false; }
  isDestroyed() { return this.window.destroyed; }
  on(event, listener) {
    const result = super.on(event, listener);
    if (event === 'before-input-event') this.send('desktop-input-hook', true);
    return result;
  }
  send(channel, ...args) {
    if (!this.window.frontendReady) this.window.eventQueue.push({ channel, args });
    else this.window.command('emit', { channel, args });
  }
  executeJavaScript(script) { return this.window.command('eval', { script }); }
  setWindowOpenHandler(handler) { this.window.openHandler = handler; }
  openDevTools() {
    this.devTools = true;
    this.window.command('devtools', { open: true }).then(() => {
      if (!this.devTools || this.window.destroyed) return;
      this.emit('devtools-opened');
      clearInterval(this.devToolsTimer);
      this.devToolsTimer = setInterval(() => {
        if (this.window.destroyed) { clearInterval(this.devToolsTimer); return; }
        this.window.command('devtools-state').then(open => {
          if (!open && this.devTools) {
            this.devTools = false;
            clearInterval(this.devToolsTimer);
            this.emit('devtools-closed');
          }
        }).catch(() => clearInterval(this.devToolsTimer));
      }, 500);
      this.devToolsTimer.unref();
    }).catch(() => { this.devTools = false; });
  }
  closeDevTools() {
    this.devTools = false;
    clearInterval(this.devToolsTimer);
    this.window.command('devtools', { open: false });
    this.emit('devtools-closed');
  }
  toggleDevTools() { if (this.devTools) this.closeDevTools(); else this.openDevTools(); }
  isDevToolsOpened() { return this.devTools; }
  inspectElement(x, y) { return this.window.command('inspect', { x, y }); }
}

class BrowserWindow extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = ++sequence;
    this.label = `desktop-${this.id}`;
    this.options = options;
    this.bounds = { x: options.x ?? 100, y: options.y ?? 100, width: options.width || 800, height: options.height || 600 };
    this.destroyed = false;
    this.loaded = false;
    this.menuVisible = true;
    this.minimized = false;
    this.fullscreen = false;
    this.queue = [];
    this.eventQueue = [];
    this.frontendReady = false;
    this.visible = options.show !== false;
    this.webContents = new WebContents(this);
    windows.set(this.label, this);
  }
  static getAllWindows() { return [...windows.values()].filter(window => !window.destroyed); }
  static fromWebContents(contents) { return contents?.window || null; }
  static getFocusedWindow() { return [...windows.values()].find(window => window.focused) || null; }
  isDestroyed() { return this.destroyed; }
  isMinimized() { return this.minimized; }
  isFullScreen() { return this.fullscreen; }
  isVisible() { return this.visible === true; }
  isMenuBarVisible() { return this.menuVisible; }
  getBounds() { return { ...this.bounds }; }
  getSize() { return [this.bounds.width, this.bounds.height]; }
  getPosition() { return [this.bounds.x, this.bounds.y]; }
  command(op, payload = {}) {
    const promise = this.loaded ? request(op, { label: this.label, ...payload })
      : new Promise((resolve, reject) => this.queue.push({ op, payload, resolve, reject }));
    // Electron's fire-and-forget window methods are widely used without awaiting.
    promise.catch(report);
    return promise;
  }
  async loadFile(file, options = {}) {
    const name = path.basename(file);
    if (!windowFiles.includes(name) || path.dirname(path.resolve(file)) !== __dirname) {
      throw new Error(`Desktop window cannot load ${file}`);
    }
    if (this.loaded) return this.command('navigate', { file: name, query: options.query || {} });
    this.file = name;
    console.debug(`[Tauri] Creating ${name} (${this.label})`);
    const { parent, webPreferences, ...nativeOptions } = this.options;
    try {
      const state = await request('create', { label: this.label, file: name, query: options.query || {},
        options: nativeOptions, parent: parent?.label });
      if (state?.bounds) this.bounds = state.bounds;
      this.loaded = true;
      for (const entry of this.queue.splice(0)) {
        request(entry.op, { label: this.label, ...entry.payload }).then(entry.resolve, entry.reject);
      }
    } catch (error) {
      for (const entry of this.queue.splice(0)) entry.reject(error);
      report(error);
      throw error;
    }
  }
  show() { this.visible = true; return this.command('show'); }
  hide() { this.visible = false; return this.command('hide'); }
  focus() { return this.command('focus'); }
  restore() { this.minimized = false; return this.command('restore'); }
  center() { return this.command('center'); }
  setTitle(title) { return this.command('title', { title }); }
  setSize(width, height) { Object.assign(this.bounds, { width, height }); return this.command('size', { width, height }); }
  setPosition(x, y) { Object.assign(this.bounds, { x, y }); return this.command('position', { x, y }); }
  setBounds(bounds) { this.setSize(bounds.width, bounds.height); this.setPosition(bounds.x, bounds.y); }
  setOpacity(opacity) { return this.command('opacity', { opacity }); }
  setMenuBarVisibility(visible) { this.menuVisible = visible; return this.command('menu-visible', { visible }); }
  setMenu(menu) { return this.command('window-menu', { menu: menu?.items || null }); }
  reload() { return this.command('reload'); }
  close() {
    if (this.destroyed) return;
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    this.emit('close', event);
    if (!event.defaultPrevented) this.command('destroy');
  }
  destroy() { if (!this.destroyed) return this.command('destroy'); }
}

function serializeMenu(template) {
  return template.map(item => {
    const id = `menu-${++sequence}`;
    const native = { ...item, id };
    delete native.click;
    if (item.click) menuCallbacks.set(id, { item, click: item.click });
    if (item.submenu) native.submenu = serializeMenu(Array.isArray(item.submenu) ? item.submenu : item.submenu.items);
    return native;
  });
}

const Menu = {
  buildFromTemplate(template) {
    const items = serializeMenu(template);
    return { items, popup({ window } = {}) { fire('popup-menu', { label: window?.label, menu: items }); } };
  },
  setApplicationMenu(menu) { fire('menu', { menu: menu?.items || [] }); },
};

const dialog = {
  showSaveDialog: (...args) => request('dialog', { kind: 'save', options: args.at(-1), label: args.length > 1 ? args[0].label : undefined }),
  showOpenDialog: (...args) => request('dialog', { kind: 'open', options: args.at(-1), label: args.length > 1 ? args[0].label : undefined }),
  showErrorBox: (title, message) => fire('dialog', { kind: 'error', options: { title, message } }),
  showMessageBox: (...args) => request('dialog', { kind: 'message', options: args.at(-1) }),
};
const clipboard = { writeText: text => fire('clipboard', { text: String(text) }) };
const shell = {
  openExternal(url) {
    const parsed = new URL(url);
    if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) return Promise.reject(new Error('External URL scheme is not permitted'));
    return request('open-external', { url: parsed.href });
  },
};
const screen = {
  getPrimaryDisplay() {
    if (!displays.length) throw new Error('Native display information is not available');
    return displays[0];
  },
  getDisplayMatching(bounds) {
    return displays.find(display => {
      const area = display.workArea;
      return bounds.x >= area.x && bounds.x < area.x + area.width && bounds.y >= area.y && bounds.y < area.y + area.height;
    }) || this.getPrimaryDisplay();
  },
};

async function receive(message) {
  if (message.type === 'result') {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(message.error));
    else waiter.resolve(message.value);
    return;
  }
  if (message.type === 'init') {
    displays = message.displays;
    nativeTheme.shouldUseDarkColors = message.dark === true;
    ready = true;
    readyResolve();
    app.emit('ready');
    return;
  }
  if (message.type === 'quit') { app.quit(); return; }
  if (message.type === 'menu') {
    const entry = menuCallbacks.get(message.id);
    if (entry) {
      if (['checkbox', 'radio'].includes(entry.item.type)) entry.item.checked = message.checked;
      await entry.click(entry.item, BrowserWindow.getFocusedWindow());
    }
    return;
  }
  const window = windows.get(message.label);
  if (!window || window.destroyed) throw new Error('Desktop event has an unknown window');
  if (message.type === 'window') {
    if (typeof message.minimized === 'boolean') window.minimized = message.minimized;
    if (typeof message.fullscreen === 'boolean') window.fullscreen = message.fullscreen;
    if (message.event === 'close') window.close();
    else if (message.event === 'closed') {
      window.destroyed = true;
      clearInterval(window.webContents.devToolsTimer);
      window.emit('closed');
      windows.delete(window.label);
      if (!windows.size) app.emit('window-all-closed');
    } else if (message.event === 'bounds') {
      const moved = window.bounds.x !== message.bounds.x || window.bounds.y !== message.bounds.y;
      const resized = window.bounds.width !== message.bounds.width || window.bounds.height !== message.bounds.height;
      window.bounds = message.bounds;
      if (moved) window.emit('move');
      if (resized) window.emit('resize');
    } else if (message.event === 'focus') window.focused = message.focused;
    else if (message.event === 'theme') {
      nativeTheme.shouldUseDarkColors = message.dark;
      nativeTheme.emit('updated');
    } else if (message.event === 'external') {
      const result = window.openHandler?.({ url: message.url });
      if (!result) console.warn('[Tauri] Blocked external window navigation');
    }
    return;
  }
  if (message.type !== 'frontend') throw new Error('Unknown desktop message');
  const payload = message.message;
  let value;
  try {
    if (payload.type === 'ready') {
      console.debug(`[Tauri] Ready ${window.file} (${window.label})`);
      window.frontendReady = true;
      for (const payload of window.eventQueue.splice(0)) window.command('emit', payload);
      window.webContents.emit('dom-ready');
      window.webContents.emit('did-finish-load');
      window.emit('ready-to-show');
    } else if (payload.type === 'context-menu') {
      window.webContents.emit('context-menu', {});
    } else if (payload.type === 'console') {
      window.webContents.emit('console-message', { level: 3, message: payload.message, sourceId: payload.sourceId, line: payload.line });
    } else if (payload.type === 'before-input') {
      const input = payload.input;
      if (!input || input.type !== 'keyDown' || typeof input.key !== 'string' || input.key.length > 64) {
        throw new Error('Invalid keyboard input event');
      }
      const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      window.webContents.emit('before-input-event', event, {
        type: 'keyDown', key: input.key, code: String(input.code || '').slice(0, 64),
        control: input.control === true, meta: input.meta === true,
        shift: input.shift === true, alt: input.alt === true, isAutoRepeat: input.isAutoRepeat === true,
      });
      value = { preventDefault: event.defaultPrevented };
    } else {
      if (!['send', 'invoke'].includes(payload.type) || !isAllowedChannel(window.file, payload.channel) || !Array.isArray(payload.args)) {
        throw new Error('IPC channel is not permitted for this window');
      }
      const event = { sender: window.webContents, reply: (channel, ...args) => window.webContents.send(channel, ...args) };
      if (payload.type === 'invoke') {
        const handler = handlers.get(payload.channel);
        if (!handler) throw new Error(`No IPC handler: ${payload.channel}`);
        value = await handler(event, ...payload.args);
      } else {
        if (!ipcMain.listenerCount(payload.channel)) throw new Error(`No IPC listener: ${payload.channel}`);
        for (const listener of ipcMain.rawListeners(payload.channel)) await listener.call(ipcMain, event, ...payload.args);
      }
    }
    send({ type: 'response', id: message.id, value: value ?? null });
  } catch (error) {
    console.error(`[Tauri] IPC rejected: ${error.message}`);
    send({ type: 'response', id: message.id, error: error.message });
  }
}

function start() {
  if (cli) {
    ready = true;
    readyResolve();
    app.emit('ready');
    return;
  }
  let buffer = '';
  const decoder = new StringDecoder('utf8');
  process.stdin.on('data', chunk => {
    buffer += decoder.write(chunk);
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (Buffer.byteLength(line) + 1 > MAX_FRAME) { console.error('[Tauri] Desktop IPC frame exceeds limit'); process.exit(1); }
      try { receive(JSON.parse(line)).catch(report); }
      catch (error) { report(error); process.exit(1); }
    }
    if (Buffer.byteLength(buffer) > MAX_FRAME) { console.error('[Tauri] Desktop IPC frame exceeds limit'); process.exit(1); }
  });
  process.stdin.on('end', () => app.quit());
  process.stdin.on('error', error => { report(error); app.exit(1); });
}

module.exports = { app, BrowserWindow, ipcMain, nativeTheme, dialog, clipboard, shell, Menu, screen, start };
