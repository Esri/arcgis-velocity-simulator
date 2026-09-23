const assert = require('assert');
const {
  normalizeSocketAddressFamily, normalizeSocketHost, resolveSocketEndpoint, tcpSocketOptions,
  normalizeUdpAddressFamily, resolveUdpEndpoint, udpEndpointKey, formatSocketEndpoint,
} = require('../src/socket-address-utils');

(async () => {
  assert.strictEqual(normalizeSocketAddressFamily(), 'auto');
  assert.strictEqual(normalizeUdpAddressFamily(), 'ipv4');
  assert.throws(() => normalizeUdpAddressFamily('auto'), /family/);
  assert.throws(() => normalizeSocketAddressFamily('invalid'), /family/);
  assert.strictEqual(normalizeSocketHost('[::1]', 'ipv6'), '::1');
  assert.strictEqual(normalizeSocketHost('0:0:0:0:0:0:0:1', 'ipv6'), '::1');
  assert.strictEqual(normalizeSocketHost('fe80::1%en0', 'ipv6'), 'fe80::1%en0');
  for (const [host, family] of [['127.0.0.1', 'ipv6'], ['::1', 'ipv4']]) {
    assert.throws(() => normalizeSocketHost(host, family), /does not match/);
  }
  for (const host of ['[::1]:5565', '[127.0.0.1]', 'http://host', 'user@host', 'bad host']) {
    assert.throws(() => normalizeSocketHost(host));
  }
  assert.throws(() => normalizeSocketHost('::ffff:127.0.0.1', 'ipv6'), /IPv4-mapped/);
  assert.strictEqual(normalizeSocketHost('::ffff:127.0.0.1'), '::ffff:7f00:1');
  const calls = [];
  const lookup = async (host, options) => {
    calls.push([host, options.family]);
    return { address: options.family === 6 ? '::1' : '127.0.0.1', family: options.family };
  };
  const automatic = await resolveSocketEndpoint('dual.example', 'auto', { lookup });
  assert.deepStrictEqual(automatic, { address: 'dual.example', family: 0 });
  assert.deepStrictEqual(calls, [], 'TCP Auto must leave DNS selection to net');
  await assert.rejects(resolveSocketEndpoint('0.0.0.0', 'auto'), /wildcard/);
  await assert.rejects(resolveSocketEndpoint('[::]', 'auto'), /wildcard/);
  assert.deepStrictEqual(await resolveSocketEndpoint('0.0.0.0', 'auto', { bind: true }), { address: '0.0.0.0', family: 0 });
  assert.deepStrictEqual(await resolveSocketEndpoint('::', 'auto', { bind: true }), { address: '::', family: 0 });
  assert.deepStrictEqual(tcpSocketOptions(automatic, 5565), { host: 'dual.example', port: 5565 });
  const ipv6 = await resolveSocketEndpoint('dual.example', 'ipv6', { lookup, bind: true });
  assert.deepStrictEqual(tcpSocketOptions(ipv6, 5565, { bind: true }), { host: '::1', port: 5565, ipv6Only: true });
  assert.deepStrictEqual(tcpSocketOptions(ipv6, 5565), { host: '::1', port: 5565, family: 6 });
  const udp4 = await resolveUdpEndpoint('dual.example', 'ipv4', { lookup });
  assert.deepStrictEqual(udp4.socketOptions, { type: 'udp4' });
  assert.deepStrictEqual(calls, [['dual.example', 6], ['dual.example', 4]]);
  const udp6 = await resolveUdpEndpoint('[::1]', 'ipv6');
  assert.deepStrictEqual(udp6.socketOptions, { type: 'udp6', ipv6Only: true });
  for (const [host, family] of [['0.0.0.0', 'ipv4'], ['::', 'ipv6']]) {
    assert.strictEqual((await resolveUdpEndpoint(host, family, { bind: true })).address, host);
    await assert.rejects(resolveUdpEndpoint(host, family), /wildcard/);
  }
  await assert.rejects(resolveUdpEndpoint('missing.example', 'ipv6', {
    lookup: async () => { throw new Error('private resolver details'); },
  }), error => /missing.example.*IPv6/.test(error.message) && !error.message.includes('private'));
  await assert.rejects(resolveUdpEndpoint('wrong.example', 'ipv6', {
    lookup: async () => ({ address: '127.0.0.1' }),
  }), /does not match/);
  assert.strictEqual(udpEndpointKey({ address: '::1', port: 5565 }), '["::1",5565]');
  assert.notStrictEqual(udpEndpointKey({ address: '::1', port: 5565 }), udpEndpointKey({ address: '::1', port: 5566 }));
  assert.throws(() => udpEndpointKey({ address: 'host', port: 5565 }), /recipient/);
  assert.throws(() => udpEndpointKey({ address: '::1', port: 65536 }), /recipient/);
  assert.strictEqual(formatSocketEndpoint({ address: '::1', port: 5565 }), '[::1]:5565');
  assert.strictEqual(formatSocketEndpoint({ address: '127.0.0.1', port: 5565 }), '127.0.0.1:5565');
  console.log('socket-address-utils: family, literal, DNS, wildcard, endpoint and TCP Auto tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
