/**
 * Config Manager Unit Tests
 * Run with: node test/config.test.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock Electron app module
const mockApp = {
  getPath: (name) => {
    if (name === 'userData') {
      return path.join(os.homedir(), 'Library/Application Support/arcgis-velocity-simulator');
    }
    return '';
  }
};

// Mock the electron module
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'electron') {
    return { app: mockApp };
  }
  return originalRequire.apply(this, arguments);
};

const { ConfigManager, defaultConfig } = require('../src/config.js');

/**
 * Test Suite: ConfigManager
 */
async function runConfigTests() {
  console.log('\n=== ConfigManager Test Suite ===');
  let passed = 0;
  let failed = 0;
  
  const runTest = (testName, testFn) => {
    try {
      if (testFn()) {
        console.log(`✅ ${testName}`);
        passed++;
      } else {
        console.log(`❌ ${testName}`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ ${testName} - Error: ${error.message}`);
      failed++;
    }
  };
  
  console.log('\nInitializing ConfigManager...');
  
  const configManager = new ConfigManager();

  runTest('Reference-window bounds have configuration defaults', () =>
    defaultConfig.dialogSizes.help.width === 1080 &&
    defaultConfig.dialogSizes.help.height === 760 &&
    defaultConfig.dialogSizes.commandLine.width === 1200 &&
    defaultConfig.dialogSizes.commandLine.height === 760);
  runTest('Saved reference-window bounds merge without dropping defaults', () => {
    const merged = configManager.mergeWithDefaults({
      dialogSizes: { help: { width: 900, x: 25 } },
    });
    return merged.dialogSizes.help.width === 900 &&
      merged.dialogSizes.help.x === 25 &&
      merged.dialogSizes.help.height === 760 &&
      merged.dialogSizes.commandLine.width === 1200;
  });
  
  // Test 1: Export functionality
  console.log('\n--- Test 1: Export Configuration ---');
  const testExportPath = './test-config-export.json';
  const exportResult = configManager.exportConfig(testExportPath);
  
  runTest('Configuration export returns success', () => exportResult.success);
  
  if (exportResult.success) {
    // Verify the exported file exists and has content
    if (fs.existsSync(testExportPath)) {
      const exportedContent = fs.readFileSync(testExportPath, 'utf8');
      const exportedConfig = JSON.parse(exportedContent);
      console.log('Exported config currentView:', exportedConfig.windowState.currentView);
    }
    
    // Test 2: Read configuration file
    console.log('\n--- Test 2: Read Configuration File ---');
    const readResult = configManager.readConfigFile(testExportPath);
    
    runTest('Configuration file read returns success', () => readResult.success);
    if (readResult.success) {
      runTest('Config contains windowState', () => readResult.config.windowState !== undefined);
      runTest('Config contains currentView', () => readResult.config.windowState.currentView !== undefined);
    }
    
    // Test 3: Write configuration file
    console.log('\n--- Test 3: Write Configuration File ---');
    const testConfig = {
      windowState: {
        fullView: { width: 800, height: 600, splitterPosition: '300px' },
        compactView: { width: 400, height: 500, splitterPosition: '200px' },
        currentView: 'compact',
        isCompactView: true
      },
      theme: 'light'
    };
    
    const testWritePath = './test-config-write.json';
    const writeResult = configManager.writeConfigFile(testWritePath, testConfig);
    
    runTest('Configuration file write returns success', () => writeResult.success);
    
    if (writeResult.success) {
      // Verify written content
      const writtenContent = fs.readFileSync(testWritePath, 'utf8');
      const writtenConfig = JSON.parse(writtenContent);
      
      runTest('Written config matches input', () => writtenConfig.windowState.currentView === 'compact');
      runTest('Written config has correct theme', () => writtenConfig.theme === 'light');
      
      // Clean up write test file
      fs.unlinkSync(testWritePath);
    }
    
    // Test 4: Import configuration functionality
    console.log('\n--- Test 4: Import Configuration ---');
    const importResult = configManager.importConfig(testExportPath);
    
    runTest('Configuration import returns success', () => importResult.success);
    
    // Clean up export test file
    fs.unlinkSync(testExportPath);
  }

  console.log('\n--- Test 5: XMPP Launch Configuration Mappings ---');
  const sampleNames = [
    'launch-config.sample.json',
    'launch-config.client.sample.json',
    'launch-config.server.sample.json',
    'launch-config.xmpp.sample.json',
  ];
  const xmppKeys = [
    'xmppAllowRemote', 'xmppAllowUnverifiedTls', 'xmppConnectTimeoutMs',
    'xmppConversation', 'xmppDestination', 'xmppDomain',
    'xmppExternalPassword', 'xmppExternalUsername', 'xmppNickname',
    'xmppPassword', 'xmppPingIntervalMs', 'xmppReconnectDelayMs', 'xmppReplyTimeoutMs',
    'xmppResource', 'xmppRoom', 'xmppRoomPassword', 'xmppTlsCaPath',
    'xmppTlsCertPath', 'xmppTlsKeyPath', 'xmppTlsPolicy', 'xmppUsername',
  ];
  const xmppSecretKeys = [
    'xmppExternalPassword', 'xmppPassword', 'xmppRoomPassword',
  ];
  const socketPayloadKeys = [
    'tcpFormat', 'tcpAddressFamily', 'tcpHandshakeText', 'tcpHandshakeUseEscapes', 'tcpInputHasHeader', 'tcpXField', 'tcpYField', 'tcpWkid',
    'udpFormat', 'udpAddressFamily', 'udpAppendNewline', 'udpInputHasHeader', 'udpXField', 'udpYField', 'udpWkid',
  ];
  runTest('Every launch-config sample includes TCP and UDP payload conversion settings', () =>
    sampleNames.every((name) => {
      const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/examples', name), 'utf8'));
      return socketPayloadKeys.every((key) => Object.hasOwn(sample.connection, key));
    }));
  runTest('Every launch-config sample includes HTTP Poller mode disabled by default', () =>
    sampleNames.every((name) => {
      const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/examples', name), 'utf8'));
      return sample.connection.httpPolling === false;
    }));
  runTest('Every launch-config sample includes the complete XMPP mapping', () =>
    sampleNames.every((name) => {
      const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/examples', name), 'utf8'));
      return xmppKeys.every((key) => Object.hasOwn(sample.connection, key));
    }));
  const mainSource = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const getCurrentLaunchConfigSource = mainSource.slice(
    mainSource.indexOf('async function getCurrentLaunchConfig()'),
    mainSource.indexOf('let launchConfigWindow'),
  );
  runTest('Saved launch configurations map every non-secret XMPP setting', () =>
    xmppKeys.filter((key) => !xmppSecretKeys.includes(key)).every((key) =>
      mainSource.includes(`${key}: s.${key}`) ||
      mainSource.includes(`${key}: getVal(`) ||
      mainSource.includes(`${key}: getChecked(`)));
  runTest('Saved launch configurations map every TCP and UDP payload setting', () =>
    socketPayloadKeys.every((key) =>
      mainSource.includes(`${key}: s.${key}`) ||
      mainSource.includes(`${key}: getVal(`) ||
      mainSource.includes(`${key}: getChecked(`)));
  runTest('Saved launch configurations omit every XMPP password', () =>
    xmppSecretKeys.every((key) => !getCurrentLaunchConfigSource.includes(`${key}:`)));
  const clientSample = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../docs/examples/launch-config.client.sample.json'),
    'utf8',
  ));
  clientSample.connection.xmppPassword = '  preserved whitespace  ';
  runTest('JSON launch configuration preserves XMPP password whitespace', () =>
    JSON.parse(JSON.stringify(clientSample)).connection.xmppPassword === '  preserved whitespace  ');

  const { parseCommandLineArgs } = require('../src/cli-options.js');
  const roundTripPath = path.join(os.tmpdir(), `avs-xmpp-launch-config-${process.pid}.json`);
  runTest('Legacy UDP Server configs retain Registered while new CLI and explicit Direct use stable destinations', () => {
    const file = path.join(os.tmpdir(), `avs-udp-mode-${process.pid}.json`);
    try {
      fs.writeFileSync(file, JSON.stringify({ connection: { protocol: 'udp', mode: 'server', ip: '127.0.0.1', port: 5565 } }));
      const legacy = parseCommandLineArgs(['node', 'main.js', `config=${file}`, 'runMode=headless', `filename=${__filename}`]);
      const direct = parseCommandLineArgs(['node', 'main.js', `config=${file}`, 'runMode=headless', `filename=${__filename}`, 'udpConnectionMode=direct']);
      const fresh = parseCommandLineArgs(['node', 'main.js', 'protocol=udp', 'mode=server', 'runMode=headless', `filename=${__filename}`]);
      return legacy.headless.udpConnectionMode === 'registered'
        && direct.headless.udpConnectionMode === 'direct'
        && fresh.headless.udpConnectionMode === 'direct'
        && fresh.headless.udpLocalPort === 0;
    } finally { fs.rmSync(file, { force: true }); }
  });
  runTest('TCP greeting JSON preserves literal CRLF and whitespace with escapes disabled', () => {
    const file = path.join(os.tmpdir(), `avs-tcp-handshake-${process.pid}.json`);
    const greeting = '  secret-auth\r\nnext  ';
    try {
      fs.writeFileSync(file, JSON.stringify({ connection: {
        protocol: 'tcp', tcpHandshakeText: greeting, tcpHandshakeUseEscapes: false,
      } }));
      const parsed = parseCommandLineArgs(['node', 'main.js', `config=${file}`, 'runMode=headless', `filename=${__filename}`]);
      return parsed.mode === 'headless' && parsed.headless.tcpHandshakeText === greeting && parsed.headless.tcpHandshakeUseEscapes === false;
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
  runTest('Launch configs preserve explicit LF off and use on when missing in UI and headless', () => {
    const file = path.join(os.tmpdir(), `avs-udp-lf-config-${process.pid}.json`);
    try {
      for (const value of [undefined, false, true]) {
        const connection = { protocol: 'udp', mode: 'client', ip: '127.0.0.1', port: 5565 };
        if (value !== undefined) connection.udpAppendNewline = value;
        fs.writeFileSync(file, JSON.stringify({ connection }));
        const ui = parseCommandLineArgs(['node', 'main.js', `config=${file}`]);
        const headless = parseCommandLineArgs(['node', 'main.js', `config=${file}`, 'runMode=headless', `filename=${__filename}`]);
        if (ui.mode !== 'ui' || headless.mode !== 'headless') return false;
        if (ui.ui.presets.udpAppendNewline !== value || headless.headless.udpAppendNewline !== (value ?? true)) return false;
        const override = parseCommandLineArgs(['node', 'main.js', `config=${file}`, 'runMode=headless', `filename=${__filename}`, 'udpAppendNewline=false']);
        if (override.headless.udpAppendNewline !== false) return false;
      }
      return true;
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
  runTest('All launch samples enable LF by default', () => sampleNames.every(name =>
    JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/examples', name), 'utf8')).connection.udpAppendNewline === true));
  runTest('A launch-config file round-trips XMPP passwords without trimming them', () => {
    const configured = JSON.parse(JSON.stringify(clientSample));
    configured.connection.protocol = 'xmpp';
    configured.connection.mode = 'client';
    configured.connection.ip = '127.0.0.1';
    delete configured.connection.port;
    configured.connection.xmppUsername = 'receiver';
    configured.connection.xmppPassword = '  padded secret  ';
    configured.connection.xmppRoomPassword = '  padded room  ';
    configured.connection.xmppDestination = 'feed@example.test';
    configured.headless = { ...(configured.headless || {}), filename: __filename, runMode: 'headless' };
    fs.writeFileSync(roundTripPath, JSON.stringify(configured, null, 2), 'utf8');
    try {
      const parsed = parseCommandLineArgs(['node', 'main.js', 'runMode=headless', `config=${roundTripPath}`]);
      return parsed.mode === 'headless' &&
        parsed.headless.xmppPassword === '  padded secret  ' &&
        parsed.headless.xmppRoomPassword === '  padded room  ' &&
        parsed.headless.port === 5222 &&
        parsed.headless.xmppReconnectDelayMs === 60000;
    } finally {
      fs.rmSync(roundTripPath, { force: true });
    }
  });

  runTest('Launch-config samples use canonical XMPP keys and the shared ip host override', () =>
    sampleNames.every((name) => {
      const raw = fs.readFileSync(path.join(__dirname, '../docs/examples', name), 'utf8');
      const sample = JSON.parse(raw);
      return !raw.includes('xmppHost') &&
        Object.hasOwn(sample.connection, 'ip') &&
        sample.connection.xmppConversation === 'direct' &&
        sample.connection.xmppAllowUnverifiedTls === false &&
        sample.connection.xmppConnectTimeoutMs === 30000 &&
        sample.connection.xmppReplyTimeoutMs === 15000 &&
        sample.connection.xmppPingIntervalMs === 60000 &&
        sample.connection.xmppReconnectDelayMs === 60000;
    }));
  
  // Test Summary
  console.log('\n=== Test Results ===');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed!');
  } else {
    console.log(`\n⚠️  ${failed} test(s) failed.`);
    process.exit(1);
  }
}

if (require.main === module) {
  runConfigTests().catch(console.error);
}

module.exports = { runConfigTests };