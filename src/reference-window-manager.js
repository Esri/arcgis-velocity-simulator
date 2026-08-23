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

const BOUNDS_SAVE_DELAY_MS = 250;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function isAllowedExternalUrl(url, allowedExternalUrlPrefix) {
  if (typeof url !== 'string' || typeof allowedExternalUrlPrefix !== 'string') return false;
  try {
    const candidate = new URL(url);
    return candidate.protocol === 'https:' && candidate.href.startsWith(allowedExternalUrlPrefix);
  } catch {
    return false;
  }
}

function resolveReferenceWindowBounds(screen, mainWindow, savedBounds = {}, defaults = {}) {
  const defaultWidth = finiteNumber(defaults.width) || 960;
  const defaultHeight = finiteNumber(defaults.height) || 720;
  const minimumWidth = finiteNumber(defaults.minWidth) || 640;
  const minimumHeight = finiteNumber(defaults.minHeight) || 420;
  const parentBounds = mainWindow && !mainWindow.isDestroyed() && typeof mainWindow.getBounds === 'function'
    ? mainWindow.getBounds()
    : null;
  const requestedWidth = finiteNumber(savedBounds.width) || defaultWidth;
  const requestedHeight = finiteNumber(savedBounds.height) || defaultHeight;
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
  const width = clamp(requestedWidth, Math.min(minimumWidth, workArea.width), workArea.width);
  const height = clamp(requestedHeight, Math.min(minimumHeight, workArea.height), workArea.height);
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
    minWidth: Math.min(minimumWidth, workArea.width),
    minHeight: Math.min(minimumHeight, workArea.height),
    maxWidth: workArea.width,
    maxHeight: workArea.height,
  };
}

function createReferenceWindowManager(options) {
  const {
    BrowserWindow,
    ipcMain,
    screen,
    path,
    basePath,
    getMainWindow,
    getAppConfig,
    saveAppConfig,
    shell,
  } = options;
  const windows = new Map();

  function getLiveWindow(key) {
    const window = windows.get(key);
    return window && !window.isDestroyed() ? window : null;
  }

  function focus(key) {
    const window = getLiveWindow(key);
    if (!window) return false;
    if (window.isMinimized()) window.restore();
    window.focus();
    return true;
  }

  function open(windowOptions) {
    const {
      key,
      title,
      file,
      readyChannel,
      query,
      defaults,
      allowedExternalUrlPrefix,
    } = windowOptions;
    if (focus(key)) return getLiveWindow(key);

    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const appConfig = getAppConfig() || {};
    const savedBounds = (appConfig.dialogSizes && appConfig.dialogSizes[key]) || {};
    const bounds = resolveReferenceWindowBounds(screen, mainWindow, savedBounds, defaults);
    const window = new BrowserWindow({
      ...bounds,
      title,
      parent: mainWindow,
      modal: false,
      show: false,
      frame: true,
      resizable: true,
      minimizable: true,
      maximizable: true,
      fullscreenable: true,
      autoHideMenuBar: true,
      icon: path.join(basePath, 'assets', 'icon.png'),
      webPreferences: {
        preload: path.join(basePath, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        enableRemoteModule: false,
      },
    });
    windows.set(key, window);
    window.setMenuBarVisibility(false);
    window.setMenu(null);
    if (typeof window.webContents.setWindowOpenHandler === 'function') {
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (isAllowedExternalUrl(url, allowedExternalUrlPrefix)
          && shell && typeof shell.openExternal === 'function') {
          shell.openExternal(url);
        }
        return { action: 'deny' };
      });
    }

    let boundsTimer = null;
    const persistBounds = () => {
      if (boundsTimer) {
        clearTimeout(boundsTimer);
        boundsTimer = null;
      }
      if (window.isDestroyed()) return;
      const config = getAppConfig();
      if (!config || typeof config !== 'object') return;
      if (!config.dialogSizes) config.dialogSizes = {};
      const currentBounds = window.getBounds();
      config.dialogSizes[key] = {
        width: currentBounds.width,
        height: currentBounds.height,
        x: currentBounds.x,
        y: currentBounds.y,
      };
      saveAppConfig(config);
    };
    const scheduleBoundsPersistence = () => {
      if (boundsTimer) clearTimeout(boundsTimer);
      boundsTimer = setTimeout(persistBounds, BOUNDS_SAVE_DELAY_MS);
    };
    const showWhenReady = (event) => {
      if (event && event.sender !== window.webContents) return;
      if (!window.isDestroyed()) window.show();
    };

    window.on('resize', scheduleBoundsPersistence);
    window.on('move', scheduleBoundsPersistence);
    window.on('close', persistBounds);
    if (readyChannel) ipcMain.on(readyChannel, showWhenReady);
    window.on('closed', () => {
      if (boundsTimer) clearTimeout(boundsTimer);
      if (readyChannel) ipcMain.removeListener(readyChannel, showWhenReady);
      windows.delete(key);
    });
    window.loadFile(path.join(basePath, file), { query });
    return window;
  }

  function closeAll() {
    [...windows.values()].forEach((window) => {
      if (window && !window.isDestroyed()) window.close();
    });
  }

  return { closeAll, focus, getWindow: getLiveWindow, open };
}

module.exports = {
  createReferenceWindowManager,
  isAllowedExternalUrl,
  resolveReferenceWindowBounds,
};
