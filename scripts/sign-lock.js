#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SIGN_LOCK_DIR_ENV = 'VELOCITY_SIGN_LOCK_DIR';
const DEFAULT_LOCK_DIR = path.join(os.tmpdir(), 'arcgis-velocity-external-sign.lock');
const DEFAULT_POLL_MS = 1000;
const DEFAULT_STALE_MS = 12 * 60 * 60 * 1000;
const WAIT_LOG_INTERVAL_MS = 30 * 1000;
const SIGNAL_NAMES = ['SIGINT', 'SIGTERM', 'SIGHUP'];

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function getLockDir(options = {}) {
  return path.resolve(options.lockDir || process.env[SIGN_LOCK_DIR_ENV] || DEFAULT_LOCK_DIR);
}

function readOwner(lockDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeOwner(lockDir, owner) {
  fs.writeFileSync(path.join(lockDir, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`);
}

function getLockAgeMs(lockDir) {
  try {
    return Date.now() - fs.statSync(lockDir).mtimeMs;
  } catch (_) {
    return 0;
  }
}

function isProcessAlive(pid) {
  if (!pid || !Number.isInteger(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

function acquireSignLock({ phase = 'external signing', lockDir = getLockDir(), pollMs = DEFAULT_POLL_MS, staleMs = DEFAULT_STALE_MS, log = console.log } = {}) {
  const token = crypto.randomUUID ? crypto.randomUUID() : `${process.pid}-${Date.now()}-${Math.random()}`;
  const owner = {
    token,
    pid: process.pid,
    cwd: process.cwd(),
    phase,
    createdAt: new Date().toISOString(),
  };
  let lastWaitLog = 0;

  while (true) {
    try {
      fs.mkdirSync(lockDir, { recursive: false });
      writeOwner(lockDir, owner);

      let released = false;
      const releaseSignLock = function releaseSignLock() {
        if (released) return;
        released = true;
        const currentOwner = readOwner(lockDir);
        if (currentOwner && currentOwner.token === token) {
          fs.rmSync(lockDir, { recursive: true, force: true });
        }
        process.removeListener('exit', releaseSignLock);
        SIGNAL_NAMES.forEach((sig) => process.removeListener(sig, signalHandler));
      };
      const signalHandler = (sig) => {
        releaseSignLock();
        // Re-raise the original signal so the parent build sees the correct
        // exit reason instead of a silent exit-0.
        process.kill(process.pid, sig);
      };
      // Best-effort safety nets: clean up on normal exit, fatal exceptions,
      // and the most common termination signals (Ctrl-C, parent SIGTERM,
      // terminal hang-up). Without these the lock outlives the Node process
      // and silently blocks every subsequent build.
      process.on('exit', releaseSignLock);
      SIGNAL_NAMES.forEach((sig) => process.once(sig, signalHandler));
      return releaseSignLock;
    } catch (error) {
      if (error && error.code !== 'EEXIST') {
        throw error;
      }

      const ageMs = getLockAgeMs(lockDir);
      const staleOwner = readOwner(lockDir);
      const ownerPid = staleOwner && staleOwner.pid;
      const ownerAlive = isProcessAlive(ownerPid);

      // If the recorded owner pid is dead, the lock is orphaned — remove it
      // immediately regardless of age. Waiting hours/days for a dead owner
      // would silently block every subsequent build.
      if (staleOwner && !ownerAlive) {
        const stalePhase = staleOwner && staleOwner.phase ? ` (${staleOwner.phase})` : '';
        const pidLabel = ownerPid ? ` pid ${ownerPid}` : '';
        log(`[external-sign] Removing orphaned signing lock${stalePhase}; owner${pidLabel} is no longer running. Age ${Math.round(ageMs / 1000)}s. Lock: ${lockDir}`);
        fs.rmSync(lockDir, { recursive: true, force: true });
        continue;
      }

      // Fallback: even if the owner pid is still alive, give up on a lock
      // older than `staleMs` (default 12h) so a hung process cannot block
      // builds indefinitely.
      if (ageMs > staleMs) {
        const stalePhase = staleOwner && staleOwner.phase ? ` (${staleOwner.phase})` : '';
        log(`[external-sign] Removing stale signing lock after ${Math.round(ageMs / 1000)}s${stalePhase}: ${lockDir}`);
        fs.rmSync(lockDir, { recursive: true, force: true });
        continue;
      }

      const now = Date.now();
      if (now - lastWaitLog >= WAIT_LOG_INTERVAL_MS || lastWaitLog === 0) {
        const currentOwner = readOwner(lockDir);
        const currentPhase = currentOwner && currentOwner.phase ? `: ${currentOwner.phase}` : '';
        log(`[external-sign] Waiting for external signing lock${currentPhase} (${lockDir})`);
        lastWaitLog = now;
      }
      sleepSync(pollMs);
    }
  }
}

function withSignLock(options, fn) {
  const release = acquireSignLock(options);
  try {
    return fn();
  } finally {
    release();
  }
}

module.exports.SIGN_LOCK_DIR_ENV = SIGN_LOCK_DIR_ENV;
module.exports.acquireSignLock = acquireSignLock;
module.exports.getLockDir = getLockDir;
module.exports.withSignLock = withSignLock;

// Standalone CLI: inspect or force-remove the external signing lock.
//   node scripts/sign-lock.js --status
//   node scripts/sign-lock.js --clear
if (require.main === module) {
  const args = process.argv.slice(2);
  const lockDir = getLockDir();
  const owner = readOwner(lockDir);
  const ageSec = Math.round(getLockAgeMs(lockDir) / 1000);

  if (args.includes('--clear')) {
    if (fs.existsSync(lockDir)) {
      fs.rmSync(lockDir, { recursive: true, force: true });
      console.log(`[sign-lock] Removed: ${lockDir}`);
    } else {
      console.log(`[sign-lock] No lock to clear: ${lockDir}`);
    }
    process.exit(0);
  }

  if (!fs.existsSync(lockDir)) {
    console.log(`[sign-lock] No lock present: ${lockDir}`);
    process.exit(0);
  }

  console.log(`[sign-lock] Lock dir : ${lockDir}`);
  console.log(`[sign-lock] Age      : ${ageSec}s`);
  if (owner) {
    const alive = isProcessAlive(owner.pid);
    console.log(`[sign-lock] Owner pid: ${owner.pid} (${alive ? 'alive' : 'DEAD — lock is orphaned'})`);
    console.log(`[sign-lock] Phase    : ${owner.phase || '(unknown)'}`);
    console.log(`[sign-lock] Created  : ${owner.createdAt || '(unknown)'}`);
    console.log(`[sign-lock] Cwd      : ${owner.cwd || '(unknown)'}`);
  } else {
    console.log('[sign-lock] Owner    : (owner.json missing or unreadable)');
  }
  console.log('\nRun  node scripts/sign-lock.js --clear  to force-remove this lock.');
}
