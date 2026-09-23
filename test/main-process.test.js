/**
 * Main-process transport lifecycle tests
 * Run with: node test/main-process.test.js
 *
 * `src/main.js` needs a real Electron runtime, so these tests read its source
 * and assert the wiring that cannot be exercised from Node alone: that the
 * disconnect handler awaits every asynchronous teardown before it reports
 * 'disconnected', that a teardown failure is caught rather than left as a
 * rejected promise, and that the WebSocket send path handles the promise its
 * client transport returns.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const mainSource = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

/**
 * Returns the body of one `ipcMain` registration, from its marker up to the
 * next top-level `ipcMain` registration.
 */
function ipcBlock(marker) {
  const start = mainSource.indexOf(marker);
  assert.notStrictEqual(start, -1, `${marker} must exist in main.js`);
  const rest = mainSource.slice(start + marker.length);
  const end = rest.search(/\nipcMain\.(handle|on|once)\(/);
  return rest.slice(0, end === -1 ? rest.length : end);
}

/** Returns one `else if` branch of the disconnect or send handler. */
function branch(block, condition) {
  const start = block.indexOf(condition);
  assert.notStrictEqual(start, -1, `${condition} must exist`);
  const rest = block.slice(start + condition.length);
  const end = rest.search(/\n {4}\} else if |\n {4}\}\n/);
  return rest.slice(0, end === -1 ? rest.length : end);
}

console.log('main-process.test.js');

const disconnectBlock = ipcBlock("ipcMain.handle('disconnect'");
const sendBlock = ipcBlock("ipcMain.on('send-data'");

test('the disconnect handler is asynchronous', () => {
  assert.match(mainSource, /ipcMain\.handle\('disconnect', async \(\) => \{/,
    'disconnect must be an async handler so teardown can be awaited');
});

test('every asynchronous teardown is awaited, never fire-and-forget', () => {
  assert.doesNotMatch(disconnectBlock, /disconnect\(\)\.then\(/,
    'no teardown may be left as a floating then()');
  assert.doesNotMatch(disconnectBlock, /^\s*(wsTransport|grpcTransport|httpTransport|active)\.disconnect\(\);\s*$/m,
    'no teardown may be started without awaiting it');
  const awaited = disconnectBlock.match(/await active\.disconnect\(\);/g) || [];
  assert.strictEqual(awaited.length, 4,
    'XMPP, gRPC, HTTP, and WebSocket teardown must each be awaited');
});

['wsTransport', 'grpcTransport', 'httpTransport'].forEach((transport) => {
  test(`the ${transport} branch awaits teardown before reporting 'disconnected'`, () => {
    const body = branch(disconnectBlock, `} else if (${transport}) {`);
    const nulled = body.indexOf(`${transport} = null;`);
    const awaited = body.indexOf('await active.disconnect();');
    const reported = body.indexOf("emitConnectionStatus('disconnected'");
    assert.ok(nulled > -1, `${transport} must be cleared during teardown`);
    assert.ok(awaited > -1, `${transport} teardown must be awaited`);
    assert.ok(reported > -1, `${transport} teardown must report the new state`);
    assert.ok(nulled < awaited, 'the reference is cleared first, so no send races the teardown');
    assert.ok(awaited < reported, "'disconnected' must only be reported once teardown finished");
    assert.match(body, /\} catch \(err\) \{/, 'a teardown failure must be caught');
    const catchIndex = body.indexOf('} catch (err) {');
    assert.match(body.slice(catchIndex), /emitConnectionStatus\('disconnected'/,
      'a failed teardown must still finalize the state rather than leave the user connected');
  });
});

test('the WebSocket send path handles the promise the client transport returns', () => {
  const body = branch(sendBlock, '} else if (wsTransport) {');
  assert.match(body, /Promise\.resolve\(wsTransport\.send\(data\)\)\.catch\(/,
    'an asynchronous send rejection must be caught instead of becoming an unhandled rejection');
  assert.match(body, /logStatus\(`WebSocket send error: \$\{err\.message\}`\)/,
    'a rejected send must reach the status log');
  const catches = body.match(/logStatus\(`WebSocket send error: \$\{err\.message\}`\)/g) || [];
  assert.strictEqual(catches.length, 2,
    'the outer try must still report a synchronous throw as well');
  assert.match(body, /\} catch \(err\) \{/, 'the synchronous path keeps its try/catch');
});

test('the UI UDP send path shares LF encoding and rejects the final oversized datagram', () => {
  const vm = require('vm');
  const net = require('net');
  const payloadUtils = require('../src/payload-format-utils');
  const { encodeUdpPayload } = require('../src/udp-utils');
  const sent = [];
  const logs = [];
  let send;
  const context = {
    ipcMain: { on: (_name, callback) => { send = callback; } },
    connection: { mode: 'client', port: 17009, ip: '127.0.0.1',
      socket: { send: (bytes, port, ip, callback) => { sent.push({ bytes, port, ip }); callback(); } } },
    activeSocketPayloadFormat: 'delimited',
    net, encodeUdpPayload, validatePayload: payloadUtils.validatePayload,
    assertTcpPayloadSize: payloadUtils.assertTcpPayloadSize,
    logStatus: message => logs.push(message),
  };
  const start = mainSource.indexOf("ipcMain.on('send-data'");
  const end = mainSource.indexOf("\nipcMain.", start + 1);
  vm.runInNewContext(mainSource.slice(start, end), context);
  send({}, '1,café');
  assert.deepStrictEqual(sent[0].bytes, Buffer.from('1,café\n'));
  assert.match(mainSource, /udpAppendNewline = true/);
  send({}, 'x'.repeat(65507));
  assert.strictEqual(sent.length, 1);
  assert(logs.some(message => message.includes('65507')));
  context.connection.udpAppendNewline = false;
  send({}, '2,plain');
  assert.deepStrictEqual(sent[1].bytes, Buffer.from('2,plain'));
});

test('the gRPC client transport receives a logging hook for teardown diagnostics', () => {
  assert.match(mainSource, /createGrpcClientTransport\(\{[^}]*onLog: \(level, message\) => velocityLog\(level, message\)/,
    'gRPC teardown diagnostics must reach the application log');
});

console.log(`\n${passed} passed`);
if (process.exitCode) {
  console.error('main-process tests failed');
}
