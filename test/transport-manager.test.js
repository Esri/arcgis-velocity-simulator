/**
 * TransportManager HTTP/WebSocket Integration Tests
 * Run with: node test/transport-manager.test.js
 */

const assert = require('assert');
const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const { TransportManager } = require('../src/transport-manager.js');

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, message, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await delay(10);
  }
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

async function withManagers(fn) {
  const server = new TransportManager({ logger });
  const client = new TransportManager({ logger });
  try {
    await fn(server, client);
  } finally {
    await client.disconnect();
    await server.disconnect();
  }
}

async function run() {
  console.log('transport-manager.test.js');

  await test('HTTP client POST and server SSE broadcast use canonical options and recipient waiting', async () => {
    await withManagers(async (server, client) => {
      const serverReceived = [];
      const clientReceived = [];
      server.on('data-received', ({ data }) => serverReceived.push(data));
      client.on('data-received', ({ data }) => clientReceived.push(data));

      const listening = await server.connect({
        protocol: 'http',
        mode: 'server',
        ip: '127.0.0.1',
        port: 0,
        httpFormat: 'geo-json',
        httpPath: '/headless',
        httpTls: false,
      });
      assert.deepStrictEqual(await server.send('no watcher yet'), {
        delivered: false,
        recipients: 0,
        reason: 'no-clients',
      });
      const recipient = server.waitForRecipients({ timeoutMs: 2000 });
      const connected = await client.connect({
        protocol: 'http',
        mode: 'client',
        ip: '127.0.0.1',
        port: listening.address.port,
        httpFormat: 'geo-json',
        httpPath: '/headless',
        httpTls: false,
        authToken: 'test-token',
      });

      assert.strictEqual(connected.contentType, 'application/geo+json');
      assert.strictEqual(client.connection.authToken, 'test-token');
      await recipient;
      assert.strictEqual(server.hasRecipients(), true);

      const postResult = await client.send('{"type":"Feature"}');
      assert.deepStrictEqual(postResult, { delivered: true, recipients: 1, statusCode: 200 });
      await waitFor(() => serverReceived.includes('{"type":"Feature"}'), 'HTTP server did not receive the client POST');

      const broadcastResult = await server.send('{"from":"server"}');
      assert.strictEqual(broadcastResult.delivered, true);
      assert.strictEqual(broadcastResult.recipients, 1);
      await waitFor(() => clientReceived.includes('{"from":"server"}'), 'HTTP client did not receive the SSE broadcast');
    });
  });

  await test('HTTP manager forwards explicit unverified TLS to the shared transport', async () => {
    await withManagers(async (server, client) => {
      const listening = await server.connect({
        protocol: 'http',
        mode: 'server',
        ip: '127.0.0.1',
        port: 0,
        httpFormat: 'json',
        httpPath: '/tls',
        httpTls: true,
      });
      await client.connect({
        protocol: 'http',
        mode: 'client',
        ip: '127.0.0.1',
        port: listening.address.port,
        httpFormat: 'json',
        httpPath: '/tls',
        httpTls: true,
        httpAllowUnverifiedTls: true,
      });
      const result = await client.send('{"tls":true}');
      assert.strictEqual(result.delivered, true);
      assert.match(client.connection._tlsInfo, /explicit allowUnverifiedTls/);
    });
  });

  await test('WebSocket client subscription and server broadcast support both directions', async () => {
    await withManagers(async (server, client) => {
      const serverReceived = [];
      const clientReceived = [];
      server.on('data-received', ({ data }) => serverReceived.push(data));
      client.on('data-received', ({ data }) => clientReceived.push(data));

      const listening = await server.connect({
        protocol: 'ws',
        mode: 'server',
        ip: '127.0.0.1',
        port: 0,
        wsFormat: 'xml',
        wsPath: '/stream',
        wsTls: false,
      });
      assert.deepStrictEqual(await server.send('no socket yet'), {
        delivered: false,
        recipients: 0,
        reason: 'no-clients',
      });
      const recipient = server.waitForRecipients({ timeoutMs: 2000 });
      const connected = await client.connect({
        protocol: 'ws',
        mode: 'client',
        ip: '127.0.0.1',
        port: listening.address.port,
        wsFormat: 'xml',
        wsPath: '/stream',
        wsTls: false,
        wsSubscriptionMsg: '<subscribe/>',
        wsIgnoreFirstMsg: true,
        wsHeaders: '{"X-Headless-Test":"enabled"}',
      });

      assert.strictEqual(connected.contentType, 'application/xml');
      await recipient;
      await waitFor(() => serverReceived.includes('<subscribe/>'), 'WebSocket server did not receive the subscription');
      assert.strictEqual(server.hasRecipients(), true);

      const clientResult = await client.send('<from-client/>');
      assert.deepStrictEqual(clientResult, { delivered: true, recipients: 1 });
      await waitFor(() => serverReceived.includes('<from-client/>'), 'WebSocket server did not receive client data');

      await server.send('<ignored/>');
      await server.send('<from-server/>');
      await waitFor(() => clientReceived.includes('<from-server/>'), 'WebSocket client did not receive server data');
      assert.deepStrictEqual(clientReceived, ['<from-server/>']);
    });
  });

  await test('WebSocket manager forwards custom and bearer-auth upgrade headers', async () => {
    const wss = new WebSocket.Server({ host: '127.0.0.1', port: 0, path: '/auth' });
    await new Promise((resolve, reject) => {
      wss.once('listening', resolve);
      wss.once('error', reject);
    });
    const headers = new Promise((resolve) => {
      wss.once('connection', (_socket, request) => resolve(request.headers));
    });
    const client = new TransportManager({ logger });
    try {
      await client.connect({
        protocol: 'ws',
        mode: 'client',
        ip: '127.0.0.1',
        port: wss.address().port,
        wsPath: '/auth',
        wsTls: false,
        wsHeaders: '{"X-Headless-Test":"enabled"}',
        authToken: 'test-token',
      });
      const requestHeaders = await headers;
      assert.strictEqual(requestHeaders.authorization, 'Bearer test-token');
      assert.strictEqual(requestHeaders['x-headless-test'], 'enabled');
    } finally {
      await client.disconnect();
      await new Promise((resolve) => wss.close(() => resolve()));
    }
  });

  await test('TCP manager reconstructs structured records across socket chunks', async () => {
    const server = new TransportManager({ logger });
    const records = [];
    server.on('data-received', ({ data }) => records.push(data));
    let client;
    try {
      const listening = await server.connect({
        protocol: 'tcp', mode: 'server', ip: '127.0.0.1', port: 0, tcpFormat: 'json',
      });
      client = net.createConnection({ host: '127.0.0.1', port: listening.address.port });
      await new Promise((resolve, reject) => {
        client.once('connect', resolve);
        client.once('error', reject);
      });
      client.write(Buffer.from('{"value":"'));
      client.write(Buffer.from('雪"}{"next":'));
      client.write(Buffer.from('2}'));
      await waitFor(() => records.length === 2, 'TCP records were not reconstructed');
      assert.deepStrictEqual(records, ['{"value":"雪"}', '{"next":2}']);
      client.end();
      await new Promise(resolve => client.once('close', resolve));
      assert.deepStrictEqual(records, ['{"value":"雪"}', '{"next":2}'], 'EOF must not duplicate a complete record');
      client = null;
    } finally {
      if (client) client.destroy();
      await server.disconnect();
    }
  });

  await test('UDP manager excludes registration control traffic and preserves datagrams', async () => {
    const server = new TransportManager({ logger });
    const records = [];
    const recipients = [];
    const replies = [];
    server.on('data-received', ({ data }) => records.push(data));
    server.on('client-connected', ({ clientKey }) => recipients.push(clientKey));
    const client = dgram.createSocket('udp4');
    client.on('message', data => replies.push(data));
    try {
      const listening = await server.connect({
        protocol: 'udp', mode: 'server', ip: '127.0.0.1', port: 0, udpFormat: 'json', udpConnectionMode: 'registered',
      });
      await new Promise((resolve, reject) => {
        client.send(Buffer.from('UDP Client connected'), listening.address.port, '127.0.0.1', error => error ? reject(error) : resolve());
      });
      await new Promise((resolve, reject) => {
        client.send(Buffer.from('UDP Client connected'), listening.address.port, '127.0.0.1', error => error ? reject(error) : resolve());
      });
      await new Promise((resolve, reject) => {
        client.send(Buffer.from('{"id":1}'), listening.address.port, '127.0.0.1', error => error ? reject(error) : resolve());
      });
      await waitFor(() => records.length === 1, 'UDP payload was not received');
      assert.deepStrictEqual(records, ['{"id":1}']);
      assert.strictEqual(recipients.length, 1, 'Renewal must not duplicate a recipient notification');
      assert.strictEqual(server.udpServerClients.size, 1);
      assert.deepStrictEqual(replies, [], 'Registration renewal must not produce an acknowledgement');
      await assert.rejects(server.send('not-json'), /Invalid JSON payload/);
    } finally {
      client.close();
      await server.disconnect();
    }
  });
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
