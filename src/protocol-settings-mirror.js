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
 * @file protocol-settings-mirror.js
 * @description Shared, dependency-free mirroring primitives for the detached
 * Protocol Settings window.
 *
 * The main renderer stays the single owner of every connection field. This
 * module only describes that authoritative DOM and replays the description in
 * the detached window, so no form rule, default, validation, or transport
 * decision is ever duplicated:
 *
 * - `createProtocolSettingsSource()` serializes the authoritative subtree and
 *   returns only what changed since the previous capture, plus the minimal
 *   structural patches needed when nodes are added, removed, or reordered.
 * - `applyProtocolSettingsPayload()` replays that description exactly. Every
 *   attribute is mirrored verbatim - class, style, aria, and data included -
 *   alongside the `value`, `checked`, `selected`, `disabled`, and `hidden`
 *   properties that never appear as attributes.
 *
 * The same file is loaded by both documents, so a change to the mirroring rules
 * can never apply to one side only. It is byte-identical in the ArcGIS Velocity
 * Simulator and the ArcGIS Velocity Logger.
 */

(function initProtocolSettingsMirror(global) {
  'use strict';

  /** Tags whose `value` is a property rather than an attribute. */
  const VALUE_TAGS = ['INPUT', 'SELECT', 'TEXTAREA'];

  /** Input types whose state lives in `checked` rather than `value`. */
  const CHECKED_TYPES = ['checkbox', 'radio'];

  /**
   * @param {Element} root the subtree the mirror describes
   * @param {Element} element a descendant of `root`
   * @returns {string} a dotted child-index path, or '' for `root` itself
   */
  function describePath(root, element) {
    if (!root || !element || element === root) return '';
    const indexes = [];
    let node = element;
    while (node && node !== root) {
      const parent = node.parentElement;
      if (!parent) return '';
      indexes.unshift(Array.prototype.indexOf.call(parent.children, node));
      node = parent;
    }
    return node === root ? indexes.join('.') : '';
  }

  /**
   * @param {Element} root the subtree the mirror describes
   * @param {string} path a path produced by `describePath`
   * @returns {Element|null} the element at that path
   */
  function resolvePath(root, path) {
    if (!root) return null;
    if (path === '' || path === undefined || path === null) return root;
    let node = root;
    const parts = String(path).split('.');
    for (let index = 0; index < parts.length; index += 1) {
      const position = Number(parts[index]);
      if (!node || !node.children || !Number.isInteger(position)) return null;
      node = node.children[position];
    }
    return node || null;
  }

  /**
   * Describes one element exactly: every attribute verbatim, plus the
   * properties the DOM never reflects into an attribute.
   *
   * @param {Element} element
   * @returns {object} a JSON-safe description
   */
  function serializeElement(element) {
    const attributes = {};
    const list = element.attributes || [];
    for (let index = 0; index < list.length; index += 1) {
      attributes[list[index].name] = list[index].value;
    }
    const entry = { a: attributes, h: element.hidden === true };
    if (VALUE_TAGS.indexOf(element.tagName) !== -1) {
      entry.v = element.value;
      entry.d = element.disabled === true;
      if (CHECKED_TYPES.indexOf(element.type) !== -1) entry.c = element.checked === true;
    }
    if (element.tagName === 'OPTION') entry.s = element.selected === true;
    if (element.children.length === 0) entry.t = element.textContent;
    return entry;
  }

  /**
   * Applies one description to one element. Attributes the source no longer
   * carries are removed, so the mirror never keeps a stale aria or data value.
   *
   * @param {Element} element
   * @param {object} entry a description produced by `serializeElement`
   */
  function applyElement(element, entry) {
    if (!element || !entry) return;
    const attributes = entry.a || {};
    const present = [];
    const list = element.attributes || [];
    for (let index = 0; index < list.length; index += 1) present.push(list[index].name);
    present.forEach((name) => {
      if (!Object.prototype.hasOwnProperty.call(attributes, name)) element.removeAttribute(name);
    });
    Object.keys(attributes).forEach((name) => {
      if (element.getAttribute(name) !== attributes[name]) element.setAttribute(name, attributes[name]);
    });
    if ('v' in entry && element.value !== entry.v) element.value = entry.v;
    if ('c' in entry && element.checked !== entry.c) element.checked = entry.c;
    if ('s' in entry && element.selected !== entry.s) element.selected = entry.s;
    if ('d' in entry && element.disabled !== entry.d) element.disabled = entry.d;
    if ('h' in entry && element.hidden !== entry.h) element.hidden = entry.h;
    if ('t' in entry && element.children.length === 0 && element.textContent !== entry.t) {
      element.textContent = entry.t;
    }
  }

  /**
   * @param {Element} root
   * @returns {Map<string, object>} every descendant description, by path
   */
  function serializeTree(root) {
    const entries = new Map();
    if (!root) return entries;
    const walk = (element, path) => {
      entries.set(path, serializeElement(element));
      const children = element.children;
      for (let index = 0; index < children.length; index += 1) {
        walk(children[index], path === '' ? String(index) : `${path}.${index}`);
      }
    };
    walk(root, '');
    return entries;
  }

  /**
   * @param {Element} element
   * @returns {{tag: string, sig: string, children: Array}} a structural
   *   signature that ignores every value and attribute, so a keystroke never
   *   looks like a structural change
   */
  function buildSignature(element) {
    const children = [];
    for (let index = 0; index < element.children.length; index += 1) {
      children.push(buildSignature(element.children[index]));
    }
    return {
      tag: element.tagName,
      sig: `${element.tagName}(${children.map((child) => child.sig).join(',')})`,
      children,
    };
  }

  /** Collects the highest nodes whose structure changed. */
  function collectPatches(previous, next, element, path, patches) {
    if (!previous || previous.sig === next.sig) {
      if (!previous) patches.push({ path, html: element.outerHTML });
      return;
    }
    if (previous.tag !== next.tag || previous.children.length !== next.children.length) {
      patches.push({ path, html: element.outerHTML });
      return;
    }
    for (let index = 0; index < next.children.length; index += 1) {
      collectPatches(previous.children[index], next.children[index], element.children[index],
        path === '' ? String(index) : `${path}.${index}`, patches);
    }
  }

  /**
   * Replays structural patches. A patch with an empty path replaces the whole
   * mirrored subtree; every other patch replaces exactly one element.
   *
   * @param {Element} root
   * @param {Array<{path: string, html: string}>} patches
   */
  function applyPatches(root, patches) {
    if (!root || !patches || !patches.length) return;
    patches.forEach((patch) => {
      if (!patch || typeof patch.html !== 'string') return;
      if (!patch.path) {
        root.innerHTML = patch.html;
        return;
      }
      const target = resolvePath(root, patch.path);
      if (target) target.outerHTML = patch.html;
    });
  }

  /**
   * Replays a payload produced by a mirror source.
   *
   * @param {Element} root
   * @param {{patches?: Array, entries?: Array}} payload
   */
  function applyProtocolSettingsPayload(root, payload) {
    if (!root || !payload) return;
    applyPatches(root, payload.patches);
    (payload.entries || []).forEach((change) => {
      if (!change) return;
      applyElement(resolvePath(root, change.p), change.e);
    });
  }

  /**
   * Creates a change-tracking serializer for one authoritative subtree.
   *
   * @param {Element} root the authoritative Protocol Settings element
   * @returns {{capture: function(): {patches: Array, entries: Array, full: boolean}, reset: function(): void}}
   */
  function createProtocolSettingsSource(root) {
    let signature = null;
    let sent = new Map();

    /** Drops the cache for a patched subtree so its state is resent in full. */
    const invalidate = (path) => {
      if (!path) {
        sent = new Map();
        return;
      }
      const prefix = `${path}.`;
      [...sent.keys()].forEach((key) => {
        if (key === path || key.indexOf(prefix) === 0) sent.delete(key);
      });
    };

    return {
      reset() {
        signature = null;
        sent = new Map();
      },
      capture() {
        const next = buildSignature(root);
        const patches = [];
        const full = !signature;
        if (!signature || signature.tag !== next.tag
          || signature.children.length !== next.children.length) {
          patches.push({ path: '', html: root.innerHTML });
        } else if (signature.sig !== next.sig) {
          for (let index = 0; index < next.children.length; index += 1) {
            collectPatches(signature.children[index], next.children[index], root.children[index],
              String(index), patches);
          }
        }
        signature = next;
        patches.forEach((patch) => invalidate(patch.path));

        const entries = [];
        const described = serializeTree(root);
        described.forEach((entry, path) => {
          const encoded = JSON.stringify(entry);
          if (sent.get(path) === encoded) return;
          sent.set(path, encoded);
          entries.push({ p: path, e: entry });
        });
        [...sent.keys()].forEach((key) => {
          if (!described.has(key)) sent.delete(key);
        });
        return { patches, entries, full };
      },
    };
  }

  const api = {
    describePath,
    resolvePath,
    serializeElement,
    applyElement,
    serializeTree,
    buildSignature,
    applyPatches,
    applyProtocolSettingsPayload,
    createProtocolSettingsSource,
  };

  global.ProtocolSettingsMirror = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
