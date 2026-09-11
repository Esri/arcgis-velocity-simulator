/**
 * Tests for http-transport.js
 */
const { createHttpClientTransport, createHttpServerTransport, HTTP_FORMATS, VALID_HTTP_FORMATS, FORMAT_CONTENT_TYPES, HTTP_DEFAULT_PORT, HTTPS_DEFAULT_PORT } = require('../src/http-transport.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`✅ ${message}`); }
  else { failed++; console.error(`❌ ${message}`); }
}

/** Polls until a condition holds, so timing-sensitive tests stay deterministic. */
async function waitFor(predicate, message, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      failed++;
      console.error(`❌ ${message} (timed out after ${timeoutMs}ms)`);
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  passed++;
  console.log(`✅ ${message}`);
  return true;
}

console.log('\n--- Test 1: Constants ---');
assert(HTTP_FORMATS.JSON === 'json', 'HTTP_FORMATS.JSON is json');
assert(HTTP_FORMATS.DELIMITED === 'delimited', 'HTTP_FORMATS.DELIMITED is delimited');
assert(HTTP_FORMATS.ESRI_JSON === 'esri-json', 'HTTP_FORMATS.ESRI_JSON is esri-json');
assert(HTTP_FORMATS.GEO_JSON === 'geo-json', 'HTTP_FORMATS.GEO_JSON is geo-json');
assert(HTTP_FORMATS.XML === 'xml', 'HTTP_FORMATS.XML is xml');
assert(VALID_HTTP_FORMATS.size === 5, 'VALID_HTTP_FORMATS has 5 entries');
assert(HTTP_DEFAULT_PORT === 8080, 'HTTP_DEFAULT_PORT is 8080');
assert(HTTPS_DEFAULT_PORT === 8443, 'HTTPS_DEFAULT_PORT is 8443');

console.log('\n--- Test 2: FORMAT_CONTENT_TYPES mapping ---');
assert(FORMAT_CONTENT_TYPES['json'] === 'application/json', 'json → application/json');
assert(FORMAT_CONTENT_TYPES['delimited'] === 'text/plain', 'delimited → text/plain');
assert(FORMAT_CONTENT_TYPES['esri-json'] === 'application/json', 'esri-json → application/json');
assert(FORMAT_CONTENT_TYPES['geo-json'] === 'application/geo+json', 'geo-json → application/geo+json');
assert(FORMAT_CONTENT_TYPES['xml'] === 'application/xml', 'xml → application/xml');

console.log('\n--- Test 3: Factory functions ---');
const client = createHttpClientTransport({ ip: '127.0.0.1', port: 8080, httpFormat: 'json', httpTls: false });
assert(client !== null, 'createHttpClientTransport returns an object');
assert(typeof client.connect === 'function', 'client has connect method');
assert(typeof client.send === 'function', 'client has send method');
assert(typeof client.disconnect === 'function', 'client has disconnect method');
assert(typeof client.isConnected === 'function', 'client has isConnected method');
assert(client.isConnected() === false, 'client is not connected initially');

const server = createHttpServerTransport({ ip: '127.0.0.1', port: 8081, httpFormat: 'json', httpTls: false });
assert(server !== null, 'createHttpServerTransport returns an object');
assert(typeof server.connect === 'function', 'server has connect method');
assert(typeof server.send === 'function', 'server has send method');
assert(typeof server.disconnect === 'function', 'server has disconnect method');
assert(typeof server.isConnected === 'function', 'server has isConnected method');
assert(server.isConnected() === false, 'server is not connected initially');

console.log('\n--- Test 4: HTTP Client connect/disconnect (unsecure) ---');
(async () => {
  const c = createHttpClientTransport({ ip: '127.0.0.1', port: 19876, httpFormat: 'delimited', httpPath: '/data', httpTls: false });
  const result = await c.connect();
  assert(result.protocol === 'http', 'connect result protocol is http');
  assert(result.mode === 'client', 'connect result mode is client');
  assert(result.httpFormat === 'delimited', 'connect result httpFormat is delimited');
  assert(result.address === 'http://127.0.0.1:19876/data', 'connect result address is correct');
  assert(result.contentType === 'text/plain', 'connect result contentType is text/plain');
  assert(result.tlsInfo.includes('unsecure'), 'connect result tlsInfo says unsecure');
  assert(c.isConnected() === true, 'client is connected after connect');
  await c.disconnect();
  assert(c.isConnected() === false, 'client is disconnected after disconnect');

  console.log('\n--- Test 5: HTTP Server connect/disconnect (unsecure) ---');
  const s = createHttpServerTransport({ ip: '127.0.0.1', port: 19877, httpFormat: 'xml', httpPath: '/feed', httpTls: false });
  const sResult = await s.connect();
  assert(sResult.protocol === 'http', 'server connect result protocol is http');
  assert(sResult.mode === 'server', 'server connect result mode is server');
  assert(sResult.httpFormat === 'xml', 'server connect result httpFormat is xml');
  assert(sResult.address.port === 19877, 'server bound to correct port');
  assert(sResult.contentType === 'application/xml', 'server contentType is application/xml');
  assert(s.isConnected() === true, 'server is connected after connect');
  await s.disconnect();
  assert(s.isConnected() === false, 'server is disconnected after disconnect');

  console.log('\n--- Test 6: HTTP Server receives POST data ---');
  const http = require('http');
  let receivedData = null;
  let receivedMetadata = null;
  const s2 = createHttpServerTransport({
    ip: '127.0.0.1', port: 19878, httpFormat: 'json', httpPath: '/', httpTls: false,
    onData: (data, meta) => { receivedData = data; receivedMetadata = meta; }
  });
  await s2.connect();

  await new Promise((resolve, reject) => {
    const payload = '{"test": true}';
    const req = http.request({ hostname: '127.0.0.1', port: 19878, path: '/', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  assert(receivedData === '{"test": true}', 'server received correct data');
  assert(receivedMetadata !== null, 'server received metadata');
  assert(receivedMetadata.method === 'POST', 'metadata method is POST');
  assert(receivedMetadata.contentType === 'application/json', 'metadata contentType is application/json');
  assert(receivedMetadata.httpFormat === 'json', 'metadata httpFormat is json');
  await s2.disconnect();

  console.log('\n--- Test 7: A transient POST failure does not latch the client disconnected ---');
  const recoveryPort = 19879;
  const recoveryReceived = [];
  const makeRecoveryServer = () => createHttpServerTransport({
    ip: '127.0.0.1', port: recoveryPort, httpFormat: 'json', httpPath: '/', httpTls: false,
    onData: (data) => { recoveryReceived.push(data); },
  });
  let recoveryServer = makeRecoveryServer();
  await recoveryServer.connect();

  const recoveryClient = createHttpClientTransport({ ip: '127.0.0.1', port: recoveryPort, httpFormat: 'json', httpPath: '/', httpTls: false });
  await recoveryClient.connect();
  const firstSend = await recoveryClient.send('{"n":1}');
  assert(firstSend.delivered === true, 'the first send is delivered');

  await recoveryServer.disconnect();
  let transientError = null;
  try {
    await recoveryClient.send('{"n":2}');
  } catch (error) {
    transientError = error;
  }
  assert(transientError !== null, 'a send with the peer down rejects');
  assert(/HTTP request failed/.test(transientError.message), `the rejection names the request failure: ${transientError && transientError.message}`);
  assert(recoveryClient.isConnected() === true, 'a transient request failure does not latch the client disconnected');

  recoveryServer = makeRecoveryServer();
  await recoveryServer.connect();
  const recoverySend = await recoveryClient.send('{"n":3}');
  assert(recoverySend.delivered === true, 'a later send succeeds once the peer is back');
  assert(recoveryReceived.includes('{"n":3}'), 'the recovered send reaches the restarted server');

  await recoveryClient.disconnect();
  assert(recoveryClient.isConnected() === false, 'an explicit disconnect still clears the connected state');
  let afterDisconnectError = null;
  try {
    await recoveryClient.send('{"n":4}');
  } catch (error) {
    afterDisconnectError = error;
  }
  assert(afterDisconnectError !== null && /not connected/.test(afterDisconnectError.message),
    'sending after an explicit disconnect still reports that the client is not connected');
  await recoveryServer.disconnect();

  console.log('\n--- Test 8: The SSE subscription stops after a definitive non-SSE response ---');
  const pacingDefaults = createHttpClientTransport({ ip: '127.0.0.1', port: 1, httpTls: false });
  assert(pacingDefaults._sseReconnectDelayMs === 1000, 'a dropped stream reconnects after 1000ms by default');
  assert(pacingDefaults._sseErrorRetryDelayMs === 2000, 'a connection failure retries after 2000ms by default');

  const plainRequests = [];
  const plainServer = http.createServer((req, res) => {
    plainRequests.push({ method: req.method, authorization: req.headers.authorization || null });
    if (req.method === 'POST') {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      });
      return;
    }
    // A POST-only endpoint: it answers the subscription, but never with an event stream.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'listening' }));
  });
  await new Promise((resolve) => plainServer.listen(19880, '127.0.0.1', resolve));

  const subscriptionLogs = [];
  const pollingClient = createHttpClientTransport({
    ip: '127.0.0.1', port: 19880, httpFormat: 'json', httpPath: '/', httpTls: false,
    authToken: 'unit-test-token',
    onData: () => {},
    onLog: (level, message) => subscriptionLogs.push(`${level}: ${message}`),
  });
  // Production pacing on purpose: the earlier behavior re-subscribed every
  // 1000ms, so this window would have collected roughly six GET requests.
  await pollingClient.connect();
  await new Promise((resolve) => setTimeout(resolve, 6400)); // ~6 retry intervals

  const subscriptionGets = plainRequests.filter((entry) => entry.method === 'GET');
  assert(subscriptionGets.length === 1, `exactly one GET is sent to a non-SSE endpoint over ~6 retry intervals (got ${subscriptionGets.length})`);
  assert(subscriptionGets.filter((entry) => entry.authorization).length === 1,
    'the Authorization header is not resent to an endpoint that does not stream');
  assert(subscriptionLogs.some((entry) => entry.includes('Server-to-client streaming is off')),
    'the definitive non-SSE answer is reported once');

  const pollingSend = await pollingClient.send('{"n":1}');
  assert(pollingSend.delivered === true, 'sending still works after the subscription stopped');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert(plainRequests.filter((entry) => entry.method === 'GET').length === 1,
    'the subscription stays stopped after a later send');
  await pollingClient.disconnect();
  await new Promise((resolve) => plainServer.close(resolve));

  console.log('\n--- Test 9: An established SSE stream still reconnects when it drops ---');
  // This is the paired Simulator-server / Logger-client shape: one side hosts
  // the SSE endpoint, the other subscribes and must survive a restart.
  const pairedPort = 19881;
  const makePairedServer = () => createHttpServerTransport({
    ip: '127.0.0.1', port: pairedPort, httpFormat: 'delimited', httpPath: '/', httpTls: false,
  });
  let pairedServer = makePairedServer();
  await pairedServer.connect();

  const watched = [];
  const watcher = createHttpClientTransport({
    ip: '127.0.0.1', port: pairedPort, httpFormat: 'delimited', httpPath: '/', httpTls: false,
    onData: (data) => { watched.push(data); },
  });
  await watcher.connect();
  await waitFor(() => pairedServer.hasRecipients(), 'the watcher subscribed to the SSE endpoint');
  await pairedServer.send('alpha');
  await waitFor(() => watched.includes('alpha'), 'the watcher received the first broadcast');

  // The stream drops with the server, then the same endpoint comes back.
  await pairedServer.disconnect();
  pairedServer = makePairedServer();
  await pairedServer.connect();
  await waitFor(() => pairedServer.hasRecipients(), 'the watcher re-subscribed after the stream dropped', 10000);
  await pairedServer.send('beta');
  await waitFor(() => watched.includes('beta'), 'the watcher received a broadcast after reconnecting');
  assert(true, 'an established SSE stream reconnects after it drops');
  await watcher.disconnect();
  await pairedServer.disconnect();

  console.log('\n--- Test 10: HTTP Poller mode serves the latest replay payload ---');
  const pollingServer = createHttpServerTransport({
    ip: '127.0.0.1', port: 0, httpFormat: 'json', httpPath: '/poll?site=one',
    httpPolling: true, httpTls: false,
  });
  const pollingResult = await pollingServer.connect();
  const get = () => new Promise((resolve, reject) => {
    require('http').get({
      hostname: '127.0.0.1',
      port: pollingResult.address.port,
      path: '/poll?site=one',
    }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, type: response.headers['content-type'], body }));
    }).on('error', reject);
  });
  assert(pollingServer.hasRecipients() === true, 'polling mode can accept replay data before the first GET');
  assert((await get()).status === 204, 'polling mode returns 204 before a replay payload is available');
  assert((await pollingServer.send('{"id":1}')).delivered === true, 'polling mode stores replay payloads without SSE watchers');
  const polled = await get();
  assert(polled.status === 200, 'polling mode returns the latest replay payload');
  assert(polled.type === 'application/json', 'polling mode uses the selected payload content type');
  assert(polled.body === '{"id":1}', 'polling mode preserves the latest payload');
  await pollingServer.disconnect();

  console.log(`\n=== Test Results ===`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);
  if (failed > 0) process.exit(1);
})();
