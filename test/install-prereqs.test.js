/**
 * Unit tests for scripts/install-prereqs.js
 * — pure Node, no test framework. Tests the exported pure functions:
 * parseArgs, buildPlan, formatPlan. Side-effect functions (executePlan,
 * runChecker) are not tested directly to avoid mutating the host.
 */
'use strict';
const assert = require('assert');
const path = require('path');

const {
  parseArgs,
  buildPlan,
  formatPlan,
  linuxInstallCmd,
  windowsInstallCmd,
} = require('../scripts/install-prereqs.js');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed += 1; }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.stack || err.message}`); process.exitCode = 1; }
}

console.log('install-prereqs.test.js');

// ── parseArgs ────────────────────────────────────────────────────────────────
test('parseArgs: defaults to --all when no target given', () => {
  const o = parseArgs([]);
  assert.deepStrictEqual(o.targets, ['--all']);
  assert.strictEqual(o.release, false);
  assert.strictEqual(o.dryRun, false);
  assert.strictEqual(o.useSudo, false);
});

test('parseArgs: collects multiple target flags', () => {
  const o = parseArgs(['--mac', '--linux']);
  assert.deepStrictEqual(o.targets.sort(), ['--linux', '--mac']);
});

test('parseArgs: --release / --dry-run / --use-sudo / --quiet / --help', () => {
  const o = parseArgs(['--release', '--dry-run', '--use-sudo', '--quiet', '--help']);
  assert.strictEqual(o.release, true);
  assert.strictEqual(o.dryRun, true);
  assert.strictEqual(o.useSudo, true);
  assert.strictEqual(o.quiet, true);
  assert.strictEqual(o.help, true);
});

test('parseArgs: -h alias for --help', () => {
  const o = parseArgs(['-h']);
  assert.strictEqual(o.help, true);
});

// ── buildPlan: macOS host ────────────────────────────────────────────────────
const macHost = { platform: 'darwin', linuxPm: null, windowsPm: null };
const linuxHost = (pm) => ({ platform: 'linux', linuxPm: pm, windowsPm: null });
const winHost = (pm) => ({ platform: 'win32', linuxPm: null, windowsPm: pm });
const opts = (overrides) => ({ useSudo: false, sudoTtyOk: true, dryRun: false, ...overrides });

test('buildPlan macOS: dpkg + fakeroot + binutils → coalesced brew installs', () => {
  const problems = [
    { tool: 'dpkg', need: '', install: '' },
    { tool: 'fakeroot', need: '', install: '' },
    { tool: 'GNU ar', need: '', install: '' },
  ];
  const plan = buildPlan(problems, macHost, opts());
  assert.strictEqual(plan.auto.length, 3);
  assert.ok(plan.auto.some(a => a.cmd === 'brew install dpkg'));
  assert.ok(plan.auto.some(a => a.cmd === 'brew install fakeroot'));
  assert.ok(plan.auto.some(a => a.cmd === 'brew install binutils'));
  assert.strictEqual(plan.manual.length, 0);
});

test('buildPlan macOS: same brew package only emitted once (deduplication)', () => {
  // Two problems both mapping to the same brew formula should coalesce.
  const problems = [
    { tool: 'dpkg', need: '', install: '' },
    { tool: 'dpkg', need: '', install: '' },
  ];
  const plan = buildPlan(problems, macHost, opts());
  assert.strictEqual(plan.auto.length, 1);
});

test('buildPlan macOS: git + gh in --release flow', () => {
  const problems = [
    { tool: 'git', need: '', install: '' },
    { tool: 'gh', need: '', install: '' },
  ];
  const plan = buildPlan(problems, macHost, opts());
  assert.ok(plan.auto.some(a => a.cmd === 'brew install git'));
  assert.ok(plan.auto.some(a => a.cmd === 'brew install gh'));
});

test('buildPlan macOS: gh authentication is always SKIP-with-instructions', () => {
  const problems = [{ tool: 'gh authentication', need: '', install: '' }];
  const plan = buildPlan(problems, macHost, opts());
  assert.strictEqual(plan.auto.length, 0);
  assert.strictEqual(plan.manual.length, 1);
  assert.match(plan.manual[0].instructions, /gh auth login/);
});

test('buildPlan macOS: node major upgrade is SKIP-with-instructions', () => {
  const problems = [{ tool: 'node >= 18', need: '', install: '' }];
  const plan = buildPlan(problems, macHost, opts());
  assert.strictEqual(plan.auto.length, 0);
  assert.strictEqual(plan.manual.length, 1);
  assert.match(plan.manual[0].instructions, /node@20|nodejs\.org/i);
});

test('buildPlan macOS: node_modules → npm install with cwd', () => {
  const problems = [{ tool: 'node_modules', need: '', install: '' }];
  const plan = buildPlan(problems, macHost, opts());
  assert.strictEqual(plan.auto.length, 1);
  assert.strictEqual(plan.auto[0].cmd, 'npm install');
  assert.ok(plan.auto[0].cwd && plan.auto[0].cwd.length > 0, 'cwd should be set');
});

// ── buildPlan: Linux host ────────────────────────────────────────────────────
test('buildPlan Linux apt-get without sudo: instructions to run with sudo', () => {
  const problems = [{ tool: 'dpkg', need: '', install: '' }];
  const plan = buildPlan(problems, linuxHost('apt-get'), opts({ useSudo: false }));
  assert.strictEqual(plan.auto.length, 0);
  assert.strictEqual(plan.manual.length, 1);
  assert.match(plan.manual[0].instructions, /sudo apt-get install/);
});

test('buildPlan Linux apt-get with --use-sudo and TTY: auto-install with sudo', () => {
  const problems = [{ tool: 'fakeroot', need: '', install: '' }];
  const plan = buildPlan(problems, linuxHost('apt-get'), opts({ useSudo: true, sudoTtyOk: true }));
  assert.strictEqual(plan.auto.length, 1);
  assert.strictEqual(plan.auto[0].cmd, 'sudo apt-get install -y fakeroot');
});

test('buildPlan Linux --use-sudo without TTY: still SKIP, do not hang', () => {
  const problems = [{ tool: 'fakeroot', need: '', install: '' }];
  const plan = buildPlan(problems, linuxHost('apt-get'), opts({ useSudo: true, sudoTtyOk: false }));
  assert.strictEqual(plan.auto.length, 0);
  assert.strictEqual(plan.manual.length, 1);
  assert.match(plan.manual[0].instructions, /no TTY available/i);
});

test('buildPlan Linux dnf with sudo', () => {
  const problems = [{ tool: 'git', need: '', install: '' }];
  const plan = buildPlan(problems, linuxHost('dnf'), opts({ useSudo: true, sudoTtyOk: true }));
  assert.strictEqual(plan.auto[0].cmd, 'sudo dnf install -y git');
});

test('buildPlan Linux pacman with sudo', () => {
  const problems = [{ tool: 'git', need: '', install: '' }];
  const plan = buildPlan(problems, linuxHost('pacman'), opts({ useSudo: true, sudoTtyOk: true }));
  assert.strictEqual(plan.auto[0].cmd, 'sudo pacman -S --noconfirm git');
});

test('buildPlan Linux: no PM detected → manual instructions', () => {
  const problems = [{ tool: 'git', need: '', install: '' }];
  const plan = buildPlan(problems, linuxHost(null), opts({ useSudo: true, sudoTtyOk: true }));
  assert.strictEqual(plan.auto.length, 0);
  assert.strictEqual(plan.manual.length, 1);
  assert.match(plan.manual[0].instructions, /apt-get|dnf|pacman/);
});

test('buildPlan Linux: GNU ar → manual note (system ar is GNU on Linux)', () => {
  const problems = [{ tool: 'GNU ar', need: '', install: '' }];
  const plan = buildPlan(problems, linuxHost('apt-get'), opts({ useSudo: true, sudoTtyOk: true }));
  assert.strictEqual(plan.auto.length, 0);
  assert.strictEqual(plan.manual.length, 1);
  assert.match(plan.manual[0].instructions, /system ar/i);
});

test('buildPlan Linux: gh requires repo setup → manual', () => {
  const problems = [{ tool: 'gh', need: '', install: '' }];
  const plan = buildPlan(problems, linuxHost('apt-get'), opts({ useSudo: true, sudoTtyOk: true }));
  assert.strictEqual(plan.auto.length, 0);
  assert.strictEqual(plan.manual.length, 1);
  assert.match(plan.manual[0].instructions, /cli\.github\.com/);
});

// ── buildPlan: Windows host ──────────────────────────────────────────────────
test('buildPlan Windows winget: git + gh', () => {
  const problems = [
    { tool: 'git', need: '', install: '' },
    { tool: 'gh', need: '', install: '' },
  ];
  const plan = buildPlan(problems, winHost('winget'), opts());
  assert.ok(plan.auto.some(a => a.cmd === 'winget install -e --id Git.Git'));
  assert.ok(plan.auto.some(a => a.cmd === 'winget install -e --id GitHub.cli'));
});

test('buildPlan Windows choco fallback: git + gh', () => {
  const problems = [
    { tool: 'git', need: '', install: '' },
    { tool: 'gh', need: '', install: '' },
  ];
  const plan = buildPlan(problems, winHost('choco'), opts());
  assert.ok(plan.auto.some(a => a.cmd === 'choco install -y git'));
  assert.ok(plan.auto.some(a => a.cmd === 'choco install -y gh'));
});

test('buildPlan Windows: dpkg/fakeroot → manual (use WSL)', () => {
  const problems = [
    { tool: 'dpkg', need: '', install: '' },
    { tool: 'fakeroot', need: '', install: '' },
  ];
  const plan = buildPlan(problems, winHost('winget'), opts());
  assert.strictEqual(plan.auto.length, 0);
  assert.strictEqual(plan.manual.length, 2);
  for (const m of plan.manual) {
    assert.match(m.instructions, /WSL/);
  }
});

test('buildPlan Windows: no PM detected → manual', () => {
  const problems = [{ tool: 'git', need: '', install: '' }];
  const plan = buildPlan(problems, winHost(null), opts());
  assert.strictEqual(plan.auto.length, 0);
  assert.strictEqual(plan.manual.length, 1);
});

// ── formatPlan ───────────────────────────────────────────────────────────────
test('formatPlan: empty problems → success line', () => {
  const out = formatPlan({ auto: [], manual: [], errors: [] }, 0, opts());
  assert.match(out, /already installed/i);
});

test('formatPlan: with auto + manual + errors', () => {
  const plan = {
    auto: [{ tool: 'git', cmd: 'brew install git' }],
    manual: [{ tool: 'gh authentication', instructions: 'gh auth login' }],
    errors: [{ tool: 'unknown', reason: 'no mapping' }],
  };
  const out = formatPlan(plan, 3, opts());
  assert.match(out, /Auto-install/);
  assert.match(out, /brew install git/);
  assert.match(out, /Manual action/);
  assert.match(out, /gh auth login/);
  assert.match(out, /Internal errors/);
});

test('formatPlan: dryRun adds "DRY RUN" annotation', () => {
  const plan = { auto: [{ tool: 'git', cmd: 'brew install git' }], manual: [], errors: [] };
  const out = formatPlan(plan, 1, opts({ dryRun: true }));
  assert.match(out, /DRY RUN/);
});

// ── helper: linuxInstallCmd / windowsInstallCmd ──────────────────────────────
test('linuxInstallCmd: known PMs', () => {
  assert.strictEqual(linuxInstallCmd('apt-get', ['git'], false), 'apt-get install -y git');
  assert.strictEqual(linuxInstallCmd('apt-get', ['git'], true), 'sudo apt-get install -y git');
  assert.strictEqual(linuxInstallCmd('dnf', ['git'], false), 'dnf install -y git');
  assert.strictEqual(linuxInstallCmd('pacman', ['git'], false), 'pacman -S --noconfirm git');
  assert.strictEqual(linuxInstallCmd('zypper', ['git'], false), null, 'unknown PM returns null');
});

test('windowsInstallCmd: winget vs choco', () => {
  assert.strictEqual(windowsInstallCmd('winget', 'Git.Git', 'git'), 'winget install -e --id Git.Git');
  assert.strictEqual(windowsInstallCmd('choco', 'Git.Git', 'git'), 'choco install -y git');
  assert.strictEqual(windowsInstallCmd('winget', null, null), null);
});

if (process.exitCode) {
  console.error('\nFAIL');
  process.exit(1);
}
console.log(`\n${passed} passed.`);

