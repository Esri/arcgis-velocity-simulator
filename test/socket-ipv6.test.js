const assert = require('assert');
const net = require('net');
const dgram = require('dgram');
const dns = require('dns').promises;
const { once } = require('events');
const { TransportManager } = require('../src/transport-manager');

async function waitFor(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for received socket payloads');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function exercise(protocol, mode, family) {
  const host = family === 'ipv6' ? '::1' : '127.0.0.1';
  const manager = new TransportManager();
  const payloads = ['1,café', '2,雪'];
  const chunks = [];
  let receiver;
  let tcpPeer;
  let port;
  try {
    if (mode === 'client') {
      if (protocol === 'tcp') {
        receiver = net.createServer(socket => {
          tcpPeer = socket;
          socket.on('data', data => chunks.push(data));
        });
        receiver.listen({ host, port: 0, ipv6Only: family === 'ipv6' });
      } else {
        receiver = dgram.createSocket(family === 'ipv6' ? { type: 'udp6', ipv6Only: true } : 'udp4');
        receiver.on('message', data => chunks.push(data));
        receiver.bind(0, host);
      }
      await once(receiver, 'listening');
      port = receiver.address().port;
    } else {
      const result = await manager.connect({
        protocol, mode, ip: host, port: 0, [`${protocol}AddressFamily`]: family,
      });
      port = result.address.port;
      if (protocol === 'tcp') {
        receiver = net.createConnection({ host, port });
        receiver.on('data', data => chunks.push(data));
        await once(receiver, 'connect');
      } else {
        receiver = dgram.createSocket(family === 'ipv6' ? { type: 'udp6', ipv6Only: true } : 'udp4');
        receiver.on('message', data => chunks.push(data));
        receiver.bind(0, host);
        await once(receiver, 'listening');
        await new Promise((resolve, reject) => receiver.send('UDP Client connected', port, host, error => error ? reject(error) : resolve()));
      }
      await manager.waitForRecipients({ timeoutMs: 2000 });
    }
    if (mode === 'client') await manager.connect({
      protocol, mode, ip: family === 'ipv6' ? `[${host}]` : host, port, [`${protocol}AddressFamily`]: family,
    });
    assert.strictEqual(manager.isConnected(), true);
    if (protocol === 'udp') {
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.deepStrictEqual(chunks, [], 'UDP clients send no probe and servers send no registration acknowledgement');
    }
    for (const payload of payloads) await manager.send(payload);
    const expected = Buffer.from(protocol === 'tcp' ? `${payloads.join('\n')}\n` : payloads.join(''));
    await waitFor(() => Buffer.concat(chunks).length >= expected.length);
    assert.deepStrictEqual(Buffer.concat(chunks), expected);
    if (protocol === 'udp') assert.deepStrictEqual(chunks, payloads.map(payload => Buffer.from(payload)));
    console.log(`  ${protocol} ${mode} ${family}: exact received UTF-8 bytes verified`);
  } finally {
    if (tcpPeer) tcpPeer.destroy();
    if (receiver instanceof net.Socket) receiver.destroy();
    await manager.disconnect();
    if (receiver instanceof net.Server) await new Promise(resolve => receiver.close(resolve));
    else if (receiver && !(receiver instanceof net.Socket)) await new Promise(resolve => receiver.close(resolve));
  }
  assert.strictEqual(manager.isConnected(), false);
  assert.strictEqual(manager.udpServerClients.size, 0);
}

async function exerciseDnsRecovery(family, code) {
  const originalLookup = dns.lookup;
  const host = family === 'ipv6' ? '::1' : '127.0.0.1';
  const chunks = [];
  const peers = [];
  const logs = [];
  const manager = new TransportManager({ logger: { info: message => logs.push(message) } });
  const receiver = net.createServer(socket => {
    peers.push(socket);
    socket.on('data', data => chunks.push(data));
  });
  receiver.listen({ host, port: 0, ipv6Only: family === 'ipv6' });
  await once(receiver, 'listening');
  let lookups = 0;
  try {
    dns.lookup = async (name, options) => {
      assert.strictEqual(name, 'recovering.example');
      assert.strictEqual(options.family, family === 'ipv6' ? 6 : 4);
      lookups++;
      if (lookups === 1) throw Object.assign(new Error('Temporary DNS failure'), { code });
      return { address: host, family: options.family };
    };
    await manager.connect({
      protocol: 'tcp', mode: 'client', ip: 'recovering.example', port: receiver.address().port,
      tcpAddressFamily: family, connectWaitForServer: true, connectRetryIntervalMs: 5, connectTimeoutMs: 1000,
    });
    assert.strictEqual(manager.isConnected(), true);
    assert.strictEqual(lookups, 2);
    assert.deepStrictEqual(chunks, []);
    assert(logs.some(message => message.includes(`(${code})`)));
    const payload = '1,café,雪';
    await manager.send(payload);
    await waitFor(() => Buffer.concat(chunks).length >= Buffer.byteLength(`${payload}\n`));
    assert.deepStrictEqual(Buffer.concat(chunks), Buffer.from(`${payload}\n`));
    assert.strictEqual(peers.length, 1, 'DNS retry must not duplicate connections or sends');
  } finally {
    dns.lookup = originalLookup;
    await manager.disconnect();
    peers.forEach(socket => socket.destroy());
    await new Promise(resolve => receiver.close(resolve));
  }
  console.log(`  TCP ${family} ${code}: DNS retry recovered and exact receiver bytes verified`);
}

async function exerciseDnsRetryLimits() {
  const originalLookup = dns.lookup;
  let lookups = 0;
  try {
    dns.lookup = async () => {
      lookups++;
      throw Object.assign(new Error('Temporary DNS failure'), { code: 'EAI_AGAIN' });
    };
    const options = {
      protocol: 'tcp', mode: 'client', ip: 'unavailable.example', port: 5565,
      tcpAddressFamily: 'ipv6', connectWaitForServer: true, connectRetryIntervalMs: 5, connectTimeoutMs: 30,
    };
    const bounded = new TransportManager();
    await assert.rejects(bounded.connect(options), /Timed out waiting for TCP server/);
    assert(lookups >= 2 && lookups <= 7, `Unexpected retry count: ${lookups}`);
    assert.strictEqual(bounded.isConnected(), false);
    lookups = 0;
    await assert.rejects(new TransportManager().connect({ ...options, connectWaitForServer: false }), error => error.cause.code === 'EAI_AGAIN');
    assert.strictEqual(lookups, 1);
    lookups = 0;
    await assert.rejects(new TransportManager().connect({ ...options, ip: '127.0.0.1' }), /does not match/);
    assert.strictEqual(lookups, 0, 'Validation failures must not trigger DNS or retries');
    dns.lookup = async () => {
      lookups++;
      throw Object.assign(new Error('Non-retryable DNS failure'), { code: 'EACCES' });
    };
    await assert.rejects(new TransportManager().connect(options), error => error.cause.code === 'EACCES');
    assert.strictEqual(lookups, 1);
  } finally {
    dns.lookup = originalLookup;
  }
}

(async () => {
  for (const family of ['ipv4', 'ipv6']) {
    for (const protocol of ['tcp', 'udp']) {
      for (const mode of ['client', 'server']) await exercise(protocol, mode, family);
    }
  }
  for (const family of ['ipv4', 'ipv6']) {
    for (const code of ['ENOTFOUND', 'EAI_AGAIN']) await exerciseDnsRecovery(family, code);
  }
  await exerciseDnsRetryLimits();
  for (const protocol of ['tcp', 'udp']) {
    const manager = new TransportManager();
    await assert.rejects(manager.connect({
      protocol, mode: 'client', ip: '::1', port: 5565, [`${protocol}AddressFamily`]: 'ipv4',
    }), /does not match/);
    assert.strictEqual(manager.isConnected(), false);
  }
  console.log('socket-ipv6: all IPv4/IPv6 TCP/UDP sender roles and cleanup passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
