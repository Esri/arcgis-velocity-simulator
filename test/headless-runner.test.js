/**
 * Headless Runner Unit Tests
 * Run with: node test/headless-runner.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EXIT_CODES, runHeadlessSession, writeDoneFile } = require('../src/headless-runner.js');

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

