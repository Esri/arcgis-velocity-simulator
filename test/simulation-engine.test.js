/**
 * Simulation Engine Unit Tests
 * Run with: node test/simulation-engine.test.js
 */

const { EventEmitter } = require('events');
const { SimulationEngine } = require('../src/simulation-engine.js');

class FakeTransport extends EventEmitter {
  constructor({ recipients = true, failOnSendIndexes = [] } = {}) {
    super();
    this.connected = false;
    this.recipients = recipients;
    this.sentPayloads = [];
    this.sendAttempts = 0;
    this.failOnSendIndexes = new Set(failOnSendIndexes);
  }

  isConnected() {
    return this.connected;
  }

  requiresRecipients() {
    return true;
  }

  hasRecipients() {
    return this.recipients;
  }

  async connect() {
    this.connected = true;
    this.emit('status', { status: 'connected', message: 'fake transport connected' });
  }

  async waitForRecipients() {
    if (this.recipients) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(() => {
        this.recipients = true;
        this.emit('client-connected', { clientKey: 'fake-client' });
        resolve();
      }, 20);
    });
  }

  async send(line) {
    const index = this.sendAttempts;
    this.sendAttempts += 1;
    if (this.failOnSendIndexes.has(index)) {
      throw new Error(`fake send failure at index ${index}`);
    }

    if (!this.recipients) {
      return { delivered: false, recipients: 0, reason: 'no-clients' };
    }

    this.sentPayloads.push(line);
    return { delivered: true, recipients: 1 };
  }
}

async function runSimulationEngineTests() {
  console.log('\n=== Simulation Engine Test Suite ===');
  let passed = 0;
  let failed = 0;

  const runAsyncTest = async (testName, testFn) => {
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

  const mockLoadLines = async () => ['line-1', 'line-2', 'line-3', 'line-4', 'line-5'];
  const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

  console.log('\n--- Test 1: Range and maxLines ---');
  await runAsyncTest('Processes only the configured line range and respects maxLines', async () => {
    const transport = new FakeTransport();
    const engine = new SimulationEngine({
      transport,
      logger: silentLogger,
      loadLines: mockLoadLines,
      options: {
        filename: '/tmp/fake.csv',
        startLine: 2,
        endLine: 5,
        maxLines: 2,
        intervalMs: 5,
        linesPerInterval: 1,
      },
    });

    const summary = await engine.run();
    return summary.status === 'completed'
      && summary.linesSent === 2
      && transport.sentPayloads.join(',') === 'line-2,line-3';
  });

  console.log('\n--- Test 2: waitForClient ---');
  await runAsyncTest('waitForClient waits before advancing the stream', async () => {
    const transport = new FakeTransport({ recipients: false });
    const engine = new SimulationEngine({
      transport,
      logger: silentLogger,
      loadLines: mockLoadLines,
      options: {
        filename: '/tmp/fake.csv',
        waitForClient: true,
        maxLines: 1,
        intervalMs: 5,
        linesPerInterval: 1,
      },
    });

    const summary = await engine.run();
    return summary.status === 'completed'
      && summary.linesSent === 1
      && transport.sentPayloads[0] === 'line-1';
  });

  console.log('\n--- Test 3: onError=continue ---');
  await runAsyncTest('onError=continue skips a failed line and finishes remaining work', async () => {
    const transport = new FakeTransport({ failOnSendIndexes: [1] });
    const engine = new SimulationEngine({
      transport,
      logger: silentLogger,
      loadLines: mockLoadLines,
      options: {
        filename: '/tmp/fake.csv',
        maxLines: 3,
        onError: 'continue',
        intervalMs: 5,
        linesPerInterval: 1,
      },
    });

    const summary = await engine.run();
    return summary.status === 'completed'
      && summary.errorCount === 1
      && summary.linesSent === 3
      && transport.sentPayloads.join(',') === 'line-1,line-3,line-4';
  });

  console.log('\n=== Test Results ===');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runSimulationEngineTests().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}


