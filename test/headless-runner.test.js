/**
 * Headless Runner Unit Tests
 * Run with: node test/headless-runner.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EXIT_CODES, runHeadlessSession, writeDoneFile } = require('../src/headless-runner.js');
const { createXmppServerTransport } = require('../src/xmpp-transport.js');

async function runHeadlessRunnerTests() {
  console.log('\n=== Headless Runner Test Suite ===');
  let passed = 0;
  let failed = 0;

  const runTest = async (testName, testFn) => {
    try {
      const result = await testFn();
      if (result) {
        console.log(`✅ ${testName}`);
        passed += 1;
      } else {
        console.log(`❌ ${testName}`);
        failed += 1;
      }
    } catch (error) {
      console.log(`❌ ${testName} - Error: ${error.message}`);
      failed += 1;
    }
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avs-headless-runner-'));
  const csvPath = path.join(tmpDir, 'data.csv');
  const doneFilePath = path.join(tmpDir, 'run.done.json');
  const manualDoneFilePath = path.join(tmpDir, 'manual.done.json');

  fs.writeFileSync(csvPath, 'alpha\nbeta\n', 'utf8');

  console.log('\n--- Test 1: writeDoneFile ---');
  await runTest('writeDoneFile creates the requested JSON artifact', async () => {
    writeDoneFile(manualDoneFilePath, { success: true, sample: 1 });
    const parsed = JSON.parse(fs.readFileSync(manualDoneFilePath, 'utf8'));
    return parsed.success === true && parsed.sample === 1;
  });

  console.log('\n--- Test 2: runHeadlessSession success path ---');
  await runTest('runHeadlessSession returns success and writes a done file', async () => {
    const exitCode = await runHeadlessSession({
      filename: csvPath,
      protocol: 'udp',
      mode: 'client',
      ip: '127.0.0.1',
      port: 5565,
      linesPerInterval: 1,
      intervalMs: 5,
      loop: false,
      autoConnect: true,
      autoStart: true,
      exitOnComplete: true,
      waitForClient: false,
      startLine: 1,
      endLine: null,
      maxLines: null,
      connectTimeoutMs: 0,
      logLevel: 'error',
      logFile: null,
      config: null,
      onError: 'exit',
      doneFile: doneFilePath,
      runId: 'headless-runner-test',
      stdout: false,
    });

    console.log('\n--- Test 3: XMPP headless client path ---');
    await runTest('runHeadlessSession sends through the XMPP client transport and cleans up', async () => {
      const received = [];
      const server = createXmppServerTransport({
        ip: '127.0.0.1',
        port: 0,
        xmppTlsPolicy: 'disabled',
        xmppExternalUsername: 'headless',
        xmppExternalPassword: '  headless secret  ',
        onData: (body) => received.push(body),
      });
      try {
        const listening = await server.connect();
        const loggedErrors = [];
        const logger = {
          debug() {},
          info() {},
          warn() {},
          error(message) { loggedErrors.push(message); },
        };
        const exitCode = await runHeadlessSession({
          filename: csvPath,
          protocol: 'xmpp',
          mode: 'client',
          ip: '127.0.0.1',
          port: listening.address.port,
          xmppDomain: 'localhost',
          xmppTlsPolicy: 'disabled',
          xmppUsername: 'headless',
          xmppPassword: '  headless secret  ',
          xmppResource: 'headless-test',
          xmppConversation: 'direct',
          xmppDestination: listening.serviceJid,
          xmppConnectTimeoutMs: 3000,
          xmppReplyTimeoutMs: 1000,
          // Every XMPP timing is positive; a long, unref'd keepalive and
          // reconnect delay simply never fire during a short replay.
          xmppPingIntervalMs: 600000,
          xmppReconnectDelayMs: 600000,
          linesPerInterval: 1,
          intervalMs: 5,
          loop: false,
          autoConnect: true,
          autoStart: true,
          exitOnComplete: true,
          waitForClient: false,
          startLine: 1,
          endLine: null,
          maxLines: null,
          connectTimeoutMs: 0,
          logLevel: 'error',
          logFile: null,
          config: null,
          onError: 'exit',
          doneFile: null,
          runId: 'xmpp-headless-test',
          stdout: false,
        }, { logger });
        if (exitCode !== EXIT_CODES.success) {
          throw new Error(`unexpected exit code ${exitCode}: ${loggedErrors.join('; ')}`);
        }
        if (received.length !== 2) throw new Error(`expected 2 XMPP messages, received ${received.length}`);
        if (received[0] !== 'alpha' || received[1] !== 'beta') {
          throw new Error(`unexpected XMPP payloads: ${JSON.stringify(received)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (server.hasRecipients()) throw new Error('headless cleanup left an XMPP recipient connected');
        return true;
      } finally {
        await server.disconnect();
      }
    });

    console.log('\n--- Test 4: XMPP headless failed-connect cleanup ---');
    await runTest('a failed XMPP connect is cleaned up and reported through the done file', async () => {
      const failureDoneFile = path.join(tmpDir, 'xmpp-failure.done.json');
      const server = createXmppServerTransport({
        ip: '127.0.0.1',
        port: 0,
        xmppTlsPolicy: 'disabled',
        xmppExternalUsername: 'headless',
        xmppExternalPassword: 'headless secret',
      });
      try {
        const listening = await server.connect();
        const logger = { debug() {}, info() {}, warn() {}, error() {} };
        const exitCode = await runHeadlessSession({
          filename: csvPath,
          protocol: 'xmpp',
          mode: 'client',
          ip: '127.0.0.1',
          port: listening.address.port,
          xmppDomain: 'localhost',
          xmppTlsPolicy: 'disabled',
          xmppUsername: 'headless',
          xmppPassword: 'the wrong secret',
          xmppConversation: 'direct',
          xmppDestination: listening.serviceJid,
          xmppConnectTimeoutMs: 4000,
          xmppReplyTimeoutMs: 1000,
          xmppPingIntervalMs: 600000,
          xmppReconnectDelayMs: 600000,
          linesPerInterval: 1,
          intervalMs: 5,
          loop: false,
          autoConnect: true,
          autoStart: true,
          exitOnComplete: true,
          waitForClient: false,
          startLine: 1,
          endLine: null,
          maxLines: null,
          connectTimeoutMs: 0,
          logLevel: 'error',
          logFile: null,
          config: null,
          onError: 'exit',
          doneFile: failureDoneFile,
          runId: 'xmpp-headless-failure',
          stdout: false,
        }, { logger });
        if (exitCode !== EXIT_CODES.runtimeError) {
          throw new Error(`expected a runtime error exit code, got ${exitCode}`);
        }
        const failureDone = JSON.parse(fs.readFileSync(failureDoneFile, 'utf8'));
        if (failureDone.success !== false || !failureDone.error) {
          throw new Error('the done file should record the failure');
        }
        // The transport is registered before connect() is awaited, so the
        // half-open stream is torn down even though connect never succeeded.
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (server.getClientCount() !== 0) {
          throw new Error('a failed connect left a stream registered on the server');
        }
        return true;
      } finally {
        await server.disconnect();
      }
    });

    const done = JSON.parse(fs.readFileSync(doneFilePath, 'utf8'));
    return exitCode === EXIT_CODES.success
      && done.success === true
      && done.summary.linesSent === 2
      && done.runId === 'headless-runner-test';
  });

  console.log('\n=== Test Results ===');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runHeadlessRunnerTests().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
