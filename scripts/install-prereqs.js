#!/usr/bin/env node
/**
 * install-prereqs.js
 *
 * Companion to check-build-prereqs.js: invokes the checker (with --json) to
 * get the canonical list of missing prerequisites for the current host, then
 * installs them via the host's native package manager (Homebrew, apt/dnf/pacman,
 * winget/choco). Skip-with-instructions for things that are too risky to auto-
 * install (Node major upgrades, `gh auth login`, .deb on Windows → WSL, …).
 *
 * The list of *what is needed* lives in check-build-prereqs.js (single source
 * of truth). This script only knows *how to install* what the checker reports.
 *
 * Usage:
 *   node scripts/install-prereqs.js                # install build-only prereqs (all targets)
 *   node scripts/install-prereqs.js --linux        # only Linux deps
 *   node scripts/install-prereqs.js --mac --win    # multiple targets
 *   node scripts/install-prereqs.js --release      # also install git, gh
 *   node scripts/install-prereqs.js --dry-run      # print plan, do not execute
 *   node scripts/install-prereqs.js --quiet        # only print on failure / when installing
 *   node scripts/install-prereqs.js --use-sudo     # allow sudo on Linux apt/dnf
 *   node scripts/install-prereqs.js --help         # show help
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');

// ── Tiny styling (TTY-aware) ─────────────────────────────────────────────────
const useColor = process.stdout.isTTY;
const c = (code) => (useColor ? code : '');
const RED    = c('\x1b[31m');
const YELLOW = c('\x1b[33m');
const GREEN  = c('\x1b[32m');
const CYAN   = c('\x1b[36m');
const BOLD   = c('\x1b[1m');
const DIM    = c('\x1b[2m');
const RESET  = c('\x1b[0m');

// ── Pure: argument parser ────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(0);
  const opts = {
    help: args.includes('--help') || args.includes('-h'),
    quiet: args.includes('--quiet'),
    dryRun: args.includes('--dry-run'),
    release: args.includes('--release'),
    useSudo: args.includes('--use-sudo'),
    targets: [],
  };
  for (const flag of ['--mac', '--win', '--linux', '--all']) {
    if (args.includes(flag)) opts.targets.push(flag);
  }
  if (opts.targets.length === 0) opts.targets.push('--all');
  return opts;
}

// ── Help ─────────────────────────────────────────────────────────────────────
function printHelp() {
  process.stdout.write(`
${BOLD}install-prereqs.js${RESET} — install missing build/release prerequisites

${BOLD}Usage:${RESET}
  node scripts/install-prereqs.js [options]

${BOLD}Targets${RESET} (combinable; default: all):
  --mac        Install macOS-build prereqs
  --win        Install Windows-build prereqs
  --linux      Install Linux-build prereqs (dpkg, fakeroot, GNU ar on macOS)
  --all        All of the above

${BOLD}Modes:${RESET}
  --release    Also install release prereqs (git, gh). Does NOT run gh auth login.
  --dry-run    Print the plan without executing any install commands.
  --quiet      Suppress success chatter; only print on action or failure.
  --use-sudo   On Linux, prefix apt/dnf/pacman with sudo (requires interactive TTY).
  --help, -h   Show this help and exit.

${BOLD}What it does:${RESET}
  1. Runs check-build-prereqs.js --json to get the list of missing tools.
  2. Maps each missing tool to a host-OS-appropriate install command.
  3. Prints the plan (auto-install / skip-with-instructions / manual).
  4. Executes the install commands (unless --dry-run).
  5. Re-runs the checker; exits non-zero if anything is still missing.

${BOLD}Skip-with-instructions${RESET} (never auto-installed):
  • Node major upgrades — too risky to bump Node version automatically.
  • ${BOLD}gh auth login${RESET} — interactive; user must run it.
  • .deb tooling on Windows — use WSL.
`);
}

// ── Run the checker, return parsed problems list ─────────────────────────────
function runChecker(targetFlags, releaseMode) {
  const checkerPath = path.join(__dirname, 'check-build-prereqs.js');
  const args = [checkerPath, '--json', ...targetFlags];
  if (releaseMode) args.push('--release');
  // The auto-heal hook in check-build-prereqs.js MUST NOT recurse into us when
  // we invoke it for plan-building. Setting INSTALL_PREREQS_RUNNING blocks that.
  const env = { ...process.env, INSTALL_PREREQS_RUNNING: '1' };
  const result = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
  if (result.error) {
    throw new Error(`Failed to spawn check-build-prereqs.js: ${result.error.message}`);
  }
  const stdout = (result.stdout || '').trim();
  if (!stdout) {
    throw new Error(`check-build-prereqs.js --json produced no output (exit ${result.status})\nstderr:\n${result.stderr || ''}`);
  }
  try {
    return JSON.parse(stdout);
  } catch (e) {
    throw new Error(`check-build-prereqs.js --json produced invalid JSON: ${e.message}\noutput:\n${stdout}`);
  }
}

// ── Detect Linux package manager ─────────────────────────────────────────────
function detectLinuxPm() {
  for (const pm of ['apt-get', 'dnf', 'pacman']) {
    const r = spawnSync('command', ['-v', pm], { shell: true, encoding: 'utf8' });
    if (r.status === 0 && (r.stdout || '').trim()) return pm;
  }
  return null;
}

// Convenience: produce an install command for a given Linux pm + package list.
function linuxInstallCmd(pm, pkgs, useSudo) {
  const sudoPrefix = useSudo ? 'sudo ' : '';
  switch (pm) {
    case 'apt-get': return `${sudoPrefix}apt-get install -y ${pkgs.join(' ')}`;
    case 'dnf':     return `${sudoPrefix}dnf install -y ${pkgs.join(' ')}`;
    case 'pacman':  return `${sudoPrefix}pacman -S --noconfirm ${pkgs.join(' ')}`;
    default:        return null;
  }
}

// ── Detect Windows package manager ───────────────────────────────────────────
function detectWindowsPm() {
  for (const pm of ['winget', 'choco']) {
    const r = spawnSync('where', [pm], { encoding: 'utf8' });
    if (r.status === 0 && (r.stdout || '').trim()) return pm;
  }
  return null;
}

function windowsInstallCmd(pm, wingetId, chocoPkg) {
  if (pm === 'winget' && wingetId)  return `winget install -e --id ${wingetId}`;
  if (pm === 'choco'  && chocoPkg)  return `choco install -y ${chocoPkg}`;
  return null;
}

// ── Pure: build a plan from problems[] + host info ───────────────────────────
//
// A plan is { auto: [{tool, cmd, cwd?}], manual: [{tool, instructions}], errors: [] }.
//   - auto:    we will run `cmd` (unless --dry-run).
//   - manual:  we cannot run anything — print `instructions` for the user.
//   - errors:  unrecognised tools (shouldn't happen if checker stays in sync).
//
// `host` is { platform: 'darwin'|'linux'|'win32', linuxPm, windowsPm }.
// `options` is { useSudo, sudoTtyOk }.  sudoTtyOk = stdin is TTY.
function buildPlan(problems, host, options) {
  const plan = { auto: [], manual: [], errors: [] };
  const seenBrew = new Set();
  const isMac   = host.platform === 'darwin';
  const isLinux = host.platform === 'linux';
  const isWin   = host.platform === 'win32';

  const repoRoot = path.resolve(__dirname, '..');

  for (const p of problems) {
    const tool = p.tool;

    // ── node_modules → npm install (universal) ─────────────────────────────
    if (tool === 'node_modules') {
      plan.auto.push({
        tool, cmd: 'npm install', cwd: repoRoot,
      });
      continue;
    }

    // ── Node version upgrade — never auto, always manual ──────────────────
    if (tool === 'node >= 18') {
      plan.manual.push({
        tool,
        instructions: isMac
          ? 'Install Node 20 LTS:  brew install node@20  (or download from https://nodejs.org)'
          : isWin
          ? 'Install Node 20 LTS:  winget install -e --id OpenJS.NodeJS.LTS  (or download from https://nodejs.org)'
          : 'Install Node 20 LTS:  use nvm (https://github.com/nvm-sh/nvm) or your distro\'s package — auto-upgrade is too risky',
      });
      continue;
    }

    // ── npm reinstall — manual (means Node install is broken) ─────────────
    if (tool === 'npm') {
      plan.manual.push({
        tool,
        instructions: 'Reinstall Node.js (npm ships with it): https://nodejs.org or `brew install node`',
      });
      continue;
    }

    // ── gh auth login — always manual, interactive ────────────────────────
    if (tool === 'gh authentication') {
      plan.manual.push({
        tool,
        instructions: 'Run interactively:  gh auth login',
      });
      continue;
    }

    // ── Tools installable per-host ────────────────────────────────────────
    // Map: tool → (mac brew pkg, win winget id, win choco pkg, linux pkg)
    const map = {
      'dpkg':       { brew: 'dpkg',      winget: null,             choco: null,    linuxPkg: 'dpkg',     manualWin: 'Build .deb under WSL — Windows host cannot produce .deb directly' },
      'fakeroot':   { brew: 'fakeroot',  winget: null,             choco: null,    linuxPkg: 'fakeroot', manualWin: 'Build .deb under WSL — Windows host cannot produce .deb directly' },
      'GNU ar':     { brew: 'binutils',  winget: null,             choco: null,    linuxPkg: null,       manualWin: 'Build .deb under WSL — Windows host cannot produce .deb directly', linuxNote: 'GNU ar is the system ar on Linux — no install needed' },
      'git':        { brew: 'git',       winget: 'Git.Git',        choco: 'git',   linuxPkg: 'git' },
      'gh':         { brew: 'gh',        winget: 'GitHub.cli',     choco: 'gh',    linuxPkg: 'gh',       linuxManualNote: 'See https://cli.github.com/manual/installation for the official apt/dnf repository setup; auto-install requires repo configuration we won\'t do silently. After install run:  gh auth login' },
    };

    const m = map[tool];
    if (!m) {
      plan.errors.push({ tool, reason: `install-prereqs.js does not know how to install '${tool}' — checker may be ahead of installer` });
      continue;
    }

    if (isMac) {
      if (!m.brew) {
        plan.manual.push({ tool, instructions: m.manualMac || `No brew formula known for ${tool}` });
        continue;
      }
      // Coalesce duplicate brew installs into one command (e.g. dpkg + fakeroot)
      if (!seenBrew.has(m.brew)) {
        seenBrew.add(m.brew);
        plan.auto.push({ tool, cmd: `brew install ${m.brew}` });
      }
      continue;
    }

    if (isLinux) {
      if (!m.linuxPkg) {
        plan.manual.push({ tool, instructions: m.linuxNote || m.manualLinux || `No Linux package known for ${tool}` });
        continue;
      }
      // gh on Linux is left as manual: requires adding GitHub's apt/dnf repo first.
      if (m.linuxManualNote) {
        plan.manual.push({ tool, instructions: m.linuxManualNote });
        continue;
      }
      const pm = host.linuxPm;
      if (!pm) {
        plan.manual.push({
          tool,
          instructions: `No supported package manager (apt-get/dnf/pacman) found on PATH. Install ${m.linuxPkg} manually.`,
        });
        continue;
      }
      if (options.useSudo && !options.sudoTtyOk) {
        plan.manual.push({
          tool,
          instructions: `Run manually (no TTY available for sudo prompt):  sudo ${linuxInstallCmd(pm, [m.linuxPkg], false)}`,
        });
        continue;
      }
      const cmd = linuxInstallCmd(pm, [m.linuxPkg], options.useSudo);
      if (!cmd) {
        plan.manual.push({ tool, instructions: `Could not build install command for ${pm}` });
        continue;
      }
      if (!options.useSudo) {
        plan.manual.push({
          tool,
          instructions: `Privileged install needed. Re-run with --use-sudo, or run manually:  sudo ${cmd}`,
        });
        continue;
      }
      plan.auto.push({ tool, cmd });
      continue;
    }

    if (isWin) {
      const pm = host.windowsPm;
      const cmd = pm ? windowsInstallCmd(pm, m.winget, m.choco) : null;
      if (!cmd) {
        plan.manual.push({
          tool,
          instructions: m.manualWin
            || `No winget/choco entry known for ${tool}. Install manually.`,
        });
        continue;
      }
      plan.auto.push({ tool, cmd });
      continue;
    }
  }

  return plan;
}

// ── Pure: format plan for printing ──────────────────────────────────────────
function formatPlan(plan, problemCount, options) {
  const lines = [];
  if (problemCount === 0) {
    lines.push(`${GREEN}✔${RESET}  All prerequisites already installed`);
    return lines.join('\n');
  }
  lines.push(`${BOLD}${CYAN}Plan to fix ${problemCount} missing prerequisite(s):${RESET}`);
  lines.push('');
  if (plan.auto.length > 0) {
    lines.push(`  ${GREEN}Auto-install${RESET} (will run${options.dryRun ? ' — DRY RUN, not executed' : ''}):`);
    for (const item of plan.auto) {
      lines.push(`    ${GREEN}+${RESET} ${BOLD}${item.tool}${RESET}  ${DIM}→${RESET}  ${item.cmd}${item.cwd ? `  ${DIM}(in ${item.cwd})${RESET}` : ''}`);
    }
    lines.push('');
  }
  if (plan.manual.length > 0) {
    lines.push(`  ${YELLOW}Manual action required${RESET}:`);
    for (const item of plan.manual) {
      lines.push(`    ${YELLOW}!${RESET} ${BOLD}${item.tool}${RESET}`);
      lines.push(`        ${DIM}${item.instructions}${RESET}`);
    }
    lines.push('');
  }
  if (plan.errors.length > 0) {
    lines.push(`  ${RED}Internal errors${RESET}:`);
    for (const item of plan.errors) {
      lines.push(`    ${RED}✖${RESET} ${BOLD}${item.tool}${RESET}  ${DIM}${item.reason}${RESET}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ── Side-effect: execute the auto-install part of the plan ──────────────────
function executePlan(plan, options) {
  let failed = 0;
  for (const item of plan.auto) {
    process.stdout.write(`\n${CYAN}▶${RESET}  ${BOLD}${item.tool}${RESET}  ${DIM}→${RESET}  ${item.cmd}\n`);
    if (options.dryRun) {
      process.stdout.write(`   ${YELLOW}(dry run — skipped)${RESET}\n`);
      continue;
    }
    const spawnOpts = { stdio: 'inherit', shell: true };
    if (item.cwd) spawnOpts.cwd = item.cwd;
    const r = spawnSync(item.cmd, spawnOpts);
    if (r.status !== 0) {
      process.stdout.write(`   ${RED}✖ install failed (exit ${r.status})${RESET}\n`);
      failed += 1;
    } else {
      process.stdout.write(`   ${GREEN}✔ installed${RESET}\n`);
    }
  }
  return failed;
}

// ── Main ────────────────────────────────────────────────────────────────────
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { printHelp(); process.exit(0); }

  if (!opts.quiet) {
    process.stdout.write(`${BOLD}${CYAN}install-prereqs:${RESET} querying check-build-prereqs.js…\n`);
  }

  let report;
  try {
    report = runChecker(opts.targets, opts.release);
  } catch (e) {
    process.stderr.write(`${RED}✖${RESET}  ${e.message}\n`);
    process.exit(2);
  }

  const problems = report.problems || [];
  const host = {
    platform: report.platform || os.platform(),
    linuxPm: null,
    windowsPm: null,
  };
  if (host.platform === 'linux') host.linuxPm = detectLinuxPm();
  if (host.platform === 'win32') host.windowsPm = detectWindowsPm();

  const planOptions = {
    useSudo: opts.useSudo,
    sudoTtyOk: process.stdin.isTTY === true,
    dryRun: opts.dryRun,
  };
  const plan = buildPlan(problems, host, planOptions);

  // Print plan (always, unless quiet AND there's nothing to do)
  if (!(opts.quiet && problems.length === 0)) {
    process.stdout.write('\n' + formatPlan(plan, problems.length, planOptions) + '\n');
  }

  if (problems.length === 0) process.exit(0);

  // Execute auto items unless dry-run
  const failed = executePlan(plan, planOptions);

  if (opts.dryRun) {
    process.stdout.write(`\n${YELLOW}Dry run complete.${RESET} Re-run without --dry-run to perform the install.\n`);
    // In dry-run we still surface manual items but DO NOT re-check.
    process.exit(0);
  }

  if (failed > 0) {
    process.stderr.write(`\n${RED}✖${RESET}  ${failed} install command(s) failed.\n`);
    process.exit(1);
  }

  // Re-run the checker (human-readable output) to confirm everything is now OK.
  process.stdout.write(`\n${CYAN}Re-checking prerequisites…${RESET}\n`);
  const checkerArgs = [path.join(__dirname, 'check-build-prereqs.js'), ...opts.targets];
  if (opts.release) checkerArgs.push('--release');
  // Block recursive auto-heal in case INSTALL_PREREQS=1 is in the env.
  const env = { ...process.env, INSTALL_PREREQS_RUNNING: '1' };
  const r = spawnSync(process.execPath, checkerArgs, { stdio: 'inherit', env });
  if (r.status !== 0) {
    process.stderr.write(`\n${RED}✖${RESET}  Some prerequisites still missing — see above. You may need to install them manually.\n`);
    if (plan.manual.length > 0) {
      process.stderr.write(`${DIM}(Manual steps were skipped — review the plan above.)${RESET}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`${GREEN}✔${RESET}  All prerequisites are now installed.\n`);
  process.exit(0);
}

// Export pure functions for tests; only run main when invoked directly.
module.exports = {
  parseArgs,
  buildPlan,
  formatPlan,
  detectLinuxPm,
  linuxInstallCmd,
  windowsInstallCmd,
};

if (require.main === module) {
  main();
}

