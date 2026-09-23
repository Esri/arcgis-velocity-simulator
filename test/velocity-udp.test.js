const assert = require('assert');
const dgram = require('dgram');
const { once } = require('events');
const { TransportManager } = require('../src/transport-manager');
const { parseFeedItem } = require('../src/velocity-api');
const { buildVelocityConnectionOptions } = require('../src/velocity-connection-options');
const { encodeUdpPayload } = require('../src/udp-utils');
const { SimulationEngine } = require('../src/simulation-engine');

async function run() {
  assert.strictEqual(encodeUdpPayload('1,a', 'delimited').toString(), '1,a');
  assert.strictEqual(encodeUdpPayload('{"id":1}', 'json', true).toString(), '{"id":1}');
  assert.strictEqual(encodeUdpPayload('é'.repeat(32753), 'delimited', true).length, 65507);
  assert.throws(() => encodeUdpPayload('é'.repeat(32753) + 'x', 'delimited', true), /65507/);
  assert.strictEqual(encodeUdpPayload('x'.repeat(65507), 'delimited', false).length, 65507);

  for (const [type, host, family] of [
    ['udp-client', '127.0.0.1', 'udp4'], ['udp-server', '127.0.0.1', 'udp4'], ['udp-client', '::1', 'udp6'],
  ]) {
    for (const format of ['delimited', 'json']) {
      const receiver = dgram.createSocket(family);
      const transport = new TransportManager();
      const received = [];
      receiver.on('message', data => received.push(data.toString('utf8')));
      receiver.bind(0, host);
      await once(receiver, 'listening');
      try {
        const item = parseFeedItem({
          id: 'receiving-feed',
          feed: { name: type, formatName: format, properties: {
            [`${type}.hostName`]: host, [`${type}.port`]: receiver.address().port,
          } },
        });
        const options = buildVelocityConnectionOptions({
          ...item, serverApiUrl: 'https://management.invalid/context',
        });
        const [protocol, mode] = options.connectionType.split('-');
        const payloads = format === 'delimited' ? ['1,café', '2,water'] : ['{"id":1}', '{"id":2}'];
        const engine = new SimulationEngine({
          transport, options: { ...options, protocol, mode, intervalMs: 1, loop: false },
          loadLines: async () => payloads,
        });
        await engine.connect();
        assert.strictEqual(transport.hasRecipients(), true);
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.deepStrictEqual(received, [], 'Connect must not send a registration or probe');
        const summary = await engine.run();
        assert.strictEqual(summary.linesSent, 2);
        const deadline = Date.now() + 2000;
        while (received.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
        assert.deepStrictEqual(received, payloads.map(payload => format === 'delimited' ? `${payload}\n` : payload));
        assert.strictEqual(transport.udpServerClients.size, 0, 'No inbound registration is needed');
        if (format === 'delimited') {
          await assert.rejects(transport.send('x'.repeat(65507)), /65507/);
          assert.strictEqual(received.length, 2, 'An oversized framed payload must not be sent');
        }
      } finally {
        await transport.disconnect();
        await new Promise(resolve => receiver.close(resolve));
      }
    }
  }
  console.log('velocity-udp: raw loopback feeds, first-payload delivery, framing, and byte limits passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
