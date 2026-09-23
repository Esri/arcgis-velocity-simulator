const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const {
  DEFAULT_UDP_CLIENT_REGISTRATION_INTERVAL_MS,
  MAX_UDP_CLIENT_REGISTRATION_INTERVAL_MS,
  UDP_CLIENT_REGISTRATION_MESSAGE,
  startUdpClientRegistration,
  encodeUdpPayload,
} = require('../src/udp-utils.js');

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function testRenewalDoesNotOverlapAndStops() {
  let sends = 0;
  let active = 0;
  let maximumActive = 0;
  const socket = {
    send(_bytes, callback) {
      sends += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      setTimeout(() => {
        active -= 1;
        callback();
      }, 12);
    },
  };
  const registration = startUdpClientRegistration(socket, { intervalMs: 5, onError: () => {} });
  await registration.ready;
  await delay(45);
  registration.stop();
  const stoppedAt = sends;
  await delay(25);
  assert.ok(stoppedAt >= 3);
  assert.strictEqual(sends, stoppedAt);
  assert.strictEqual(maximumActive, 1);
}

async function testStopBeforeInitialCallback() {
  let callback;
  let sends = 0;
  const socket = {
    send(bytes, done) {
      sends += 1;
      assert.strictEqual(bytes.toString('utf8'), UDP_CLIENT_REGISTRATION_MESSAGE);
      callback = done;
    },
  };
  const registration = startUdpClientRegistration(socket, { intervalMs: 5, onError: () => {} });
  registration.stop();
  callback();
  await registration.ready;
  await delay(15);
  assert.strictEqual(sends, 1);
}

async function testRenewalErrorsAreSurfaced() {
  let sends = 0;
  const errors = [];
  const socket = {
    send(_bytes, callback) {
      sends += 1;
      callback(sends === 1 ? null : new Error('temporary failure'));
    },
  };
  const registration = startUdpClientRegistration(socket, {
    intervalMs: 5,
    onError: (error) => errors.push(error.message),
  });
  await registration.ready;
  await delay(18);
  registration.stop();
  assert.ok(sends >= 2);
  assert.ok(errors.every((message) => message === 'temporary failure'));
  assert.ok(errors.length >= 1);
}

async function testInitialFailureStopsRenewal() {
  let sends = 0;
  const socket = {
    send(_bytes, callback) {
      sends += 1;
      callback(new Error('initial failure'));
    },
  };
  const registration = startUdpClientRegistration(socket, {
    intervalMs: 5,
    onError: () => {
      throw new Error('Renewal callback must not handle initial failure');
    },
  });
  await assert.rejects(registration.ready, /initial failure/);
  await delay(15);
  assert.strictEqual(sends, 1);
}

function testThrowingErrorCallbackStopsAndSurfaces() {
  const modulePath = path.resolve(__dirname, '../src/udp-utils.js');
  const script = `
    const { startUdpClientRegistration } = require(${JSON.stringify(modulePath)});
    let sends = 0;
    let surfaced = '';
    process.once('uncaughtException', (error) => {
      surfaced = error.message;
      setTimeout(() => {
        if (surfaced !== 'callback failure' || sends !== 2) process.exit(2);
        process.exit(0);
      }, 20);
    });
    const registration = startUdpClientRegistration({
      send(_bytes, callback) {
        sends += 1;
        callback(sends === 1 ? null : new Error('renewal failure'));
      },
    }, {
      intervalMs: 5,
      onError() { throw new Error('callback failure'); },
    });
    registration.ready.catch(() => process.exit(3));
    setTimeout(() => process.exit(4), 200);
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
}

(async () => {
  assert.deepStrictEqual(encodeUdpPayload('1,café', 'delimited'), Buffer.from('1,café\n'));
  assert.deepStrictEqual(encodeUdpPayload('1,café\n', 'delimited'), Buffer.from('1,café\n'));
  assert.deepStrictEqual(encodeUdpPayload('1,café\r\n', 'delimited'), Buffer.from('1,café\r\n'));
  assert.deepStrictEqual(encodeUdpPayload('1,café', 'delimited', false), Buffer.from('1,café'));
  for (const [format, payload] of [
    ['json', '{"id":1}'],
    ['geo-json', '{"type":"Feature","geometry":null,"properties":{"id":1}}'],
    ['esri-json', '{"attributes":{"id":1}}'],
  ]) {
    assert.deepStrictEqual(encodeUdpPayload(payload, format), Buffer.from(payload));
    assert.deepStrictEqual(encodeUdpPayload(`${payload}\n`, format), Buffer.from(`${payload}\n`));
  }
  assert.strictEqual(encodeUdpPayload('é'.repeat(32753), 'delimited').length, 65507);
  assert.strictEqual(encodeUdpPayload(`${'é'.repeat(32753)}\n`, 'delimited').length, 65507);
  assert.throws(() => encodeUdpPayload('é'.repeat(32753) + 'x', 'delimited'), /65507/);
  assert.strictEqual(encodeUdpPayload('x'.repeat(65507), 'delimited', false).length, 65507);
  assert.strictEqual(DEFAULT_UDP_CLIENT_REGISTRATION_INTERVAL_MS, 30000);
  assert.strictEqual(MAX_UDP_CLIENT_REGISTRATION_INTERVAL_MS, 2147483647);
  for (const intervalMs of [0, -1, 1.5, 2147483648, Infinity]) {
    assert.throws(
      () => startUdpClientRegistration({ send() {} }, { intervalMs, onError: () => {} }),
      /interval/,
    );
  }
  assert.throws(
    () => startUdpClientRegistration({}, { intervalMs: 1, onError: () => {} }),
    /socket/,
  );
  assert.throws(
    () => startUdpClientRegistration({ send() {} }, { intervalMs: 1, onError: true }),
    /onError/,
  );
  assert.throws(
    () => startUdpClientRegistration({ send() {} }, { intervalMs: 1 }),
    /onError/,
  );
  await testRenewalDoesNotOverlapAndStops();
  await testStopBeforeInitialCallback();
  await testRenewalErrorsAreSurfaced();
  await testInitialFailureStopsRenewal();
  testThrowingErrorCallbackStopsAndSurfaces();
  console.log('udp-utils tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
