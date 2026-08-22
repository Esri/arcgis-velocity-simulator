/**
 * Client TLS Verification Tests
 * Run with: node test/tls-verification.test.js
 *
 * Client-mode certificate verification is on by default across gRPC, HTTP, and
 * WebSocket, and it is bypassed only through an explicit opt-in that is shared
 * with the ArcGIS Velocity Logger under the same option names.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  resolveClientTlsVerification,
  buildHttpsAgentOptions,
  buildHttpsServerOptions,
} = require('../src/tls-utils');
const { buildChannelCredentials } = require('../src/grpc-transport');
const { HttpClientTransport } = require('../src/http-transport');
const { createWsClientTransport } = require('../src/ws-transport');
const { parseCommandLineArgs, getCommandHelpText, getCommandLineReferenceData } = require('../src/cli-options');

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

async function asyncTest(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

const CLI_PARAMETERS = getCommandLineReferenceData().parameters;
const findParameter = (name) => CLI_PARAMETERS.find((entry) => entry.name === name);
const createArgv = (args) => ['/usr/bin/node', '/app/main.js', ...args];

console.log('tls-verification.test.js');

test('client verification is on by default and only an explicit opt-in disables it', () => {
  const verified = resolveClientTlsVerification();
  assert.strictEqual(verified.rejectUnauthorized, true);
  assert.match(verified.tlsInfo, /cert verification enabled/);
  assert.ok(verified.ca && verified.ca.length > 0);

  const unverified = resolveClientTlsVerification({ allowUnverifiedTls: true });
  assert.strictEqual(unverified.rejectUnauthorized, false);
  assert.match(unverified.tlsInfo, /cert verification disabled by explicit allowUnverifiedTls/);

  // Only a strict boolean true opts out.
  ['true', 1, {}, null, undefined].forEach((value) => {
    assert.strictEqual(resolveClientTlsVerification({ allowUnverifiedTls: value }).rejectUnauthorized, true);
  });
});

test('HTTPS agent options follow the shared verification decision', () => {
  const off = buildHttpsAgentOptions({ useTls: false });
  assert.strictEqual(off.agentOptions, null);
  assert.match(off.tlsInfo, /tls=off/);

  const verified = buildHttpsAgentOptions({ useTls: true });
  assert.strictEqual(verified.agentOptions.rejectUnauthorized, true);
  assert.match(verified.tlsInfo, /cert verification enabled/);

  const unverified = buildHttpsAgentOptions({ useTls: true, allowUnverifiedTls: true });
  assert.strictEqual(unverified.agentOptions.rejectUnauthorized, false);
  assert.match(unverified.tlsInfo, /explicit allowUnverifiedTls/);
});

test('custom certificate paths still honor the explicit verification opt-in', () => {
  const caPath = path.join(__dirname, `tls-verification-ca-${process.pid}.pem`);
  const generated = buildHttpsServerOptions({ useTls: true, ip: '127.0.0.1' });
  fs.writeFileSync(caPath, generated.serverOptions.cert);
  try {
    const verified = buildHttpsAgentOptions({ useTls: true, tlsCaPath: caPath });
    assert.ok(verified.agentOptions.ca);
    assert.strictEqual(verified.agentOptions.rejectUnauthorized, undefined);
    assert.match(verified.tlsInfo, /custom certs/);

    const unverified = buildHttpsAgentOptions({ useTls: true, tlsCaPath: caPath, allowUnverifiedTls: true });
    assert.strictEqual(unverified.agentOptions.rejectUnauthorized, false);
    assert.match(unverified.tlsInfo, /explicit allowUnverifiedTls/);
  } finally {
    fs.rmSync(caPath, { force: true });
  }
});

test('gRPC channel credentials reuse the same verification decision', () => {
  const off = buildChannelCredentials({ useTls: false });
  assert.match(off.tlsInfo, /tls=off/);
  const verified = buildChannelCredentials({ useTls: true });
  assert.match(verified.tlsInfo, /cert verification enabled/);
  assert.ok(verified.credentials);
  const unverified = buildChannelCredentials({ useTls: true, allowUnverifiedTls: true });
  assert.match(unverified.tlsInfo, /explicit allowUnverifiedTls/);
  assert.ok(unverified.credentials);
});

test('server TLS options are unaffected by the client verification option', () => {
  const server = buildHttpsServerOptions({ useTls: true, ip: '127.0.0.1' });
  assert.ok(server.serverOptions.cert && server.serverOptions.key);
  assert.strictEqual(server.serverOptions.rejectUnauthorized, undefined);
  assert.match(server.tlsInfo, /self-signed \(auto-generated\)/);
});

test('CLI exposes the three explicit verification options with false defaults', () => {
  const defaults = parseCommandLineArgs(createArgv(['runMode=headless', 'filename=./data.csv']));
  assert.strictEqual(defaults.headless.allowUnverifiedTls, false);
  assert.strictEqual(defaults.headless.httpAllowUnverifiedTls, false);
  assert.strictEqual(defaults.headless.wsAllowUnverifiedTls, false);

  const grpc = parseCommandLineArgs(createArgv([
    'runMode=headless', 'filename=./data.csv', 'protocol=grpc', 'mode=client',
    'ip=127.0.0.1', 'useTls=true', 'allowUnverifiedTls=true',
  ]));
  assert.strictEqual(grpc.mode, 'headless');
  assert.strictEqual(grpc.headless.allowUnverifiedTls, true);
  assert.ok(grpc.warnings.some((warning) => warning.includes('disables certificate verification for any host')));

  const invalid = parseCommandLineArgs(createArgv([
    'runMode=headless', 'filename=./data.csv', 'protocol=ws', 'mode=client',
    'ip=127.0.0.1', 'wsAllowUnverifiedTls=maybe',
  ]));
  assert.strictEqual(invalid.mode, 'error');
});

test('CLI warns when an explicit verification option cannot apply', () => {
  const serverMode = parseCommandLineArgs(createArgv([
    'runMode=headless', 'filename=./data.csv', 'protocol=http', 'mode=server',
    'httpAllowUnverifiedTls=true',
  ]));
  assert.ok(serverMode.warnings.some((warning) => warning.includes("'httpAllowUnverifiedTls' is ignored outside http client mode")));

  const tlsOff = parseCommandLineArgs(createArgv([
    'runMode=headless', 'filename=./data.csv', 'protocol=ws', 'mode=client',
    'ip=127.0.0.1', 'wsTls=false', 'wsAllowUnverifiedTls=true',
  ]));
  assert.ok(tlsOff.warnings.some((warning) => warning.includes('has no effect because wsTls is false')));
});

test('UI mode accepts the explicit verification options as prepopulation presets', () => {
  const ui = parseCommandLineArgs(createArgv([
    'protocol=grpc', 'mode=client', 'useTls=true', 'allowUnverifiedTls=true',
  ]));
  assert.strictEqual(ui.mode, 'ui');
  assert.strictEqual(String(ui.ui.presets.allowUnverifiedTls), 'true');
  assert.ok(!ui.warnings.some((warning) => warning.includes("'allowUnverifiedTls' is ignored in UI mode")));
});

test('help documents the explicit verification options', () => {
  const help = getCommandHelpText({ layout: 'detailed' });
  ['allowUnverifiedTls', 'httpAllowUnverifiedTls', 'wsAllowUnverifiedTls'].forEach((key) => {
    const entry = findParameter(key);
    assert.ok(entry, `${key} must be a documented CLI parameter`);
    assert.strictEqual(entry.defaultValue, 'false');
    assert.match(entry.purpose, /not only localhost/);
    assert.ok(help.includes(key), `${key} must appear in the CLI help`);
  });
});

test('XMPP allow-unverified help no longer claims a loopback-only restriction', () => {
  const entry = findParameter('xmppAllowUnverifiedTls');
  assert.ok(entry);
  assert.doesNotMatch(entry.purpose, /loopback/i);
  assert.match(entry.purpose, /any host/);
});

(async () => {
  await asyncTest('the HTTP client transport carries the explicit option into its agent', async () => {
    const strict = new HttpClientTransport({ ip: '127.0.0.1', port: 8443, httpTls: true });
    await strict.connect();
    assert.match(strict._tlsInfo, /cert verification enabled/);
    assert.strictEqual(strict._agent.options.rejectUnauthorized, true);
    await strict.disconnect?.();

    const relaxed = new HttpClientTransport({
      ip: '127.0.0.1', port: 8443, httpTls: true, httpAllowUnverifiedTls: true,
    });
    await relaxed.connect();
    assert.match(relaxed._tlsInfo, /explicit allowUnverifiedTls/);
    assert.strictEqual(relaxed._agent.options.rejectUnauthorized, false);
    await relaxed.disconnect?.();
  });

  await asyncTest('the WebSocket client transport reports the verification decision it used', async () => {
    // A closed port fails fast; the transport must still have resolved TLS
    // options before dialling, which is what the failure message proves.
    const relaxed = createWsClientTransport({
      ip: '127.0.0.1', port: 1, wsTls: true, wsAllowUnverifiedTls: true,
    });
    await assert.rejects(() => relaxed.connect());
    const strict = createWsClientTransport({ ip: '127.0.0.1', port: 1, wsTls: true });
    await assert.rejects(() => strict.connect());
  });

  console.log(`\n${passed} passed`);
})();
