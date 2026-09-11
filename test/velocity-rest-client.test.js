const assert = require('assert');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');
const tlsUtils = require('../src/tls-utils');
const {
  jsonRequest, generateToken, generateOAuthToken, TokenManager, MAX_RESPONSE_BYTES,
} = require('../src/velocity-rest-client');

async function withResponse(scenario, callback) {
  const original = { http: http.request, https: https.request, roots: tlsUtils.getSystemRootCertificates };
  const roots = Buffer.from('synthetic bundled and operating-system root certificates');
  const calls = [];
  const fake = (options, receive) => {
    const req = new EventEmitter();
    req.destroy = () => { req.destroyed = true; };
    req.write = value => { req.body = value; };
    req.end = () => {
      if (scenario.wait) return;
      queueMicrotask(() => {
        if (scenario.networkError) {
          req.emit('error', Object.assign(new Error('secret-password secret-token'), { code: scenario.networkCode }));
          return;
        }
        const res = new EventEmitter();
        res.statusCode = scenario.status || 200;
        res.resume = () => {};
        res.destroy = () => {};
        receive(res);
        if (scenario.aborted) { res.emit('aborted'); return; }
        const body = scenario.body === undefined ? JSON.stringify(scenario.json || {}) : scenario.body;
        res.emit('data', Buffer.from(body));
        res.emit('end');
      });
    };
    calls.push({ options, req });
    return req;
  };
  http.request = fake;
  https.request = fake;
  tlsUtils.getSystemRootCertificates = () => ({ pemBuffer: roots });
  try { await callback(calls, roots); } finally {
    http.request = original.http;
    https.request = original.https;
    tlsUtils.getSystemRootCertificates = original.roots;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function main() {
  await withResponse({ json: [] }, async (calls, roots) => {
    assert.deepStrictEqual(await jsonRequest('https://example.com:7443/base/feed', { token: 'current', headers: { authorization: 'old' } }), []);
    assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer current');
    assert.strictEqual(calls[0].options.headers.authorization, undefined);
    assert.strictEqual(calls[0].options.path, '/base/feed');
    assert.strictEqual(calls[0].options.port, '7443');
    assert.strictEqual(calls[0].options.ca, roots);
    assert.strictEqual(calls[0].options.rejectUnauthorized, true);
    await jsonRequest('http://example.com/data', { method: 'POST', body: '{}' });
    assert.strictEqual(calls[1].options.port, 80);
    assert.strictEqual(calls[1].req.body, '{}');
    assert.strictEqual(calls[1].options.ca, undefined);
    assert.strictEqual(calls[1].options.rejectUnauthorized, undefined);
    await jsonRequest('https://[::1]:443/root/feed');
    assert.strictEqual(calls[2].options.hostname, '::1');
    assert.strictEqual(calls[2].options.port, 443);
    await jsonRequest('https://example.com', { rejectUnauthorized: false, ca: 'untrusted' });
    assert.strictEqual(calls[3].options.rejectUnauthorized, true);
    assert.strictEqual(calls[3].options.ca, roots);
  });
  for (const scenario of [
    { status: 401, json: { error: { code: 498, message: 'secret-token', details: ['secret-password'] } }, code: 'ARCGIS_ERROR' },
    { status: 200, json: { error: { code: 498, message: 'secret-token' } }, code: 'ARCGIS_ERROR' },
    { status: 302, body: 'secret-token', code: 'REDIRECT' },
    { status: 500, json: { message: 'secret-token' }, code: 'HTTP_ERROR' },
    { status: 404, body: '<html>secret-token</html>', code: 'INVALID_JSON' },
    { body: 'x'.repeat(MAX_RESPONSE_BYTES + 1), code: 'RESPONSE_TOO_LARGE' },
    { networkError: true, code: 'NETWORK_ERROR' },
    { aborted: true, code: 'NETWORK_ERROR' },
    { wait: true, code: 'TIMEOUT' },
  ]) {
    const logs = [];
    await withResponse(scenario, async calls => {
      await assert.rejects(jsonRequest('https://example.com/base?token=secret-token', {
        timeoutMs: 5, onLog: (level, message) => logs.push(message),
      }), error => {
        assert.strictEqual(error.code, scenario.code);
        assert.ok(!JSON.stringify(error).includes('secret-'));
        assert.ok(!error.message.includes('secret-'));
        assert.strictEqual(error.rawBody, undefined);
        assert.strictEqual(error.cause, undefined);
        return true;
      });
      assert.strictEqual(calls.length, 1);
    });
    assert.ok(!logs.join('').includes('secret-'));
  }
  for (const url of ['file:///data', 'https://name:password@example.com', 'not-a-url']) {
    await assert.rejects(jsonRequest(url), /Invalid ArcGIS request/);
  }
  for (const [networkCode, message] of [
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', /certificate verification failed/],
    ['CERT_HAS_EXPIRED', /validity period/],
    ['ERR_TLS_CERT_ALTNAME_INVALID', /does not match the hostname/],
    ['ENOTFOUND', /hostname could not be resolved/],
    ['ECONNREFUSED', /connection was refused/],
    ['ECONNRESET', /connection failed/],
  ]) {
    await withResponse({ networkError: true, networkCode }, async () => {
      await assert.rejects(jsonRequest('https://example.com?token=secret-token'), error => {
        assert.strictEqual(error.code, 'NETWORK_ERROR');
        assert.strictEqual(error.networkCode, networkCode);
        assert.match(error.message, message);
        assert.ok(error.message.includes(networkCode));
        assert.ok(!error.message.includes('secret-'));
        assert.ok(!error.message.includes('example.com'));
        return true;
      });
    });
  }
  await withResponse({ networkError: true, networkCode: 'secret-token' }, async () => {
    await assert.rejects(jsonRequest('https://example.com'), error => {
      assert.strictEqual(error.networkCode, undefined);
      assert.ok(!error.message.includes('secret-token'));
      return true;
    });
  });
  for (const timeoutMs of [0, -1, Infinity, 120001]) {
    await assert.rejects(jsonRequest('https://example.com', { timeoutMs }));
  }
  const now = Date.now();
  const issued = [];
  const options = { now: () => now, request: async (url, request) => {
    issued.push({ url, ...request });
    return url.endsWith('oauth2/token')
      ? { access_token: 'oauth-token', expires_in: 60 }
      : { token: 'password-token', expires: now + 60000 };
  } };
  assert.deepStrictEqual(await generateToken('https://example.com:443/nested/portal', 'name', ' secret ', 60, options),
    { token: 'password-token', expires: now + 60000 });
  assert.strictEqual(issued[0].url, 'https://example.com:443/nested/portal/sharing/rest/generateToken');
  assert.strictEqual(new URLSearchParams(issued[0].body).get('password'), ' secret ');
  assert.deepStrictEqual(await generateOAuthToken('https://example.com/portal', 'client', 'secret', options),
    { token: 'oauth-token', expires: now + 60000 });
  assert.strictEqual(issued[1].url, 'https://example.com/portal/sharing/rest/oauth2/token');
  assert.strictEqual(new URLSearchParams(issued[1].body).get('grant_type'), 'client_credentials');
  await assert.rejects(generateToken('http://example.com', 'name', 'secret', 60, options), /HTTPS/);
  for (const expires of [undefined, null, 'bad', 0, now, Infinity, 1e20]) {
    await assert.rejects(generateToken('https://example.com', 'name', 'secret', 60, {
      request: async () => ({ token: 'value', expires }),
    }), /invalid or expired token/);
  }
  for (const expires_in of [undefined, null, 'bad', 0, -1, Infinity]) {
    await assert.rejects(generateOAuthToken('https://example.com', 'client', 'secret', {
      request: async () => ({ access_token: 'value', expires_in }),
    }), /invalid or expired token/);
  }
  const queues = [];
  const manager = new TokenManager({ now: () => now, request: () => {
    const next = deferred(); queues.push(next); return next.promise;
  } });
  const refreshed = [];
  manager.on('refreshed', token => refreshed.push(token));
  const login = manager.loginWithPassword('https://example.com', 'name', 'secret');
  queues[0].resolve({ token: 'initial', expires: now + 60000 });
  await login;
  assert.strictEqual(queues.length, 1);
  const first = manager.refresh();
  const second = manager.refresh();
  assert.strictEqual(first, second);
  assert.strictEqual(queues.length, 2);
  queues[1].resolve({ token: 'fresh', expires: now + 60000 });
  await first;
  assert.strictEqual(manager.token, 'fresh');
  const staleRefresh = manager.refresh();
  manager.logout();
  queues[2].resolve({ token: 'stale', expires: now + 60000 });
  await assert.rejects(staleRefresh, /session changed/);
  assert.strictEqual(manager.token, null);
  assert.strictEqual(manager.isAuthenticated, false);
  const oldLogin = manager.loginWithPassword('https://example.com', 'old', 'secret');
  const newLogin = manager.loginWithOAuth('https://example.com/portal', 'client', 'secret');
  queues[4].resolve({ access_token: 'latest', expires_in: 60 });
  await newLogin;
  queues[3].resolve({ token: 'old', expires: now + 60000 });
  await assert.rejects(oldLogin, /session changed/);
  assert.strictEqual(manager.token, 'latest');
  assert.deepStrictEqual(refreshed, ['initial', 'fresh', 'latest']);
  const errorRefresh = manager.refresh();
  queues[5].reject(new Error('Failure'));
  await assert.rejects(errorRefresh, /Failure/);
  assert.strictEqual(manager.token, 'latest');
  const oldFailure = manager.loginWithPassword('https://example.com', 'old', 'secret');
  manager.logout();
  queues[6].reject(new Error('Old failure'));
  await assert.rejects(oldFailure, /session changed/);
  const backgroundLogin = manager.loginWithPassword('https://example.com', 'old', 'secret');
  queues[7].resolve({ token: 'background', expires: now + 60000 });
  await backgroundLogin;
  let backgroundError;
  manager.on('error', error => { backgroundError = error; });
  manager._backgroundRefresh(5, manager._generation);
  queues[8].reject(new Error('Refresh unavailable'));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(backgroundError.message, /Refresh unavailable/);
  assert.strictEqual(manager.token, 'background');
  const refreshDuringLogin = manager.refresh();
  const replacementLogin = manager.loginWithPassword('https://other.example.com/portal', 'new', 'secret');
  queues[10].resolve({ token: 'replacement', expires: now + 60000 });
  await replacementLogin;
  queues[9].resolve({ token: 'discarded', expires: now + 60000 });
  await assert.rejects(refreshDuringLogin, /session changed/);
  assert.strictEqual(manager.token, 'replacement');
  manager.logout();
  console.log('velocity-rest-client tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
