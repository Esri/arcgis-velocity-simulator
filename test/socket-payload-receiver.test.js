const assert = require('assert');
const { EventEmitter } = require('events');
const {
  attachTcpPayloadReceiver,
  finishTcpPayloadReceiver,
  createUdpPayloadReceiver,
  assertSocketPayloadFormat,
} = require('../src/socket-payload-receiver.js');
const { UDP_MAX_PAYLOAD_BYTES } = require('../src/payload-format-utils.js');

let passed = 0;
function test(name, run) {
  try {
    run();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

function capture(format = 'delimited', decoderOptions = {}) {
  const records = [];
  const warnings = [];
  const warningContexts = [];
  return {
    records,
    warnings,
    warningContexts,
    options: {
      format,
      decoderOptions,
      onRecord: (raw, context) => records.push({ raw, context }),
      onWarning: (message, context) => {
        warnings.push(message);
        warningContexts.push(context);
      },
    },
  };
}

console.log('socket-payload-receiver.test.js');

test('socket formats reject unsupported and missing explicit values', () => {
  for (const format of ['delimited', 'json', 'geo-json', 'esri-json']) {
    assert.doesNotThrow(() => assertSocketPayloadFormat(format, 'tcpFormat'));
  }
  for (const format of ['', null, 'xml', 'geojson']) {
    assert.throws(() => assertSocketPayloadFormat(format, 'tcpFormat'), /tcpFormat/);
  }
});

test('TCP sockets keep independent UTF-8 and record state', () => {
  const first = capture('json');
  const second = capture('json');
  const a = new EventEmitter();
  const b = new EventEmitter();
  attachTcpPayloadReceiver(a, first.options);
  attachTcpPayloadReceiver(b, second.options);
  const payload = Buffer.from('{"value":"雪"}');
  const split = payload.indexOf(Buffer.from('雪')) + 1;
  a.emit('data', payload.subarray(0, split));
  b.emit('data', Buffer.from('{"other":2}'));
  assert.strictEqual(first.records.length, 0);
  a.emit('data', payload.subarray(split));
  assert.deepStrictEqual(first.records.map((record) => record.raw), ['{"value":"雪"}']);
  assert.deepStrictEqual(second.records.map((record) => record.raw), ['{"other":2}']);
  a.emit('end');
  b.emit('close');
  assert.deepStrictEqual(first.warnings, []);
});

test('TCP CSV keeps quoted line breaks and escaped quotes in one record', () => {
  const state = capture();
  const socket = new EventEmitter();
  attachTcpPayloadReceiver(socket, state.options);
  for (const chunk of ['id,"first\n', 'second ""', 'quoted"""\r', '\nnext,row\n']) {
    socket.emit('data', Buffer.from(chunk));
  }
  socket.emit('end');
  assert.deepStrictEqual(state.records.map((record) => record.raw), [
    'id,"first\nsecond ""quoted"""', 'next,row',
  ]);
  assert.deepStrictEqual(state.warnings, []);
});

test('TCP ignores blank and whitespace-only records but retains quoted empty fields', () => {
  const state = capture();
  const socket = new EventEmitter();
  attachTcpPayloadReceiver(socket, state.options);
  socket.emit('data', Buffer.from('\n\r\none,row\n\n \t\n""\n'));
  socket.emit('end');
  assert.deepStrictEqual(state.records.map((record) => record.raw), ['one,row', '""']);
  assert.deepStrictEqual(state.warnings, []);
});

test('TCP callers can explicitly keep empty records', () => {
  const state = capture('delimited', { skipEmptyRecords: false });
  const socket = new EventEmitter();
  attachTcpPayloadReceiver(socket, state.options);
  socket.emit('data', Buffer.from('\n'));
  socket.emit('end');
  assert.deepStrictEqual(state.records.map((record) => record.raw), ['']);
});

test('TCP retains valid records on both sides of a malformed document', () => {
  const state = capture('json');
  const socket = new EventEmitter();
  attachTcpPayloadReceiver(socket, state.options);
  socket.emit('data', Buffer.from('{"valid":1}{"bad":}{"next":2}'));
  socket.emit('end');
  assert.deepStrictEqual(state.records.map((record) => record.raw), [
    '{"valid":1}', '{"bad":}', '{"next":2}',
  ]);
  assert.strictEqual(state.warnings.length, 1);
});

test('TCP feature validation warns without discarding the incoming JSON', () => {
  const state = capture('geo-json');
  const socket = new EventEmitter();
  attachTcpPayloadReceiver(socket, state.options);
  socket.emit('data', Buffer.from('{"notAFeature":1}'));
  assert.deepStrictEqual(state.records.map((record) => record.raw), ['{"notAFeature":1}']);
  assert.strictEqual(state.warnings.length, 1);
  socket.emit('end');
});

test('TCP record and warning callbacks receive the static socket context', () => {
  const state = capture('json');
  const socket = new EventEmitter();
  const context = { address: '127.0.0.1', port: 10003 };
  attachTcpPayloadReceiver(socket, { ...state.options, context });
  socket.emit('data', Buffer.from('{"bad":}'));
  socket.emit('end');
  assert.deepStrictEqual(state.warningContexts, [context]);
  assert.deepStrictEqual(state.records, [{ raw: '{"bad":}', context }]);
});

test('TCP EOF, close, and explicit cleanup flush an incomplete record only once', () => {
  for (const terminal of ['end', 'close', 'error', 'explicit']) {
    const state = capture('json');
    const socket = new EventEmitter();
    attachTcpPayloadReceiver(socket, state.options);
    socket.on('error', () => {});
    socket.emit('data', Buffer.from('{"pending":'));
    if (terminal === 'explicit') finishTcpPayloadReceiver(socket);
    else socket.emit(terminal, new Error('Peer disconnected'));
    socket.emit('close');
    finishTcpPayloadReceiver(socket);
    assert.deepStrictEqual(state.records.map((record) => record.raw), ['{"pending":']);
    assert.strictEqual(state.warnings.length, 1);
    assert.strictEqual(socket.listenerCount('data'), 0);
  }
});

test('TCP oversized incomplete input warns and does not poison the next record', () => {
  const state = capture('json', { maxRecordBytes: 32 });
  const socket = new EventEmitter();
  attachTcpPayloadReceiver(socket, state.options);
  socket.emit('data', Buffer.from(`{"long":"${'x'.repeat(64)}`));
  socket.emit('data', Buffer.from('{"next":1}'));
  socket.emit('end');
  assert.ok(state.warnings.some((message) => /exceed|limit|maximum/i.test(message)));
  assert.ok(state.records.some((record) => record.raw === '{"next":1}'));
});

test('UDP injected control packets are excluded before format inspection', () => {
  const state = capture('json');
  const control = Buffer.from('test-control-packet');
  const receive = createUdpPayloadReceiver({
    ...state.options,
    isControlDatagram: (buffer) => buffer.equals(control),
  });
  receive(control);
  assert.deepStrictEqual(state.records, []);
  assert.deepStrictEqual(state.warnings, []);
});

test('UDP has no application-specific control policy without an injected predicate', () => {
  const state = capture();
  createUdpPayloadReceiver(state.options)(Buffer.from('test-control-packet'));
  assert.strictEqual(state.records[0].raw, 'test-control-packet');
  assert.throws(() => createUdpPayloadReceiver({
    ...state.options, isControlDatagram: true,
  }), /isControlDatagram/);
});

test('UDP preserves raw documents and sender context without joining datagrams', () => {
  const state = capture('json');
  const receive = createUdpPayloadReceiver(state.options);
  const one = { address: '127.0.0.1', port: 10001 };
  const two = { address: '127.0.0.1', port: 10002 };
  receive(Buffer.from('{"id":'), one);
  receive(Buffer.from('1}'), two);
  receive(Buffer.from('{\n  "complete": true\n}\n'), one);
  assert.deepStrictEqual(state.records, [
    { raw: '{"id":', context: one },
    { raw: '1}', context: two },
    { raw: '{\n  "complete": true\n}\n', context: one },
  ]);
  assert.strictEqual(state.warnings.length, 2);
  assert.deepStrictEqual(state.warningContexts, [one, two]);
});

test('UDP reports invalid UTF-8 and byte-limit failures without fabricated data', () => {
  const state = capture();
  const receive = createUdpPayloadReceiver(state.options);
  receive(Buffer.from([0xff]));
  receive(Buffer.alloc(UDP_MAX_PAYLOAD_BYTES + 1, 0x61));
  assert.deepStrictEqual(state.records, []);
  assert.strictEqual(state.warnings.length, 2);
  receive(Buffer.from('still,receiving'));
  assert.strictEqual(state.records[0].raw, 'still,receiving');
});

test('UDP keeps multiple CSV rows in one invalid datagram rather than splitting them', () => {
  const state = capture();
  createUdpPayloadReceiver(state.options)(Buffer.from('one,row\ntwo,row\n'));
  assert.strictEqual(state.records.length, 1);
  assert.strictEqual(state.records[0].raw, 'one,row\ntwo,row\n');
  assert.strictEqual(state.warnings.length, 1);
});

console.log(`\n${passed} passed`);
