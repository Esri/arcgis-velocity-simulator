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
    connect: async (payload) => { state.connects.push(payload); return { success: true }; },
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

  await uiTest('applying a preset opens the matching options area and reports status', async ({ document, window }) => {
    const select = document.getElementById('connection-preset');
    select.value = 'local-xmpp-logger-server';
    select.dispatchEvent(new window.Event('change'));
    assert.strictEqual(document.getElementById('extra-options-body').style.display, '');
    assert.notStrictEqual(document.getElementById('xmpp-username-group').style.display, 'none');
    const status = document.getElementById('status-messages').textContent;
    assert.match(status, /Preset applied: Local XMPP — Logger Server/);
    assert.match(status, /Fields were pre-filled only/);
    assert.match(select.dataset.tooltip, /Local XMPP — Logger Server/);

    select.value = 'local-grpc-simulator-server';
    select.dispatchEvent(new window.Event('change'));
    assert.strictEqual(document.getElementById('extra-options-body').style.display, '');
    assert.notStrictEqual(document.getElementById('grpc-serialization-group').style.display, 'none');
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

  await uiTest('progressive disclosure keeps advanced fields available but collapsed', async ({ document, window }) => {
    ['grpc-advanced', 'http-advanced', 'ws-advanced', 'xmpp-advanced'].forEach((id) => {
      const details = document.getElementById(id);
      assert.ok(details, `${id} must exist`);
      assert.strictEqual(details.tagName, 'DETAILS');
      assert.strictEqual(details.open, false, `${id} starts collapsed`);
      const summary = details.querySelector('summary');
      assert.ok(summary.dataset.tooltip, `${id} summary needs a tooltip`);
      assert.ok(summary.getAttribute('aria-label'), `${id} summary needs an aria-label`);
    });
    // Advanced controls stay in the DOM and keep their ids.
    ['grpc-tls-ca-path', 'http-tls-key-path', 'ws-headers', 'xmpp-tls-ca-path', 'xmpp-connect-timeout']
      .forEach((id) => assert.ok(document.getElementById(id), `${id} must be preserved`));

    // Essentials stay visible for the selected protocol; advanced stays closed.
    const connectionType = document.getElementById('connection-type');
    connectionType.value = 'ws-client';
    connectionType.dispatchEvent(new window.Event('change'));
    assert.notStrictEqual(document.getElementById('ws-format-group').style.display, 'none');
    assert.notStrictEqual(document.getElementById('ws-path-group').style.display, 'none');
    assert.strictEqual(document.getElementById('ws-advanced').open, false);
    assert.notStrictEqual(document.getElementById('ws-advanced').style.display, 'none');
    // A disclosure for another protocol is hidden entirely.
    assert.strictEqual(document.getElementById('xmpp-advanced').style.display, 'none');
  });

  await uiTest('a preset that enables a verification bypass reveals the control', async ({ document, window }) => {
    const select = document.getElementById('connection-preset');
    // The only preset that turns a bypass on must open the disclosure holding it,
    // so a warning-level control is never enabled out of sight.
    select.value = 'local-xmpp-logger-server';
    select.dispatchEvent(new window.Event('change'));
    assert.strictEqual(document.getElementById('xmpp-allow-unverified').checked, true);
    assert.strictEqual(document.getElementById('xmpp-advanced').open, true);

    // Applying a preset is deterministic: disclosures collapse again unless the
    // new preset needs one open.
    select.value = 'local-xmpp-simulator-server';
    select.dispatchEvent(new window.Event('change'));
    assert.strictEqual(document.getElementById('xmpp-allow-unverified').checked, false);
    assert.strictEqual(document.getElementById('xmpp-advanced').open, false);

    select.value = 'local-grpc-logger-server';
    select.dispatchEvent(new window.Event('change'));
    assert.strictEqual(document.getElementById('grpc-advanced').open, false);
  });

  await uiTest('validation reveals and focuses a control hidden behind Advanced', async ({ document, window, state }) => {
    const connectionType = document.getElementById('connection-type');
    connectionType.value = 'xmpp-server';
    connectionType.dispatchEvent(new window.Event('change'));
    document.getElementById('xmpp-external-username').value = 'velocity-logger';
    // A certificate without its key is invalid, and both live under Advanced.
    document.getElementById('xmpp-tls-cert-path').value = './server.pem';
    document.getElementById('xmpp-advanced').open = false;

    enableConnect(document).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(state.connects.length, 0, 'an invalid pair must not connect');
    assert.strictEqual(document.getElementById('xmpp-advanced').open, true);
    assert.strictEqual(document.activeElement.id, 'xmpp-tls-key-path');
    assert.strictEqual(document.getElementById('extra-options-body').style.display, '');
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
