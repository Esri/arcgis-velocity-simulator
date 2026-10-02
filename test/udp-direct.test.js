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

async function mainProcessDirect() {
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
    logStatus() {}, velocityLog() {}, emitConnectionStatus() {},
  };
  const start = source.indexOf("ipcMain.handle('connect',");
  const end = source.indexOf('// Builds the settings a receiver needs', start);
  vm.runInNewContext(source.slice(start, end), context);
  const receiver = await bind('udp4', '127.0.0.1');
  try {
    const result = await handlers.get('connect')({}, {
      protocol: 'udp', mode: 'server', ip: '127.0.0.1', port: receiver.address().port,
      udpLocalHost: '127.0.0.1', udpLocalPort: 0,
    });
    assert.strictEqual(result.success, true);
    const deadline = Date.now() + 2000;
    while (!context.connection && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert(context.connection);
    const bytes = await received(receiver, () => handlers.get('send-data')({}, 'main,雪'));
    assert.deepStrictEqual(bytes, Buffer.from('main,雪\n'));
  } finally {
    if (context.connection) await handlers.get('disconnect')();
    receiver.close();
  }
}
(async () => {
  for (const [type, host, family] of [['udp4', '127.0.0.1', 'ipv4'], ['udp6', '::1', 'ipv6']]) {
    const receiver = await bind(type, host);
    const outsider = await bind(type, host);
    const manager = new TransportManager();
    const seen = [];
    const rogueReplies = [];
    outsider.on('message', data => rogueReplies.push(data));
    manager.on('data-received', ({ data }) => seen.push(data));
    try {
      const ready = await manager.connect({
        protocol: 'udp', mode: 'server', ip: host, port: receiver.address().port,
        udpLocalHost: host, udpLocalPort: 0, udpAddressFamily: family,
      });
      assert(manager.hasRecipients(), 'Direct destinations do not need registration');
      assert.strictEqual(manager.udpServerClients.size, 1);
      await outsider.send('UDP Client connected', ready.address.port, host);
      const limit = Date.now() + 2000;
      while (!seen.length && Date.now() < limit) await new Promise(resolve => setTimeout(resolve, 5));
      assert.deepStrictEqual(seen, ['UDP Client connected'], 'Marker-looking direct data is ordinary data');
      assert.strictEqual(manager.udpServerClients.size, 1, 'Inbound traffic cannot add a Direct destination');
      const data = await received(receiver, () => manager.send('1,café,雪'));
      assert.deepStrictEqual(data, Buffer.from('1,café,雪\n'));
      assert.deepStrictEqual(rogueReplies, []);
    } finally {
      await manager.disconnect();
      receiver.close();
      outsider.close();
    }
    await mainProcessDirect();
    const publisher = new TransportManager();
    const registering = await bind(type, host);
    try {
      const ready = await publisher.connect({ protocol: 'udp', mode: 'server', ip: host, port: 0,
        udpAddressFamily: family, udpConnectionMode: 'registered' });
      registering.send('ordinary payload', ready.address.port, host);
      await new Promise(resolve => setTimeout(resolve, 25));
      assert.strictEqual(publisher.hasRecipients(), false, 'Registered mode requires the exact marker, not any datagram');
      registering.send('UDP Client connected', ready.address.port, host);
      await publisher.waitForRecipients({ timeoutMs: 2000 });
      const data = await received(registering, () => publisher.send('record'));
      assert.deepStrictEqual(data, Buffer.from('record\n'));
    } finally {
      await publisher.disconnect();
      registering.close();
    }
  }
  console.log('udp-direct: explicit destinations, no registration dependency, marker preservation and registered isolation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
