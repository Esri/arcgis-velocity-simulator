const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');

const source = fs.readFileSync(path.join(__dirname, '../src/ws-transport.js'), 'utf8');
let socket;
let handshakeFailure = false;
class FakeSocket extends EventEmitter {
  constructor(url, options) {
    super();
    socket = this;
    this.url = url;
    this.options = options;
    queueMicrotask(() => {
      if (!handshakeFailure) return this.emit('open');
      const error = new Error(`Handshake failed for ${url}`);
      error.response = {
        statusCode: 403,
        statusMessage: 'Denied temporary secret',
        request: { url },
      };
      this.emit('error', error);
    });
  }
}
const moduleValue = { exports: {} };
vm.runInNewContext(source, {
  module: moduleValue,
  require: (name) => {
    if (name === 'ws') return FakeSocket;
    if (name === './tls-utils') return {
      buildHttpsAgentOptions: () => ({ agentOptions: {}, tlsInfo: 'tls=on' }),
    };
    return require(name.startsWith('.') ? path.join(__dirname, '../src', name) : name);
  },
  URL, Buffer, setTimeout, clearTimeout,
});

(async () => {
  const events = [];
  const client = moduleValue.exports.createWsClientTransport({
    ip: '2001:db8::1',
    port: 443,
    wsTls: true,
    wsPath: '/velocity/stream/subscribe?tenant=demo',
    authQueryToken: 'temporary secret',
    onStateChange: (state, detail) => events.push([state, detail]),
  });
  const connected = await client.connect();
  assert.strictEqual(new URL(socket.url).hostname, '[2001:db8::1]');
  assert.strictEqual(new URL(socket.url).searchParams.get('token'), 'temporary secret');
  assert.strictEqual(new URL(socket.url).searchParams.get('tenant'), 'demo');
  assert.strictEqual(socket.options.headers, undefined);
  assert.ok(!JSON.stringify(connected).includes('token'));
  assert.ok(!JSON.stringify(events).includes('temporary'));
  socket.emit('error', new Error(`Handshake failed for ${socket.url}`));
  assert.ok(!JSON.stringify(events).includes('temporary'));
  assert.ok(!JSON.stringify(events).includes('secret'));
  assert.match(events.at(-1)[1].message, /Handshake failed/);
  handshakeFailure = true;
  await assert.rejects(client.connect(), (error) => {
    assert.ok(!error.message.includes('temporary'));
    assert.ok(!JSON.stringify(error).includes('secret'));
    assert.strictEqual(error.response.statusCode, 403);
    assert.strictEqual(error.response.request, undefined);
    return true;
  });
  await assert.rejects(moduleValue.exports.createWsClientTransport({
    ip: 'events.example.com', port: 80, wsTls: false, authQueryToken: 'token',
  }).connect(), /unsecure/);
  console.log('ws-query-auth tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
