/**
 * Test Runner - Runs all test suites
 * Run with: npm test or node test/run-all-tests.js
 */

const { spawn } = require('child_process');
const path = require('path');

const testSuites = [
  { file: 'config.test.js', description: '📋 Config Manager Tests' },
  { file: 'cli-options.test.js', description: '🧾 CLI Options Tests' },
  { file: 'connection-presets.test.js', description: '🎚  Connection Preset Tests' },
  { file: 'connection-summary.test.js', description: '🧾 Connection Summary Tests' },
  { file: 'protocol-settings.test.js', description: '⚙️  Protocol Settings Dialog Tests' },
  { file: 'protocol-settings-window.test.js', description: '🪟 Protocol Settings Window Tests' },
  { file: 'reference-window-manager.test.js', description: '🪟 Reference Window Manager Tests' },
  { file: 'renderer.test.js', description: '🖥️  Renderer Tests' },
  { file: 'preload.test.js', description: '🔗 Preload API Tests' },
  { file: 'about.test.js', description: '📄 About Dialog Tests' },
  { file: 'help.test.js', description: '❓ Help Dialog Tests' },
  { file: 'secondary-window-theme.test.js', description: '🎨 Secondary Window Theme Tests' },
  { file: 'theme-palette.test.js', description: '🎨 Theme Palette Contract Tests' },
  { file: 'simulation-engine.test.js', description: '🚀 Simulation Engine Tests' },
  { file: 'file-source.test.js', description: '📄 Replay Source Conversion Tests' },
  { file: 'headless-runner.test.js', description: '🧪 Headless Runner Tests' },
  { file: 'transport-manager.test.js', description: '🔀 Transport Manager Tests' },
  { file: 'main-process.test.js', description: '🧵 Main Process Lifecycle Tests' },
  { file: 'grpc-transport.test.js', description: '🔌 gRPC Transport Tests' },
  { file: 'http-transport.test.js', description: '🌍 HTTP Transport Tests' },
  { file: 'tls-verification.test.js', description: '🔐 Client TLS Verification Tests' },
  { file: 'tls-system-roots.test.js', description: 'Cross-platform Certificate Trust Store Tests' },
  { file: 'external-sign.test.js', description: '✍️  External Signing Tests' },
  { file: 'sign-lock.test.js', description: '🔒 External Signing Lock Tests' },
  { file: 'format-utils.test.js', description: '📦 Format Utils Tests' },
  { file: 'payload-format-utils.test.js', description: '🧩 TCP and UDP Payload Format Tests' },
  { file: 'socket-payload-receiver.test.js', description: '📥 TCP and UDP Payload Receiver Tests' },
  { file: 'ws-transport.test.js', description: '🌐 WebSocket Transport Tests' },
  { file: 'xmpp-core.test.js', description: '💬 XMPP Core Tests' },
  { file: 'xmpp-transport.test.js', description: '📨 XMPP Transport Integration Tests' },
  { file: 'xmpp-secrets.test.js', description: '🕵️  XMPP Secret-Disclosure Tests' },
  { file: 'xmpp-parity.test.js', description: '🔀 XMPP Simulator/Logger Parity Tests' },
  { file: 'velocity-auth-utils.test.js', description: '🔑 Velocity Auth Utility Tests' },
  { file: 'velocity-endpoints.test.js', description: 'Velocity Endpoint Resolution Tests' },
  { file: 'velocity-rest-client.test.js', description: 'Velocity REST and Token Tests' },
  { file: 'velocity-session.test.js', description: 'Velocity Session Tests' },
  { file: 'velocity-api.test.js', description: 'Velocity Feed API Tests' },
  { file: 'velocity-catalog.test.js', description: 'Velocity Multi-server Catalog Tests' },
  { file: 'velocity-preferences.test.js', description: 'Velocity Endpoint Preference Tests' },
  { file: 'velocity-main-integration.test.js', description: 'Velocity Main IPC Integration Tests' },
  { file: 'velocity-connection-options.test.js', description: 'Velocity Connection Application Tests' },
  { file: 'velocity-udp.test.js', description: 'Velocity UDP Feed Loopback Tests' },
  { file: 'velocity-login.test.js', description: 'Velocity Login Dialog Tests' },
  { file: 'ws-query-auth.test.js', description: 'WebSocket Ephemeral Credential Tests' },
  { file: 'network-address-utils.test.js', description: 'Network Authority Formatting Tests' },
  { file: 'tooltip-utils.test.js', description: '💬 Tooltip Utility Tests' },
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
