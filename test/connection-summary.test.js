/**
 * Connection summary unit tests
 * Run with: node test/connection-summary.test.js
 *
 * The summary generator is pure: it turns connection field values into the
 * rows shown by the warning alert and the read-only Summary section of the
 * Protocol Settings dialog.
 */

const assert = require('assert');
const summaryApi = require('../src/connection-summary');

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

console.log('connection-summary.test.js');

const {
  buildConnectionSummary,
  formatConnectionSummaryText,
  countConfiguredProtocolSettings,
  formatConnectionWarningLine,
  describeSecret,
  buildConnectionUrl,
  normalizePath,
  splitConnectionType,
  CONNECTION_TYPES,
} = summaryApi;

const BASE = { host: '127.0.0.1', port: 5565 };

function rowsByKey(summary) {
  return summary.rows.reduce((map, row) => {
    map[row.key] = row;
    return map;
  }, {});
}

test('covers all twelve connection modes with a title, endpoint, and status', () => {
  assert.strictEqual(CONNECTION_TYPES.length, 12);
  CONNECTION_TYPES.forEach((connectionType) => {
    const summary = buildConnectionSummary({ ...BASE, connectionType });
    const rows = rowsByKey(summary);
    assert.strictEqual(summary.connectionType, connectionType);
    assert.ok(summary.title.endsWith(' settings'), `${connectionType} title`);
    assert.ok(rows.connection && rows.endpoint && rows.status && rows.preset, `${connectionType} core rows`);
    assert.strictEqual(rows.status.value, 'Disconnected');
    assert.match(summary.headline, summary.mode === 'server' ? /^Listening on / : /^Publishing to /);
    assert.ok(summary.rows.length >= 4, `${connectionType} must report rows`);
  });
});

test('uses send-oriented role wording for server and client modes', () => {
  const server = buildConnectionSummary({ ...BASE, connectionType: 'tcp-server' });
  const client = buildConnectionSummary({ ...BASE, connectionType: 'tcp-client' });
  assert.strictEqual(server.headline, 'Listening on 127.0.0.1:5565');
  assert.strictEqual(client.headline, 'Publishing to 127.0.0.1:5565');
  assert.strictEqual(rowsByKey(server).endpoint.label, 'Listening on');
  assert.strictEqual(rowsByKey(client).endpoint.label, 'Publishing to');
});

test('composes HTTP and WebSocket URLs from TLS, host, port, and path', () => {
  assert.strictEqual(
    buildConnectionUrl({ connectionType: 'http-server', host: '127.0.0.1', port: 8443, httpTls: true, httpPath: '/' }),
    'https://127.0.0.1:8443/',
  );
  assert.strictEqual(
    buildConnectionUrl({ connectionType: 'http-client', host: 'example.com', port: 8080, httpTls: false, httpPath: 'receiver/feed' }),
    'http://example.com:8080/receiver/feed',
  );
  assert.strictEqual(
    buildConnectionUrl({ connectionType: 'ws-client', host: '::1', port: 8443, wsTls: true, wsPath: '/stream' }),
    'wss://[::1]:8443/stream',
  );
  assert.strictEqual(
    buildConnectionUrl({ connectionType: 'ws-server', host: '127.0.0.1', port: 8080, wsTls: false }),
    'ws://127.0.0.1:8080/',
  );
  assert.strictEqual(
    buildConnectionUrl({ connectionType: 'grpc-client', host: '127.0.0.1', port: 5565 }),
    '127.0.0.1:5565',
  );
  assert.strictEqual(normalizePath(''), '/');
  assert.strictEqual(normalizePath('feed'), '/feed');
  assert.strictEqual(normalizePath('/feed'), '/feed');
});

test('reports missing endpoint parts instead of inventing them', () => {
  const summary = buildConnectionSummary({ connectionType: 'tcp-server', host: '', port: '' });
  assert.strictEqual(rowsByKey(summary).endpoint.value, 'Not set:Not set');
});

test('never exposes a secret value', () => {
  assert.strictEqual(describeSecret('hunter2'), 'Set (hidden)');
  assert.strictEqual(describeSecret(''), 'Empty');
  assert.strictEqual(describeSecret('', { optional: true }), 'Not set');
  assert.strictEqual(describeSecret(undefined), 'Not set');
  assert.strictEqual(describeSecret(null), 'Not set');

  const summary = buildConnectionSummary({
    ...BASE,
    connectionType: 'xmpp-client',
    port: 5222,
    xmppUsername: 'velocity-simulator',
    xmppPassword: 'super-secret-value',
    xmppConversation: 'muc',
    xmppRoom: 'events@conference.example.com',
    xmppRoomPassword: '',
  });
  const rows = rowsByKey(summary);
  assert.strictEqual(rows.xmppPassword.value, 'Set (hidden)');
  assert.strictEqual(rows.xmppPassword.secret, true);
  assert.strictEqual(rows.xmppRoomPassword.value, 'Not set');
  const text = formatConnectionSummaryText(summary);
  assert.doesNotMatch(text, /super-secret-value/);
  assert.match(text, /Password: Set \(hidden\)/);
});

test('credential-bearing WebSocket fields report presence only', () => {
  const summary = buildConnectionSummary({
    ...BASE,
    connectionType: 'ws-client',
    port: 8443,
    wsSubscriptionMsg: '{"token":"do-not-print-me"}',
    wsHeaders: '{"Authorization":"do-not-print-me"}',
  });
  const rows = rowsByKey(summary);
  assert.strictEqual(rows.wsHeaders.value, 'Set (hidden)');
  assert.strictEqual(rows.wsHeaders.secret, true);
  assert.strictEqual(rows.wsSubscriptionMessage.value, 'Set (hidden)');
  assert.strictEqual(rows.wsSubscriptionMessage.secret, true);
  assert.doesNotMatch(formatConnectionSummaryText(summary), /do-not-print-me/);
});

test('an empty XMPP account password is reported as Empty, not as unset', () => {
  const summary = buildConnectionSummary({
    ...BASE, port: 5222, connectionType: 'xmpp-client', xmppUsername: 'velocity-simulator', xmppPassword: '',
  });
  assert.strictEqual(rowsByKey(summary).xmppPassword.value, 'Empty');
  const server = buildConnectionSummary({
    ...BASE, port: 5222, connectionType: 'xmpp-server', xmppExternalUsername: 'simulator', xmppExternalPassword: '',
  });
  assert.strictEqual(rowsByKey(server).xmppExternalPassword.value, 'Empty');
});

test('warnings come first, and the certificate bypass leads them', () => {
  const summary = buildConnectionSummary({
    ...BASE,
    connectionType: 'http-client',
    port: 8443,
    httpTls: true,
    httpAllowUnverifiedTls: true,
  });
  assert.strictEqual(summary.warnings.length, 1);
  assert.strictEqual(summary.rows[0].key, 'unverifiedCertificate');
  assert.strictEqual(summary.rows[0].kind, 'warning');
  assert.match(summary.rows[0].value, /Off for every host/);
  assert.strictEqual(summary.primaryRows.length, 3);
  assert.strictEqual(summary.primaryRows[0].key, 'unverifiedCertificate');
  assert.strictEqual(rowsByKey(summary).certificateVerification.severity, 'warning');
});

test('plaintext, opportunistic STARTTLS, and remote binding raise warnings', () => {
  const plain = buildConnectionSummary({ ...BASE, connectionType: 'ws-server', port: 8080, wsTls: false });
  assert.deepStrictEqual(plain.warnings.map((row) => row.key), ['unsecureTransport']);
  assert.match(plain.warnings[0].value, /plaintext/);

  const opportunistic = buildConnectionSummary({
    ...BASE, connectionType: 'xmpp-client', port: 5222, xmppTlsPolicy: 'preferred',
  });
  assert.deepStrictEqual(opportunistic.warnings.map((row) => row.key), ['opportunisticTls']);

  const remote = buildConnectionSummary({
    ...BASE, connectionType: 'xmpp-server', port: 5222, xmppAllowRemote: true,
  });
  assert.deepStrictEqual(remote.warnings.map((row) => row.key), ['remoteBind']);

  const clean = buildConnectionSummary({ ...BASE, connectionType: 'http-server', port: 8443, httpTls: true });
  assert.deepStrictEqual(clean.warnings, []);
  assert.strictEqual(clean.rows[0].key, 'connection');
});

test('TCP and UDP report that encryption is unavailable without a warning', () => {
  ['tcp-server', 'udp-client'].forEach((connectionType) => {
    const summary = buildConnectionSummary({ ...BASE, connectionType });
    assert.deepStrictEqual(summary.warnings, []);
    assert.match(rowsByKey(summary).tls.value, /Not available for (TCP|UDP)/);
  });
});

test('certificate verification is reported for every mode whenever TLS applies', () => {
  const osTrust = buildConnectionSummary({ ...BASE, connectionType: 'grpc-client', grpcTls: true });
  assert.strictEqual(rowsByKey(osTrust).certificateVerification.value, 'On (operating system trust store)');
  const customCa = buildConnectionSummary({
    ...BASE, connectionType: 'grpc-client', grpcTls: true, grpcTlsCaPath: '/certs/ca.pem',
  });
  assert.strictEqual(rowsByKey(customCa).certificateVerification.value, 'On (custom CA)');
  assert.strictEqual(rowsByKey(customCa).certificateAuthority.value, '/certs/ca.pem');
  const bypassed = buildConnectionSummary({
    ...BASE, connectionType: 'grpc-client', grpcTls: true, grpcAllowUnverifiedTls: true,
  });
  assert.strictEqual(rowsByKey(bypassed).certificateVerification.value, 'Off — any certificate accepted');
  // A server does not verify its clients, and says so rather than staying
  // silent about verification.
  const server = buildConnectionSummary({ ...BASE, connectionType: 'grpc-server', grpcTls: true });
  assert.strictEqual(
    rowsByKey(server).certificateVerification.value,
    'Not performed — this server does not verify client certificates',
  );
  // With encryption off there is nothing to verify, so no row is offered.
  const plaintext = buildConnectionSummary({ ...BASE, connectionType: 'grpc-client', grpcTls: false });
  assert.strictEqual(rowsByKey(plaintext).certificateVerification, undefined);
});

test('an XMPP server without certificate paths reports the automatic self-signed pair', () => {
  const summary = buildConnectionSummary({ ...BASE, connectionType: 'xmpp-server', port: 5222 });
  const rows = rowsByKey(summary);
  assert.strictEqual(rows.certificate.value, 'Automatic self-signed certificate');
  assert.strictEqual(rows.certificateKey.value, 'Automatic self-signed key');
  assert.strictEqual(rows.tls.value, 'Required STARTTLS');
});

test('protocol rows describe formats, paths, serialization, and timings', () => {
  const http = rowsByKey(buildConnectionSummary({
    ...BASE, connectionType: 'http-server', port: 8443, httpFormat: 'geo-json', httpPath: '/feed',
  }));
  assert.strictEqual(http.format.value, 'GeoJSON');
  assert.strictEqual(http.path.value, '/feed');

  const ws = rowsByKey(buildConnectionSummary({
    ...BASE, connectionType: 'ws-client', port: 8080, wsSubscriptionMsg: 'subscribe', wsIgnoreFirstMsg: true,
  }));
  assert.strictEqual(ws.wsSubscriptionMessage.value, 'Set (hidden)');
  assert.strictEqual(ws.wsSkipFirstMessage.value, 'On');
  assert.strictEqual(ws.wsHeaders.value, 'Not set');

  const tcp = rowsByKey(buildConnectionSummary({
    ...BASE,
    connectionType: 'tcp-client',
    tcpFormat: 'esri-json',
    tcpInputHasHeader: true,
    tcpXField: 'longitude',
    tcpYField: 'latitude',
    tcpWkid: 4326,
  }));
  assert.strictEqual(tcp.format.value, 'Esri JSON');
  assert.strictEqual(tcp.csvHeader.value, 'On');
  assert.strictEqual(tcp.pointFields.value, 'longitude / latitude');

  const udp = buildConnectionSummary({
    ...BASE,
    connectionType: 'udp-client',
    udpFormat: 'geo-json',
    udpXField: 'longitude',
    udpWkid: 3857,
  });
  assert.ok(udp.warnings.some(row => row.key === 'pointFieldMapping'));
  assert.ok(udp.warnings.some(row => row.key === 'geoJsonWkid'));

  const grpc = rowsByKey(buildConnectionSummary({
    ...BASE, connectionType: 'grpc-client', grpcSerialization: 'text', grpcSendMethod: 'unary',
    grpcHeaderPathKey: 'grpc-path', grpcHeaderPath: 'feed.uid',
  }));
  assert.strictEqual(grpc.grpcSerialization.value, 'Text');
  assert.strictEqual(grpc.grpcRpcType.value, 'Unary');
  assert.strictEqual(grpc.grpcEndpointHeader.value, 'grpc-path=feed.uid');

  const xmpp = rowsByKey(buildConnectionSummary({
    ...BASE, connectionType: 'xmpp-client', port: 5222, xmppConnectTimeoutMs: 30000, xmppReplyTimeoutMs: 15000,
    xmppPingIntervalMs: 60000, xmppReconnectDelayMs: 60000,
  }));
  assert.strictEqual(xmpp.xmppTiming.value, 'connect 30000 ms, reply 15000 ms, ping 60000 ms, reconnect 60000 ms');
});

test('the Simulator reports the destinations it publishes to', () => {
  const client = rowsByKey(buildConnectionSummary({
    ...BASE, connectionType: 'xmpp-client', port: 5222, xmppDestination: 'feed@localhost',
  }));
  assert.strictEqual(client.xmppDestination.label, 'Destination');
  assert.strictEqual(client.xmppDestination.value, 'feed@localhost');

  // A client without a destination has nothing to publish to; a server falls
  // back to every account that has signed in.
  const clientUnset = rowsByKey(buildConnectionSummary({ ...BASE, connectionType: 'xmpp-client', port: 5222 }));
  assert.strictEqual(clientUnset.xmppDestination.value, 'Not set');
  const serverUnset = rowsByKey(buildConnectionSummary({ ...BASE, connectionType: 'xmpp-server', port: 5222 }));
  assert.strictEqual(serverUnset.xmppDestination.value, 'Every signed-in account');

  // A room conversation addresses the room, so the destination row gives way
  // to the room rows.
  const muc = rowsByKey(buildConnectionSummary({
    ...BASE, connectionType: 'xmpp-client', port: 5222, xmppConversation: 'muc', xmppRoom: 'traffic',
  }));
  assert.strictEqual(muc.xmppDestination, undefined);
  assert.strictEqual(muc.xmppRoom.value, 'traffic');
});

test('preset state is reported as Custom, an applied preset, or modified', () => {
  const custom = buildConnectionSummary({ ...BASE, connectionType: 'tcp-server' });
  assert.strictEqual(rowsByKey(custom).preset.value, 'Custom');
  const applied = buildConnectionSummary({
    ...BASE,
    connectionType: 'tcp-server',
    preset: { id: 'local-tcp-logger-server', label: 'Local TCP — Logger Server / Simulator Client' },
  });
  assert.strictEqual(rowsByKey(applied).preset.value, 'Local TCP — Logger Server / Simulator Client');
  const modified = buildConnectionSummary({
    ...BASE,
    connectionType: 'tcp-server',
    preset: { id: 'custom', modified: true, baseLabel: 'Local TCP — Logger Server / Simulator Client' },
  });
  assert.strictEqual(
    rowsByKey(modified).preset.value,
    'Custom (modified from Local TCP — Logger Server / Simulator Client)',
  );
});

test('the connection state is echoed for every lifecycle value', () => {
  ['disconnected', 'connecting', 'connected', 'disconnecting', 'error'].forEach((connectionState) => {
    const summary = buildConnectionSummary({ ...BASE, connectionType: 'tcp-server', connectionState });
    assert.strictEqual(summary.connectionState, connectionState);
    assert.strictEqual(rowsByKey(summary).status.value, summary.connectionStateLabel);
  });
  const unknown = buildConnectionSummary({ ...BASE, connectionType: 'tcp-server', connectionState: 'nonsense' });
  assert.strictEqual(unknown.connectionState, 'disconnected');
});

test('the chip counts only protocol settings that differ from their defaults', () => {
  const tcp = countConfiguredProtocolSettings({ connectionType: 'tcp-server' });
  assert.strictEqual(tcp.hasSettings, true);
  assert.strictEqual(tcp.count, 0);
  assert.strictEqual(tcp.shortLabel, '');
  assert.strictEqual(tcp.label, 'TCP · defaults');

  const httpDefaults = countConfiguredProtocolSettings({
    connectionType: 'http-server', httpFormat: 'delimited', httpTls: true, httpPath: '/',
  });
  assert.strictEqual(httpDefaults.count, 0);
  assert.strictEqual(httpDefaults.shortLabel, '');
  assert.strictEqual(httpDefaults.label, 'HTTP · defaults');

  const httpChanged = countConfiguredProtocolSettings({
    connectionType: 'http-server', httpFormat: 'json', httpTls: false, httpPath: '/feed',
  });
  assert.strictEqual(httpChanged.count, 3);
  assert.strictEqual(httpChanged.shortLabel, '3');
  assert.strictEqual(httpChanged.label, 'HTTP · 3 changed');

  // A warning is appended to the count, never substituted for it, so a bypass
  // cannot hide the fact that other settings were changed too.
  const withWarning = countConfiguredProtocolSettings({
    connectionType: 'http-client', httpFormat: 'json', httpAllowUnverifiedTls: true,
  }, 1);
  assert.strictEqual(withWarning.count, 2);
  assert.strictEqual(withWarning.shortLabel, '2');
  assert.strictEqual(withWarning.label, 'HTTP · 2 changed · 1 warning');

  // Client-only settings are not counted for a server, and the reverse.
  const grpcServer = countConfiguredProtocolSettings({ connectionType: 'grpc-server' });
  const grpcClient = countConfiguredProtocolSettings({ connectionType: 'grpc-client' });
  assert.ok(grpcClient.total > grpcServer.total);

  // Room settings only count while Multi-User Chat is selected.
  const direct = countConfiguredProtocolSettings({ connectionType: 'xmpp-client', xmppConversation: 'direct', xmppRoom: 'events@rooms' });
  const muc = countConfiguredProtocolSettings({ connectionType: 'xmpp-client', xmppConversation: 'muc', xmppRoom: 'events@rooms' });
  assert.strictEqual(direct.count, 0);
  assert.strictEqual(muc.count, 2, 'the room and the non-default conversation both count');
});

test('the warning alert condenses the count and highest-priority warning', () => {
  assert.strictEqual(formatConnectionWarningLine({ warnings: [] }), null);
  assert.deepStrictEqual(formatConnectionWarningLine({
    warnings: [
      { label: 'Certificate verification', value: 'Off for every host' },
      { label: 'Transport encryption', value: 'Off' },
    ],
  }), {
    count: 2,
    label: '2 warnings',
    value: 'Certificate verification: Off for every host',
    text: '2 warnings: Certificate verification: Off for every host',
  });
});

test('the copied text starts with the app, mode, and state, then every row', () => {
  const summary = buildConnectionSummary({
    ...BASE, connectionType: 'grpc-server', connectionState: 'connected', grpcTls: true,
  });
  const lines = formatConnectionSummaryText(summary).split('\n');
  assert.strictEqual(lines[0], 'ArcGIS Velocity Simulator — connection summary');
  assert.strictEqual(lines[1], 'gRPC Server · Connected');
  assert.strictEqual(lines[2], '');
  assert.strictEqual(lines.length, 3 + summary.rows.length);
  assert.strictEqual(formatConnectionSummaryText(null), '');
});

test('an unknown connection type falls back to the documented default', () => {
  const summary = buildConnectionSummary({ ...BASE, connectionType: 'carrier-pigeon' });
  assert.strictEqual(summary.connectionType, 'tcp-server');
  assert.deepStrictEqual(splitConnectionType('carrier-pigeon'), { protocol: 'tcp', mode: 'server' });
  assert.deepStrictEqual(splitConnectionType('ws-client'), { protocol: 'ws', mode: 'client' });
  assert.deepStrictEqual(buildConnectionSummary().rows.length > 0, true);
});

test('row keys are unique and stable for the shared cross-application schema', () => {
  CONNECTION_TYPES.forEach((connectionType) => {
    const summary = buildConnectionSummary({ ...BASE, connectionType, xmppConversation: 'muc' });
    const keys = summary.rows.map((row) => row.key);
    assert.strictEqual(new Set(keys).size, keys.length, `${connectionType} rows must be unique`);
    summary.rows.forEach((row) => {
      assert.strictEqual(typeof row.label, 'string');
      assert.strictEqual(typeof row.value, 'string');
      assert.ok(['warning', 'state', 'endpoint', 'preset', 'security', 'setting', 'secret'].includes(row.kind), `${row.key} kind`);
      assert.ok(['info', 'warning'].includes(row.severity), `${row.key} severity`);
    });
  });
});

console.log(`\n${passed} passed`);
