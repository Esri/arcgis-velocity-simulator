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
  assert.deepStrictEqual(build({ outputType: 'http', url: 'http://receiver.example.com/events', format: 'json' }), {
    connectionType: 'http-server', ip: 'receiver.example.com', port: 80,
    httpTls: false, httpPath: '/events', httpFormat: 'json',
  });
  assert.strictEqual(build({ outputType: 'grpc', url: 'receiver.example.com:50051' }).port, 50051);
});

test('missing or invalid endpoints fail without fallback', () => {
  for (const url of ['', 'bad address', 'https:receiver.example.com', 'https:///receiver.example.com', 'ftp://receiver.example.com', 'https://receiver.example.com:0', 'https://receiver.example.com:65536']) {
    assert.throws(() => build({ feedType: 'http-receiver', url }), undefined, url);
  }
  assert.throws(() => build({ feedType: 'http-receiver', url: 'https://receiver.example.com', format: 'unknown' }), /format/);
  assert.strictEqual(build({ feedType: 'websocket', url: 'wss://receiver.example.com' }).connectionType, 'ws-server');
  assert.throws(() => build({ feedType: 'mqtt', url: 'https://receiver.example.com' }), /supported/);
});

test('both UDP feed types receive and both output types send without registration', () => {
  for (const type of ['udp-client', 'udp-server']) {
    for (const format of ['delimited', 'json', 'geo-json', 'esri-json']) {
      assert.deepStrictEqual(build({
        feedType: type, host: 'data.example.com', serverApiUrl: 'https://management.example.com/arcgis',
        port: '17009', format,
      }), {
        connectionType: 'udp-client', ip: 'data.example.com', port: 17009, udpFormat: format,
        udpAddressFamily: 'ipv4',
        udpAppendNewline: format === 'delimited',
      });
      const output = build({ outputType: type, host: 'destination.example.com', port: 17009, format });
      assert.strictEqual(output.connectionType, 'udp-server');
      assert.strictEqual(output.ip, '127.0.0.1');
      assert.strictEqual(output.udpFormat, format);
      assert.deepStrictEqual(output.expectedDestination, { host: 'destination.example.com', port: 17009, family: 'ipv4' });
      assert.match(output.routingWarning, /destination.example.com:17009/);
      assert.match(output.routingWarning, /routes to this Logger/);
      if (type === 'udp-server') assert.match(output.routingWarning, /fixed by the deployment public host name/);
    }
    for (const direction of ['feedType', 'outputType']) {
      for (const host of ['', '0.0.0.0', '*', '::', '[::]', 'bad host']) {
        assert.throws(() => build({ [direction]: type, host, port: 17009, serverApiUrl: 'https://management.example.com' }), /host|IPv4/);
      }
      for (const port of [0, 65536, 'bad']) assert.throws(() => build({ [direction]: type, host: 'data.example.com', port }), /port/);
      assert.throws(() => build({ [direction]: type, host: 'data.example.com', port: 17009, format: 'xml' }), /XML/);
    }
  }
});

test('TCP connector role inversion is unchanged', () => {
  assert.deepStrictEqual(build({
    feedType: 'tcp-server', serverApiUrl: 'https://velocity.example.com/arcgis',
    port: '17011', format: 'delimited',
  }), {
    connectionType: 'tcp-client', ip: 'velocity.example.com', port: 17011, tcpFormat: 'delimited', tcpAddressFamily: 'ipv4', tcpHandshakeText: '', tcpHandshakeUseEscapes: true,
  });
  assert.deepStrictEqual(build({
    outputType: 'tcp-client', host: 'logger.example.com', port: 17013, format: 'esri-json',
  }), {
    connectionType: 'tcp-server', ip: 'logger.example.com', port: 17013, tcpFormat: 'esri-json', tcpAddressFamily: 'auto', tcpHandshakeText: '', tcpHandshakeUseEscapes: true,
  });
  assert.deepStrictEqual(build({
    outputType: 'tcp-server', serverApiUrl: 'https://velocity.example.com:7143/arcgis',
    port: 17011, format: 'json',
  }), {
    connectionType: 'tcp-client', ip: 'velocity.example.com', port: 17011, tcpFormat: 'json', tcpAddressFamily: 'ipv4', tcpHandshakeText: '', tcpHandshakeUseEscapes: true,
  });
  assert.throws(() => build({
    outputType: 'tcp-server', port: 17011, format: 'json',
  }), /data endpoint is missing/);
  assert.throws(() => build({
    outputType: 'tcp-client', host: 'destination.example.com:9010', port: 17011, format: 'json',
  }), /host is invalid/);
  assert.throws(() => build({
    outputType: 'tcp-client', host: '[not-an-ipv6-address]', port: 17011, format: 'json',
  }), /host is invalid/);
  assert.strictEqual(build({
    outputType: 'tcp-client', host: '2001:db8::1', port: 17011, format: 'json',
  }).ip, '2001:db8::1');
  assert.strictEqual(build({
    outputType: 'tcp-client', host: '[2001:db8::2]', port: 17011, format: 'json',
  }).ip, '2001:db8::2');
  assert.throws(() => build({
    feedType: 'udp-server', host: '2001:db8::1',
    port: 17009, format: 'json',
  }), /IPv4/);
});

test('advertised IPv6 selects family only for capable Velocity connectors', () => {
  for (const host of ['::1', '[::1]']) {
    const feed = build({ feedType: 'udp-client', host, port: 17009, format: 'delimited' });
    assert.strictEqual(feed.udpAddressFamily, 'ipv6');
    assert.strictEqual(feed.ip, '::1');
    assert.strictEqual(feed.udpAppendNewline, true);
    for (const outputType of ['udp-client', 'udp-server']) {
      const output = build({ outputType, host, port: 17009 });
      assert.strictEqual(output.udpAddressFamily, 'ipv6');
      assert.strictEqual(output.ip, '::1');
      assert.deepStrictEqual(output.expectedDestination, { host: '::1', port: 17009, family: 'ipv6' });
      assert.match(output.routingWarning, /\[::1\]:17009/);
    }
    assert.throws(() => build({ feedType: 'udp-server', host, port: 17009 }), /bind IPv4 only/);
    for (const direction of ['feedType', 'outputType']) {
      assert.strictEqual(build({ [direction]: 'tcp-client', host, port: 17009 }).tcpAddressFamily, 'ipv6');
      assert.throws(() => build({ [direction]: 'tcp-server', host, port: 17009 }), /bind IPv4 only/);
    }
  }
  assert.strictEqual(build({ feedType: 'udp-client', host: 'dual.example', port: 17009 }).udpAddressFamily, 'ipv4');
  assert.strictEqual(build({ feedType: 'tcp-client', host: 'dual.example', port: 17009 }).tcpAddressFamily, 'auto');
  for (const protocol of ['tcp', 'udp']) {
    assert.throws(() => build({ feedType: `${protocol}-client`, host: '::1', port: 17009, [`${protocol}AddressFamily`]: 'ipv4' }), /family/);
    assert.throws(() => build({ feedType: `${protocol}-client`, host: '127.0.0.1', port: 17009, [`${protocol}AddressFamily`]: 'ipv6' }), /family/);
  }
});

test('every TCP mapping clears a previous greeting instead of exposing it to a new endpoint', () => {
  for (const direction of ['feedType', 'outputType']) {
    for (const type of ['tcp', 'tcp-client', 'tcp-server']) {
      const options = build({ [direction]: type, host: 'new.example.com', port: 5565,
        tcpHandshakeText: 'secret-from-another-endpoint', tcpHandshakeUseEscapes: false });
      assert.strictEqual(options.tcpHandshakeText, '');
      assert.strictEqual(options.tcpHandshakeUseEscapes, true);
    }
  }
});

test('HTTP Poller and WebSocket feeds map to Simulator server roles', () => {
  assert.deepStrictEqual(build({
    feedType: 'http-poller', httpMethod: 'GET',
    url: 'https://simulator.example.com:8443/events?site=one', format: 'json',
  }), {
    connectionType: 'http-server', ip: 'simulator.example.com', port: 8443,
    httpTls: true, httpPath: '/events?site=one', httpFormat: 'json', httpPolling: true,
  });
  assert.deepStrictEqual(build({
    feedType: 'websocket', url: 'wss://simulator.example.com:9443/stream?tenant=demo', format: 'geo-json',
  }), {
    connectionType: 'ws-server', ip: 'simulator.example.com', port: 9443,
    wsTls: true, wsPath: '/stream', wsFormat: 'geo-json',
  });
  assert.throws(() => build({
    feedType: 'http-poller', httpMethod: 'POST', url: 'https://simulator.example.com/events',
  }), /GET-based/);
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
  const dom = new JSDOM('<select id="type"><option>tcp-server</option><option>http-client</option><option>grpc-client</option><option>udp-client</option></select>');
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
  for (const feedType of ['udp-client', 'udp-server']) {
    writes.length = 0;
    callback({ feedType, host: 'data.example.com', port: 17009, format: 'delimited' });
    assert.strictEqual(context.connectionTypeSelect.value, 'udp-client');
    assert(writes.some(([key, value]) => key === 'udpAppendNewline' && value === true));
    assert(writes.some(([key, value]) => key === 'host' && value === 'data.example.com'));
  }
  writes.length = 0;
  callback({ feedType: 'tcp-client', host: 'new.example.com', port: 5565 });
  assert(writes.some(([key, value]) => key === 'tcpHandshakeText' && value === ''));
  assert(writes.some(([key, value]) => key === 'tcpHandshakeUseEscapes' && value === true));
  assert(!/\.connect\(/.test(block));
  dom.window.close();
});

console.log(`velocity-connection-options: ${passed} tests passed`);
