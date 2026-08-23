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
 * @file protocol-settings-window.js
 * @description Controller for the detached Protocol Settings window.
 *
 * The window is a mirror and nothing more. It never decides which sections
 * exist, which controls apply, what a default is, whether a value is valid, or
 * what a connection does with it: the main renderer owns all of that and this
 * window replays its DOM. Every edit, button press, and section change is
 * reported straight back and dispatched into the authoritative document, so
 * there is only ever one copy of the settings and one copy of the rules.
 *
 * This file is byte-identical in the ArcGIS Velocity Simulator and the ArcGIS
 * Velocity Logger.
 */

(function initProtocolSettingsWindow() {
  'use strict';

  const client = window.protocolSettingsClient;
  const mirror = window.ProtocolSettingsMirror;
  const root = document.getElementById('protocol-settings-root');
  if (!client || !mirror || !root) return;

  /** Keys the section rail handles in the authoritative document. */
  const TABLIST_KEYS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];

  let applying = false;
  let editRevision = 0;
  const pendingEdits = new Map();

  /**
   * Applies the window chrome the payload describes. Theme, compact mode, and
   * fonts all come from the main window, so the two surfaces can never show
   * different themes.
   *
   * @param {object} meta
   */
  function applyMeta(meta) {
    if (!meta) return;
    if (typeof meta.title === 'string' && document.title !== meta.title) document.title = meta.title;
    if (typeof meta.bodyClass === 'string') {
      const next = `${meta.bodyClass} protocol-settings-window`.trim();
      if (document.body.className !== next) document.body.className = next;
    }
    if (typeof meta.themeHref === 'string') {
      let link = document.getElementById('current-theme-stylesheet');
      if (!meta.themeHref) {
        if (link) link.remove();
        return;
      }
      if (!link) {
        link = document.createElement('link');
        link.rel = 'stylesheet';
        link.id = 'current-theme-stylesheet';
        document.head.appendChild(link);
      }
      if (link.getAttribute('href') !== meta.themeHref) link.setAttribute('href', meta.themeHref);
    }
  }

  /**
   * Replays one mirrored state payload. Focus and the caret survive a
   * structural replacement, so a summary row that appears while typing never
   * costs the user their place.
   *
   * @param {object} payload
   */
  function applyState(payload) {
    if (!payload) return;
    const acknowledged = Number.isSafeInteger(payload.ackRevision) ? payload.ackRevision : 0;
    pendingEdits.forEach((revision, id) => {
      if (revision <= acknowledged) pendingEdits.delete(id);
    });
    const pendingValues = new Map();
    pendingEdits.forEach((revision, id) => {
      const element = document.getElementById(id);
      if (!element) return;
      pendingValues.set(id, {
        value: element.value,
        checked: element.checked,
      });
    });
    applying = true;
    try {
      applyMeta(payload.meta);
      const active = document.activeElement;
      const focusedPath = active && root.contains(active) ? mirror.describePath(root, active) : null;
      const selectionStart = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
      const selectionEnd = active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;
      mirror.applyProtocolSettingsPayload(root, payload);
      pendingValues.forEach((state, id) => {
        const element = document.getElementById(id);
        if (!element) return;
        if (typeof state.value === 'string') element.value = state.value;
        if (typeof state.checked === 'boolean') element.checked = state.checked;
      });
      // The source is a <dialog>, while this document uses a <div> because the
      // native BrowserWindow is already the containing surface.
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'false');
      if (focusedPath !== null && active) {
        const restored = active.isConnected ? active : mirror.resolvePath(root, focusedPath);
        if (restored && typeof restored.focus === 'function') {
          if (document.activeElement !== restored) restored.focus();
          if (selectionStart !== null && typeof restored.setSelectionRange === 'function') {
            try {
              restored.setSelectionRange(selectionStart, selectionEnd);
            } catch (error) {
              // A control that rejects a selection range keeps plain focus.
            }
          }
        }
      }
    } finally {
      applying = false;
    }
  }

  /** Reports one edit against the mirrored control id. */
  function reportValue(type, target) {
    if (applying || !target || !target.id) return;
    const isCheckbox = target.type === 'checkbox' || target.type === 'radio';
    editRevision += 1;
    pendingEdits.set(target.id, editRevision);
    client.emit({
      type,
      id: target.id,
      value: isCheckbox ? undefined : String(target.value),
      checked: isCheckbox ? target.checked === true : undefined,
      revision: editRevision,
    });
  }

  root.addEventListener('input', (event) => reportValue('input', event.target));
  root.addEventListener('change', (event) => reportValue('change', event.target));

  // Only buttons are reported as presses. A checkbox reached through its label
  // already reports a change, so forwarding the label click as well would
  // toggle the authoritative control twice.
  root.addEventListener('click', (event) => {
    if (applying) return;
    const button = event.target.closest ? event.target.closest('button') : null;
    if (!button || !button.id || button.disabled) return;
    client.emit({ type: 'click', id: button.id });
  });

  // Section navigation stays a main-renderer decision: the key is forwarded to
  // the authoritative rail, and the resulting selection arrives as state.
  root.addEventListener('keydown', (event) => {
    if (applying) return;
    const tablist = event.target.closest ? event.target.closest('[role="tablist"]') : null;
    if (!tablist || !tablist.id || TABLIST_KEYS.indexOf(event.key) === -1) return;
    event.preventDefault();
    client.emit({ type: 'keydown', id: tablist.id, key: event.key });
  });

  // Escape keeps the edits, exactly like Done. Invoking the application
  // shortcut again focuses this existing window rather than closing it.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    client.requestClose();
  });

  client.onState(applyState);

  client.onCommand((command) => {
    if (!command || command.type !== 'focus') return;
    const target = mirror.resolvePath(root, command.path);
    if (target && typeof target.focus === 'function') target.focus();
  });

  client.ready();
}());
