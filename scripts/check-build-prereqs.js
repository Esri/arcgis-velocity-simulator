#!/usr/bin/env node
/**
 * check-build-prereqs.js
 *
 * Verifies that platform-specific build tooling required by electron-builder
 * (and optionally by the release script) is available on PATH. Fails fast
 * with a clear install hint when something is missing, so a long sequential
 * build doesn't silently produce a broken artifact (e.g. a 96-byte ".deb"
 * stub when dpkg/fakeroot are absent on macOS).
 *
 * Usage:
 *   node scripts/check-build-prereqs.js                # build-only checks
 *   node scripts/check-build-prereqs.js --linux        # only Linux deps
 *   node scripts/check-build-prereqs.js --mac --win    # multiple targets
 *   node scripts/check-build-prereqs.js --release      # also check git, gh, gh auth
 *   node scripts/check-build-prereqs.js --quiet        # only print on failure
 */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { findBinutilsBinDir } = require('./binutils-path');

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const releaseMode = args.includes('--release');
const onlyTargets = args.filter(a => ['--mac', '--win', '--linux', '--all'].includes(a));
const wantAll = onlyTargets.length === 0 || onlyTargets.includes('--all');
const wantMac   = wantAll || onlyTargets.includes('--mac');
const wantWin   = wantAll || onlyTargets.includes('--win');
const wantLinux = wantAll || onlyTargets.includes('--linux');

const platform = os.platform();              // 'darwin' | 'linux' | 'win32'
const isMac    = platform === 'darwin';
const isLinux  = platform === 'linux';
const isWin    = platform === 'win32';

const problems = [];

function which(cmd) {
  try {
    const out = execSync(
      isWin ? `where ${cmd}` : `command -v ${cmd}`,
      { stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString().trim();
    return out.split('\n')[0] || null;
  } catch {
    return null;
  }
}

function isGnuAr(arPath) {
  if (!arPath) return false;
  try {
    const out = execSync(`${arPath} --version 2>&1`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    return /GNU ar/i.test(out);
  } catch {
    return false;
  }
}

function tryRun(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  } catch {
    return null;
  }
}

// ── Core build toolchain (always required) ──────────────────────────────────
// node + npm: required by every build script. Without these nothing else
// in this checker even runs — but on the off chance someone invokes us via
// a wrapper, still report it cleanly.
const nodeVer = process.versions.node;
const nodeMajor = parseInt(nodeVer.split('.')[0], 10);
if (nodeMajor < 18) {
  problems.push({
    tool: 'node >= 18',
    need: `electron-builder requires Node 18 or newer (you have ${nodeVer})`,
    install: 'Install Node 20 LTS via https://nodejs.org or `brew install node`',
  });
}
if (!which('npm')) {
  problems.push({
    tool: 'npm',
    need: 'Required to run package scripts',
    install: 'Reinstall Node.js (npm ships with it)',
  });
}

// node_modules must be installed (electron-builder lives there). Detect by
// looking for the resolved binary path used by timed-build.js.
const repoRoot = path.resolve(__dirname, '..');
const ebBin = path.join(repoRoot, 'node_modules', '.bin',
  isWin ? 'electron-builder.cmd' : 'electron-builder');
if (!fs.existsSync(ebBin)) {
  problems.push({
    tool: 'node_modules',
    need: 'electron-builder is not installed (node_modules missing or incomplete)',
    install: 'npm install',
  });
}

// ── Linux artifact prerequisites (deb) ──────────────────────────────────────
// `.deb` requires dpkg + fakeroot regardless of host OS. macOS also needs
// GNU ar (Homebrew binutils) because the system /usr/bin/ar is BSD ar and
// silently produces a broken archive.
if (wantLinux) {
  if (!which('dpkg') && !which('dpkg-deb')) {
    problems.push({
      tool: 'dpkg',
      need: 'Required to build .deb packages',
      install: isMac
        ? 'brew install dpkg'
        : 'apt-get install dpkg (Linux) — usually preinstalled',
    });
  }
  if (!which('fakeroot')) {
    problems.push({
      tool: 'fakeroot',
      need: 'Required to set Linux file ownership inside .deb',
      install: isMac
        ? 'brew install fakeroot'
        : 'apt-get install fakeroot',
    });
  }
  if (isMac) {
    // The build scripts auto-discover Homebrew's GNU ar via binutils-path.js,
    // so it's enough that binutils is installed somewhere — we don't require
    // the user to put it on PATH manually. Only complain if it's missing.
    const arPath = which('ar');
    const gnuFromBrew = findBinutilsBinDir();
    if (!gnuFromBrew && !isGnuAr(arPath)) {
      problems.push({
        tool: 'GNU ar',
        need: `macOS BSD ar (${arPath || 'not found'}) cannot build .deb archives, and Homebrew binutils is not installed`,
        install: 'brew install binutils  (build scripts will pick it up automatically — no PATH edit needed)',
      });
    }
  }
}

// ── macOS artifact prerequisites (dmg, codesigning) ─────────────────────────
// dmg builds require macOS host. codesign / xcrun ship with Xcode CLT.
// Nothing strictly required for unsigned dmg/zip beyond what ships with macOS.
// (Cross-platform mac builds are not supported by electron-builder for dmg.)

// ── Windows artifact prerequisites ──────────────────────────────────────────
// Unsigned nsis/portable builds work without wine via electron-builder's
// bundled tooling, so no hard prerequisite check is needed for default config.

// ── Release-mode prerequisites (git, gh, auth) ──────────────────────────────
if (releaseMode) {
  if (!which('git')) {
    problems.push({
      tool: 'git',
      need: 'Required to commit/tag/push the version bump',
      install: isMac ? 'brew install git' : 'apt-get install git (Linux)',
    });
  }
  if (!which('gh')) {
    problems.push({
      tool: 'gh',
      need: 'GitHub CLI required to create the release and upload assets',
      install: isMac
        ? 'brew install gh  &&  gh auth login'
        : 'See https://cli.github.com/ for installation, then `gh auth login`',
    });
  } else {
    // Verify authentication. `gh auth status` exits non-zero when not logged in.
    if (tryRun('gh auth status') === null) {
      problems.push({
        tool: 'gh authentication',
        need: 'GitHub CLI is installed but not authenticated',
        install: 'gh auth login',
      });
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const RESET  = '\x1b[0m';

if (problems.length === 0) {
  if (!quiet) {
    console.log(`${GREEN}✔${RESET}  Build prerequisites OK${releaseMode ? ' (including release tooling)' : ''}`);
  }
  process.exit(0);
}

console.error('');
console.error(`${BOLD}${RED}✖  Missing prerequisites:${RESET}`);
console.error('');
for (const p of problems) {
  console.error(`  ${RED}•${RESET}  ${BOLD}${p.tool}${RESET}`);
  console.error(`     ${DIM}${p.need}${RESET}`);
  console.error(`     ${YELLOW}Install:${RESET}  ${p.install}`);
  console.error('');
}
console.error(`${DIM}Without these tools the build may fail or silently produce broken`);
console.error(`artifacts (e.g. an unusable ~100 byte ".deb" file).${RESET}`);
console.error('');
process.exit(1);



