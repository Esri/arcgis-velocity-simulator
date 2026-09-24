const assert = require('assert');
const { EventEmitter } = require('events');
const { decodeTcpHandshake: decode, writeTcpHandshake: write } = require('../src/tcp-handshake-utils');

class Socket extends EventEmitter {
  constructor(send) {
    super();
    this.writable = true;
    this.destroyed = false;
    this.write = send;
  }
  destroy() { this.destroyed = true; }
}

function noListeners(socket) {
  for (const name of ['drain', 'close', 'error']) assert.strictEqual(socket.listenerCount(name), 0, name);
}

(async () => {
  assert.strictEqual(decode().length, 0);
  assert.strictEqual(decode(' \t ').toString(), ' \t ');
  assert.strictEqual(decode('hi,café,雪').toString(), 'hi,café,雪');
  assert.strictEqual(decode(String.raw`\b\t\n\f\r\\\"\'`).toString(), '\b\t\n\f\r\\"\'');
  assert.strictEqual(decode(String.raw`\u0041\uu0042\uD83D\uDE00`).toString(), 'AB😀');
  assert.strictEqual(decode(String.raw`\0\12\377\777`).toString(), '\0\nÿ?7');
  assert.strictEqual(decode(String.raw` hello\r\n `, { useEscapes: false }).toString(), String.raw` hello\r\n `);
  assert.strictEqual(decode('x'.repeat(1024 * 1024)).length, 1024 * 1024);
  assert.throws(() => decode(String.raw`\u0041`.repeat(180000)), /character input limit/);
  assert.strictEqual(decode('é'.repeat(512 * 1024)).length, 1024 * 1024);
  assert.throws(() => decode('é'.repeat(512 * 1024) + 'x'), /1 MiB/);
  for (const text of ['secret\\', 'secret\\q', 'secret\\uXYZ1', 'secret\\u123', 'secret\\uD800', 'secret\\uDC00']) {
    assert.throws(() => decode(text), error => /TCP handshake/.test(error.message) && !error.message.includes('secret'));
  }
  assert.throws(() => decode(17), /string/);
  assert.throws(() => decode('', { useEscapes: 'secret' }), error => !error.message.includes('secret'));

  const empty = new Socket(() => { throw new Error('Empty greeting must not write'); });
  assert.deepStrictEqual(await write(empty, decode()), { bytesWritten: 0 });
  noListeners(empty);
  const immediate = new Socket((bytes, callback) => {
    assert.deepStrictEqual(bytes, Buffer.from('hi'));
    callback();
    return true;
  });
  assert.deepStrictEqual(await write(immediate, decode('hi')), { bytesWritten: 2 });
  noListeners(immediate);

  let callback;
  const backpressure = new Socket((_bytes, done) => { callback = done; return false; });
  let completed = false;
  const blocked = write(backpressure, decode('hello')).then(result => { completed = true; return result; });
  callback();
  await Promise.resolve();
  assert.strictEqual(completed, false);
  backpressure.emit('drain');
  assert.deepStrictEqual(await blocked, { bytesWritten: 5 });
  noListeners(backpressure);
  const earlyDrain = new Socket((_bytes, done) => {
    earlyDrain.emit('drain');
    done();
    return false;
  });
  await write(earlyDrain, decode('hello'));
  noListeners(earlyDrain);

  for (const action of ['error', 'close', 'abort', 'throw', 'callback']) {
    const controller = new AbortController();
    const socket = new Socket((_bytes, done) => {
      if (action === 'throw') throw new Error('secret greeting');
      if (action === 'callback') done(new Error('secret greeting'));
      return false;
    });
    const sending = write(socket, decode('secret greeting'), { signal: controller.signal });
    if (action === 'abort') controller.abort(new Error('secret abort reason'));
    else if (action === 'error') socket.emit('error', new Error('secret socket error'));
    else if (action === 'close') socket.emit('close');
    await assert.rejects(sending, error => error.code === (action === 'abort' ? 'TCP_HANDSHAKE_CANCELLED' : 'TCP_HANDSHAKE_FAILED')
      && error.message === (action === 'abort' ? 'TCP handshake cancelled before completion.' : 'TCP handshake could not be sent.')
      && !error.message.includes('secret') && !error.cause);
    assert.strictEqual(socket.destroyed, true);
    noListeners(socket);
  }
  const controller = new AbortController();
  controller.abort();
  const aborted = new Socket(() => { throw new Error('Aborted greeting must not write'); });
  await assert.rejects(write(aborted, decode('hi'), { signal: controller.signal }), /cancelled/);
  noListeners(aborted);
  const closed = new Socket(() => { throw new Error('Closed socket must not write'); });
  closed.destroy();
  await assert.rejects(write(closed, decode('secret greeting')), error =>
    error.code === 'TCP_HANDSHAKE_FAILED' && error.message === 'TCP handshake could not be sent.' && !error.cause);
  noListeners(closed);
  const stalled = new Socket(() => false);
  await assert.rejects(write(stalled, decode('hi'), { timeoutMs: 10 }), error => error.code === 'TCP_HANDSHAKE_TIMEOUT');
  assert(stalled.destroyed);
  noListeners(stalled);
  await assert.rejects(write(empty, decode('hi'), { timeoutMs: -1 }), /timeout/);
  console.log('tcp-handshake-utils: escapes, UTF-8 bounds, ordering, backpressure, cancellation, and secrecy passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
