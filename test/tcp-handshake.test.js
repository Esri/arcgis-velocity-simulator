const assert = require('assert');
const net = require('net');
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
    tcpHandshakeText: String.raw`secret-auth\r\n雪`, tcpHandshakeUseEscapes: true,
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

(async () => {
  for (const [host, family] of [['127.0.0.1', 'ipv4'], ['::1', 'ipv6']]) {
    await clientCase(host, family, '', true, Buffer.alloc(0));
    await clientCase(host, family, String.raw`secret-auth\r\n\u96ea\101`, true, Buffer.from('secret-auth\r\n雪A'));
    await clientCase(host, family, '  ', true, Buffer.from('  '));
    await clientCase(host, family, String.raw` secret-auth\r\n `, false, Buffer.from(String.raw` secret-auth\r\n `));
    await serverCase(host, family);
  }
  await failureCase('failure');
  await failureCase('cancel');
  await failureCase('timeout');
  console.log('tcp-handshake: IPv4/IPv6 greeting ordering, inbound data, reconnect, multi-peer, failure/cancel and secrecy passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
