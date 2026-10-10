const assert = require('assert');
const net = require('net');
const fs = require('fs');
const vm = require('vm');
const { EventEmitter, once } = require('events');
const { TransportManager } = require('../src/transport-manager');

async function until(check) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('TCP handshake fixture timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function clientCase(host, family, text, useEscapes, expected) {
  const sessions = [];
  const peers = [];
  const logs = [];
  const manager = new TransportManager({ logger: { info: message => logs.push(message), debug: message => logs.push(message) } });
  const incoming = [];
  manager.on('data-received', ({ data }) => incoming.push(data));
  const server = net.createServer(socket => {
    peers.push(socket);
    const chunks = [];
    sessions.push(chunks);
    socket.on('data', data => chunks.push(data));
    socket.write('incoming-before-replay\n');
  });
  server.listen({ host, port: 0 });
  await once(server, 'listening');
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await manager.connect({
        protocol: 'tcp', mode: 'client', ip: host, port: server.address().port, tcpAddressFamily: family,
        tcpHandshakeText: text, tcpHandshakeUseEscapes: useEscapes,
      });
      await until(() => incoming.length === attempt + 1);
      await manager.send('1,café');
      const wanted = Buffer.concat([expected, Buffer.from('1,café\n')]);
      await until(() => Buffer.concat(sessions[attempt]).length >= wanted.length);
      assert.deepStrictEqual(Buffer.concat(sessions[attempt]), wanted, 'Greeting precedes payload once per connection, with no extra LF');
      await manager.disconnect();
    }
    assert(!logs.join('\n').includes('secret-auth'));
    assert.strictEqual(manager._tcpPendingSockets.size, 0);
  } finally {
    await manager.disconnect();
    peers.forEach(socket => socket.destroy());
    await new Promise(resolve => server.close(resolve));
  }
}

async function serverCase(host, family) {
  const manager = new TransportManager();
  const incoming = [];
  manager.on('data-received', ({ data }) => incoming.push(data));
  const listening = await manager.connect({
    protocol: 'tcp', mode: 'server', ip: host, port: 0, tcpAddressFamily: family,
    tcpHandshakeText: String.raw`  secret-auth\r\n雪  `, tcpHandshakeUseEscapes: true,
  });
  const peers = [];
  const buffers = [];
  try {
    for (let i = 0; i < 3; i++) {
      const chunks = [];
      buffers.push(chunks);
      const peer = net.createConnection({ host, port: listening.address.port });
      peers.push(peer);
      peer.on('data', data => chunks.push(data));
      await once(peer, 'connect');
      peer.write(`incoming-${i}\n`);
    }
    await until(() => manager.tcpClientSockets.length === 3 && incoming.length === 3);
    await manager.send('2,water');
    const expected = Buffer.from('secret-auth\r\n雪2,water\n');
    await until(() => buffers.every(chunks => Buffer.concat(chunks).length >= expected.length));
    buffers.forEach(chunks => assert.deepStrictEqual(Buffer.concat(chunks), expected));
  } finally {
    peers.forEach(socket => socket.destroy());
    await manager.disconnect();
  }
  assert.strictEqual(manager._tcpPendingSockets.size, 0);
}

async function failureCase(action) {
  const original = net.createConnection;
  const manager = new TransportManager();
  let writes = 0;
  class FakeSocket extends EventEmitter {
    constructor() { super(); this.writable = true; this.destroyed = false; }
    write(_data, callback) {
      writes++;
      if (action === 'failure') callback(new Error('secret-auth must never be logged'));
      return false;
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit('close');
    }
  }
  net.createConnection = (_options, connected) => {
    const socket = new FakeSocket();
    process.nextTick(connected);
    return socket;
  };
  try {
    const pending = manager.connect({
      protocol: 'tcp', mode: 'client', ip: '127.0.0.1', port: 5565,
      tcpHandshakeText: 'secret-auth', connectWaitForServer: true, connectTimeoutMs: 100,
    });
    const rejected = assert.rejects(pending, error => !error.message.includes('secret-auth')
      && (action !== 'timeout' || /timed out/.test(error.message)));
    if (action === 'cancel') {
      await until(() => writes === 1);
      await manager.disconnect();
    }
    await rejected;
    assert.strictEqual(writes, 1, 'Handshake failures must not retry a partially sent greeting');
    assert.strictEqual(manager.isConnected(), false);
    assert.strictEqual(manager._tcpPendingSockets.size, 0);
  } finally {
    net.createConnection = original;
    await manager.disconnect();
  }
}

function desktopHarness(network = net) {
  const source = fs.readFileSync(require.resolve('../src/main'), 'utf8');
  const handlers = new Map();
  const logs = [];
  const context = {
    ...require('../src/socket-address-utils'),
    ...require('../src/udp-utils'),
    ...require('../src/payload-format-utils'),
    ...require('../src/socket-payload-receiver'),
    ...require('../src/tcp-handshake-utils'),
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => handlers.set(name, fn) },
    net: network, connection: null, grpcTransport: null, httpTransport: null, wsTransport: null, xmppTransport: null,
    velocityConnectionBusy: false, velocityAppliedRevision: null, velocityTransportRevision: null,
    activeSocketPayloadFormat: null, udpServerClients: new Map(),
    tcpHandshakeController: null, tcpPendingSockets: new Set(), tcpClientSockets: [], hasLoggedNoClients: false,
    logStatus: message => logs.push(message), velocityLog: (_level, message) => logs.push(message),
    emitConnectionStatus(status) {
      context.velocityConnectionBusy = status === 'connected' || status === 'connecting';
      if (status === 'disconnected') context.activeSocketPayloadFormat = null;
    },
    Buffer, AbortController, setTimeout, clearTimeout,
  };
  const start = source.indexOf("ipcMain.handle('connect',");
  const end = source.indexOf('// Builds the settings a receiver needs', start);
  assert(start >= 0 && end > start);
  vm.runInNewContext(source.slice(start, end), context);
  return { context, handlers, logs };
}

async function desktopCase(mode, text, useEscapes, greeting) {
  const { context, handlers, logs } = desktopHarness();
  const peers = [];
  const chunks = [];
  let server;
  try {
    server = net.createServer(socket => {
      peers.push(socket);
      socket.on('data', bytes => chunks.push(bytes));
      socket.write('peer-before-replay\n');
    });
    server.listen({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    const port = server.address().port;
    if (mode === 'server') {
      await new Promise(resolve => server.close(resolve));
      server = null;
    }
    const options = { protocol: 'tcp', mode, ip: '127.0.0.1', port, tcpHandshakeText: text,
      ...(useEscapes === undefined ? {} : { tcpHandshakeUseEscapes: useEscapes }) };
    for (let attempt = 0; attempt < 2; attempt++) {
      chunks.length = 0;
      if (mode === 'client' || attempt === 0) {
        const result = await handlers.get('connect')({}, options);
        assert.strictEqual(result.success, true, result.error);
        await until(() => context.connection);
      }
      if (mode === 'server') {
        const peer = net.createConnection({ host: '127.0.0.1', port });
        peers.push(peer);
        peer.on('data', bytes => chunks.push(bytes));
        await once(peer, 'connect');
        peer.write('peer-before-replay\n');
        await until(() => context.tcpClientSockets.length === 1);
      }
      await until(() => logs.filter(message => message.includes('peer-before-replay')).length === attempt + 1);
      if (greeting.length) await until(() => Buffer.concat(chunks).length >= greeting.length);
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.deepStrictEqual(Buffer.concat(chunks), greeting, 'Connect sends only the greeting before playback');
      handlers.get('send-data')({}, '  payload,雪  ');
      const expected = Buffer.concat([greeting, Buffer.from('  payload,雪  \n')]);
      await until(() => Buffer.concat(chunks).length >= expected.length);
      assert.deepStrictEqual(Buffer.concat(chunks), expected, 'Payload whitespace is not handshake-trimmed');
      if (mode === 'client') {
        await handlers.get('disconnect')();
        await until(() => context.connection === null);
      } else {
        peers.at(-1).end();
        await until(() => context.tcpClientSockets.length === 0);
        assert(context.connection.listening, 'Server remains listening for peer reconnect');
      }
    }
    assert(!logs.some(message => message.includes('secret-auth')));
  } finally {
    peers.forEach(peer => peer.destroy());
    if (context.connection || context.tcpHandshakeController) {
      await handlers.get('disconnect')();
      await until(() => context.connection === null);
    }
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

async function malformedCases() {
  let networkCalls = 0;
  const network = { ...net,
    createServer() { networkCalls++; throw new Error('Malformed greeting must not bind'); },
    createConnection() { networkCalls++; throw new Error('Malformed greeting must not connect'); },
  };
  for (const mode of ['client', 'server']) {
    for (const text of [String.raw` secret-auth\uXYZ1 `, String.raw` secret-auth\u123 `]) {
      const desktop = desktopHarness(network);
      const result = await desktop.handlers.get('connect')({}, {
        protocol: 'tcp', mode, ip: '127.0.0.1', port: 5565, tcpHandshakeText: text,
      });
      assert.strictEqual(result.success, false);
      assert.match(result.error, /TCP handshake/);
      assert(!desktop.logs.some(message => message.includes('secret-auth')));
      assert.strictEqual(desktop.context.connection, null);
      const manager = new TransportManager();
      await assert.rejects(manager.connect({
        protocol: 'tcp', mode, ip: '127.0.0.1', port: 5565, tcpHandshakeText: text,
      }), /TCP handshake/);
      assert.strictEqual(manager.isConnected(), false);
    }
  }
  assert.strictEqual(networkCalls, 0, 'Malformed desktop greetings never reach a socket or send bytes');
}

(async () => {
  for (const [host, family] of [['127.0.0.1', 'ipv4'], ['::1', 'ipv6']]) {
    await clientCase(host, family, '', true, Buffer.alloc(0));
    await clientCase(host, family, String.raw`secret-auth\r\n\u96ea\101`, true, Buffer.from('secret-auth\r\n雪A'));
    await clientCase(host, family, '  ', true, Buffer.alloc(0));
    await clientCase(host, family, String.raw` secret-auth\r\n `, false, Buffer.from(String.raw`secret-auth\r\n`));
    await clientCase(host, family, String.raw`  AUTH\r\n  `, undefined, Buffer.from('AUTH\r\n'));
    await clientCase(host, family, String.raw` \q\x41\uuu+0041\777\\n\uD800 `, true, Buffer.from(String.raw`qx41A?7\n?`));
    await serverCase(host, family);
  }
  await failureCase('failure');
  await failureCase('cancel');
  await failureCase('timeout');
  for (const mode of ['client', 'server']) {
    for (const [text, useEscapes, expected] of [
      [String.raw`  secret-auth\r\n  `, true, Buffer.from('secret-auth\r\n')],
      [String.raw`  secret-auth\r\n  `, false, Buffer.from(String.raw`secret-auth\r\n`)],
      [String.raw`  secret-auth\r\n  `, undefined, Buffer.from('secret-auth\r\n')],
      [' \t\r\n ', true, Buffer.alloc(0)],
      ['\u00a0AUTH\u00a0', false, Buffer.from('\u00a0AUTH\u00a0')],
      [String.raw` \q\x41\uuu+0041\777\\n\uD800 `, true, Buffer.from(String.raw`qx41A?7\n?`)],
    ]) await desktopCase(mode, text, useEscapes, expected);
  }
  await malformedCases();
  console.log('tcp-handshake: desktop/headless trimming, IPv4/IPv6 ordering, reconnect, multi-peer, failure/cancel and secrecy passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
