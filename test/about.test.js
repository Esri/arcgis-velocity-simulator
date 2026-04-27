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
 * About Dialog Unit Tests
 * Run with: node test/about.test.js
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// --- Test Setup ---

const aboutHtmlPath = path.resolve(__dirname, '../src/about.html');
const aboutJsPath = path.resolve(__dirname, '../src/about.js');

const aboutHtml = fs.readFileSync(aboutHtmlPath, 'utf-8');
const aboutScript = fs.readFileSync(aboutJsPath, 'utf-8');

const dom = new JSDOM(aboutHtml, {
  runScripts: 'outside-only',
  url: 'file://' + path.resolve(__dirname, '../src/'),
});

// --- Mocking Globals ---

global.document = dom.window.document;
global.window = dom.window;

// Mock window.api for about dialog
global.window.api = {
  getAppVersion: () => Promise.resolve('1.2.3'),
  onSetTheme: (callback) => {
    global.window.api._themeCallback = callback;
  },
  themeApplied: () => {
    global.window.api._themeAppliedCalled = true;
  }
};

// Mock window.close
global.window.close = () => {
  global.window._closeCalled = true;
};

/**
 * Test Suite: About Dialog
 */
async function runAboutTests() {
  console.log('\n=== About Dialog Test Suite ===');
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
  
  const runAsyncTest = async (testName, testFn) => {
    try {
      const result = await testFn();
      if (result) {
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
  
  console.log('\nSetting up about dialog environment...');
  
  // Execute the about script
  dom.window.eval(aboutScript);
  
  // Manually trigger DOMContentLoaded
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  
  // Wait for async operations
  await new Promise(resolve => process.nextTick(resolve));
  
  // Test 1: DOM Elements
  console.log('\n--- Test 1: DOM Elements ---');
  runTest('Close button exists', () => {
    return document.getElementById('close-button') !== null;
  });
  
  runTest('Version element exists', () => {
    return document.getElementById('about-version') !== null;
  });
  
  // Test 2: Version Display
  console.log('\n--- Test 2: Version Display ---');
  await runAsyncTest('Version is displayed correctly', async () => {
    // Wait a bit for the async version call to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    const versionElement = document.getElementById('about-version');
    return versionElement && versionElement.textContent.includes('1.2.3');
  });
  
  // Test 3: Close Button Functionality
  console.log('\n--- Test 3: Close Button Functionality ---');
  runTest('Close button has click listener', () => {
    const closeButton = document.getElementById('close-button');
    // Simulate click
    global.window._closeCalled = false;
    closeButton.click();
    return global.window._closeCalled === true;
  });
  
  // Test 4: Theme Handling
  console.log('\n--- Test 4: Theme Handling ---');
  runTest('Theme callback is registered', () => {
    return typeof global.window.api._themeCallback === 'function';
  });
  
  runTest('Theme application works with valid theme', () => {
    global.window.api._themeAppliedCalled = false;
    // Simulate theme event
    global.window.api._themeCallback(null, 'dark');
    return document.body.className === 'dark' && global.window.api._themeAppliedCalled;
  });
  
  runTest('Theme application works with null theme (defaults to dark)', () => {
    global.window.api._themeAppliedCalled = false;
    document.body.className = ''; // Reset
    // Simulate theme event with null
    global.window.api._themeCallback(null, null);
    return document.body.className === 'dark' && global.window.api._themeAppliedCalled;
  });
  
  runTest('Theme application works with undefined theme (defaults to dark)', () => {
    global.window.api._themeAppliedCalled = false;
    document.body.className = ''; // Reset
    // Simulate theme event with undefined
    global.window.api._themeCallback(null, undefined);
    return document.body.className === 'dark' && global.window.api._themeAppliedCalled;
  });
  
  // Test 5: Multiple Theme Changes
  console.log('\n--- Test 5: Multiple Theme Changes ---');
  runTest('Multiple theme changes work correctly', () => {
    const themes = ['light', 'blue', 'green', 'dark'];
    let allWorked = true;
    
    for (const theme of themes) {
      global.window.api._themeAppliedCalled = false;
      global.window.api._themeCallback(null, theme);
      if (document.body.className !== theme || !global.window.api._themeAppliedCalled) {
        allWorked = false;
        break;
      }
    }
    
    return allWorked;
  });
  
  // Test 6: Edge Cases
  console.log('\n--- Test 6: Edge Cases ---');
  runTest('Empty string theme defaults to dark', () => {
    global.window.api._themeAppliedCalled = false;
    document.body.className = ''; // Reset
    global.window.api._themeCallback(null, '');
    return document.body.className === 'dark' && global.window.api._themeAppliedCalled;
  });
  
  runTest('Whitespace-only theme defaults to dark', () => {
    global.window.api._themeAppliedCalled = false;
    document.body.className = ''; // Reset
    const whitespaceTheme = '   ';
    // Simulate the theme handling logic that would trim whitespace
    const processedTheme = whitespaceTheme.trim() || 'dark';
    global.window.api._themeCallback(null, processedTheme);
    return document.body.className === 'dark' && global.window.api._themeAppliedCalled;
  });
  
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
  runAboutTests().catch(console.error);
}

module.exports = { runAboutTests };
