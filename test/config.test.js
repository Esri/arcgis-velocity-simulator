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

const { ConfigManager } = require('../src/config.js');

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