/**
 * Unit tests for scripts/check-build-prereqs.js
 * — pure Node, no test framework. Verifies --json shape, exit codes, and
 * structural invariants in a host-agnostic way.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const CHECKER = path.resolve(__dirname, '..', 'scripts', 'check-build-prereqs.js');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed += 1; }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.stack || err.message}`); process.exitCode = 1; }
}

console.log('check-build-prereqs.test.js');

function run(args, env) {
  return spawnSync(process.execPath, [CHECKER, ...args], {
    encoding: 'utf8',
    env: { ...process.env, INSTALL_PREREQS_RUNNING: '1', ...(env || {}) },
  });
}

test('--json emits parseable JSON with required keys', () => {
  const r = run(['--json']);
  // Exit code: 0 when nothing missing on this machine, 1 otherwise — both valid.
  assert.ok(r.status === 0 || r.status === 1, `unexpected exit ${r.status}`);
  const stdout = (r.stdout || '').trim();
  assert.ok(stdout.length > 0, 'stdout should be non-empty in --json mode');
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(stdout); }, 'stdout must be valid JSON');
  assert.ok(Array.isArray(parsed.problems), 'problems must be an array');
  assert.ok(typeof parsed.platform === 'string', 'platform must be a string');
  assert.ok(parsed.targets && typeof parsed.targets === 'object', 'targets must be an object');
  assert.strictEqual(typeof parsed.targets.mac, 'boolean');
  assert.strictEqual(typeof parsed.targets.win, 'boolean');
  assert.strictEqual(typeof parsed.targets.linux, 'boolean');
  assert.strictEqual(typeof parsed.targets.all, 'boolean');
  assert.strictEqual(typeof parsed.release, 'boolean');
});

test('--json with --release sets release: true', () => {
  const r = run(['--json', '--release']);
  const parsed = JSON.parse((r.stdout || '').trim());
  assert.strictEqual(parsed.release, true);
});

test('--json without --release sets release: false', () => {
  const r = run(['--json']);
  const parsed = JSON.parse((r.stdout || '').trim());
  assert.strictEqual(parsed.release, false);
});

test('--json --linux limits targets to linux only', () => {
  const r = run(['--json', '--linux']);
  const parsed = JSON.parse((r.stdout || '').trim());
  assert.strictEqual(parsed.targets.linux, true);
  assert.strictEqual(parsed.targets.mac, false);
  assert.strictEqual(parsed.targets.win, false);
  assert.strictEqual(parsed.targets.all, false);
});

test('exit code matches problems.length', () => {
  const r = run(['--json']);
  const parsed = JSON.parse((r.stdout || '').trim());
  if (parsed.problems.length === 0) {
    assert.strictEqual(r.status, 0);
  } else {
    assert.strictEqual(r.status, 1);
  }
});

test('each problem entry has tool/need/install strings', () => {
  const r = run(['--json']);
  const parsed = JSON.parse((r.stdout || '').trim());
  for (const p of parsed.problems) {
    assert.strictEqual(typeof p.tool, 'string', 'problem.tool');
    assert.strictEqual(typeof p.need, 'string', 'problem.need');
    assert.strictEqual(typeof p.install, 'string', 'problem.install');
  }
});

test('non-JSON mode prints to stderr (or stdout success line) and exits cleanly', () => {
  const r = run([]);
  assert.ok(r.status === 0 || r.status === 1, `unexpected exit ${r.status}`);
  const out = (r.stdout || '') + (r.stderr || '');
  assert.ok(out.length > 0, 'should produce some output');
});

test('--quiet suppresses success line on green path', () => {
  const r = run(['--quiet']);
  if (r.status === 0) {
    assert.strictEqual((r.stdout || '').trim(), '', '--quiet on success should print nothing to stdout');
  }
});

test('INSTALL_PREREQS_RUNNING blocks auto-heal recursion', () => {
  // Even with INSTALL_PREREQS=1, the RUNNING guard must short-circuit.
  // We can't easily force a failure on this machine, so we just assert that
  // setting both env vars never causes the checker to spawn install-prereqs
  // (heuristic: stdout should not contain the install-prereqs banner).
  const r = run([], { INSTALL_PREREQS: '1', INSTALL_PREREQS_RUNNING: '1' });
  assert.ok(
    !((r.stdout || '') + (r.stderr || '')).includes('install-prereqs: querying'),
    'INSTALL_PREREQS_RUNNING should prevent recursion into install-prereqs.js'
  );
});

if (process.exitCode) {
  console.error('\nFAIL');
  process.exit(1);
}
console.log(`\n${passed} passed.`);

