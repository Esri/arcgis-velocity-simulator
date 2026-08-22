/**
 * XMPP Simulator/Logger Parity Tests
 * Run with: node test/xmpp-parity.test.js
 *
 * The Simulator and the sister ArcGIS Velocity Logger share one XMPP option
 * vocabulary. These tests pin the parts of that contract that live in this
 * repository so a rename, a changed default, or a re-introduced alias fails
 * here instead of silently splitting the two apps apart.
 */

const fs = require('fs');
const path = require('path');
const {
  XMPP_DEFAULT_C2S_PORT,
  XMPP_DEFAULT_CONNECT_TIMEOUT_MS,
  XMPP_DEFAULT_PING_INTERVAL_MS,
  XMPP_DEFAULT_RECONNECT_DELAY_MS,
  XMPP_DEFAULT_REPLY_TIMEOUT_MS,
  XMPP_DEFAULT_ROLE,
  XMPP_TIMING_OPTIONS,
} = require('../src/xmpp-constants.js');
const { getCommandLineReferenceData, parseCommandLineArgs } = require('../src/cli-options.js');

const repoRoot = path.join(__dirname, '..');

/** Option names that must exist verbatim in both repositories. */
const SHARED_OPTION_VOCABULARY = [
  'xmppAllowRemote',
  'xmppAllowUnverifiedTls',
  'xmppConnectTimeoutMs',
  'xmppConversation',
  'xmppDomain',
  'xmppExternalPassword',
  'xmppExternalUsername',
  'xmppNickname',
  'xmppPassword',
  'xmppPingIntervalMs',
  'xmppReconnectDelayMs',
  'xmppReplyTimeoutMs',
  'xmppResource',
  'xmppRoom',
  'xmppRoomPassword',
  'xmppTlsCaPath',
  'xmppTlsCertPath',
  'xmppTlsKeyPath',
  'xmppTlsPolicy',
  'xmppUsername',
];

/**
 * Names that must never appear: either a non-canonical alias of a shared
 * option, or an option that belongs only to the Logger's receive role.
 */
const FORBIDDEN_NAMES = [
  'xmppHost',
  'xmppMucPassword',
  'xmppSkipTlsVerify',
  'xmppChatMode',
  'xmppLocalJid',
];

const SOURCES = [
  'src/xmpp-constants.js',
  'src/xmpp-transport.js',
  'src/xmpp-client-core.js',
  'src/xmpp-server-core.js',
  'src/xmpp-accounts.js',
  'src/xmpp-utils.js',
  'src/xmpp-muc.js',
  'src/xmpp-sasl-server.js',
  'src/cli-options.js',
  'src/main.js',
  'src/renderer.js',
  'src/index.html',
  'src/help.html',
  'docs/xmpp.md',
  'docs/command-line.md',
  'docs/configuration.md',
  'docs/headless.md',
  'docs/tls.md',
  'docs/examples/launch-config.sample.json',
  'docs/examples/launch-config.client.sample.json',
  'docs/examples/launch-config.server.sample.json',
  'docs/examples/launch-config.xmpp.sample.json',
];

let passed = 0;
let failed = 0;

function runTest(name, testFn) {
  try {
    if (testFn()) {
      console.log(`✅ ${name}`);
      passed += 1;
    } else {
      console.log(`❌ ${name}`);
      failed += 1;
    }
  } catch (error) {
    console.log(`❌ ${name} - Error: ${error.message}`);
    failed += 1;
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function runXmppParityTests() {
  console.log('\n=== XMPP Parity Test Suite ===');

  const agents = read('AGENTS.md');
  const cliParameters = getCommandLineReferenceData().parameters.map((entry) => entry.name);

  runTest('AGENTS.md states the Simulator client / Logger server role default', () =>
    /Default role when `protocol=xmpp` is selected/.test(agents) &&
    /\*\*Client\*\* — it signs in to the receiving server and publishes/.test(agents) &&
    /\*\*Server\*\* — it hosts the endpoint a publisher signs in to/.test(agents));

  runTest('AGENTS.md documents the intentional xmppDestination / xmppLocalJid asymmetry', () =>
    agents.includes('`xmppDestination`') &&
    agents.includes('`xmppLocalJid`') &&
    /the only XMPP options that differ/.test(agents) &&
    /Do not add `xmppLocalJid` here/.test(agents) &&
    /any receive-only behavior/.test(agents));

  runTest('AGENTS.md pins the shared option vocabulary, defaults, ip host, and port 5222', () =>
    SHARED_OPTION_VOCABULARY.every((option) => agents.includes(`\`${option}\``)) &&
    agents.includes('`xmppConnectTimeoutMs` (30000)') &&
    agents.includes('`xmppReplyTimeoutMs` (15000)') &&
    agents.includes('`xmppPingIntervalMs` (60000)') &&
    agents.includes('`xmppReconnectDelayMs` (60000)') &&
    /no zero-disable or zero-wait-forever behavior/.test(agents) &&
    /shared top-level `ip` as the network host override/.test(agents) &&
    /Neither repository may introduce an `xmppHost` key/.test(agents) &&
    /port 5222 whenever XMPP is selected without an explicit port/.test(agents));

  runTest('AGENTS.md allows internal callback differences but not public divergence', () =>
    /Internal differences are allowed/.test(agents) &&
    /name their internal callbacks differently/.test(agents) &&
    /Public option names, defaults, validation messages, tooltips, and documented behavior may not diverge/
      .test(agents));

  runTest('The shared option vocabulary is complete in the CLI reference', () =>
    SHARED_OPTION_VOCABULARY.every((option) => cliParameters.includes(option)) &&
    cliParameters.includes('xmppDestination'));

  runTest('No non-canonical alias or Logger-only option leaks into this repository', () => {
    const offenders = [];
    for (const source of SOURCES) {
      const contents = read(source);
      for (const name of FORBIDDEN_NAMES) {
        // Only real usages count: a CLI parameter, a JSON key, a JS string, or
        // an object property. Prose and documentation may still *name* a
        // forbidden option in order to say that it does not exist.
        const usage = new RegExp(`(${name}=)|("${name}")|('${name}')|(\\b${name}\\s*:)`);
        if (usage.test(contents)) offenders.push(`${source}:${name}`);
      }
    }
    if (offenders.length > 0) console.log(`   forbidden usages found: ${offenders.join(', ')}`);
    return offenders.length === 0;
  });

  runTest('Canonical timing defaults match the documented parity contract', () =>
    XMPP_DEFAULT_CONNECT_TIMEOUT_MS === 30000 &&
    XMPP_DEFAULT_REPLY_TIMEOUT_MS === 15000 &&
    XMPP_DEFAULT_PING_INTERVAL_MS === 60000 &&
    XMPP_DEFAULT_RECONNECT_DELAY_MS === 60000 &&
    XMPP_TIMING_OPTIONS.map((option) => option.key).join(',') ===
      'xmppConnectTimeoutMs,xmppReplyTimeoutMs,xmppPingIntervalMs,xmppReconnectDelayMs');

  runTest('The Simulator keeps the client role and port 5222 as its XMPP defaults', () => {
    const resolved = parseCommandLineArgs([
      'node', 'main.js', 'runMode=headless', 'filename=./data.csv', 'protocol=xmpp',
      'ip=127.0.0.1', 'xmppUsername=simulator', 'xmppPassword=secret',
      'xmppDestination=feed@example.test',
    ]);
    return XMPP_DEFAULT_ROLE === 'client' &&
      XMPP_DEFAULT_C2S_PORT === 5222 &&
      resolved.headless.mode === 'client' &&
      resolved.headless.port === 5222;
  });

  runTest('Copied client settings use the shared ip key, never a host or xmppHost key', () => {
    const { createXmppServerTransport, formatClientSettings } = require('../src/xmpp-transport.js');
    const transport = createXmppServerTransport({
      ip: '127.0.0.1',
      xmppTlsPolicy: 'disabled',
      xmppExternalUsername: 'receiver',
      xmppExternalPassword: 'secret',
    });
    const text = formatClientSettings(transport.getClientSettings());
    return /^ip=127\.0\.0\.1$/m.test(text) &&
      !/(^|\n)host=/.test(text) &&
      !text.includes('xmppHost');
  });

  console.log('\n=== Test Results ===');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);

  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  runXmppParityTests();
}

module.exports = { runXmppParityTests };
