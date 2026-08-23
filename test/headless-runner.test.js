/**
 * Headless Runner Unit Tests
 * Run with: node test/headless-runner.test.js
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const { EXIT_CODES, runHeadlessSession, writeDoneFile } = require('../src/headless-runner.js');
const { createXmppServerTransport } = require('../src/xmpp-transport.js');
const { createHttpClientTransport, createHttpServerTransport } = require('../src/http-transport.js');
const { createWsClientTransport, createWsServerTransport } = require('../src/ws-transport.js');

const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };

function createReplayOptions(csvPath, overrides = {}) {
  return {
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
    connectTimeoutMs: 2000,
    connectWaitForServer: false,
    connectRetryIntervalMs: 20,
    logLevel: 'error',
    logFile: null,
    config: null,
    onError: 'exit',
    doneFile: null,
    runId: 'headless-runner-test',
    stdout: false,
    ...overrides,
  };
}

async function waitFor(predicate, message, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

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

  const tmpDir = path.join(__dirname, `.headless-runner-${process.pid}`);
  fs.mkdirSync(tmpDir, { recursive: true });
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

    console.log('\n--- Test 4: HTTP headless client path ---');
    await runTest('runHeadlessSession sends through the HTTP client transport', async () => {
      const received = [];
      const server = createHttpServerTransport({
        ip: '127.0.0.1',
        port: 0,
        httpFormat: 'geo-json',
        httpPath: '/headless-client',
        httpTls: false,
        onData: (data) => received.push(data),
      });
      try {
        const listening = await server.connect();
        const exitCode = await runHeadlessSession(createReplayOptions(csvPath, {
          protocol: 'http',
          port: listening.address.port,
          httpFormat: 'geo-json',
          httpPath: '/headless-client',
          httpTls: false,
        }), { logger: quietLogger });
        await waitFor(() => received.length === 2, 'HTTP server did not receive both replay lines');
        return exitCode === EXIT_CODES.success
          && received[0] === 'alpha'
          && received[1] === 'beta';
      } finally {
        await server.disconnect();
      }
    });

    console.log('\n--- Test 5: HTTP headless server path ---');
    await runTest('runHeadlessSession waits for an HTTP SSE recipient and broadcasts', async () => {
      const port = await getFreePort();
      const received = [];
      const run = runHeadlessSession(createReplayOptions(csvPath, {
        protocol: 'http',
        mode: 'server',
        port,
        httpFormat: 'delimited',
        httpPath: '/headless-server',
        httpTls: false,
        waitForClient: true,
      }), { logger: quietLogger });
      await new Promise((resolve) => setTimeout(resolve, 30));
      const client = createHttpClientTransport({
        ip: '127.0.0.1',
        port,
        httpFormat: 'delimited',
        httpPath: '/headless-server',
        httpTls: false,
        onData: (data) => received.push(data),
      });
      try {
        await client.connect();
        const exitCode = await run;
        await waitFor(() => received.length === 2, 'HTTP SSE client did not receive both replay lines');
        return exitCode === EXIT_CODES.success
          && received[0] === 'alpha'
          && received[1] === 'beta';
      } finally {
        await client.disconnect();
      }
    });

    console.log('\n--- Test 6: WebSocket headless client path ---');
    await runTest('runHeadlessSession sends through the WebSocket client transport', async () => {
      const received = [];
      const server = createWsServerTransport({
        ip: '127.0.0.1',
        port: 0,
        wsFormat: 'json',
        wsPath: '/headless-client',
        wsTls: false,
        onData: (data) => received.push(data),
      });
      try {
        const listening = await server.connect();
        const exitCode = await runHeadlessSession(createReplayOptions(csvPath, {
          protocol: 'ws',
          port: listening.address.port,
          wsFormat: 'json',
          wsPath: '/headless-client',
          wsTls: false,
          wsHeaders: '{"X-Headless":"client"}',
        }), { logger: quietLogger });
        await waitFor(() => received.length === 2, 'WebSocket server did not receive both replay lines');
        return exitCode === EXIT_CODES.success
          && received[0] === 'alpha'
          && received[1] === 'beta';
      } finally {
        await server.disconnect();
      }
    });

    console.log('\n--- Test 7: WebSocket headless server path ---');
    await runTest('runHeadlessSession waits for a WebSocket recipient and broadcasts', async () => {
      const port = await getFreePort();
      const received = [];
      const run = runHeadlessSession(createReplayOptions(csvPath, {
        protocol: 'ws',
        mode: 'server',
        port,
        wsFormat: 'delimited',
        wsPath: '/headless-server',
        wsTls: false,
        waitForClient: true,
      }), { logger: quietLogger });
      await new Promise((resolve) => setTimeout(resolve, 30));
      const client = createWsClientTransport({
        ip: '127.0.0.1',
        port,
        wsFormat: 'delimited',
        wsPath: '/headless-server',
        wsTls: false,
        onData: (data) => received.push(data),
      });
      try {
        await client.connect();
        const exitCode = await run;
        await waitFor(() => received.length === 2, 'WebSocket client did not receive both replay lines');
        return exitCode === EXIT_CODES.success
          && received[0] === 'alpha'
          && received[1] === 'beta';
      } finally {
        await client.disconnect();
      }
    });

    console.log('\n--- Test 8: XMPP headless failed-connect cleanup ---');
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

    console.log('\n--- Test 9: Teardown never fails a completed run ---');
    await runTest('a teardown failure after a completed replay still reports success', async () => {
      const { TransportManager } = require('../src/transport-manager.js');
      const originalDisconnect = TransportManager.prototype.disconnect;
      const warnings = [];
      const teardownLogger = {
        debug() {}, info() {}, error() {},
        warn(message) { warnings.push(message); },
      };
      // A peer that disappeared first makes teardown report a diagnostic. The
      // replay already finished, so the run must still succeed and exit 0.
      TransportManager.prototype.disconnect = async function failingDisconnect() {
        await originalDisconnect.call(this);
        throw new Error('gRPC Stream failed: 14 UNAVAILABLE: Connection dropped');
      };
      try {
        const exitCode = await runHeadlessSession(createReplayOptions(csvPath), { logger: teardownLogger });
        return exitCode === EXIT_CODES.success
          && warnings.some((message) => message.includes('Teardown after the run reported')
            && message.includes('UNAVAILABLE'));
      } finally {
        TransportManager.prototype.disconnect = originalDisconnect;
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
