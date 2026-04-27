/**
 * Copyright 2026 Esri
 *
 * Licensed under the Apache License Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Test Runner - Runs all test suites
 * Run with: npm test or node test/run-all-tests.js
 */

const { spawn } = require('child_process');
const path = require('path');

const testSuites = [
  { file: 'config.test.js', description: '📋 Config Manager Tests' },
  { file: 'cli-options.test.js', description: '🧾 CLI Options Tests' },
  { file: 'renderer.test.js', description: '🖥️  Renderer Tests' },
  { file: 'preload.test.js', description: '🔗 Preload API Tests' },
  { file: 'about.test.js', description: '📄 About Dialog Tests' },
  { file: 'help.test.js', description: '❓ Help Dialog Tests' },
  { file: 'simulation-engine.test.js', description: '🚀 Simulation Engine Tests' },
  { file: 'headless-runner.test.js', description: '🧪 Headless Runner Tests' },
  { file: 'grpc-transport.test.js', description: '🔌 gRPC Transport Tests' },
];

function runTest(suite) {
  return new Promise((resolve, reject) => {
    console.log(`\n${suite.description}`);
    console.log('-'.repeat(suite.description.length));

    const testProcess = spawn('node', [path.join(__dirname, suite.file)], { stdio: 'pipe' });

    testProcess.stdout.on('data', (data) => {
      process.stdout.write(data);
    });

    testProcess.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    testProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`\n❌ Test suite '${suite.file}' failed with exit code ${code}`);
        reject(new Error(`Test suite failed: ${suite.file}`));
      } else {
        console.log(`\n✅ Test suite '${suite.file}' passed.`);
        resolve();
      }
    });

    testProcess.on('error', (err) => {
      console.error(`\n💥 Failed to start test suite '${suite.file}':`, err);
      reject(err);
    });
  });
}

async function runAllTests() {
  console.log('🧪 Running ArcGIS Velocity Simulator Test Suite in Isolated Processes');
  console.log('=' .repeat(70));

  let suitesFailed = 0;

  for (const suite of testSuites) {
    try {
      await runTest(suite);
    } catch (error) {
      suitesFailed++;
    }
    console.log('=' .repeat(70));
  }

  // Final Summary
  console.log('\n🏁 Test Suite Complete');
  if (suitesFailed > 0) {
    console.error(`\n❌ ${suitesFailed} of ${testSuites.length} test suites failed.`);
    process.exit(1);
  } else {
    console.log(`\n✅ All ${testSuites.length} test suites passed successfully!`);
    console.log('\n🎉 Ready for development and deployment!');
    process.exit(0);
  }
}

if (require.main === module) {
  runAllTests();
}

