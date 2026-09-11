const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { buildVelocityConnectionOptions: build } = require('../src/velocity-connection-options');

let passed = 0;
function test(name, run) {
  try { run(); passed++; console.log(`  ✓ ${name}`); }
  catch (error) { console.error(`  ✗ ${name}\n${error.stack}`); process.exitCode = 1; }
}

test('HTTP retains public path, query, TLS, explicit port, and format', () => {
  assert.deepStrictEqual(build({
    feedType: 'http-receiver', url: 'https://receiver.example.com:8443/public/events?topic=traffic&f=json', format: 'geojson',
  }), {
    connectionType: 'http-client', ip: 'receiver.example.com', port: 8443, httpTls: true,
    httpPath: '/public/events?topic=traffic&f=json', httpFormat: 'geo-json',
  });
  assert.strictEqual(build({ feedType: 'http-receiver', url: 'https://receiver.example.com/events' }).port, 443);
  assert.strictEqual(build({ feedType: 'http-receiver', url: 'http://receiver.example.com/events' }).port, 80);
});

test('gRPC preserves explicit ports, bracketed IPv6 and routing metadata', () => {
  assert.deepStrictEqual(build({ feedType: 'grpc', url: '[2001:db8::1]:7443', headerPathKey: 'x-route', headerPath: '/tenant/feed' }), {
    connectionType: 'grpc-client', ip: '2001:db8::1', port: 7443, grpcTls: true,
    grpcSerialization: 'protobuf', grpcHeaderPathKey: 'x-route', grpcHeaderPath: '/tenant/feed',
  });
  assert.strictEqual(build({ feedType: 'grpc', url: 'receiver.example.com' }).port, 443);
  assert.strictEqual(build({ feedType: 'grpc', url: 'http://receiver.example.com:50051' }).grpcTls, false);
  assert.strictEqual(build({ feedType: 'grpc', url: 'https://receiver.example.com:8443/' }).port, 8443);
});

test('Logger output and safe Stream Layer mappings share the same helper', () => {
  const expected = {
    connectionType: 'ws-client', ip: '2001:db8::2', port: 443, wsTls: true,
    wsPath: '/stream/subscribe?filter=all', wsFormat: 'json',
  };
  assert.deepStrictEqual(build({ outputType: 'websocket', url: 'wss://[2001:db8::2]/stream/subscribe?filter=all', format: 'json' }), expected);
  assert.deepStrictEqual(build({ connectionType: 'ws-client', outputType: 'stream-layer', url: 'wss://[2001:db8::2]/stream/subscribe?filter=all', format: 'json' }), expected);
  assert.strictEqual(build({ outputType: 'http', url: 'http://receiver.example.com' }).httpTls, false);
  assert.strictEqual(build({ outputType: 'grpc', url: 'receiver.example.com:50051' }).port, 50051);
});

test('missing or invalid endpoints fail without fallback', () => {
  for (const url of ['', 'bad address', 'https:receiver.example.com', 'https:///receiver.example.com', 'ftp://receiver.example.com', 'https://receiver.example.com:0', 'https://receiver.example.com:65536']) {
    assert.throws(() => build({ feedType: 'http-receiver', url }), undefined, url);
  }
  assert.throws(() => build({ feedType: 'http-receiver', url: 'https://receiver.example.com', format: 'unknown' }), /format/);
  assert.throws(() => build({ feedType: 'websocket', url: 'wss://receiver.example.com' }), /outbound source/);
  assert.throws(() => build({ feedType: 'mqtt', url: 'https://receiver.example.com' }), /supported/);
});

test('credentials and fragments cannot enter saved transport fields', () => {
  for (const url of [
    'https://user:pass@receiver.example.com/data', 'https://receiver.example.com/data#fragment',
    'https://receiver.example.com/data#', 'https://receiver.example.com/data?token=secret',
    'https://receiver.example.com/data?access_token=secret', 'https://receiver.example.com/data?api_key=secret',
    'https://receiver.example.com/data?%74oken=secret', 'https://receiver.example.com/data?value=Bearer%20secret',
    'https://receiver.example.com/data?signature=secret',
  ]) assert.throws(() => build({ feedType: 'http-receiver', url }), /credentials|fragments|credential/);
});

test('gRPC does not derive arbitrary RPC paths or unsafe metadata', () => {
  for (const url of ['receiver.example.com/rpc', 'https://receiver.example.com/context', '2001:db8::1', 'receiver.example.com?x=y']) {
    assert.throws(() => build({ feedType: 'grpc', url }));
  }
  assert.throws(() => build({ feedType: 'grpc', url: 'receiver.example.com', headerPathKey: 'invalid key' }), /header key/);
  assert.throws(() => build({ feedType: 'grpc', url: 'receiver.example.com', headerPath: 'route\r\nheader:value' }), /header value/);
});

test('browser UMD export matches the Node module', () => {
  const sandbox = { URL };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/velocity-connection-options'), 'utf8'), sandbox);
  assert.strictEqual(sandbox.VelocityConnectionOptions.buildVelocityConnectionOptions({ feedType: 'grpc', url: 'receiver.example.com' }).port, 443);
});

test('main renderer validates atomically, honors transport locks, and never connects', () => {
  const source = fs.readFileSync(require.resolve('../src/renderer'), 'utf8');
  const block = source.slice(source.indexOf('  window.api.onFeedApplied((item) => {'), source.indexOf('  // Token refresh notification'));
  const dom = new JSDOM('<select id="type"><option>tcp-server</option><option>http-client</option><option>grpc-client</option></select>');
  const writes = [];
  let callback;
  let authUpdates = 0;
  const context = {
    window: { api: { onFeedApplied: fn => { callback = fn; } }, VelocityConnectionOptions: { buildVelocityConnectionOptions: build } },
    isConnected: false, isConnecting: false, Event: dom.window.Event,
    connectionTypeSelect: dom.window.document.getElementById('type'),
    setPresetControlValue: (key, value) => writes.push([key, value]),
    markConnectionFieldsModified: () => {}, updateProtocolVisibility: () => {},
    renderConnectionSummary: () => {}, logStatus: () => {},
    updateAuthFromVelocityItem: () => authUpdates++,
  };
  vm.createContext(context);
  vm.runInContext(block, context);
  callback({ feedType: 'http-receiver', url: 'not a URL' });
  assert.strictEqual(context.connectionTypeSelect.value, 'tcp-server');
  assert.strictEqual(authUpdates, 0);
  assert.deepStrictEqual(writes, []);
  context.isConnecting = true;
  callback({ feedType: 'http-receiver', url: 'https://receiver.example.com/path?q=1' });
  callback({ tokenOnly: true });
  assert.deepStrictEqual(writes, []);
  assert.strictEqual(authUpdates, 0);
  context.isConnecting = false;
  context.isConnected = true;
  callback({ feedType: 'http-receiver', url: 'https://receiver.example.com/path?q=1' });
  callback({ tokenOnly: true });
  assert.deepStrictEqual(writes, []);
  assert.strictEqual(authUpdates, 0);
  context.isConnected = false;
  callback({ feedType: 'http-receiver', url: 'https://receiver.example.com:8443/path?q=1' });
  assert.strictEqual(context.connectionTypeSelect.value, 'http-client');
  assert(writes.some(([key, value]) => key === 'httpPath' && value === '/path?q=1'));
  assert.deepStrictEqual(writes.at(-1), ['port', 8443]);
  assert.strictEqual(authUpdates, 1);
  writes.length = 0;
  callback({ feedType: 'grpc', url: 'receiver.example.com:7443', headerPathKey: 'x-route', headerPath: '/tenant/feed' });
  assert.strictEqual(context.connectionTypeSelect.value, 'grpc-client');
  assert(writes.some(([key, value]) => key === 'grpcSerialization' && value === 'protobuf'));
  assert(writes.some(([key, value]) => key === 'grpcHeaderPathKey' && value === 'x-route'));
  assert(writes.some(([key, value]) => key === 'grpcHeaderPath' && value === '/tenant/feed'));
  assert.deepStrictEqual(writes.at(-1), ['port', 7443]);
  assert(!/\.connect\(/.test(block));
  dom.window.close();
});

console.log(`velocity-connection-options: ${passed} tests passed`);
