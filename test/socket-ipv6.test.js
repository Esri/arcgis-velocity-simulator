const assert = require('assert');
const net = require('net');
const dgram = require('dgram');
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

(async () => {
  for (const family of ['ipv4', 'ipv6']) {
    for (const protocol of ['tcp', 'udp']) {
      for (const mode of ['client', 'server']) await exercise(protocol, mode, family);
    }
  }
  for (const protocol of ['tcp', 'udp']) {
    const manager = new TransportManager();
    await assert.rejects(manager.connect({
      protocol, mode: 'client', ip: '::1', port: 5565, [`${protocol}AddressFamily`]: 'ipv4',
    }), /does not match/);
    assert.strictEqual(manager.isConnected(), false);
  }
  console.log('socket-ipv6: all IPv4/IPv6 TCP/UDP sender roles and cleanup passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
