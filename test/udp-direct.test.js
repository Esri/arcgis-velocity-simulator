const assert = require('assert');
const dgram = require('dgram');
const { once } = require('events');
const { TransportManager } = require('../src/transport-manager');
const fs = require('fs');
const vm = require('vm');

async function bind(type, host) {
  const socket = dgram.createSocket(type);
  socket.bind(0, host);
  await once(socket, 'listening');
  return socket;
}
async function received(socket, send) {
  const promise = once(socket, 'message', { signal: AbortSignal.timeout(2000) });
  await send();
  return (await promise)[0];
}
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitFor(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for UDP payload');
    await delay(5);
  }
}
async function sendTo(socket, payload, port, host) {
  await new Promise((resolve, reject) => socket.send(payload, port, host, error => error ? reject(error) : resolve()));
}

async function mainProcessDirect(type, host, family, mode) {
  const source = fs.readFileSync(require.resolve('../src/main'), 'utf8');
  const handlers = new Map();
  const context = {
    ...require('../src/socket-address-utils'),
    ...require('../src/udp-utils'),
    ...require('../src/payload-format-utils'),
    ...require('../src/socket-payload-receiver'),
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), on: (name, handler) => handlers.set(name, handler) },
    net: require('net'), dgram, connection: null, grpcTransport: null, httpTransport: null, wsTransport: null, xmppTransport: null,
    velocityConnectionBusy: false, velocityAppliedRevision: null, velocityTransportRevision: null,
    activeSocketPayloadFormat: null, udpServerClients: new Map(), tcpHandshakeController: null, tcpPendingSockets: new Set(),
    logStatus() {}, velocityLog() {},
    emitConnectionStatus(status) {
      context.velocityConnectionBusy = status === 'connected' || status === 'connecting';
      if (status === 'disconnected') {
        context.velocityTransportRevision = null;
        context.activeSocketPayloadFormat = null;
      }
    },
    Buffer, setTimeout, clearTimeout,
  };
  const start = source.indexOf("ipcMain.handle('connect',");
  const end = source.indexOf('// Builds the settings a receiver needs', start);
  vm.runInNewContext(source.slice(start, end), context);
  const receiver = await bind(type, host);
  const chunks = [];
  receiver.on('message', bytes => chunks.push(bytes));
  try {
    for (const [udpFormat, udpAppendNewline, payload, expected] of [
      ['delimited', undefined, 'main,雪', 'main,雪\n'],
      ['delimited', false, 'UDP Client connected', 'UDP Client connected'],
      ['json', undefined, '{"id":1}', '{"id":1}'],
      ['geo-json', undefined, '{"type":"Feature","geometry":null,"properties":{}}', '{"type":"Feature","geometry":null,"properties":{}}'],
      ['esri-json', undefined, '{"attributes":{"id":1}}', '{"attributes":{"id":1}}'],
    ]) {
      chunks.length = 0;
      const result = await handlers.get('connect')({}, {
        protocol: 'udp', mode, ip: host, port: receiver.address().port,
        udpLocalHost: host, udpLocalPort: 0, udpAddressFamily: family, udpFormat, udpAppendNewline,
      });
      assert.strictEqual(result.success, true, result.error);
      await waitFor(() => context.connection);
      await delay(20);
      assert.deepStrictEqual(chunks, [], 'Main-process connect must not emit a marker');
      const bytes = await received(receiver, () => handlers.get('send-data')({}, payload));
      assert.deepStrictEqual(bytes, Buffer.from(expected));
      await handlers.get('disconnect')();
      await waitFor(() => context.connection === null);
    }
    for (const key of ['udpConnectionMode', 'udpRegistrationIntervalMs']) {
      const result = await handlers.get('connect')({}, {
        protocol: 'udp', mode, ip: host, port: receiver.address().port, [key]: 'direct',
      });
      assert.strictEqual(result.success, false);
      assert(result.error.includes(key));
      assert.strictEqual(context.connection, null);
    }
  } finally {
    if (context.connection) await handlers.get('disconnect')();
    await new Promise(resolve => receiver.close(resolve));
  }
}
(async () => {
  for (const [type, host, family] of [['udp4', '127.0.0.1', 'ipv4'], ['udp6', '::1', 'ipv6']]) {
    for (const mode of ['client', 'server']) {
    const receiver = await bind(type, host);
    const outsider = await bind(type, host);
    const manager = new TransportManager();
    const seen = [];
    const rogueReplies = [];
    outsider.on('message', data => rogueReplies.push(data));
    manager.on('data-received', ({ data }) => seen.push(data));
    try {
      const ready = await manager.connect({
        protocol: 'udp', mode, ip: host, port: receiver.address().port,
        ...(family === 'ipv6' ? { udpLocalHost: host } : {}), udpAddressFamily: family,
      });
      assert(manager.hasRecipients(), 'Configured destinations do not need registration');
      assert(ready.address.port > 0, 'Default local port zero selects an ephemeral source port');
      assert.notStrictEqual(ready.address.port, receiver.address().port);
      if (mode === 'server') assert.strictEqual(ready.address.address, host, 'Server defaults to loopback');
      await manager.waitForRecipients({ timeoutMs: 100 });
      await sendTo(outsider, 'UDP Client connected', ready.address.port, host);
      await sendTo(outsider, 'ordinary inbound data', ready.address.port, host);
      await waitFor(() => seen.length === 2);
      assert.deepStrictEqual(seen, ['UDP Client connected', 'ordinary inbound data'], 'All inbound bytes are ordinary data');
      const data = await received(receiver, () => manager.send('1,café,雪'));
      assert.deepStrictEqual(data, Buffer.from('1,café,雪\n'));
      const marker = await received(receiver, () => manager.send('UDP Client connected'));
      assert.deepStrictEqual(marker, Buffer.from('UDP Client connected\n'));
      assert.deepStrictEqual(rogueReplies, []);
    } finally {
      await manager.disconnect();
      await Promise.all([receiver, outsider].map(socket => new Promise(resolve => socket.close(resolve))));
    }
    await mainProcessDirect(type, host, family, mode);
    }
  }
  for (const mode of ['client', 'server']) {
    const manager = new TransportManager();
    try {
      const options = { protocol: 'udp', mode, ip: '127.0.0.1', port: 5565 };
      for (const key of ['udpConnectionMode', 'udpRegistrationIntervalMs']) {
        for (const value of ['direct', 'registered', undefined, null, 0, 'private-value']) {
          await assert.rejects(manager.connect({ ...options, [key]: value }), error => {
            assert(error.message.includes(key));
            assert(!error.message.includes('private-value'));
            return true;
          });
          assert.strictEqual(manager.isConnected(), false);
        }
      }
      for (const port of [0, -1, 65536, 1.5, NaN]) {
        await assert.rejects(manager.connect({ ...options, port }), /port/i);
        assert.strictEqual(manager.isConnected(), false);
      }
      if (mode === 'server') {
        for (const udpLocalPort of [-1, 65536, 1.5, NaN]) {
          await assert.rejects(manager.connect({ ...options, udpLocalPort }), /udpLocalPort/);
        }
      }
    } finally {
      await manager.disconnect();
    }
  }
  console.log('udp-direct: configured destinations, marker preservation, no learning and obsolete option rejection passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
