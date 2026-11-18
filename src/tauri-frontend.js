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

/* This initialization script runs before the existing, unmodified preload. */
(() => {
  'use strict';
  const listeners = new Map();
  let inputHook = false;
  const invoke = message => window.__TAURI_INTERNALS__.invoke('desktop_ipc', { message });
  const report = error => {
    console.error('[Tauri] Desktop request failed:', error);
    window.dispatchEvent(new CustomEvent('desktop-runtime-error', { detail: String(error) }));
  };
  const ipcRenderer = {
    send(channel, ...args) { invoke({ type: 'send', channel, args }).catch(report); },
    invoke(channel, ...args) { return invoke({ type: 'invoke', channel, args }); },
    on(channel, callback) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(callback);
      return ipcRenderer;
    },
    once(channel, callback) {
      const wrapped = (...args) => { ipcRenderer.removeListener(channel, wrapped); callback(...args); };
      return ipcRenderer.on(channel, wrapped);
    },
    removeListener(channel, callback) { listeners.get(channel)?.delete(callback); return ipcRenderer; },
  };
  Object.defineProperty(window, '__velocityDesktop', {
    value: Object.freeze({
      ipcRenderer,
      contextBridge: { exposeInMainWorld(name, value) { Object.defineProperty(window, name, { value: Object.freeze(value) }); } },
      deliver(channel, args) {
        if (channel === 'desktop-input-hook') { inputHook = args[0] === true; return; }
        if (channel === 'desktop-runtime-error') {
          window.dispatchEvent(new CustomEvent('desktop-runtime-error', { detail: args[0] }));
          return;
        }
        for (const listener of [...(listeners.get(channel) || [])]) listener({}, ...args);
      },
    }),
  });
  window.addEventListener('DOMContentLoaded', () => {
    invoke({ type: 'ready' }).catch(report);
    window.addEventListener('contextmenu', event => {
      event.preventDefault();
      invoke({ type: 'context-menu' }).catch(report);
    });
  }, { once: true });
  window.addEventListener('keydown', event => {
    if (!inputHook) return;
    const main = location.pathname === '/' || location.pathname.endsWith('/index.html');
    const reserved = main && (['F1', 'F3'].includes(event.key)
      || (event.key.toLowerCase() === 'i' && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey))
      || location.pathname.endsWith('/about.html') && event.key === 'Escape';
    if (reserved) event.preventDefault();
    invoke({ type: 'before-input', input: {
      type: 'keyDown', key: event.key, code: event.code, control: event.ctrlKey, meta: event.metaKey,
      shift: event.shiftKey, alt: event.altKey, isAutoRepeat: event.repeat,
    } }).then(result => {
      if (result?.preventDefault && !reserved) report(new Error(`Unregistered native keyboard cancellation: ${event.key}`));
    }).catch(report);
  }, true);
  window.addEventListener('error', event => {
    invoke({ type: 'console', message: event.message, sourceId: event.filename, line: event.lineno }).catch(report);
  });
  window.addEventListener('desktop-runtime-error', event => {
    let alert = document.getElementById('desktop-runtime-error');
    if (!alert) {
      alert = document.createElement('div');
      alert.id = 'desktop-runtime-error';
      alert.setAttribute('role', 'alert');
      alert.style.cssText = 'flex-shrink:0;padding:12px;margin:12px;background:Canvas;color:CanvasText;border:2px solid #c44;white-space:pre-wrap';
      const close = document.createElement('button');
      close.textContent = 'Dismiss';
      close.setAttribute('aria-label', 'Dismiss desktop runtime error');
      close.title = 'Dismiss this desktop runtime error';
      close.onclick = () => alert.remove();
      const text = document.createElement('p');
      alert.append(text, close);
      document.body.prepend(alert);
    }
    alert.firstElementChild.textContent = event.detail;
  });
})();
