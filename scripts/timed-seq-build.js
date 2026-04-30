#!/usr/bin/env node
/**
 * timed-seq-build.js
 * Runs multiple electron-builder steps sequentially, prints per-step timing,
 * and prints an overall summary table at the end.
 *
 * Usage (via npm scripts):
 *   node scripts/timed-seq-build.js [--clean] <step1Label:arg1,arg2,...> <step2Label:arg1,...> ...
 *
 * Examples:
 *   node scripts/timed-seq-build.js "macOS:--mac" "Windows:--win" "Windows ZIP:--win,zip,--x64" "Linux:--linux"
 *   node scripts/timed-seq-build.js --clean "macOS:--mac" "Windows:--win" "Windows ZIP:--win,zip,--x64" "Linux:--linux"
 *   node scripts/timed-seq-build.js --compression=maximum "macOS:--mac" "Windows:--win" "Windows ZIP:--win,zip,--x64" "Linux:--linux"
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
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
  console.error('Usage: node scripts/timed-seq-build.js [--clean] [--compression=maximum] "Label:--arg1,--arg2" ...');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatElapsed(ms) {
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(1);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

// ── Optional clean ────────────────────────────────────────────────────────────
if (clean) {
  console.log('\n🧹 Cleaning dist/ ...');
  fs.rmSync(distDir, { recursive: true, force: true });
  console.log('   dist/ removed.\n');
}

// ── Unpacked dir cleanup ──────────────────────────────────────────────────────
// electron-builder leaves platform staging dirs (e.g. dist/linux-unpacked,
// dist/mac) between steps. Subsequent platform builds can reuse stale content
// from these dirs, producing undersized or corrupted artifacts. We wipe them
// before each step so every platform build starts from a clean slate.
const unpackedDirs = [
  'linux-unpacked',
  'linux-arm64-unpacked',
  'win-unpacked',
  'mac',
  'mac-arm64',
];

function cleanUnpacked() {
  for (const dir of unpackedDirs) {
    const full = path.join(distDir, dir);
    if (fs.existsSync(full)) {
      fs.rmSync(full, { recursive: true, force: true });
    }
  }
}

// ── Run steps ─────────────────────────────────────────────────────────────────
const totalStart = Date.now();
const totalStartTime = new Date().toLocaleTimeString();
const results = [];

console.log(`\n${'═'.repeat(60)}`);
console.log(`⏱  Sequential build started at ${totalStartTime}`);
console.log(`${'═'.repeat(60)}\n`);

for (const def of stepDefs) {
  const colonIdx = def.indexOf(':');
  const label = colonIdx >= 0 ? def.slice(0, colonIdx) : def;
  const argsStr = colonIdx >= 0 ? def.slice(colonIdx + 1) : '';
  let stepArgs = argsStr ? argsStr.split(',') : [];

  if (compressionOverride) {
    stepArgs = stepArgs.filter(a => !a.startsWith('--config.compression'));
    stepArgs.push(`--config.compression=${compressionOverride}`);
  }

  cleanUnpacked();

  const stepStart = Date.now();
  const stepStartTime = new Date().toLocaleTimeString();

  console.log(`${'─'.repeat(60)}`);
  console.log(`▶  [${label}]  electron-builder ${stepArgs.join(' ')}`);
  console.log(`   Started at ${stepStartTime}\n`);

  const result = spawnSync(bin, stepArgs, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: childEnv,
  });

  const elapsed = Date.now() - stepStart;
  const endTime = new Date().toLocaleTimeString();
  const ok = result.status === 0;

  console.log(
    `\n${ok ? '✅' : '❌'} [${label}]  ${formatElapsed(elapsed)}  (${stepStartTime} → ${endTime})`
  );

  results.push({ label, elapsed, ok, startTime: stepStartTime, endTime });

  if (!ok) {
    // Print summary up to the failed step, then exit.
    printSummary(results, true);
    process.exit(result.status || 1);
  }
}

printSummary(results, false);

// ── Summary ───────────────────────────────────────────────────────────────────
function printSummary(steps, failed) {
  const totalElapsed = Date.now() - totalStart;
  const totalEndTime = new Date().toLocaleTimeString();

  const labelWidth = Math.max(8, ...steps.map(s => s.label.length));
  const timeWidth  = Math.max(8, ...steps.map(s => formatElapsed(s.elapsed).length));

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
  for (const s of steps) {
    const status = s.ok ? '✅ ok' : '❌ FAILED';
    console.log(
      '  ' + s.label.padEnd(labelWidth) + '  ' +
      formatElapsed(s.elapsed).padStart(timeWidth) + '  ' +
      status
    );
  }
  console.log(divider);
  const totalLabel = (failed ? '❌ Total (aborted)' : '✅ Total').padEnd(labelWidth + 2);
  console.log('  ' + totalLabel + '  ' + formatElapsed(totalElapsed).padStart(timeWidth));
  console.log(`${'═'.repeat(60)}\n`);
}
