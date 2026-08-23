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
 * @file protocol-settings-preload.js
 * @description Preload for the detached Protocol Settings window.
 *
 * The window renders a mirror of the main renderer's authoritative Protocol
 * Settings DOM and reports the user's intent back. It therefore needs exactly
 * three things and nothing else: state in, intent out, and a close request.
 * Node integration stays off and context isolation stays on, so this narrow
 * surface is the only thing the window can reach.
 *
 * This file is byte-identical in the ArcGIS Velocity Simulator and the ArcGIS
 * Velocity Logger.
 */

const { contextBridge, ipcRenderer } = require('electron');

/** Intents the window may report. Anything else is dropped here and in main. */
const WINDOW_EVENT_TYPES = ['input', 'change', 'click', 'keydown'];
const WINDOW_KEYS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
const CONTROL_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('protocolSettingsClient', {
  /** Announces that the mirror is mounted and ready for its first state. */
  ready: () => ipcRenderer.send('protocol-settings:window-ready'),

  /** Reports one user intent, addressed by the mirrored control id. */
  emit: (message) => {
    if (!message || WINDOW_EVENT_TYPES.indexOf(message.type) === -1) return;
    if (typeof message.id !== 'string' || !CONTROL_ID_PATTERN.test(message.id)) return;
    if (message.type === 'keydown' && WINDOW_KEYS.indexOf(message.key) === -1) return;
    ipcRenderer.send('protocol-settings:window-event', {
      type: message.type,
      id: message.id,
      value: typeof message.value === 'string' ? message.value.slice(0, 1024 * 1024) : undefined,
      checked: typeof message.checked === 'boolean' ? message.checked : undefined,
      key: typeof message.key === 'string' ? message.key : undefined,
      shiftKey: message.shiftKey === true,
      altKey: message.altKey === true,
      ctrlKey: message.ctrlKey === true,
      metaKey: message.metaKey === true,
    });
  },

  /** Asks the main renderer to close Protocol Settings, keeping the edits. */
  requestClose: () => ipcRenderer.send('protocol-settings:window-close'),

  /** Receives one mirrored state payload. */
  onState: (callback) => subscribe('protocol-settings:state', callback),

  /** Receives one focus command from the authoritative renderer. */
  onCommand: (callback) => subscribe('protocol-settings:command', callback),
});
