#!/usr/bin/env node
/**
 * timed-parallel-build.js
 * Runs multiple electron-builder steps in parallel, prefixes each step's output
 * with its label, and prints a summary table (matching timed-seq-build.js style)
 * when all steps finish.
 *
 * Usage (via npm scripts):
 *   node scripts/timed-parallel-build.js [--clean] [--compression=maximum] "Label:--arg1,--arg2" ...
 *
 * Examples:
 *   node scripts/timed-parallel-build.js "macOS:--mac" "Windows:--win" "Linux:--linux"
 *   node scripts/timed-parallel-build.js --compression=maximum "macOS:--mac" "Windows:--win" "Linux:--linux"
 *   node scripts/timed-parallel-build.js --clean "macOS:--mac" "Windows:--win" "Linux:--linux"
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { ensureGnuArPath } = require('./binutils-path');

const bin = path.join(__dirname, '..', 'node_modules', '.bin', 'electron-builder');
const distDir = path.join(__dirname, '..', 'dist');

// PATH override: prepend Homebrew binutils on macOS so electron-builder finds
// GNU `ar` instead of BSD `ar` (required for valid .deb archives).
const childEnv = { ...process.env, PATH: ensureGnuArPath(process.env.PATH) };

// ── Parse args ────────────────────────────────────────────────────────────────
const rawArgs = process.argv.slice(2);
let clean = false;
let compressionOverride = null;
const stepDefs = [];

for (const arg of rawArgs) {
  if (arg === '--clean') {
    clean = true;
  } else if (arg.startsWith('--compression=')) {
    compressionOverride = arg.replace('--compression=', '');
  } else {
    stepDefs.push(arg);
  }
}

if (stepDefs.length === 0) {
  console.error('Usage: node scripts/timed-parallel-build.js [--clean] [--compression=maximum] "Label:--arg1,--arg2" ...');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatElapsed(ms) {
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(1);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

// Pad label to a fixed width for aligned prefixes
const MAX_LABEL = Math.max(...stepDefs.map(d => {
  const i = d.indexOf(':');
  return (i >= 0 ? d.slice(0, i) : d).length;
}));

function prefix(label) {
  return `[${label.padEnd(MAX_LABEL)}] `;
}

// ── Optional clean ────────────────────────────────────────────────────────────
if (clean) {
  console.log('\n🧹 Cleaning dist/ ...');
  fs.rmSync(distDir, { recursive: true, force: true });
  console.log('   dist/ removed.\n');
}

// ── Launch all steps ──────────────────────────────────────────────────────────
const totalStart = Date.now();
const totalStartTime = new Date().toLocaleTimeString();

console.log(`\n${'═'.repeat(60)}`);
console.log(`⏱  Parallel build started at ${totalStartTime}  (${stepDefs.length} steps)`);
console.log(`${'═'.repeat(60)}\n`);

const promises = stepDefs.map(def => {
  const colonIdx = def.indexOf(':');
  const label = colonIdx >= 0 ? def.slice(0, colonIdx) : def;
  const argsStr = colonIdx >= 0 ? def.slice(colonIdx + 1) : '';
  let stepArgs = argsStr ? argsStr.split(',') : [];

  if (compressionOverride) {
    stepArgs = stepArgs.filter(a => !a.startsWith('--config.compression'));
    stepArgs.push(`--config.compression=${compressionOverride}`);
  }

  const stepStart = Date.now();
  const stepStartTime = new Date().toLocaleTimeString();
  const pfx = prefix(label);

  console.log(`${pfx}▶  electron-builder ${stepArgs.join(' ')}  (started ${stepStartTime})`);

  return new Promise(resolve => {
    const child = spawn(bin, stepArgs, {
      shell: process.platform === 'win32',
      env: childEnv,
    });

    // Stream stdout/stderr with label prefix
    function streamLines(stream) {
      let buf = '';
      stream.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop(); // incomplete last line
        for (const line of lines) {
          process.stdout.write(pfx + line + '\n');
        }
      });
      stream.on('end', () => {
        if (buf) process.stdout.write(pfx + buf + '\n');
      });
    }

    streamLines(child.stdout);
    streamLines(child.stderr);

    child.on('close', code => {
      const elapsed = Date.now() - stepStart;
      const endTime = new Date().toLocaleTimeString();
      const ok = code === 0;
      console.log(
        `\n${pfx}${ok ? '✅' : '❌'}  ${formatElapsed(elapsed)}  (${stepStartTime} → ${endTime})\n`
      );
      resolve({ label, elapsed, ok, startTime: stepStartTime, endTime });
    });
  });
});

// ── Wait for all and print summary ────────────────────────────────────────────
Promise.all(promises).then(results => {
  const totalElapsed = Date.now() - totalStart;
  const totalEndTime = new Date().toLocaleTimeString();

  const labelWidth = Math.max(8, ...results.map(r => r.label.length));
  const timeWidth  = Math.max(8, ...results.map(r => formatElapsed(r.elapsed).length),
                               formatElapsed(totalElapsed).length);

  const header =
    '  ' + 'Step'.padEnd(labelWidth) + '  ' +
    'Time'.padStart(timeWidth) + '  ' +
    'Status';
  const divider = '─'.repeat(header.length + 2);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📋 Build Summary  (${totalStartTime} → ${totalEndTime})`);
  console.log(`${'═'.repeat(60)}`);
  console.log(header);
  console.log(divider);

  const anyFailed = results.some(r => !r.ok);
  for (const r of results) {
    console.log(
      '  ' + r.label.padEnd(labelWidth) + '  ' +
      formatElapsed(r.elapsed).padStart(timeWidth) + '  ' +
      (r.ok ? '✅ ok' : '❌ FAILED')
    );
  }

  console.log(divider);
  const totalLabel = (anyFailed ? '❌ Total (with failures)' : '✅ Total').padEnd(labelWidth + 2);
  console.log('  ' + totalLabel + '  ' + formatElapsed(totalElapsed).padStart(timeWidth));
  console.log(`${'═'.repeat(60)}\n`);

  if (anyFailed) process.exit(1);
});

