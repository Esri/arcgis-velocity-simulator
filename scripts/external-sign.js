#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  DEFAULT_EXTERNAL_SIGN_TIMEOUT_MINUTES,
  SIGN_PRODUCT_NAMES_ENV,
  SIGN_SCRIPT_ENV,
  SIGN_SHARE_DIR_ENV,
  SIGN_TIMEOUT_MINUTES_ENV,
  resolveSignScriptPath,
} = require('./sign-options');
const { acquireSignLock, getLockDir } = require('./sign-lock');

const DEFAULT_FILE_MASK = '*.exe;*.msi;*.msp';
const SIGNABLE_ARTIFACT_RE = /\.(exe|msi|msp)$/i;
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const CYAN = '\x1b[0;36m';
const WHITE = '\x1b[0;97m';
const RESET = '\x1b[0m';
const SIGN_WATCHDOG_BUFFER_MS = 5 * 60 * 1000;
const DEFAULT_SIGN_PROGRESS_INTERVAL_MS = 30 * 1000;

// Flags whose immediately following value must be redacted when logging the
// effective sign.sh command. Keep this conservative: anything that may be a
// secret, token, credential, or personally identifying contact address.
const REDACTED_SIGN_FLAGS = new Set([
  '-jt', '--jenkins-api-token',
  '-sp', '--smb-pass',
  '-su', '--smb-user',
  '-je', '--jenkins-email-to',
]);

function redactSignArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i]);
    const eqIdx = arg.indexOf('=');
    if (eqIdx > 0) {
      const flag = arg.slice(0, eqIdx);
      if (REDACTED_SIGN_FLAGS.has(flag)) {
        out.push(`${flag}=<redacted>`);
        continue;
      }
    }
    out.push(arg);
    if (REDACTED_SIGN_FLAGS.has(arg) && i + 1 < args.length) {
      out.push('<redacted>');
      i += 1;
    }
  }
  return out;
}

function log(message) {
  console.log(`[external-sign] ${message}`);
}

function warn(message) {
  console.warn(`[external-sign] Warning: ${message}`);
}

function getSignPhaseType(phase) {
  if (/unpacked app/i.test(phase)) return 'unpacked app';
  if (/final artifacts/i.test(phase)) return 'final artifacts';
  return String(phase || 'files').replace(/\s+dry-run\b/i, '').trim().toLowerCase();
}

function signBoxStart(phase, mode) {
  const typeLabel = getSignPhaseType(phase);
  const modeLabel = mode === '--dry-run' ? ` ${BOLD}[dry run]${RESET}${BOLD}${CYAN}` : '';
  console.log('');
  console.log(`${BOLD}${CYAN}  ┌─ ✍️  External Windows signing - ${typeLabel}${modeLabel} ─────────────────────────────${RESET}`);
  console.log(`${BOLD}${CYAN}  │${RESET}  ${WHITE}${phase}${RESET}`);
}

function signBoxLine(message = '') {
  console.log(`${BOLD}${CYAN}  │${RESET}  ${message}`);
}

function signBoxEnd(message = 'External Windows signing complete', color = GREEN) {
  console.log(`${BOLD}${CYAN}  └─ ${color}${message}${RESET}${BOLD}${CYAN} ───────────────────────────${RESET}`);
}

function getSignTimeoutMs() {
  const raw = process.env.VELOCITY_SIGN_TIMEOUT_MS || '';
  if (!raw) {
    const scriptTimeoutMs = getExternalSignTimeoutMinutes() * 60 * 1000;
    return scriptTimeoutMs + SIGN_WATCHDOG_BUFFER_MS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : getSignTimeoutMsFromConfiguredMinutes();
}

function getSignTimeoutMsFromConfiguredMinutes() {
  return (getExternalSignTimeoutMinutes() * 60 * 1000) + SIGN_WATCHDOG_BUFFER_MS;
}

function getSignProgressIntervalMs() {
  const raw = process.env.VELOCITY_SIGN_PROGRESS_INTERVAL_MS || '';
  if (!raw) return DEFAULT_SIGN_PROGRESS_INTERVAL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SIGN_PROGRESS_INTERVAL_MS;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function getExternalSignTimeoutMinutes() {
  const raw = process.env[SIGN_TIMEOUT_MINUTES_ENV] || '';
  if (!raw) return DEFAULT_EXTERNAL_SIGN_TIMEOUT_MINUTES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : DEFAULT_EXTERNAL_SIGN_TIMEOUT_MINUTES;
}

function createNestedOutputWriter(writeLine = signBoxLine) {
  let buffer = '';
  return {
    write(chunk) {
      buffer += String(chunk || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach((line) => writeLine(line));
    },
    flush() {
      if (buffer) {
        writeLine(buffer);
        buffer = '';
      }
    },
  };
}

function runSignProcess({ command, args, timeoutMs = getSignTimeoutMs() }) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let lastOutputAt = startTime;
    const child = spawn(command, args, {
      encoding: 'utf8',
      env: { ...process.env, CI: process.env.CI || 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutWriter = createNestedOutputWriter();
    const stderrWriter = createNestedOutputWriter();
    let timedOut = false;
    let killTimer = null;
    let forceKillTimer = null;
    let progressTimer = null;

    const clearTimers = () => {
      if (killTimer) clearTimeout(killTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (progressTimer) clearInterval(progressTimer);
    };

    const noteOutput = () => {
      lastOutputAt = Date.now();
    };

    signBoxLine(`${DIM}[external-sign]${RESET} Started external signing process (pid ${child.pid || 'unknown'}).`);

    // Propagate termination signals from our Node process to the sign
    // subprocess so Ctrl-C / parent SIGTERM doesn't leave an orphaned
    // signing process holding the SMB mount and lock.
    const forwardSignals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const forwardHandlers = {};
    forwardSignals.forEach((sig) => {
      const handler = () => {
        signBoxLine(`${DIM}[external-sign]${RESET} Received ${sig}; forwarding to signing process and exiting.`);
        try { child.kill(sig); } catch (_) { /* ignore */ }
      };
      forwardHandlers[sig] = handler;
      process.once(sig, handler);
    });
    const detachForwarders = () => {
      forwardSignals.forEach((sig) => process.removeListener(sig, forwardHandlers[sig]));
    };

    if (timeoutMs > 0) {
      signBoxLine(`${DIM}[external-sign]${RESET} Watchdog timeout: ${formatDuration(timeoutMs)} (set VELOCITY_SIGN_TIMEOUT_MS=0 to disable).`);
      killTimer = setTimeout(() => {
        timedOut = true;
        signBoxLine(`${DIM}[external-sign]${RESET} Timeout reached; terminating external signing process.`);
        child.kill('SIGTERM');
        forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
      }, timeoutMs);
    } else {
      signBoxLine(`${DIM}[external-sign]${RESET} Watchdog timeout: disabled.`);
    }

    const progressIntervalMs = getSignProgressIntervalMs();
    if (progressIntervalMs > 0) {
      signBoxLine(`${DIM}[external-sign]${RESET} Progress heartbeat: every ${formatDuration(progressIntervalMs)} while the signing process is quiet.`);
      progressTimer = setInterval(() => {
        const now = Date.now();
        const elapsed = now - startTime;
        const idle = now - lastOutputAt;
        const remaining = timeoutMs > 0 ? `; watchdog timeout in ${formatDuration(timeoutMs - elapsed)}` : '';
        signBoxLine(`${DIM}[external-sign]${RESET} Still waiting for signing process (elapsed ${formatDuration(elapsed)}; no output for ${formatDuration(idle)}${remaining}).`);
      }, progressIntervalMs);
      if (typeof progressTimer.unref === 'function') progressTimer.unref();
    }

    child.stdout.on('data', (chunk) => {
      noteOutput();
      stdoutWriter.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      noteOutput();
      stderrWriter.write(chunk);
    });
    child.on('error', (error) => {
      stdoutWriter.flush();
      stderrWriter.flush();
      clearTimers();
      detachForwarders();
      resolve({ status: 1, signal: null, timedOut, error });
    });
    child.on('close', (status, signal) => {
      stdoutWriter.flush();
      stderrWriter.flush();
      clearTimers();
      detachForwarders();
      resolve({ status, signal, timedOut });
    });
  });
}

function getOfficialProductName(context) {
  const fromConfig = context && context.packager && context.packager.appInfo && context.packager.appInfo.productName;
  if (fromConfig) return fromConfig;

  const pkgPath = path.join(__dirname, '..', 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.productName || pkg.description || pkg.name || 'ArcGIS Velocity';
  } catch (_) {
    return 'ArcGIS Velocity';
  }
}

function getSignScriptStatus(rawScriptPath) {
  const requestedPath = rawScriptPath || '';
  const resolvedPath = resolveSignScriptPath(requestedPath, path.join(__dirname, '..'));
  if (!requestedPath) {
    return { ok: false, requestedPath, resolvedPath, reason: 'no external sign script path was provided' };
  }

  if (!fs.existsSync(resolvedPath)) {
    return { ok: false, requestedPath, resolvedPath, reason: 'file does not exist' };
  }

  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    return { ok: false, requestedPath, resolvedPath, reason: 'path exists but is not a file' };
  }

  try {
    fs.accessSync(resolvedPath, fs.constants.R_OK);
  } catch (_) {
    return { ok: false, requestedPath, resolvedPath, reason: 'file is not readable, so bash cannot run it' };
  }

  return { ok: true, requestedPath, resolvedPath, reason: 'found readable script file' };
}

function logSignScriptStatus(status) {
  if (status.ok) {
    const suffix = status.requestedPath && status.requestedPath !== status.resolvedPath
      ? ` (resolved from ${status.requestedPath})`
      : '';
    log(`Using external sign script: ${status.resolvedPath}${suffix}`);
    return;
  }

  const resolved = status.resolvedPath ? ` Resolved path: ${status.resolvedPath}.` : '';
  warn(`External sign script cannot be used: ${status.reason}.${resolved} Falling back to the current electron-builder signing/unsigned behavior.`);
}

function unique(values) {
  return [...new Set(values)];
}

function escapeMaskName(name) {
  return name.replace(/[;:]/g, '');
}

function getExternalSignProductNames(defaultProductName) {
  return process.env[SIGN_PRODUCT_NAMES_ENV] || defaultProductName;
}

function buildSignCommand({ scriptPath, sourceDirs, productName, shareDir, fileMask, mode = '--run', timeoutMinutes = DEFAULT_EXTERNAL_SIGN_TIMEOUT_MINUTES }) {
  const args = [scriptPath, mode, '--timeout-minutes', String(timeoutMinutes), '--source-dirs', sourceDirs.join(':'), '--product-names', productName];
  if (shareDir) args.push('--share-dir', shareDir);
  if (fileMask) args.push('--file-mask', fileMask);
  return { command: 'bash', args };
}

async function runExternalSign({ scriptPath, sourceDirs, productName, shareDir, fileMask, phase, mode = '--run' }) {
  if (!sourceDirs || sourceDirs.length === 0) {
    log(`Skipping ${phase}; no source directories to sign.`);
    return;
  }

  const missingDirs = sourceDirs.filter((dir) => !fs.existsSync(dir) || !fs.statSync(dir).isDirectory());
  if (missingDirs.length > 0) {
    warn(`Skipping ${phase}; source directory not found: ${missingDirs.join(', ')}`);
    return;
  }

  const signTimeoutMinutes = getExternalSignTimeoutMinutes();
  const signProductNames = getExternalSignProductNames(productName);
  const signCommand = buildSignCommand({ scriptPath, sourceDirs, productName: signProductNames, shareDir, fileMask, mode, timeoutMinutes: signTimeoutMinutes });
  signBoxStart(phase, mode);
  signBoxLine(`${DIM}[external-sign]${RESET} Product: ${signProductNames}`);
  signBoxLine(`${DIM}[external-sign]${RESET} Source: ${sourceDirs.join(':')}`);
  if (shareDir) signBoxLine(`${DIM}[external-sign]${RESET} Share: ${shareDir}`);
  if (fileMask) signBoxLine(`${DIM}[external-sign]${RESET} Mask: ${fileMask}`);
  signBoxLine(`${DIM}[external-sign]${RESET} Mode: ${mode}`);
  signBoxLine(`${DIM}[external-sign]${RESET} sign.sh timeout: ${signTimeoutMinutes} minute(s).`);
  signBoxLine(`${DIM}[external-sign]${RESET} sign.sh args: ${redactSignArgs(signCommand.args).join(' ')}`);

  const lockDir = getLockDir();
  signBoxLine(`${DIM}[external-sign]${RESET} Lock: ${lockDir}`);

  let releaseLock;
  let result;
  try {
    releaseLock = acquireSignLock({ phase, lockDir, log: (message) => signBoxLine(`${DIM}${message}${RESET}`) });
    signBoxLine(`${DIM}[external-sign]${RESET} Acquired signing lock.`);
    result = await runSignProcess(signCommand);
  } finally {
    if (releaseLock) {
      releaseLock();
      signBoxLine(`${DIM}[external-sign]${RESET} Released signing lock.`);
    }
  }
  if (result.error) {
    signBoxEnd(`External Windows signing failed: ${result.error.message}`, RED);
    throw result.error;
  }
  if (result.timedOut) {
    signBoxEnd('External Windows signing timed out', RED);
    throw new Error(`External signing timed out for ${phase}`);
  }
  if (result.signal) {
    signBoxEnd(`External Windows signing failed with signal ${result.signal}`, RED);
    throw new Error(`External signing failed for ${phase} with signal ${result.signal}`);
  }
  if (result.status !== 0) {
    signBoxEnd(`External Windows signing failed with exit code ${result.status || 1}`, RED);
    throw new Error(`External signing failed for ${phase} with exit code ${result.status || 1}`);
  }
  signBoxEnd();
}

function getArtifactSigningPlan(context) {
  const artifactPaths = Array.isArray(context.artifactPaths) ? context.artifactPaths : [];
  const signableArtifacts = artifactPaths.filter((artifactPath) => SIGNABLE_ARTIFACT_RE.test(artifactPath));
  if (signableArtifacts.length === 0) return null;

  const sourceDirs = unique(signableArtifacts.map((artifactPath) => path.dirname(artifactPath)));
  const fileMask = unique(signableArtifacts.map((artifactPath) => escapeMaskName(path.basename(artifactPath)))).join(';') || DEFAULT_FILE_MASK;
  return { sourceDirs, fileMask };
}

function getExistingArtifactSigningPlan(distDir) {
  if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) return null;
  const signableArtifacts = fs.readdirSync(distDir)
    .filter((name) => SIGNABLE_ARTIFACT_RE.test(name))
    .map((name) => path.join(distDir, name));
  return getArtifactSigningPlan({ artifactPaths: signableArtifacts });
}

function hasSignableFile(sourceDir, fileMask) {
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) return false;
  const patterns = String(fileMask || DEFAULT_FILE_MASK).split(';').filter(Boolean);
  const names = fs.readdirSync(sourceDir);
  return names.some((name) => patterns.some((pattern) => {
    if (pattern === '*.exe') return /\.exe$/i.test(name);
    if (pattern === '*.msi') return /\.msi$/i.test(name);
    if (pattern === '*.msp') return /\.msp$/i.test(name);
    return name === pattern;
  }));
}

async function runCliDryRunPreview() {
  const status = getSignScriptStatus(process.env[SIGN_SCRIPT_ENV] || '');
  if (!status.requestedPath) return;

  logSignScriptStatus(status);
  if (!status.ok) {
    return;
  }

  const repoDir = path.join(__dirname, '..');
  const distDir = path.join(repoDir, 'dist');
  const productName = getOfficialProductName({});
  const shareDir = process.env[SIGN_SHARE_DIR_ENV] || '';
  let invoked = false;

  const unpackedDir = path.join(distDir, 'win-unpacked');
  if (hasSignableFile(unpackedDir, DEFAULT_FILE_MASK)) {
    await runExternalSign({
      scriptPath: status.resolvedPath,
      sourceDirs: [unpackedDir],
      productName,
      shareDir,
      fileMask: DEFAULT_FILE_MASK,
      phase: 'Windows unpacked app dry-run',
      mode: '--dry-run',
    });
    invoked = true;
  } else {
    log(`Skipping Windows unpacked app dry-run; no matching files found in ${unpackedDir}.`);
  }

  const artifactPlan = getExistingArtifactSigningPlan(distDir);
  if (artifactPlan) {
    await runExternalSign({
      scriptPath: status.resolvedPath,
      sourceDirs: artifactPlan.sourceDirs,
      productName,
      shareDir,
      fileMask: artifactPlan.fileMask,
      phase: 'Windows final artifacts dry-run',
      mode: '--dry-run',
    });
    invoked = true;
  } else {
    log(`Skipping Windows final artifacts dry-run; no signable final artifacts found in ${distDir}.`);
  }

  if (!invoked) {
    warn('External signing dry-run was requested, but no existing signable Windows files were found in dist/. Build hooks will run the signing script after Windows artifacts are produced.');
  }
}

async function externalSign(context) {
  const rawScriptPath = process.env[SIGN_SCRIPT_ENV] || '';
  if (!rawScriptPath) return;

  if (context && context.appOutDir && context.electronPlatformName && context.electronPlatformName !== 'win32') return;
  if (!(context && context.appOutDir) && !getArtifactSigningPlan(context || {})) return;

  const status = getSignScriptStatus(rawScriptPath);
  logSignScriptStatus(status);
  if (!status.ok) {
    return;
  }

  const productName = getOfficialProductName(context);
  const shareDir = process.env[SIGN_SHARE_DIR_ENV] || '';

  if (context && context.appOutDir) {
    await runExternalSign({
      scriptPath: status.resolvedPath,
      sourceDirs: [context.appOutDir],
      productName,
      shareDir,
      fileMask: DEFAULT_FILE_MASK,
      phase: 'Windows unpacked app',
    });
    return;
  }

  const artifactPlan = getArtifactSigningPlan(context || {});
  if (!artifactPlan) return;
  await runExternalSign({
    scriptPath: status.resolvedPath,
    sourceDirs: artifactPlan.sourceDirs,
    productName,
    shareDir,
    fileMask: artifactPlan.fileMask,
    phase: 'Windows final artifacts',
  });
}

module.exports = externalSign;
module.exports._private = {
  buildSignCommand,
  getSignScriptStatus,
  getExistingArtifactSigningPlan,
  getArtifactSigningPlan,
  getOfficialProductName,
  getSignTimeoutMs,
  hasSignableFile,
  redactSignArgs,
  runSignProcess,
};

if (require.main === module) {
  if (process.argv.includes('--dry-run-preview')) {
    runCliDryRunPreview().catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
  }
}

