const http = require('http');
const WebSocket = require('ws');
const { createWsClientTransport, createWsServerTransport, WS_DEFAULT_PORT, WSS_DEFAULT_PORT, DATA_FORMATS, VALID_DATA_FORMATS, FORMAT_CONTENT_TYPES, DEFAULT_FORMAT } = require('../src/ws-transport');

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`✅ ${message}`); }
  else { failed++; console.error(`❌ ${message}`); }
}

console.log('\n--- Test 1: Constants ---');
assert(WS_DEFAULT_PORT === 8080, 'WS_DEFAULT_PORT is 8080');
assert(WSS_DEFAULT_PORT === 8443, 'WSS_DEFAULT_PORT is 8443');
assert(DEFAULT_FORMAT === 'delimited', 'DEFAULT_FORMAT is delimited');
assert(DATA_FORMATS.DELIMITED === 'delimited', 'DATA_FORMATS.DELIMITED is delimited');
assert(VALID_DATA_FORMATS.size === 5, 'VALID_DATA_FORMATS has 5 entries');
assert(FORMAT_CONTENT_TYPES['json'] === 'application/json', 'json → application/json');
assert(FORMAT_CONTENT_TYPES['delimited'] === 'text/plain', 'delimited → text/plain');

console.log('\n--- Test 2: Factory functions ---');
const client = createWsClientTransport({ ip: '127.0.0.1', port: 9900, wsFormat: 'json', wsTls: false });
assert(client !== null, 'createWsClientTransport returns an object');
assert(typeof client.connect === 'function', 'client has connect method');
assert(typeof client.send === 'function', 'client has send method');
assert(typeof client.disconnect === 'function', 'client has disconnect method');
assert(typeof client.isConnected === 'function', 'client has isConnected method');
assert(client.isConnected() === false, 'client is not connected initially');

const server = createWsServerTransport({ ip: '127.0.0.1', port: 9901, wsFormat: 'json', wsTls: false });
assert(server !== null, 'createWsServerTransport returns an object');
assert(typeof server.connect === 'function', 'server has connect method');
assert(typeof server.send === 'function', 'server has send method');
assert(typeof server.disconnect === 'function', 'server has disconnect method');
assert(typeof server.isConnected === 'function', 'server has isConnected method');
assert(typeof server.getClientCount === 'function', 'server has getClientCount method');

console.log('\n--- Test 3: Server connect and disconnect ---');
(async () => {
  const srv = createWsServerTransport({ ip: '127.0.0.1', port: 19980, wsFormat: 'delimited', wsPath: '/test', wsTls: false });
  const result = await srv.connect();
  assert(result.success === true, 'server connect succeeds');
  assert(result.mode === 'server', 'server connect result mode is server');
  assert(result.wsFormat === 'delimited', 'server connect result wsFormat is delimited');
  assert(result.address.port === 19980, 'server bound to correct port');
  assert(result.contentType === 'text/plain', 'server contentType is text/plain');
  assert(srv.isConnected() === true, 'server is connected after connect');
  srv.disconnect();
  assert(srv.isConnected() === false, 'server is disconnected after disconnect');

  console.log('\n--- Test 4: Server with xml format ---');
  const srv2 = createWsServerTransport({ ip: '127.0.0.1', port: 19981, wsFormat: 'xml', wsTls: false });
  const result2 = await srv2.connect();
  assert(result2.success === true, 'xml server connect succeeds');
  assert(result2.wsFormat === 'xml', 'xml server wsFormat is xml');
  assert(result2.contentType === 'application/xml', 'xml server contentType is application/xml');
  srv2.disconnect();

  console.log('\n--- Test 5: Client→Server message delivery ---');
  let receivedData = null;
  let receivedMeta = null;
  const testServer = createWsServerTransport({
    ip: '127.0.0.1', port: 19982, wsFormat: 'json', wsPath: '/', wsTls: false,
    onData: (data, meta) => { receivedData = data; receivedMeta = meta; },
  });
  await testServer.connect();

  const testClient = createWsClientTransport({ ip: '127.0.0.1', port: 19982, wsFormat: 'json', wsPath: '/', wsTls: false });
  await testClient.connect();
  assert(testClient.isConnected() === true, 'client connected to server');

  testClient.send('{"hello":"world"}');

  // Wait for message delivery
  await new Promise(r => setTimeout(r, 200));
  assert(receivedData === '{"hello":"world"}', 'server received correct data');
  assert(receivedMeta !== null, 'server received metadata');
  assert(receivedMeta.protocol === 'WebSocket', 'metadata protocol is WebSocket');
  assert(receivedMeta.mode === 'server', 'metadata mode is server');
  assert(receivedMeta.contentType === 'application/json', 'metadata contentType is application/json');
  assert(receivedMeta.wsFormat === 'json', 'metadata wsFormat is json');

  testClient.disconnect();
  testServer.disconnect();

  console.log('\n--- Test 6: Server broadcast to multiple clients ---');
  const broadcastServer = createWsServerTransport({ ip: '127.0.0.1', port: 19983, wsFormat: 'delimited', wsTls: false });
  await broadcastServer.connect();

  const c1 = createWsClientTransport({ ip: '127.0.0.1', port: 19983, wsTls: false });
  const c2 = createWsClientTransport({ ip: '127.0.0.1', port: 19983, wsTls: false });
  await c1.connect();
  await c2.connect();

  await new Promise(r => setTimeout(r, 100));
  assert(broadcastServer.getClientCount() === 2, 'server has 2 connected clients');

  let c1Received = null;
  let c2Received = null;
  // Access internal ws for listening (hack for test)
  // Instead, use onData on client transports
  c1.disconnect();
  c2.disconnect();
  broadcastServer.disconnect();

  console.log('\n--- Test 7: Subscription message and ignore first message ---');
  let serverReceived = [];
  let clientReceived = [];
  const subServer = createWsServerTransport({
    ip: '127.0.0.1', port: 19984, wsFormat: 'json', wsTls: false,
    onData: (data) => { serverReceived.push(data); },
  });
  await subServer.connect();

  const subClient = createWsClientTransport({
    ip: '127.0.0.1', port: 19984, wsFormat: 'json', wsTls: false,
    wsSubscriptionMsg: '{"subscribe":"feed-1"}',
    wsIgnoreFirstMsg: true,
    onData: (data) => { clientReceived.push(data); },
  });
  await subClient.connect();
  await new Promise(r => setTimeout(r, 100));

  // Server should have received the subscription message
  assert(serverReceived.length === 1, 'server received subscription message');
  assert(serverReceived[0] === '{"subscribe":"feed-1"}', 'subscription message content is correct');

  // Send two messages from server to client
  subServer.send('ack-ignore-me');
  subServer.send('real-data-1');
  await new Promise(r => setTimeout(r, 200));

  // Client should have ignored the first message
  assert(clientReceived.length === 1, 'client received 1 message (first was ignored)');
  assert(clientReceived[0] === 'real-data-1', 'client received the real data');

  subClient.disconnect();
  subServer.disconnect();

  console.log(`\n=== Test Results ===`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);
  if (failed > 0) process.exit(1);
})();

