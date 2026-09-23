const assert = require('assert');
const {
  DEFAULT_UDP_CLIENT_REGISTRATION_INTERVAL_MS,
  MAX_UDP_CLIENT_REGISTRATION_INTERVAL_MS,
  UDP_CLIENT_REGISTRATION_MESSAGE,
  startUdpClientRegistration,
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

(async () => {
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
  console.log('udp-utils tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
