const assert = require('assert');
const udp = require('../src/udp-utils.js');
const { assertDirectUdpOptions, encodeUdpPayload } = udp;

assert.deepStrictEqual(Object.keys(udp).sort(), ['assertDirectUdpOptions', 'encodeUdpPayload']);
assert.doesNotThrow(() => assertDirectUdpOptions());
assert.doesNotThrow(() => assertDirectUdpOptions({ udpLocalHost: '127.0.0.1', udpLocalPort: 0 }));
for (const key of ['udpConnectionMode', 'udpRegistrationIntervalMs']) {
  for (const value of ['direct', 'registered', undefined, null, '', 0, false, 'private-value']) {
    assert.throws(() => assertDirectUdpOptions({ [key]: value }), error => {
      assert(error instanceof Error);
      assert(error.message.includes(key));
      assert.match(error.message, /obsolete|no longer supported/i);
      assert(!error.message.includes('private-value'), 'Errors must not echo option values');
      return true;
    });
  }
}
assert.deepStrictEqual(encodeUdpPayload('1,café', 'delimited'), Buffer.from('1,café\n'));
assert.deepStrictEqual(encodeUdpPayload('1,café\n', 'delimited'), Buffer.from('1,café\n'));
assert.deepStrictEqual(encodeUdpPayload('1,café\r\n', 'delimited'), Buffer.from('1,café\r\n'));
assert.deepStrictEqual(encodeUdpPayload('1,café', 'delimited', false), Buffer.from('1,café'));
assert.deepStrictEqual(encodeUdpPayload('UDP Client connected', 'delimited', false), Buffer.from('UDP Client connected'));
assert.deepStrictEqual(encodeUdpPayload('UDP Client connected', 'delimited'), Buffer.from('UDP Client connected\n'));
for (const [format, payload] of [
  ['json', '{"id":1}'],
  ['geo-json', '{"type":"Feature","geometry":null,"properties":{"id":1}}'],
  ['esri-json', '{"attributes":{"id":1}}'],
]) {
  for (const appendNewline of [undefined, false, true]) {
    assert.deepStrictEqual(encodeUdpPayload(payload, format, appendNewline), Buffer.from(payload));
    assert.deepStrictEqual(encodeUdpPayload(`${payload}\n`, format, appendNewline), Buffer.from(`${payload}\n`));
  }
}
assert.strictEqual(encodeUdpPayload('é'.repeat(32753), 'delimited').length, 65507);
assert.strictEqual(encodeUdpPayload(`${'é'.repeat(32753)}\n`, 'delimited').length, 65507);
assert.throws(() => encodeUdpPayload('é'.repeat(32753) + 'x', 'delimited'), /65507/);
assert.strictEqual(encodeUdpPayload('x'.repeat(65507), 'delimited', false).length, 65507);
console.log('udp-utils: direct-only validation, public exports, framing and byte limits passed');
