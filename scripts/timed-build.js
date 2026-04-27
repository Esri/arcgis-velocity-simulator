#!/usr/bin/env node
/**
 * timed-build.js
 * Wraps electron-builder and prints elapsed build time on completion.
 * Usage (via npm scripts): node scripts/timed-build.js [electron-builder args...]
 */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const args = process.argv.slice(2);
// Resolve the binary relative to the repo root so this works whether invoked
// via `npm run` or directly via `node scripts/timed-build.js`.
const bin = path.join(__dirname, '..', 'node_modules', '.bin', 'electron-builder');
const startMs = Date.now();
const startTime = new Date().toLocaleTimeString();
console.log('\n\u23f1  Build started at ' + startTime);
console.log('   electron-builder ' + args.join(' ') + '\n');
// shell: true is required on Windows so the .cmd shim in node_modules/.bin resolves correctly.
const result = spawnSync(bin, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
const elapsedMs = Date.now() - startMs;
const mins = Math.floor(elapsedMs / 60000);
const secs = ((elapsedMs % 60000) / 1000).toFixed(1);
const elapsed = mins > 0 ? (mins + 'm ' + secs + 's') : (secs + 's');
const endTime = new Date().toLocaleTimeString();
if (result.status === 0) {
  console.log('\n\u2705 Build finished in ' + elapsed + '  (' + startTime + ' \u2192 ' + endTime + ')');
} else {
  console.log('\n\u274c Build failed after ' + elapsed + '  (' + startTime + ' \u2192 ' + endTime + ')');
  process.exit(result.status || 1);
}
