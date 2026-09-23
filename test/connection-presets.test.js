/**
 * Connection Preset Tests
 * Run with: node test/connection-presets.test.js
 *
 * Covers the shared Simulator/Logger preset contract, the renderer behavior
 * that applies a preset, the Custom and Custom (modified) states, the
 * progressive-disclosure layout, and the relaxed-testing behavior the presets
 * depend on (empty XMPP passwords and explicit certificate-verification
 * bypasses).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const presets = require('../src/connection-presets');

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

console.log('connection-presets.test.js');

// The cross-application contract shared with the ArcGIS Velocity Logger. The
// third column is the *Simulator* connection type: a label naming the Logger as
// the server selects a Simulator client, and the other way round.
const EXPECTED_PRESETS = [
  ['local-tcp-logger-server', 'Local TCP — Logger Server / Simulator Client', 'tcp-client'],
  ['local-tcp-simulator-server', 'Local TCP — Simulator Server / Logger Client', 'tcp-server'],
  ['local-udp-logger-server', 'Local UDP — Logger Server / Simulator Client', 'udp-client'],
  ['local-udp-simulator-server', 'Local UDP — Simulator Server / Logger Client', 'udp-server'],
  ['local-grpc-logger-server', 'Local gRPC — Logger Server / Simulator Client', 'grpc-client'],
  ['local-grpc-simulator-server', 'Local gRPC — Simulator Server / Logger Client', 'grpc-server'],
  ['local-http-logger-server', 'Local HTTP — Logger Server / Simulator Client', 'http-client'],
  ['local-http-simulator-server', 'Local HTTP — Simulator Server / Logger Client', 'http-server'],
  ['local-ws-logger-server', 'Local WebSocket — Logger Server / Simulator Client', 'ws-client'],
  ['local-ws-simulator-server', 'Local WebSocket — Simulator Server / Logger Client', 'ws-server'],
  ['local-xmpp-logger-server', 'Local XMPP — Logger Server / Simulator Client', 'xmpp-client'],
  ['local-xmpp-simulator-server', 'Local XMPP — Simulator Server / Logger Client', 'xmpp-server'],
];

const EXPECTED_PORTS = {
  tcp: 5565, udp: 5565, grpc: 5565, http: 8080, ws: 8080, xmpp: 5222,
};

test('exposes exactly the twelve shared preset ids and labels in order', () => {
  const listed = presets.listConnectionPresets();
  assert.strictEqual(listed.length, EXPECTED_PRESETS.length);
  listed.forEach((preset, index) => {
    assert.strictEqual(preset.id, EXPECTED_PRESETS[index][0]);
    assert.strictEqual(preset.label, EXPECTED_PRESETS[index][1]);
  });
  assert.strictEqual(presets.getConnectionPreset('not-a-preset'), null);
  assert.strictEqual(presets.getConnectionPreset(presets.CUSTOM_PRESET_ID), null);
  assert.strictEqual(presets.buildConnectionPresetValues(presets.CUSTOM_PRESET_ID), null);
});

test('groups presets by protocol for optgroup rendering', () => {
  const groups = presets.listConnectionPresetGroups();
  assert.deepStrictEqual(groups.map((group) => group.label), [
    'Local TCP', 'Local UDP', 'Local gRPC', 'Local HTTP', 'Local WebSocket', 'Local XMPP',
  ]);
  groups.forEach((group) => assert.strictEqual(group.presets.length, 2));
});

test('inverts the Logger role mapping for every protocol, host, and port', () => {
  EXPECTED_PRESETS.forEach(([id, , connectionType]) => {
    const preset = presets.getConnectionPreset(id);
    const values = presets.buildConnectionPresetValues(id);
    assert.strictEqual(values.connectionType, connectionType, id);
    assert.strictEqual(values.host, '127.0.0.1', id);
    assert.strictEqual(values.port, EXPECTED_PORTS[preset.protocol], id);
    // A label naming the Logger as the server must select a Simulator client.
    assert.strictEqual(
      connectionType.endsWith('-client'),
      preset.role === 'logger-server',
      `${id} must select a Simulator client only for the Logger Server label`,
    );
  });
});

test('gRPC presets use text serialization, streaming, and TLS off', () => {
  ['local-grpc-logger-server', 'local-grpc-simulator-server'].forEach((id) => {
    const values = presets.buildConnectionPresetValues(id);
    assert.strictEqual(values.grpcSerialization, 'text');
    assert.strictEqual(values.grpcSendMethod, 'stream');
    assert.strictEqual(values.grpcTls, false);
    assert.strictEqual(values.grpcAllowUnverifiedTls, false);
  });
});

test('HTTP and WebSocket presets use delimited payloads on path / with TLS off', () => {
  ['local-http-logger-server', 'local-http-simulator-server'].forEach((id) => {
    const values = presets.buildConnectionPresetValues(id);
    assert.strictEqual(values.httpFormat, 'delimited');
    assert.strictEqual(values.httpPath, '/');
    assert.strictEqual(values.httpTls, false);
    assert.strictEqual(values.httpAllowUnverifiedTls, false);
  });
  ['local-ws-logger-server', 'local-ws-simulator-server'].forEach((id) => {
    const values = presets.buildConnectionPresetValues(id);
    assert.strictEqual(values.wsFormat, 'delimited');
    assert.strictEqual(values.wsPath, '/');
    assert.strictEqual(values.wsTls, false);
    assert.strictEqual(values.wsSubscriptionMsg, '');
    assert.strictEqual(values.wsIgnoreFirstMsg, false);
    assert.strictEqual(values.wsAllowUnverifiedTls, false);
  });
});

test('XMPP presets pair the Simulator client and server accounts', () => {
  const client = presets.buildConnectionPresetValues('local-xmpp-logger-server');
  assert.strictEqual(client.connectionType, 'xmpp-client');
  assert.strictEqual(client.xmppDomain, 'localhost');
  assert.strictEqual(client.xmppConversation, 'direct');
  assert.strictEqual(client.xmppTlsPolicy, 'required');
  assert.strictEqual(client.xmppUsername, 'simulator');
  assert.strictEqual(client.xmppPassword, '');
  assert.strictEqual(client.xmppResource, 'velocity-simulator');
  assert.strictEqual(client.xmppDestination, 'velocity-logger@localhost');
  assert.strictEqual(client.xmppAllowUnverifiedTls, true);

  const server = presets.buildConnectionPresetValues('local-xmpp-simulator-server');
  assert.strictEqual(server.connectionType, 'xmpp-server');
  assert.strictEqual(server.xmppDomain, 'localhost');
  assert.strictEqual(server.xmppConversation, 'direct');
  assert.strictEqual(server.xmppTlsPolicy, 'required');
  assert.strictEqual(server.xmppExternalUsername, 'velocity-logger');
  assert.strictEqual(server.xmppExternalPassword, '');
  // An empty destination means every signed-in stream receives each line.
  assert.strictEqual(server.xmppDestination, '');
  assert.strictEqual(server.xmppAllowRemote, false);
  assert.strictEqual(server.xmppAllowUnverifiedTls, false);
});

test('the XMPP client preset is the only automatic verification bypass', () => {
  presets.listConnectionPresets().forEach((preset) => {
    const values = presets.buildConnectionPresetValues(preset.id);
    const bypasses = [
      values.grpcAllowUnverifiedTls,
      values.httpAllowUnverifiedTls,
      values.wsAllowUnverifiedTls,
      values.xmppAllowUnverifiedTls,
    ].filter((value) => value === true);
    if (preset.id === 'local-xmpp-logger-server') {
      assert.deepStrictEqual(bypasses, [true], preset.id);
    } else {
      assert.deepStrictEqual(bypasses, [], preset.id);
    }
  });
});

test('every preset writes the full field set so optional fields reset deterministically', () => {
  const fieldNames = Object.keys(presets.CONNECTION_PRESET_FIELD_DEFAULTS);
  presets.listConnectionPresets().forEach((preset) => {
    const values = presets.buildConnectionPresetValues(preset.id);
    assert.deepStrictEqual(Object.keys(values).sort(), fieldNames.slice().sort(), preset.id);
  });
  // Switching from a configured XMPP preset to TCP clears the XMPP account.
  const tcp = presets.buildConnectionPresetValues('local-tcp-logger-server');
  assert.strictEqual(tcp.xmppUsername, '');
  assert.strictEqual(tcp.xmppDestination, '');
  assert.strictEqual(tcp.xmppAllowUnverifiedTls, false);
  assert.strictEqual(tcp.wsSubscriptionMsg, '');
});

test('every preset field maps to a control that exists in index.html', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  Object.entries(presets.CONNECTION_PRESET_CONTROLS).forEach(([field, control]) => {
    assert.ok(html.includes(`id="${control.elementId}"`), `${field} -> #${control.elementId}`);
  });
});

test('describes the Custom, applied, and modified preset states', () => {
  const custom = presets.describeConnectionPreset(presets.CUSTOM_PRESET_ID);
  assert.match(custom, /Keeps the current connection fields/);
  assert.match(custom, /never connects, starts playback, selects a file, or saves a secret/);
  const applied = presets.describeConnectionPreset('local-xmpp-logger-server');
  assert.match(applied, /Local XMPP — Logger Server \/ Simulator Client/);
  const modified = presets.describeConnectionPreset(presets.CUSTOM_PRESET_ID, {
    modified: true,
    baseId: 'local-tcp-logger-server',
  });
  assert.match(modified, /Custom \(modified\)/);
  assert.match(modified, /Local TCP — Logger Server \/ Simulator Client/);
});

// ---------------------------------------------------------------------------
// Renderer behavior
// ---------------------------------------------------------------------------

const SRC = path.join(__dirname, '..', 'src');

function createApiStub(state) {
  const noop = () => {};
  const register = (channel) => (callback) => { state.listeners.set(channel, callback); };
  return {
    connect: async (payload) => { state.connects.push(payload); return state.connectResult || { success: true }; },
    disconnect: async () => ({ success: true }),
    sendData: noop,
    openFileDialog: async () => null,
    showErrorInDialog: noop,
    showContextMenu: noop,
    saveSplitterPosition: noop,
    saveTheme: noop,
    saveFontSettings: noop,
    toggleCompactView: noop,
    getFullViewDimensions: async () => ({ splitterPosition: '350px' }),
    getXmppClientSettings: async () => ({ success: false }),
    showCommandLineDialog: noop,
    openVelocityLogin: noop,
    onCliPresets: register('cli-presets'),
    onSetCompactView: register('set-compact-view'),
    onLogStatus: register('log-status'),
    onConnectionStatusChanged: register('connection-status'),
    onSetTheme: register('set-theme'),
    onSetFontSize: register('set-font-size'),
    onSetFontFamily: register('set-font-family'),
    onLoadFileOnStartup: register('load-file'),
    onLoadSavedTheme: register('saved-theme'),
    onLoadStatusAreaVisibility: register('status-visibility'),
    onFeedApplied: register('feed-applied'),
    onTokenRefreshed: register('token-refreshed'),
    onTokenError: register('token-error'),
    onTokenState: register('token-state'),
  };
}

/**
 * Wraps the stub so any additional `on*` / `get*` main-process channel the
 * renderer subscribes to resolves to a harmless no-op instead of throwing.
 */
function createApiProxy(state) {
  const stub = createApiStub(state);
  return new Proxy(stub, {
    get(target, property) {
      if (property in target) return target[property];
      if (typeof property !== 'string') return undefined;
      if (property.startsWith('on')) {
        return (callback) => { state.listeners.set(property, callback); };
      }
      return () => undefined;
    },
    has: () => true,
  });
}

async function withRenderer(run) {
  const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8')
    .replace(/<script[\s\S]*?<\/script>/g, '');
  const state = { listeners: new Map(), connects: [] };
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = () => ({
    matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  });
  window.localStorage.clear();
  window.api = createApiProxy(state);
  window.electronAPI = window.api;
  window.VelocityAuthUtils = {
    shouldSendVelocityTokenByDefault: () => false,
    describeVelocityAuthType: (value) => value || 'not specified',
  };
  window.eval(fs.readFileSync(path.join(SRC, 'connection-presets.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(SRC, 'connection-summary.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(SRC, 'renderer.js'), 'utf8'));
  await new Promise((resolve) => window.addEventListener('DOMContentLoaded', resolve, { once: true }));
  try {
    await run({ window, document: window.document, state });
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

/** Fills the file list so the Connect button is enabled in the test DOM. */
function enableConnect(document) {
  const connect = document.getElementById('connect');
  connect.disabled = false;
  return connect;
}

(async () => {
  await uiTest('preset dropdown offers Custom plus the twelve shared presets', async ({ document }) => {
    const select = document.getElementById('connection-preset');
    assert.ok(select, 'connection-preset must exist above the Mode dropdown');
    const values = [...select.querySelectorAll('option')].map((option) => option.value);
    assert.deepStrictEqual(values, ['custom', ...EXPECTED_PRESETS.map(([id]) => id)]);
    assert.strictEqual(select.value, 'custom', 'Custom is the startup default');
    [...select.querySelectorAll('option')].forEach((option) => {
      assert.ok(option.title && option.title.length > 20, `option ${option.value} needs a descriptive title`);
    });
    [...select.querySelectorAll('optgroup')].forEach((group) => {
      assert.ok(group.label, 'every optgroup needs a label');
    });
    assert.match(select.dataset.tooltip, /Keeps the current connection fields/);
    assert.ok(select.getAttribute('aria-label'));
    assert.strictEqual(document.getElementById('connection-preset-state').hidden, true);
  });

  await uiTest('applying every preset fills the mapped controls without connecting', async ({ document, window, state }) => {
    const select = document.getElementById('connection-preset');
    for (const [id] of EXPECTED_PRESETS) {
      select.value = id;
      select.dispatchEvent(new window.Event('change'));
      const values = presets.buildConnectionPresetValues(id);
      Object.entries(values).forEach(([field, expected]) => {
        const control = presets.CONNECTION_PRESET_CONTROLS[field];
        const element = document.getElementById(control.elementId);
        assert.ok(element, `${control.elementId} must exist`);
        if (control.kind === 'checked') {
          assert.strictEqual(element.checked, expected, `${id}: ${field}`);
        } else {
          assert.strictEqual(element.value, String(expected), `${id}: ${field}`);
        }
      });
      assert.strictEqual(select.value, id, `${id} must remain selected after applying`);
      assert.strictEqual(document.getElementById('connection-preset-state').hidden, true);
    }
    // A preset never connects, never plays, and never selects a file.
    assert.strictEqual(state.connects.length, 0);
    assert.strictEqual(document.getElementById('file-path').textContent, 'No file selected');
  });

  await uiTest('applying a preset fills the matching options and reports status without opening the dialog', async ({ document, window }) => {
    const select = document.getElementById('connection-preset');
    select.value = 'local-xmpp-logger-server';
    select.dispatchEvent(new window.Event('change'));
    // A preset only pre-fills; it never forces the modal open.
    assert.strictEqual(document.getElementById('protocol-settings-dialog').open, false);
    assert.notStrictEqual(document.getElementById('xmpp-username-group').style.display, 'none');
    const status = document.getElementById('status-messages').textContent;
    assert.match(status, /Preset applied: Local XMPP — Logger Server/);
    assert.match(status, /Fields were pre-filled only/);
    assert.match(select.dataset.tooltip, /Local XMPP — Logger Server/);

    select.value = 'local-grpc-simulator-server';
    select.dispatchEvent(new window.Event('change'));
    assert.strictEqual(document.getElementById('protocol-settings-dialog').open, false);
    assert.notStrictEqual(document.getElementById('grpc-serialization-group').style.display, 'none');
    assert.match(document.getElementById('protocol-settings-count').textContent, /^\d+$/);
  });

  await uiTest('editing a populated field switches the display to Custom (modified)', async ({ document, window }) => {
    const select = document.getElementById('connection-preset');
    select.value = 'local-tcp-logger-server';
    select.dispatchEvent(new window.Event('change'));
    assert.strictEqual(select.value, 'local-tcp-logger-server');

    const port = document.getElementById('port');
    port.value = '6000';
    port.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.strictEqual(select.value, 'custom');
    const stateBadge = document.getElementById('connection-preset-state');
    assert.strictEqual(stateBadge.hidden, false);
    assert.match(select.dataset.tooltip, /Custom \(modified\)/);
    assert.match(select.dataset.tooltip, /Local TCP — Logger Server/);
    assert.match(stateBadge.dataset.tooltip, /Local TCP — Logger Server/);
    assert.strictEqual(port.value, '6000', 'the edited value must be preserved');

    // Custom preserves the current values and clears the modified marker.
    select.value = 'custom';
    select.dispatchEvent(new window.Event('change'));
    assert.strictEqual(port.value, '6000');
    assert.strictEqual(stateBadge.hidden, true);
    assert.doesNotMatch(select.dataset.tooltip, /modified/);

    // Re-selecting the preset restores its values.
    select.value = 'local-tcp-logger-server';
    select.dispatchEvent(new window.Event('change'));
    assert.strictEqual(port.value, '5565');
  });

  await uiTest('protocol settings sections keep every advanced field addressable', async ({ document, window }) => {
    // Advanced controls stay in the DOM and keep their ids.
    ['grpc-tls-ca-path', 'http-tls-key-path', 'ws-headers', 'xmpp-tls-ca-path', 'xmpp-connect-timeout']
      .forEach((id) => assert.ok(document.getElementById(id), `${id} must be preserved`));
    // Each one lives inside a Protocol Settings section rather than an inline row.
    const dialog = document.getElementById('protocol-settings-dialog');
    ['ws-headers', 'xmpp-connect-timeout', 'http-tls-key-path'].forEach((id) => {
      assert.ok(dialog.contains(document.getElementById(id)), `${id} belongs in the dialog`);
    });

    // Essentials stay visible for the selected protocol, and the rail names the
    // sections that actually hold a control.
    const connectionType = document.getElementById('connection-type');
    connectionType.value = 'ws-client';
    connectionType.dispatchEvent(new window.Event('change'));
    assert.notStrictEqual(document.getElementById('ws-format-group').style.display, 'none');
    assert.notStrictEqual(document.getElementById('ws-path-group').style.display, 'none');
    const visibleTabs = () => [...document.querySelectorAll('#protocol-settings-tablist [role="tab"]')]
      .filter((tab) => !tab.hidden)
      .map((tab) => tab.dataset.section);
    assert.deepStrictEqual(visibleTabs(), ['basics', 'security', 'advanced', 'summary']);
    // gRPC server has no advanced option, so no Advanced tab is shown for it.
    connectionType.value = 'grpc-server';
    connectionType.dispatchEvent(new window.Event('change'));
    assert.deepStrictEqual(visibleTabs(), ['basics', 'security', 'summary']);
  });

  await uiTest('a preset that enables a verification bypass lands Protocol Settings on Security', async ({ document, window }) => {
    const select = document.getElementById('connection-preset');
    // The only preset that turns a bypass on must send the reviewer to the
    // section holding it, so a warning-level control is never enabled out of
    // sight.
    select.value = 'local-xmpp-logger-server';
    select.dispatchEvent(new window.Event('change'));
    assert.strictEqual(document.getElementById('xmpp-allow-unverified').checked, true);
    assert.match(document.getElementById('status-messages').textContent,
      /Certificate verification is turned off by this preset/);
    document.getElementById('protocol-settings-btn').click();
    assert.strictEqual(document.getElementById('protocol-settings-dialog').open, true);
    const selected = document.querySelector('#protocol-settings-tablist [aria-selected="true"]');
    assert.strictEqual(selected.dataset.section, 'security');
    document.getElementById('protocol-settings-done').click();

    // Applying a preset is deterministic: the next preset starts from Basics.
    select.value = 'local-xmpp-simulator-server';
    select.dispatchEvent(new window.Event('change'));
    assert.strictEqual(document.getElementById('xmpp-allow-unverified').checked, false);
    document.getElementById('protocol-settings-btn').click();
    assert.strictEqual(
      document.querySelector('#protocol-settings-tablist [aria-selected="true"]').dataset.section,
      'basics',
    );
  });

  await uiTest('validation opens the dialog on the right section and focuses the control', async ({ document, window, state }) => {
    const connectionType = document.getElementById('connection-type');
    connectionType.value = 'xmpp-server';
    connectionType.dispatchEvent(new window.Event('change'));
    document.getElementById('xmpp-external-username').value = 'velocity-logger';
    // A certificate without its key is invalid, and both live under Security.
    document.getElementById('xmpp-tls-cert-path').value = './server.pem';
    assert.strictEqual(document.getElementById('protocol-settings-dialog').open, false);

    enableConnect(document).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(state.connects.length, 0, 'an invalid pair must not connect');
    assert.strictEqual(document.getElementById('protocol-settings-dialog').open, true);
    assert.strictEqual(
      document.querySelector('#protocol-settings-tablist [aria-selected="true"]').dataset.section,
      'security',
    );
    assert.strictEqual(document.activeElement.id, 'xmpp-tls-key-path');
    assert.strictEqual(document.getElementById('xmpp-tls-key-path').getAttribute('aria-invalid'), 'true');
    const alert = document.getElementById('protocol-settings-alert');
    assert.strictEqual(alert.hidden, false);
    assert.match(alert.textContent, /certificate and its private key/);
    assert.ok(document.getElementById('xmpp-tls-key-path').getAttribute('aria-describedby').split(/\s+/).includes(alert.id));
    // The status log keeps its record of the same failure.
    assert.match(document.getElementById('status-messages').textContent, /certificate and its private key/);
  });

  await uiTest('an empty XMPP password still connects while a missing username does not', async ({ document, window, state }) => {
    const select = document.getElementById('connection-preset');
    select.value = 'local-xmpp-logger-server';
    select.dispatchEvent(new window.Event('change'));
    assert.strictEqual(document.getElementById('xmpp-password').value, '');

    enableConnect(document).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const connect = state.connects[state.connects.length - 1];
    assert.ok(connect, 'an empty password must not block the connection');
    assert.strictEqual(connect.xmppPassword, '');
    assert.strictEqual(connect.xmppUsername, 'simulator');
    assert.strictEqual(connect.xmppDestination, 'velocity-logger@localhost');
    assert.strictEqual(connect.xmppAllowUnverifiedTls, true);

    document.getElementById('xmpp-username').value = '';
    const before = state.connects.length;
    enableConnect(document).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(state.connects.length, before, 'a missing username must block the connection');
  });

  await uiTest('the XMPP server preset connects with an empty external password', async ({ document, window, state }) => {
    const select = document.getElementById('connection-preset');
    select.value = 'local-xmpp-simulator-server';
    select.dispatchEvent(new window.Event('change'));
    assert.strictEqual(document.getElementById('xmpp-external-password').value, '');

    enableConnect(document).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const connect = state.connects[state.connects.length - 1];
    assert.ok(connect);
    assert.strictEqual(connect.xmppExternalPassword, '');
    assert.strictEqual(connect.xmppExternalUsername, 'velocity-logger');
    assert.strictEqual(connect.mode, 'server');
    // An empty destination publishes to every signed-in stream.
    assert.strictEqual(connect.xmppDestination, undefined);
  });

  await uiTest('remote hosts accept the explicit XMPP verification bypass', async ({ document, window, state }) => {
    const connectionType = document.getElementById('connection-type');
    connectionType.value = 'xmpp-client';
    connectionType.dispatchEvent(new window.Event('change'));
    document.getElementById('ip-address').value = '10.1.2.3';
    document.getElementById('xmpp-username').value = 'simulator';
    document.getElementById('xmpp-destination').value = 'feed@example.com';
    document.getElementById('xmpp-allow-unverified').checked = true;

    enableConnect(document).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const connect = state.connects[state.connects.length - 1];
    assert.ok(connect, 'a remote host must not block the explicit opt-in');
    assert.strictEqual(connect.xmppAllowUnverifiedTls, true);
    assert.strictEqual(connect.ip, '10.1.2.3');
  });

  await uiTest('explicit unverified TLS controls appear for TLS client modes only', async ({ document, window, state }) => {
    const connectionType = document.getElementById('connection-type');
    const cases = [
      ['grpc', 'grpc-tls', 'grpc-allow-unverified-group', 'grpc-allow-unverified'],
      ['http', 'http-tls', 'http-allow-unverified-group', 'http-allow-unverified'],
      ['ws', 'ws-tls', 'ws-allow-unverified-group', 'ws-allow-unverified'],
    ];
    cases.forEach(([protocol, tlsId, groupId, checkboxId]) => {
      const group = document.getElementById(groupId);
      const checkbox = document.getElementById(checkboxId);
      const label = group.querySelector('label');
      assert.strictEqual(checkbox.checked, false, `${checkboxId} defaults to false`);
      assert.match(label.dataset.tooltip, /Warning/);
      assert.strictEqual(label.dataset.tooltipKind, 'warning');
      assert.ok(label.classList.contains('unverified-tls-check'));
      assert.ok(checkbox.getAttribute('aria-label'));

      connectionType.value = `${protocol}-server`;
      connectionType.dispatchEvent(new window.Event('change'));
      assert.strictEqual(group.style.display, 'none', `${groupId} hidden in server mode`);

      connectionType.value = `${protocol}-client`;
      document.getElementById(tlsId).checked = true;
      connectionType.dispatchEvent(new window.Event('change'));
      assert.strictEqual(group.style.display, '', `${groupId} shown for a TLS client`);

      const tls = document.getElementById(tlsId);
      tls.checked = false;
      tls.dispatchEvent(new window.Event('change'));
      assert.strictEqual(group.style.display, 'none', `${groupId} hidden when TLS is off`);
    });

    // The flag reaches the transport for a TLS client connection.
    connectionType.value = 'grpc-client';
    document.getElementById('grpc-tls').checked = true;
    connectionType.dispatchEvent(new window.Event('change'));
    document.getElementById('grpc-allow-unverified').checked = true;
    enableConnect(document).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const connect = state.connects[state.connects.length - 1];
    assert.strictEqual(connect.allowUnverifiedTls, true);
    assert.strictEqual(connect.httpAllowUnverifiedTls, false);
    assert.strictEqual(connect.wsAllowUnverifiedTls, false);
  });

  await uiTest('a server-mode connection never sends an unverified-TLS opt-in', async ({ document, window, state }) => {
    const connectionType = document.getElementById('connection-type');
    connectionType.value = 'grpc-server';
    connectionType.dispatchEvent(new window.Event('change'));
    document.getElementById('grpc-allow-unverified').checked = true;
    enableConnect(document).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const connect = state.connects[state.connects.length - 1];
    assert.strictEqual(connect.mode, 'server');
    assert.strictEqual(connect.allowUnverifiedTls, false);
  });

  await uiTest('TCP and UDP payload settings reach Connect without changing the default', async ({ document, window, state }) => {
    const connectionType = document.getElementById('connection-type');
    connectionType.value = 'tcp-client';
    connectionType.dispatchEvent(new window.Event('change'));
    document.getElementById('tcp-format').value = 'geo-json';
    document.getElementById('tcp-input-has-header').checked = true;
    document.getElementById('tcp-x-field').value = 'longitude';
    document.getElementById('tcp-y-field').value = 'latitude';
    document.getElementById('tcp-wkid').value = '4326';
    enableConnect(document).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const tcp = state.connects[state.connects.length - 1];
    assert.strictEqual(tcp.tcpFormat, 'geo-json');
    assert.strictEqual(tcp.tcpInputHasHeader, true);
    assert.strictEqual(tcp.tcpXField, 'longitude');
    assert.strictEqual(tcp.tcpYField, 'latitude');
    assert.strictEqual(tcp.tcpWkid, 4326);
    assert.strictEqual(tcp.udpFormat, 'delimited');
    assert.strictEqual(tcp.udpAppendNewline, false);
  });

  await uiTest('UDP LF framing reaches Connect from CLI prepopulation', async ({ document, state }) => {
    state.listeners.get('cli-presets')({ protocol: 'udp', mode: 'client', ip: '127.0.0.1', port: 17009, udpAppendNewline: true });
    assert.strictEqual(document.getElementById('udp-append-newline').checked, true);
    enableConnect(document).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(state.connects.at(-1).udpAppendNewline, true);
  });

  await uiTest('Address family stays in Basics, updates tooltip, and never rewrites Host', async ({ document, window, state }) => {
    for (const protocol of ['tcp', 'udp']) {
      const control = document.getElementById(`${protocol}-address-family`);
      assert.strictEqual(control.closest('[data-section]').dataset.section, 'basics');
      document.getElementById('ip-address').value = '127.0.0.1';
      control.value = 'ipv6';
      control.dispatchEvent(new window.Event('change'));
      assert.strictEqual(document.getElementById('ip-address').value, '127.0.0.1');
      assert.strictEqual(control.dataset.tooltip, control.selectedOptions[0].title);
    }
    state.listeners.get('cli-presets')({ protocol: 'udp', mode: 'client', ip: '::1', port: 5565, tcpAddressFamily: 'ipv6', udpAddressFamily: 'ipv6' });
    enableConnect(document).click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(state.connects.at(-1).udpAddressFamily, 'ipv6');
    assert.strictEqual(state.connects.at(-1).tcpAddressFamily, 'ipv6');
    assert.strictEqual(state.connects.at(-1).ip, '::1');
  });

  await uiTest('Socket family errors open the existing Basics validation surface', async ({ document, window, state }) => {
    document.getElementById('connection-type').value = 'udp-client';
    document.getElementById('connection-type').dispatchEvent(new window.Event('change'));
    state.connectResult = { success: false, error: 'UDP host ::1 does not match the selected IPv4 address family.' };
    enableConnect(document).click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(document.getElementById('protocol-settings-dialog').open, true);
    assert.strictEqual(document.getElementById('udp-address-family').getAttribute('aria-invalid'), 'true');
    assert.match(document.getElementById('protocol-settings-alert').textContent, /does not match/);
  });

  await uiTest('Host tooltip follows socket role and family without changing other protocols', async ({ document, window }) => {
    const type = document.getElementById('connection-type');
    const host = document.getElementById('ip-address');
    const label = document.querySelector('label[for="ip-address"]');
    for (const protocol of ['tcp', 'udp']) {
      const guide = fs.readFileSync(path.join(__dirname, `../docs/${protocol}.md`), 'utf8');
      type.value = `${protocol}-server`;
      type.dispatchEvent(new window.Event('change'));
      const family = document.getElementById(`${protocol}-address-family`);
      for (const value of protocol === 'tcp' ? ['auto', 'ipv4', 'ipv6'] : ['ipv4', 'ipv6']) {
        family.value = value;
        family.dispatchEvent(new window.Event('change'));
        assert.strictEqual(host.dataset.tooltip, label.dataset.tooltip);
        assert.match(host.dataset.tooltip, /firewall rules still apply/);
        assert.match(host.dataset.tooltip, value === 'ipv6' ? /Use :: to listen on all local IPv6/ : /0\.0\.0\.0/);
        assert(guide.includes(host.dataset.tooltip), 'The owning guide must retain exact dynamic text');
        assert.strictEqual(host.getAttribute('aria-label'), host.dataset.tooltip);
      }
      type.value = `${protocol}-client`;
      type.dispatchEvent(new window.Event('change'));
      assert.match(host.dataset.tooltip, /reachable peer/);
      assert.match(host.dataset.tooltip, /Do not use 0\.0\.0\.0 or ::/);
      assert(guide.includes(host.dataset.tooltip));
    }
    type.value = 'http-server';
    type.dispatchEvent(new window.Event('change'));
    assert.doesNotMatch(host.dataset.tooltip || '', /Local bind address|Destination address/);
    assert.doesNotMatch(label.dataset.tooltip || '', /Local bind address|Destination address/);
    assert.strictEqual(host.value, '127.0.0.1');
  });

  await uiTest('CLI prepopulation fills fields without marking the preset modified', async ({ document, state }) => {
    state.listeners.get('cli-presets')({
      protocol: 'ws', mode: 'client', ip: '127.0.0.1', port: 8443,
      wsTls: true, wsAllowUnverifiedTls: true,
    });
    assert.strictEqual(document.getElementById('ws-allow-unverified').checked, true);
    assert.strictEqual(document.getElementById('connection-preset').value, 'custom');
    assert.strictEqual(document.getElementById('connection-preset-state').hidden, true);
  });

  console.log(`\n${passed} passed`);
})();
