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

console.log('\n--- Test 1: Constants ---');
assert(HTTP_FORMATS.JSON === 'json', 'HTTP_FORMATS.JSON is json');
assert(HTTP_FORMATS.DELIMITED === 'delimited', 'HTTP_FORMATS.DELIMITED is delimited');
assert(HTTP_FORMATS.ESRI_JSON === 'esri-json', 'HTTP_FORMATS.ESRI_JSON is esri-json');
assert(HTTP_FORMATS.GEO_JSON === 'geo-json', 'HTTP_FORMATS.GEO_JSON is geo-json');
assert(HTTP_FORMATS.XML === 'xml', 'HTTP_FORMATS.XML is xml');
assert(VALID_HTTP_FORMATS.size === 5, 'VALID_HTTP_FORMATS has 5 entries');
assert(HTTP_DEFAULT_PORT === 80, 'HTTP_DEFAULT_PORT is 80');
assert(HTTPS_DEFAULT_PORT === 443, 'HTTPS_DEFAULT_PORT is 443');

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

  console.log(`\n=== Test Results ===`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);
  if (failed > 0) process.exit(1);
})();

