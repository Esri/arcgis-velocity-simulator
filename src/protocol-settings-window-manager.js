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
 * @file protocol-settings-window-manager.js
 * @description Secure main-process owner for the detached Protocol Settings
 * window. This file is byte-identical in the Simulator and Logger.
 */

'use strict';

const CHANNELS = Object.freeze({
  open: 'protocol-settings:open',
  close: 'protocol-settings:close',
  sync: 'protocol-settings:sync',
  command: 'protocol-settings:command',
  ready: 'protocol-settings:window-ready',
  event: 'protocol-settings:window-event',
  windowClose: 'protocol-settings:window-close',
});

const WINDOW_EVENT_TYPES = new Set(['input', 'change', 'click', 'keydown']);
const WINDOW_KEYS = new Set(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']);
const PATH_PATTERN = /^(?:\d+(?:\.\d+)*)?$/;
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const ATTRIBUTE_PATTERN = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/;
const MIN_WIDTH = 420;
const MIN_HEIGHT = 260;
const DEFAULT_WIDTH = 700;
const DEFAULT_HEIGHT = 720;
const MAX_TITLE_LENGTH = 240;
const MAX_VALUE_LENGTH = 1024 * 1024;
const MAX_PATCHES = 128;
const MAX_ENTRIES = 4096;
const BOUNDS_SAVE_DELAY_MS = 250;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function cleanString(value, maximum = MAX_VALUE_LENGTH) {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}

function cleanPath(value) {
  const path = cleanString(value, 512);
  return PATH_PATTERN.test(path) ? path : null;
}

function sanitizeAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return {};
  const safe = {};
  Object.keys(attributes).slice(0, 128).forEach((name) => {
    if (!ATTRIBUTE_PATTERN.test(name) || /^on/i.test(name)
      || typeof attributes[name] !== 'string') return;
    safe[name] = attributes[name].slice(0, 32768);
  });
  return safe;
}

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const safe = {
    a: sanitizeAttributes(entry.a),
    h: entry.h === true,
  };
  if (typeof entry.v === 'string') safe.v = entry.v.slice(0, MAX_VALUE_LENGTH);
  if (typeof entry.c === 'boolean') safe.c = entry.c;
  if (typeof entry.s === 'boolean') safe.s = entry.s;
  if (typeof entry.d === 'boolean') safe.d = entry.d;
  if (typeof entry.t === 'string') safe.t = entry.t.slice(0, MAX_VALUE_LENGTH);
  return safe;
}

function sanitizeThemeHref(value) {
  const href = cleanString(value, 4096);
  if (!href) return '';
  if (href.includes('..') || href.includes('\\') || href.includes(':') || href.startsWith('//')) return '';
  return /^(?:\.\/)?[A-Za-z0-9_./-]+\.css(?:\?[A-Za-z0-9_.=&-]*)?$/.test(href) ? href : '';
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  return {
    title: cleanString(meta.title, MAX_TITLE_LENGTH),
    bodyClass: cleanString(meta.bodyClass, 2048),
    themeHref: sanitizeThemeHref(meta.themeHref),
  };
}

function sanitizeStatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const patches = [];
  (Array.isArray(payload.patches) ? payload.patches : []).slice(0, MAX_PATCHES).forEach((patch) => {
    if (!patch || typeof patch !== 'object') return;
    const path = cleanPath(patch.path);
    if (path === null || typeof patch.html !== 'string') return;
    patches.push({ path, html: patch.html.slice(0, MAX_VALUE_LENGTH) });
  });
  const entries = [];
  (Array.isArray(payload.entries) ? payload.entries : []).slice(0, MAX_ENTRIES).forEach((change) => {
    if (!change || typeof change !== 'object') return;
    const path = cleanPath(change.p);
    const entry = sanitizeEntry(change.e);
    if (path === null || !entry) return;
    entries.push({ p: path, e: entry });
  });
  const ackRevision = Number.isSafeInteger(payload.ackRevision) && payload.ackRevision >= 0
    ? payload.ackRevision
    : 0;
  return { meta: sanitizeMeta(payload.meta), patches, entries, ackRevision };
}

function sanitizeWindowEvent(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  if (!WINDOW_EVENT_TYPES.has(message.type)) return null;
  if (typeof message.id !== 'string' || !ID_PATTERN.test(message.id)) return null;
  const safe = { type: message.type, id: message.id };
  if ((message.type === 'input' || message.type === 'change') && typeof message.value === 'string') {
    safe.value = message.value.slice(0, MAX_VALUE_LENGTH);
  }
  if ((message.type === 'input' || message.type === 'change') && typeof message.checked === 'boolean') {
    safe.checked = message.checked;
  }
  if ((message.type === 'input' || message.type === 'change')
    && Number.isSafeInteger(message.revision) && message.revision > 0) {
    safe.revision = message.revision;
  }
  if (message.type === 'keydown') {
    if (!WINDOW_KEYS.has(message.key)) return null;
    safe.key = message.key;
    safe.shiftKey = message.shiftKey === true;
    safe.altKey = message.altKey === true;
    safe.ctrlKey = message.ctrlKey === true;
    safe.metaKey = message.metaKey === true;
  }
  return safe;
}

function resolveWindowBounds(screen, mainWindow, savedBounds = {}) {
  const parentBounds = mainWindow && !mainWindow.isDestroyed() && typeof mainWindow.getBounds === 'function'
    ? mainWindow.getBounds()
    : null;
  const requestedWidth = finiteNumber(savedBounds.width) || DEFAULT_WIDTH;
  const requestedHeight = finiteNumber(savedBounds.height) || DEFAULT_HEIGHT;
  const reference = {
    x: finiteNumber(savedBounds.x) ?? (parentBounds ? parentBounds.x : 0),
    y: finiteNumber(savedBounds.y) ?? (parentBounds ? parentBounds.y : 0),
    width: requestedWidth,
    height: requestedHeight,
  };
  const display = (screen && typeof screen.getDisplayMatching === 'function'
    ? screen.getDisplayMatching(reference)
    : null) || screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const width = clamp(requestedWidth, Math.min(MIN_WIDTH, workArea.width), workArea.width);
  const height = clamp(requestedHeight, Math.min(MIN_HEIGHT, workArea.height), workArea.height);
  const centeredX = parentBounds
    ? parentBounds.x + Math.round((parentBounds.width - width) / 2)
    : workArea.x + Math.round((workArea.width - width) / 2);
  const centeredY = parentBounds
    ? parentBounds.y + Math.round((parentBounds.height - height) / 2)
    : workArea.y + Math.round((workArea.height - height) / 2);
  return {
    x: clamp(finiteNumber(savedBounds.x) ?? centeredX, workArea.x, workArea.x + workArea.width - width),
    y: clamp(finiteNumber(savedBounds.y) ?? centeredY, workArea.y, workArea.y + workArea.height - height),
    width,
    height,
    minWidth: Math.min(MIN_WIDTH, workArea.width),
    minHeight: Math.min(MIN_HEIGHT, workArea.height),
    maxWidth: workArea.width,
    maxHeight: workArea.height,
  };
}

function createProtocolSettingsWindowManager(options) {
  const {
    BrowserWindow,
    ipcMain,
    screen,
    path,
    basePath,
    getMainWindow,
    getAppConfig,
    saveAppConfig,
  } = options;
  let settingsWindow = null;
  let restoreFocusOnClose = true;
  let boundsSaveTimer = null;
  const handlers = new Map();

  const mainWindowIsAlive = () => {
    const mainWindow = getMainWindow();
    return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  };

  const isMainSender = (event) => {
    const mainWindow = mainWindowIsAlive();
    return Boolean(mainWindow && event && event.sender === mainWindow.webContents);
  };

  const isSettingsSender = (event) => Boolean(settingsWindow && !settingsWindow.isDestroyed()
    && event && event.sender === settingsWindow.webContents);

  const sendToMain = (channel, payload) => {
    const mainWindow = mainWindowIsAlive();
    if (mainWindow) mainWindow.webContents.send(channel, payload);
  };

  const sendToSettings = (channel, payload) => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send(channel, payload);
    }
  };

  const persistBounds = () => {
    if (boundsSaveTimer) {
      clearTimeout(boundsSaveTimer);
      boundsSaveTimer = null;
    }
    if (!settingsWindow || settingsWindow.isDestroyed()) return;
    const appConfig = getAppConfig();
    if (!appConfig || typeof appConfig !== 'object') return;
    const bounds = settingsWindow.getBounds();
    if (!appConfig.dialogSizes) appConfig.dialogSizes = {};
    appConfig.dialogSizes.protocolSettings = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
    };
    saveAppConfig(appConfig);
  };

  const scheduleBoundsPersistence = () => {
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
    boundsSaveTimer = setTimeout(persistBounds, BOUNDS_SAVE_DELAY_MS);
  };

  const close = ({ restoreFocus = true } = {}) => {
    if (!settingsWindow || settingsWindow.isDestroyed()) {
      settingsWindow = null;
      return;
    }
    restoreFocusOnClose = restoreFocus;
    settingsWindow.close();
  };

  const open = (title) => {
    const mainWindow = mainWindowIsAlive();
    if (!mainWindow) return;
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      if (settingsWindow.isMinimized()) settingsWindow.restore();
      settingsWindow.focus();
      return;
    }

    const appConfig = getAppConfig() || {};
    const savedBounds = (appConfig.dialogSizes && appConfig.dialogSizes.protocolSettings) || {};
    const bounds = resolveWindowBounds(screen, mainWindow, savedBounds);
    settingsWindow = new BrowserWindow({
      ...bounds,
      title: cleanString(title, MAX_TITLE_LENGTH) || 'Protocol Settings',
      parent: mainWindow,
      modal: false,
      show: false,
      resizable: true,
      minimizable: true,
      maximizable: true,
      autoHideMenuBar: true,
      icon: path.join(basePath, 'assets/icon.png'),
      webPreferences: {
        preload: path.join(basePath, 'protocol-settings-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        enableRemoteModule: false,
      },
    });
    restoreFocusOnClose = true;
    settingsWindow.setMenuBarVisibility(false);
    settingsWindow.setMenu(null);
    settingsWindow.on('resize', scheduleBoundsPersistence);
    settingsWindow.on('move', scheduleBoundsPersistence);
    settingsWindow.on('close', persistBounds);
    settingsWindow.on('closed', () => {
      if (boundsSaveTimer) {
        clearTimeout(boundsSaveTimer);
        boundsSaveTimer = null;
      }
      settingsWindow = null;
      const activeMainWindow = mainWindowIsAlive();
      if (activeMainWindow && restoreFocusOnClose) activeMainWindow.focus();
      sendToMain('protocol-settings:closed');
      restoreFocusOnClose = true;
    });
    settingsWindow.loadFile(path.join(basePath, 'protocol-settings.html'));
  };

  const register = (channel, handler) => {
    handlers.set(channel, handler);
    ipcMain.on(channel, handler);
  };

  register(CHANNELS.open, (event, payload) => {
    if (!isMainSender(event)) return;
    open(payload && typeof payload.title === 'string' ? payload.title : '');
  });
  register(CHANNELS.close, (event) => {
    if (isMainSender(event)) close();
  });
  register(CHANNELS.sync, (event, payload) => {
    if (!isMainSender(event)) return;
    const safe = sanitizeStatePayload(payload);
    if (!safe) return;
    if (settingsWindow && !settingsWindow.isDestroyed() && safe.meta.title) {
      settingsWindow.setTitle(safe.meta.title);
    }
    sendToSettings('protocol-settings:state', safe);
  });
  register(CHANNELS.command, (event, payload) => {
    if (!isMainSender(event) || !payload || payload.type !== 'focus') return;
    const focusPath = cleanPath(payload.path);
    if (focusPath === null) return;
    sendToSettings('protocol-settings:command', { type: 'focus', path: focusPath });
  });
  register(CHANNELS.ready, (event) => {
    if (!isSettingsSender(event)) return;
    settingsWindow.show();
    sendToMain('protocol-settings:ready');
  });
  register(CHANNELS.event, (event, payload) => {
    if (!isSettingsSender(event)) return;
    const safe = sanitizeWindowEvent(payload);
    if (safe) sendToMain('protocol-settings:event', safe);
  });
  register(CHANNELS.windowClose, (event) => {
    if (isSettingsSender(event)) sendToMain('protocol-settings:event', { type: 'close' });
  });

  return {
    close,
    dispose() {
      close({ restoreFocus: false });
      handlers.forEach((handler, channel) => ipcMain.removeListener(channel, handler));
      handlers.clear();
    },
    getWindow: () => settingsWindow,
  };
}

module.exports = {
  CHANNELS,
  createProtocolSettingsWindowManager,
  resolveWindowBounds,
  sanitizeStatePayload,
  sanitizeWindowEvent,
};
