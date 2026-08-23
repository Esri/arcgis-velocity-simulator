/**
 * Protocol Settings dialog and connection summary UI tests
 * Run with: node test/protocol-settings.test.js
 *
 * Exercises the renderer against `src/index.html`: dialog nesting, preserved
 * control ids, tab semantics and keyboard navigation, the live-edit model with
 * Revert and Reset, presets applied while the dialog is closed, validation
 * focus, connected read-only locking, secret redaction, the three summary
 * surfaces, and the application shortcuts that reach them.
 *
 * The element ids, section names, row keys, and behavior asserted here are the
 * cross-application contract shared with the ArcGIS Velocity Logger.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', 'src');
const indexHtml = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const rendererSource = fs.readFileSync(path.join(SRC, 'renderer.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
const styleCss = fs.readFileSync(path.join(SRC, 'style.css'), 'utf8');

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

/**
 * Every control that existed before the protocol settings moved into a dialog.
 * All of them must still be present, with the same ids, so launch
 * configurations, CLI prepopulation, presets, and tests keep working.
 */
const PRESERVED_CONTROL_IDS = [
  'http-format', 'http-tls', 'http-path', 'http-tls-ca-path', 'http-tls-cert-path',
  'http-tls-key-path', 'http-allow-unverified',
  'ws-format', 'ws-tls', 'ws-path', 'ws-tls-ca-path', 'ws-tls-cert-path', 'ws-tls-key-path',
  'ws-allow-unverified', 'ws-subscription-msg', 'ws-ignore-first-msg', 'ws-headers',
  'grpc-serialization', 'grpc-send-method', 'grpc-tls', 'grpc-header-path-key', 'grpc-header-path',
  'grpc-tls-ca-path', 'grpc-tls-cert-path', 'grpc-tls-key-path', 'grpc-allow-unverified',
  'xmpp-conversation', 'xmpp-domain', 'xmpp-tls-policy', 'xmpp-username', 'xmpp-password',
  'xmpp-resource', 'xmpp-external-username', 'xmpp-external-password', 'xmpp-destination',
  'xmpp-room', 'xmpp-nickname', 'xmpp-room-password', 'xmpp-copy-settings', 'xmpp-copy-password',
  'xmpp-tls-ca-path', 'xmpp-tls-cert-path', 'xmpp-tls-key-path', 'xmpp-allow-unverified',
  'xmpp-allow-remote', 'xmpp-connect-timeout', 'xmpp-reply-timeout', 'xmpp-ping-interval',
  'xmpp-reconnect-delay',
  // Shared controls that stay inline.
  'select-file', 'connection-preset', 'connection-type', 'ip-address', 'port',
  'lines-per-interval', 'rate-ms', 'connect', 'disconnect', 'play-pause', 'send-manual',
];

/** Builds the renderer inside jsdom with a stubbed main-process API. */
function createApiProxy(state) {
  const stub = {
    openFileDialog: async () => '/data/sample.csv',
    connect: async (options) => { state.connects.push(options); return { success: true }; },
    disconnect: async () => { state.disconnects += 1; return { success: true }; },
    sendData: () => {},
    readCsvFile: async () => ['a,b,c'],
    getXmppClientSettings: async () => ({ success: true, text: 'ip=127.0.0.1' }),
  };
  return new Proxy(stub, {
    get(target, property) {
      if (property in target) return target[property];
      if (typeof property !== 'string') return undefined;
      if (property.startsWith('on')) return (callback) => { state.listeners.set(property, callback); };
      return () => undefined;
    },
    has: () => true,
  });
}

async function withRenderer(run) {
  const state = {
    listeners: new Map(), connects: [], disconnects: 0, copied: [],
  };
  const dom = new JSDOM(indexHtml.replace(/<script[\s\S]*?<\/script>/g, ''), {
    runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true,
  });
  const { window } = dom;
  window.matchMedia = () => ({
    matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  });
  window.localStorage.clear();
  window.api = createApiProxy(state);
  window.VelocityAuthUtils = {
    shouldSendVelocityTokenByDefault: () => false,
    describeVelocityAuthType: (value) => value || 'not specified',
  };
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text) => { state.copied.push(text); } },
  });
  window.eval(fs.readFileSync(path.join(SRC, 'connection-presets.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(SRC, 'connection-summary.js'), 'utf8'));
  window.eval(rendererSource);
  await new Promise((resolve) => window.addEventListener('DOMContentLoaded', resolve, { once: true }));
  const { document } = window;
  const helpers = {
    window,
    document,
    state,
    select(id, value) {
      const element = document.getElementById(id);
      element.value = value;
      element.dispatchEvent(new window.Event('change', { bubbles: true }));
      return element;
    },
    check(id, value) {
      const element = document.getElementById(id);
      element.checked = value;
      element.dispatchEvent(new window.Event('change', { bubbles: true }));
      return element;
    },
    type(id, value) {
      const element = document.getElementById(id);
      element.value = value;
      element.dispatchEvent(new window.Event('input', { bubbles: true }));
      element.dispatchEvent(new window.Event('change', { bubbles: true }));
      return element;
    },
    key(target, key, init = {}) {
      target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...init }));
    },
    rows(containerId) {
      return [...document.querySelectorAll(`#${containerId} .connection-summary-row`)]
        .map((row) => ({
          key: row.dataset.rowKey,
          value: row.querySelector('dd').textContent,
          kind: row.dataset.kind,
          group: row.dataset.group,
        }));
    },
    tabState() {
      return [...document.querySelectorAll('#protocol-settings-tablist [role="tab"]')]
        .map((tab) => ({
          section: tab.dataset.section,
          hidden: tab.hidden,
          selected: tab.getAttribute('aria-selected') === 'true',
          tabIndex: tab.tabIndex,
        }));
    },
  };
  try {
    await run(helpers);
  } finally {
    window.close();
  }
}

async function uiTest(name, fn) {
  try {
    await withRenderer(fn);
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

console.log('protocol-settings.test.js');

// ---------------------------------------------------------------------------
// Source structure
// ---------------------------------------------------------------------------

test('the dialog is a native in-window dialog nested inside the connection controls', () => {
  const { document } = new JSDOM(indexHtml).window;
  const dialog = document.getElementById('protocol-settings-dialog');
  assert.ok(dialog, 'protocol-settings-dialog must exist');
  assert.strictEqual(dialog.tagName, 'DIALOG');
  assert.ok(document.querySelector('.connection-controls-group #protocol-settings-dialog'),
    'the dialog must live inside .connection-controls-group so delegated preset events still fire');
  assert.strictEqual(dialog.getAttribute('aria-labelledby'), 'protocol-settings-title');
  assert.doesNotMatch(rendererSource, /BrowserWindow/, 'the dialog must not be an Electron window');
});

test('every control id from the inline layout is preserved exactly once', () => {
  const { document } = new JSDOM(indexHtml).window;
  const allIds = [...document.querySelectorAll('[id]')].map((element) => element.id);
  PRESERVED_CONTROL_IDS.forEach((id) => {
    assert.ok(document.getElementById(id), `${id} must still exist`);
    assert.strictEqual(allIds.filter((entry) => entry === id).length, 1, `${id} must not be duplicated`);
  });
  const duplicates = allIds.filter((id, index) => allIds.indexOf(id) !== index);
  assert.deepStrictEqual(duplicates, [], 'no id may appear twice');
});

test('every protocol-specific control lives in the dialog exactly once', () => {
  const { document } = new JSDOM(indexHtml).window;
  const dialog = document.getElementById('protocol-settings-dialog');
  PRESERVED_CONTROL_IDS.filter((id) => /^(http|ws|grpc|xmpp)-/.test(id)).forEach((id) => {
    assert.ok(dialog.contains(document.getElementById(id)), `${id} must live inside the dialog`);
  });
  ['select-file', 'connection-preset', 'connection-preset-state', 'connection-type', 'ip-address',
    'port', 'lines-per-interval', 'rate-ms', 'connect', 'disconnect', 'play-pause', 'send-manual']
    .forEach((id) => {
      const element = document.getElementById(id);
      assert.ok(element, `${id} must exist`);
      assert.ok(!dialog.contains(element), `${id} must stay inline`);
    });
});

test('the shared controls keep the documented inline order, with host and port above the opener', () => {
  const { document } = new JSDOM(indexHtml).window;
  const group = document.querySelector('.connection-controls-group');
  const order = ['select-file', 'connection-preset', 'connection-type', 'ip-address', 'port', 'protocol-settings-btn'];
  const positions = order.map((id) => {
    const element = document.getElementById(id);
    return [...group.querySelectorAll('*')].indexOf(element);
  });
  positions.forEach((position, index) => {
    assert.ok(position >= 0, `${order[index]} must be inside the connection controls`);
    if (index > 0) {
      assert.ok(position > positions[index - 1], `${order[index]} must follow ${order[index - 1]}`);
    }
  });
});

test('the trigger button announces the dialog and carries a persistent chip', () => {
  const { document } = new JSDOM(indexHtml).window;
  const button = document.getElementById('protocol-settings-btn');
  assert.strictEqual(button.getAttribute('aria-haspopup'), 'dialog');
  assert.strictEqual(button.getAttribute('aria-controls'), 'protocol-settings-dialog');
  assert.strictEqual(button.getAttribute('aria-expanded'), 'false');
  assert.ok(button.getAttribute('aria-label'));
  assert.match(button.dataset.tooltip, /Cmd\/Ctrl\+Shift\+P/);
  const chip = document.getElementById('protocol-settings-count');
  assert.ok(chip && button.contains(chip), 'the configured-state chip belongs to the button');
});

test('the dialog uses tablist, tab, and tabpanel semantics with a roving tab stop', () => {
  const { document } = new JSDOM(indexHtml).window;
  const tablist = document.getElementById('protocol-settings-tablist');
  assert.strictEqual(tablist.getAttribute('role'), 'tablist');
  assert.ok(tablist.getAttribute('aria-label'));
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  assert.deepStrictEqual(tabs.map((tab) => tab.dataset.section), ['basics', 'security', 'advanced', 'summary']);
  tabs.forEach((tab) => {
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    assert.ok(panel, `${tab.id} must control a panel`);
    assert.strictEqual(panel.getAttribute('role'), 'tabpanel');
    assert.strictEqual(panel.getAttribute('aria-labelledby'), tab.id);
  });
  assert.strictEqual(tabs.filter((tab) => tab.getAttribute('tabindex') === '0').length, 1);
});

test('every protocol owns one group per section', () => {
  const { document } = new JSDOM(indexHtml).window;
  const groups = [...document.querySelectorAll('.protocol-settings-group')]
    .map((group) => `${group.dataset.protocol}/${group.dataset.section}`);
  ['grpc', 'http', 'ws', 'xmpp'].forEach((protocol) => {
    ['basics', 'security', 'advanced'].forEach((section) => {
      assert.ok(groups.includes(`${protocol}/${section}`), `${protocol} needs a ${section} group`);
    });
  });
  ['grpc-advanced', 'http-advanced', 'ws-advanced', 'xmpp-advanced'].forEach((id) => {
    assert.ok(document.getElementById(id), `${id} must identify the Advanced group of its protocol`);
  });
});

test('the validation banner is assertive and the read-only banner is polite', () => {
  const { document } = new JSDOM(indexHtml).window;
  const validation = document.getElementById('protocol-settings-alert');
  assert.strictEqual(validation.getAttribute('role'), 'alert');
  assert.strictEqual(validation.getAttribute('aria-live'), 'assertive');
  assert.strictEqual(validation.hidden, true);
  const readOnly = document.getElementById('protocol-settings-readonly');
  assert.strictEqual(readOnly.getAttribute('role'), 'status');
  assert.strictEqual(readOnly.hidden, true);
});

test('the stylesheet styles the dialog, its tabs, and the summary surfaces', () => {
  assert.match(styleCss, /\.protocol-settings-dialog::backdrop/);
  assert.match(styleCss, /\.protocol-settings-panel\[hidden\][\s\S]{0,120}display:\s*none/);
  assert.match(styleCss, /\.protocol-settings-tablist\s*\{/);
  assert.match(styleCss, /\.protocol-settings-footer\s*\{[^}]*position:\s*sticky/);
  assert.match(styleCss, /body\.compact \.protocol-settings-tablist\s*\{[\s\S]*flex-direction:\s*row/);
  assert.match(styleCss, /\.connection-summary-status-btn\s*\{/);
  // The compact layout hides the inline card, which is why the summary
  // shortcut opens the dialog there instead of focusing the card.
  assert.match(styleCss, /body\.compact \.connection-summary-card\s*\{[^}]*display:\s*none/);
});

// The application menu owns Cmd/Ctrl+I for App Configuration and
// Cmd/Ctrl+Shift+I for the Connection Summary. A shifted key arrives uppercase,
// so the pre-existing handler has to look at the modifier, not only the letter.
test('Cmd/Ctrl+Shift+I is left to the Connection Summary, not App Configuration', () => {
  const source = mainSource.match(/function registerAppSpecificShortcuts\(\)[\s\S]*?\n\}\n/);
  assert.ok(source, 'registerAppSpecificShortcuts must exist');
  const calls = { config: 0, help: 0, cli: 0 };
  const handlers = [];
  const mainWindow = { webContents: { on: (channel, handler) => { if (channel === 'before-input-event') handlers.push(handler); } } };
  // eslint-disable-next-line no-new-func
  new Function('mainWindow', 'showConfigDialog', 'showHelpDialog', 'showCommandLineDialog',
    `${source[0]}; registerAppSpecificShortcuts();`)(
    mainWindow,
    () => { calls.config += 1; },
    () => { calls.help += 1; },
    () => { calls.cli += 1; },
  );
  assert.strictEqual(handlers.length, 1, 'one before-input-event handler');
  const press = (input) => {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    handlers[0](event, { type: 'keyDown', control: false, meta: false, shift: false, alt: false, ...input });
    return event.prevented;
  };

  // Regression: Cmd/Ctrl+Shift+I must reach the Connection Summary shortcut.
  assert.strictEqual(press({ key: 'I', meta: true, shift: true }), false, 'Cmd+Shift+I must not be consumed');
  assert.strictEqual(press({ key: 'I', control: true, shift: true }), false, 'Ctrl+Shift+I must not be consumed');
  assert.strictEqual(calls.config, 0, 'App Configuration must not open on the shifted accelerator');

  // The unshifted accelerator still opens App Configuration, in either case.
  assert.strictEqual(press({ key: 'i', meta: true }), true);
  assert.strictEqual(calls.config, 1);
  assert.strictEqual(press({ key: 'I', control: true }), true);
  assert.strictEqual(calls.config, 2);

  // The other function keys are untouched.
  assert.strictEqual(press({ key: 'F1' }), true);
  assert.strictEqual(calls.help, 1);
  assert.strictEqual(press({ key: 'F3' }), true);
  assert.strictEqual(calls.cli, 1);
});

test('both connection shortcuts are offered in the application and context menus', () => {
  const menuEntries = mainSource.match(/accelerator: 'CmdOrCtrl\+Shift\+[PI]'/g) || [];
  assert.strictEqual(menuEntries.filter((entry) => entry.includes('Shift+P')).length, 2);
  assert.strictEqual(menuEntries.filter((entry) => entry.includes('Shift+I')).length, 2);
  // Both surfaces funnel through the one renderer entry point.
  assert.match(rendererSource, /function handleConnectionShortcut\(name\)/);
});

// ---------------------------------------------------------------------------
// Renderer behavior
// ---------------------------------------------------------------------------

(async () => {
  await uiTest('opening and closing keeps edits and returns focus to the trigger', async ({ document, select }) => {
    select('connection-type', 'http-server');
    const dialog = document.getElementById('protocol-settings-dialog');
    const button = document.getElementById('protocol-settings-btn');
    button.focus();
    button.click();
    assert.strictEqual(dialog.open, true);
    assert.strictEqual(button.getAttribute('aria-expanded'), 'true');
    assert.strictEqual(document.activeElement.id, 'http-format', 'focus moves into the first setting');

    select('http-format', 'json');
    document.getElementById('protocol-settings-done').click();
    assert.strictEqual(dialog.open, false);
    assert.strictEqual(button.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(document.getElementById('http-format').value, 'json', 'Done keeps the edit');
    assert.strictEqual(document.activeElement.id, 'protocol-settings-btn', 'focus returns to the opener');
  });

  await uiTest('Escape closes the dialog and keeps the edits', async ({ document, select, key }) => {
    select('connection-type', 'ws-client');
    document.getElementById('protocol-settings-btn').click();
    select('ws-path', '/stream');
    key(document.getElementById('protocol-settings-dialog'), 'Escape');
    assert.strictEqual(document.getElementById('protocol-settings-dialog').open, false);
    assert.strictEqual(document.getElementById('ws-path').value, '/stream');
    assert.strictEqual(document.activeElement.id, 'protocol-settings-btn');
  });

  await uiTest('only the sections that hold something for the protocol are offered', async ({ select, tabState, document }) => {
    select('connection-type', 'tcp-server');
    assert.deepStrictEqual(
      tabState().filter((tab) => !tab.hidden).map((tab) => tab.section),
      ['summary'],
      'TCP has no protocol settings',
    );
    assert.strictEqual(document.getElementById('protocol-settings-empty').hidden, false);
    assert.match(document.getElementById('protocol-settings-empty').textContent, /^TCP has no protocol settings/);

    select('connection-type', 'http-server');
    assert.deepStrictEqual(
      tabState().filter((tab) => !tab.hidden).map((tab) => tab.section),
      ['basics', 'security', 'summary'],
      'HTTP has no Advanced settings',
    );
    assert.strictEqual(document.getElementById('protocol-settings-empty').hidden, true);

    select('connection-type', 'ws-client');
    assert.deepStrictEqual(
      tabState().filter((tab) => !tab.hidden).map((tab) => tab.section),
      ['basics', 'security', 'advanced', 'summary'],
    );

    select('connection-type', 'grpc-server');
    assert.deepStrictEqual(
      tabState().filter((tab) => !tab.hidden).map((tab) => tab.section),
      ['basics', 'security', 'summary'],
      'the gRPC endpoint header is client-only, so a server has no Advanced section',
    );
    select('connection-type', 'grpc-client');
    assert.ok(tabState().find((tab) => tab.section === 'advanced' && !tab.hidden));
  });

  await uiTest('arrow keys, Home, and End move the roving tab stop', async ({ document, select, key, tabState }) => {
    select('connection-type', 'ws-client');
    document.getElementById('protocol-settings-btn').click();
    const tablist = document.getElementById('protocol-settings-tablist');
    const selected = () => tabState().find((tab) => tab.selected).section;
    assert.strictEqual(selected(), 'basics');

    key(tablist, 'ArrowDown');
    assert.strictEqual(selected(), 'security');
    assert.strictEqual(document.activeElement.id, 'protocol-settings-tab-security');
    assert.strictEqual(document.getElementById('protocol-settings-panel-security').hidden, false);
    assert.strictEqual(document.getElementById('protocol-settings-panel-basics').hidden, true);

    key(tablist, 'ArrowRight');
    assert.strictEqual(selected(), 'advanced');
    key(tablist, 'ArrowLeft');
    assert.strictEqual(selected(), 'security');
    key(tablist, 'End');
    assert.strictEqual(selected(), 'summary');
    key(tablist, 'ArrowRight');
    assert.strictEqual(selected(), 'basics', 'the roving tab stop wraps');
    key(tablist, 'Home');
    assert.strictEqual(selected(), 'basics');

    assert.strictEqual(tabState().filter((tab) => tab.tabIndex === 0).length, 1);
    assert.ok(tabState().filter((tab) => !tab.selected).every((tab) => tab.tabIndex === -1));
  });

  await uiTest('clicking a tab selects its panel', async ({ document, select }) => {
    select('connection-type', 'xmpp-server');
    document.getElementById('protocol-settings-btn').click();
    document.getElementById('protocol-settings-tab-advanced').click();
    assert.strictEqual(document.getElementById('protocol-settings-panel-advanced').hidden, false);
    assert.strictEqual(document.getElementById('protocol-settings-tab-advanced').getAttribute('aria-selected'), 'true');
  });

  await uiTest('Revert changes is offered only while something differs from the opening values', async ({ document, select, type }) => {
    select('connection-type', 'ws-server');
    const revert = document.getElementById('protocol-settings-revert');
    document.getElementById('protocol-settings-btn').click();
    assert.strictEqual(revert.disabled, true, 'nothing to revert on open');

    select('ws-format', 'json');
    type('ws-path', '/edited');
    document.getElementById('protocol-settings-tab-advanced').click();
    type('ws-subscription-msg', 'subscribe');
    assert.strictEqual(revert.disabled, false);

    revert.click();
    assert.strictEqual(document.getElementById('ws-format').value, 'delimited');
    assert.strictEqual(document.getElementById('ws-path').value, '/');
    assert.strictEqual(document.getElementById('ws-subscription-msg').value, '');
    assert.strictEqual(revert.disabled, true, 'Revert disables itself once nothing differs');
    assert.strictEqual(document.getElementById('protocol-settings-dialog').open, true, 'Revert keeps the dialog open');
  });

  await uiTest('Reset to preset is offered only for a modified preset', async ({ document, select, type }) => {
    const reset = document.getElementById('protocol-settings-reset');
    assert.strictEqual(reset.disabled, true, 'Custom has no preset to reset to');

    select('connection-preset', 'local-http-simulator-server');
    document.getElementById('protocol-settings-btn').click();
    assert.strictEqual(reset.disabled, true, 'an unedited preset needs no reset');

    select('http-format', 'xml');
    type('http-path', '/changed');
    assert.strictEqual(document.getElementById('connection-preset').value, 'custom');
    assert.strictEqual(document.getElementById('connection-preset-state').hidden, false);
    assert.strictEqual(reset.disabled, false);
    assert.match(reset.dataset.tooltip, /Local HTTP — Simulator Server \/ Logger Client/);

    reset.click();
    assert.strictEqual(document.getElementById('http-format').value, 'delimited');
    assert.strictEqual(document.getElementById('http-path').value, '/');
    assert.strictEqual(document.getElementById('connection-preset').value, 'local-http-simulator-server');
    assert.strictEqual(document.getElementById('connection-preset-state').hidden, true);
    assert.strictEqual(reset.disabled, true);
  });

  await uiTest('a preset applied while the dialog is closed still fills and re-labels everything', async ({ document, select, state }) => {
    const dialog = document.getElementById('protocol-settings-dialog');
    select('connection-preset', 'local-grpc-logger-server');
    assert.strictEqual(dialog.open, false, 'a preset never opens the dialog');
    assert.strictEqual(document.getElementById('grpc-serialization').value, 'text');
    assert.strictEqual(document.getElementById('grpc-tls').checked, false);
    assert.strictEqual(document.getElementById('connection-type').value, 'grpc-client');
    assert.match(document.getElementById('protocol-settings-title').textContent, /gRPC Client settings/);
    assert.match(document.getElementById('protocol-settings-count').textContent, /^gRPC · \d+ changed( · \d+ warnings?)?$/);
    assert.strictEqual(state.connects.length, 0, 'a preset never connects');

    document.getElementById('protocol-settings-btn').click();
    assert.strictEqual(dialog.open, true);
    assert.strictEqual(document.getElementById('grpc-serialization').value, 'text');
  });

  await uiTest('an edit inside the dialog still marks the preset modified', async ({ document, select }) => {
    select('connection-preset', 'local-http-simulator-server');
    document.getElementById('protocol-settings-btn').click();
    select('http-format', 'json');
    // The delegated listener lives on .connection-controls-group, which is why
    // the dialog is nested there.
    assert.strictEqual(document.getElementById('connection-preset').value, 'custom');
    assert.match(document.getElementById('connection-preset').dataset.tooltip, /Custom \(modified\)/);
  });

  await uiTest('the chip counts protocol settings that differ from their defaults', async ({ document, select, check }) => {
    const chip = document.getElementById('protocol-settings-count');
    select('connection-type', 'tcp-client');
    assert.strictEqual(chip.textContent, 'TCP · no protocol settings');

    select('connection-type', 'http-client');
    assert.strictEqual(chip.textContent, 'HTTP · defaults');
    select('http-format', 'json');
    assert.strictEqual(chip.textContent, 'HTTP · 1 changed');
    // A warning is appended to the count, never substituted for it.
    check('http-tls', false);
    assert.strictEqual(chip.textContent, 'HTTP · 2 changed · 1 warning');
    assert.strictEqual(chip.dataset.warning, 'true', 'plaintext raises a warning on the chip');
  });

  await uiTest('the inline card shows three rows with warnings first and copies redacted text', async ({ document, select, check, rows, state }) => {
    select('connection-type', 'http-server');
    assert.deepStrictEqual(rows('connection-summary-rows').map((row) => row.key), ['connection', 'endpoint', 'status']);
    assert.strictEqual(rows('connection-summary-rows')[1].value, 'https://127.0.0.1:8443/');

    select('connection-type', 'http-client');
    check('http-allow-unverified', true);
    const primary = rows('connection-summary-rows');
    assert.strictEqual(primary[0].key, 'unverifiedCertificate');
    assert.strictEqual(primary[0].kind, 'warning');
    assert.strictEqual(document.getElementById('connection-summary-card').dataset.warning, 'true');

    document.getElementById('connection-summary-copy').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const copied = state.copied.pop();
    assert.ok(copied, 'the summary is copied to the clipboard');
    assert.match(copied, /ArcGIS Velocity Simulator — connection summary/);
    assert.match(copied, /Certificate verification: Off for every host/);
  });

  await uiTest('the summary never leaks a password, whatever the surface', async ({ document, select, type, rows, state }) => {
    select('connection-type', 'xmpp-client');
    type('xmpp-username', 'simulator');
    type('xmpp-password', 'do-not-print-me');
    document.getElementById('connection-summary-show-all').click();
    const summaryRows = rows('protocol-settings-summary-rows');
    assert.strictEqual(summaryRows.find((row) => row.key === 'xmppPassword').value, 'Set (hidden)');
    document.getElementById('connection-summary-copy').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.doesNotMatch(state.copied.pop(), /do-not-print-me/);
    assert.doesNotMatch(document.getElementById('protocol-settings-summary-rows').textContent, /do-not-print-me/);
  });

  await uiTest('credential-bearing WebSocket fields never reach a summary surface', async ({ document, select, type, rows, state }) => {
    select('connection-type', 'ws-client');
    type('ws-headers', '{"Authorization":"do-not-print-me"}');
    type('ws-subscription-msg', '{"token":"do-not-print-me"}');
    document.getElementById('connection-summary-show-all').click();
    const summaryRows = rows('protocol-settings-summary-rows');
    assert.strictEqual(summaryRows.find((row) => row.key === 'wsHeaders').value, 'Set (hidden)');
    assert.strictEqual(summaryRows.find((row) => row.key === 'wsSubscriptionMessage').value, 'Set (hidden)');
    assert.strictEqual(summaryRows.find((row) => row.key === 'wsHeaders').kind, 'secret');
    document.getElementById('connection-summary-copy').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.doesNotMatch(state.copied.pop(), /do-not-print-me/);
    assert.doesNotMatch(document.getElementById('protocol-settings-summary-rows').textContent, /do-not-print-me/);
  });

  await uiTest('Show all and the status-bar button open the read-only summary section', async ({ document, select }) => {
    select('connection-type', 'grpc-client');
    document.getElementById('connection-summary-show-all').click();
    assert.strictEqual(document.getElementById('protocol-settings-dialog').open, true);
    assert.strictEqual(document.getElementById('protocol-settings-tab-summary').getAttribute('aria-selected'), 'true');
    assert.strictEqual(document.getElementById('protocol-settings-panel-summary').hidden, false);
    document.getElementById('protocol-settings-done').click();

    const statusButton = document.getElementById('connection-summary-status-btn');
    assert.strictEqual(statusButton.getAttribute('aria-haspopup'), 'dialog');
    assert.match(statusButton.dataset.tooltip, /Select or press Enter to open/);
    assert.strictEqual(document.getElementById('connection-summary-status-label').textContent, 'gRPC Client · 127.0.0.1:5565');
    statusButton.click();
    assert.strictEqual(document.getElementById('protocol-settings-dialog').open, true);
    assert.strictEqual(document.getElementById('protocol-settings-tab-summary').getAttribute('aria-selected'), 'true');
  });

  await uiTest('the status-bar tooltip only says how to open the summary', async ({ document, select, check }) => {
    select('connection-type', 'ws-client');
    check('ws-tls', false);
    const tooltip = document.getElementById('connection-summary-status-btn').dataset.tooltip;
    assert.match(tooltip, /Select or press Enter to open the full read-only summary/);
    assert.doesNotMatch(tooltip, /Subscription message/, 'the tooltip never carries the summary itself');
  });

  await uiTest('keyboard shortcuts open Protocol Settings and the Connection Summary', async ({ document, key, window }) => {
    // JSDOM reports a non-Mac platform, so the primary modifier is Ctrl here.
    const dialog = document.getElementById('protocol-settings-dialog');
    key(document.body, 'P', { ctrlKey: true, shiftKey: true });
    assert.strictEqual(dialog.open, true);
    key(document.body, 'P', { ctrlKey: true, shiftKey: true });
    assert.strictEqual(dialog.open, false);

    key(document.body, 'I', { ctrlKey: true, shiftKey: true });
    assert.strictEqual(document.activeElement.id, 'connection-summary-card');

    // The shortcut still works while a connection field has focus.
    document.getElementById('ip-address').focus();
    key(document.getElementById('ip-address'), 'P', { ctrlKey: true, shiftKey: true });
    assert.strictEqual(dialog.open, true);
    key(document.getElementById('ip-address'), 'I', { ctrlKey: true, shiftKey: true });
    assert.strictEqual(document.activeElement.id, 'protocol-settings-panel-summary');
    // Escape keeps the edits whatever holds focus.
    key(document.body, 'Escape');
    assert.strictEqual(dialog.open, false);

    // On macOS the same handler listens for Command instead of Control.
    Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true });
    key(document.body, 'P', { metaKey: true, shiftKey: true });
    assert.strictEqual(dialog.open, true);
    key(document.body, 'P', { ctrlKey: true, shiftKey: true });
    assert.strictEqual(dialog.open, true, 'Control is not the primary modifier on macOS');
  });

  await uiTest('the summary shortcut opens the dialog when the inline card is hidden', async ({ document, key }) => {
    // Compact view hides the inline summary card, so the shortcut has nothing
    // to focus there and must open the read-only Summary section instead.
    document.body.classList.add('compact');
    const dialog = document.getElementById('protocol-settings-dialog');
    key(document.body, 'I', { ctrlKey: true, shiftKey: true });
    assert.strictEqual(dialog.open, true, 'the dialog opens when the card is hidden');
    assert.strictEqual(dialog.dataset.mode, 'edit');
    assert.strictEqual(document.getElementById('protocol-settings-tab-summary').getAttribute('aria-selected'), 'true',
      'it opens directly on the Summary section');
    assert.strictEqual(document.activeElement.id, 'protocol-settings-panel-summary');
    assert.ok(document.querySelectorAll('#protocol-settings-summary-rows .connection-summary-row').length > 0,
      'the Summary section is populated before it is shown');

    // Closing hands focus to the status-bar summary button, the opener that
    // stands in for the hidden card.
    key(document.body, 'Escape');
    assert.strictEqual(dialog.open, false);
    assert.strictEqual(document.activeElement.id, 'connection-summary-status-btn');

    // Pressing it again while the dialog is open only re-selects the section.
    key(document.body, 'I', { ctrlKey: true, shiftKey: true });
    assert.strictEqual(dialog.open, true);
    key(document.body, 'I', { ctrlKey: true, shiftKey: true });
    assert.strictEqual(dialog.open, true, 'the summary shortcut never closes the dialog');
    assert.strictEqual(document.activeElement.id, 'protocol-settings-panel-summary');

    // Full view keeps focusing the inline card.
    key(document.body, 'Escape');
    document.body.classList.remove('compact');
    key(document.body, 'I', { ctrlKey: true, shiftKey: true });
    assert.strictEqual(document.activeElement.id, 'connection-summary-card');
    assert.strictEqual(dialog.open, false);
  });

  await uiTest('the menu shortcuts reach the same handler as the key presses', async ({ document, state }) => {
    const shortcut = state.listeners.get('onKeyboardShortcut');
    const dialog = document.getElementById('protocol-settings-dialog');
    shortcut('protocol-settings');
    assert.strictEqual(dialog.open, true);
    shortcut('protocol-settings');
    assert.strictEqual(dialog.open, false);
    shortcut('connection-summary');
    assert.strictEqual(document.activeElement.id, 'connection-summary-card');
  });

  await uiTest('a hidden connection row is revealed before the dialog opens', async ({ document, key }) => {
    document.getElementById('toggle-connection-controls').click();
    assert.ok(document.querySelector('.connection-controls-group').classList.contains('hidden'));
    key(document.body, 'P', { ctrlKey: true, shiftKey: true });
    assert.ok(!document.querySelector('.connection-controls-group').classList.contains('hidden'));
    assert.strictEqual(document.getElementById('protocol-settings-dialog').open, true);
  });

  await uiTest('connecting locks every protocol control and the shared connection fields', async ({ document, select, state }) => {
    select('connection-type', 'ws-server');
    state.listeners.get('onConnectionStatusChanged')('connecting', '');
    const dialog = document.getElementById('protocol-settings-dialog');
    assert.strictEqual(dialog.dataset.readOnly, 'true');
    assert.strictEqual(document.getElementById('protocol-settings-readonly').hidden, false);
    assert.match(document.getElementById('protocol-settings-readonly').textContent, /Disconnect to change these settings/);
    ['ws-format', 'ws-path', 'ws-tls', 'ws-tls-ca-path', 'ws-headers', 'ws-allow-unverified',
      'http-format', 'grpc-serialization', 'xmpp-domain']
      .forEach((id) => assert.strictEqual(document.getElementById(id).disabled, true, `${id} must be locked`));
    ['connection-type', 'ip-address', 'port', 'connection-preset']
      .forEach((id) => assert.strictEqual(document.getElementById(id).disabled, true, `${id} must be locked`));
    assert.strictEqual(document.getElementById('protocol-settings-revert').disabled, true);
    assert.strictEqual(document.getElementById('protocol-settings-reset').disabled, true);

    state.listeners.get('onConnectionStatusChanged')('disconnected', '');
    assert.strictEqual(dialog.dataset.readOnly, 'false');
    assert.strictEqual(document.getElementById('protocol-settings-readonly').hidden, true);
    ['ws-format', 'ws-path', 'ws-tls', 'ws-headers', 'connection-type', 'ip-address', 'port', 'connection-preset']
      .forEach((id) => assert.strictEqual(document.getElementById(id).disabled, false, `${id} must unlock`));
  });

  await uiTest('a connected dialog opens in read-only summary mode', async ({ document, select, state, rows }) => {
    select('connection-type', 'http-server');
    state.listeners.get('onConnectionStatusChanged')('connected', '');
    document.getElementById('protocol-settings-btn').click();
    assert.strictEqual(document.getElementById('protocol-settings-dialog').dataset.mode, 'summary');
    assert.strictEqual(document.getElementById('protocol-settings-tab-summary').getAttribute('aria-selected'), 'true');
    ['basics', 'security', 'advanced'].forEach((section) => {
      assert.strictEqual(document.getElementById(`protocol-settings-tab-${section}`).hidden, true);
    });
    assert.match(document.getElementById('protocol-settings-readonly').textContent, /Connected\. Disconnect to change these settings\./);
    assert.strictEqual(rows('protocol-settings-summary-rows').find((row) => row.key === 'status').value, 'Connected');
  });

  await uiTest('a connected XMPP server keeps Copy Client Settings available', async ({ document, select, state }) => {
    const copyButton = document.getElementById('xmpp-copy-settings');
    const includePassword = document.getElementById('xmpp-copy-password');
    select('connection-type', 'xmpp-server');
    assert.strictEqual(copyButton.disabled, true);
    assert.strictEqual(includePassword.disabled, true);

    state.listeners.get('onConnectionStatusChanged')('connected', '');
    assert.strictEqual(copyButton.disabled, false, 'the copy action survives read-only locking');
    assert.strictEqual(includePassword.disabled, false);
    assert.strictEqual(document.getElementById('xmpp-domain').disabled, true);

    state.listeners.get('onConnectionStatusChanged')('disconnected', '');
    assert.strictEqual(copyButton.disabled, true);
    assert.strictEqual(includePassword.disabled, true);
  });

  await uiTest('a failed connect opens the dialog, selects the section, and describes the error', async ({ document, select, type, state }) => {
    // Connect needs a loaded file before it can be selected at all.
    document.getElementById('select-file').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    select('connection-type', 'xmpp-server');
    type('xmpp-external-username', 'velocity-logger');
    type('xmpp-destination', 'feed@localhost');
    type('xmpp-tls-cert-path', '/not-a-real-path/server.pem');
    document.getElementById('connect').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(state.connects.length, 0, 'the connection is refused');
    assert.strictEqual(document.getElementById('protocol-settings-dialog').open, true);
    assert.strictEqual(document.getElementById('protocol-settings-tab-security').getAttribute('aria-selected'), 'true');
    assert.strictEqual(document.activeElement.id, 'xmpp-tls-key-path');
    const banner = document.getElementById('protocol-settings-alert');
    assert.strictEqual(banner.hidden, false);
    assert.match(banner.textContent, /needs both a certificate and its private key/);
    const control = document.getElementById('xmpp-tls-key-path');
    assert.strictEqual(control.getAttribute('aria-invalid'), 'true');
    assert.ok(control.getAttribute('aria-describedby').split(/\s+/).includes('protocol-settings-alert'));

    // A tooltip description is additive, so the validation message survives a
    // hover and the hover survives the validation message.
    control.setAttribute('aria-describedby', `${control.getAttribute('aria-describedby')} custom-tooltip`);
    type('xmpp-tls-key-path', '/not-a-real-path/server.key');
    assert.strictEqual(control.getAttribute('aria-invalid'), null);
    assert.strictEqual(control.getAttribute('aria-describedby'), 'custom-tooltip',
      'only the banner token is removed');
    assert.strictEqual(banner.hidden, true);
  });

  await uiTest('the empty-settings note describes the protocol, not the lock state', async ({ document, select, state }) => {
    const note = document.getElementById('protocol-settings-empty');
    select('connection-type', 'ws-server');
    assert.strictEqual(note.hidden, true);
    state.listeners.get('onConnectionStatusChanged')('connected', '');
    document.getElementById('protocol-settings-btn').click();
    assert.strictEqual(note.hidden, true, 'WebSocket has protocol settings even while connected');
    state.listeners.get('onConnectionStatusChanged')('disconnected', '');

    select('connection-type', 'udp-server');
    assert.strictEqual(note.hidden, false);
    assert.match(note.textContent, /^UDP has no protocol settings/);
  });

  await uiTest('the dialog heading and summary follow the protocol and mode', async ({ document, select, type }) => {
    const title = document.getElementById('protocol-settings-title');
    const subtitle = document.getElementById('protocol-settings-subtitle');
    select('connection-type', 'ws-client');
    type('ip-address', 'example.com');
    type('port', '9443');
    assert.strictEqual(title.textContent, 'WebSocket Client settings');
    assert.strictEqual(subtitle.textContent, 'Publishing to wss://example.com:9443/');
    select('connection-type', 'udp-server');
    assert.strictEqual(title.textContent, 'UDP Server settings');
    assert.strictEqual(subtitle.textContent, 'Listening on example.com:9443');
  });

  console.log(`\n${passed} passed`);
})();
