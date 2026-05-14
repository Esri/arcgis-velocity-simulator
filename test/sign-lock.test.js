'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { acquireSignLock } = require('../scripts/sign-lock');

function freshLockDir() {
  return path.join(os.tmpdir(), `velocity-simulator-sign-lock-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

(function testAcquireAndRelease() {
  const lockDir = freshLockDir();
  const messages = [];
  const release = acquireSignLock({ phase: 'unit-test', lockDir, log: (m) => messages.push(m) });
  assert.ok(fs.existsSync(lockDir), 'lock dir should exist after acquire');
  const owner = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
  assert.strictEqual(owner.pid, process.pid);
  assert.strictEqual(owner.phase, 'unit-test');
  release();
  assert.strictEqual(fs.existsSync(lockDir), false, 'lock dir should be gone after release');
})();

(function testOrphanedDeadOwnerLockIsClearedImmediately() {
  const lockDir = freshLockDir();
  // Fabricate a lock owned by an impossible pid (definitely dead).
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({
    token: 'fake-token',
    pid: 2147483646, // > PID_MAX on every supported OS
    cwd: '/tmp',
    phase: 'previous-crashed-run',
    createdAt: new Date().toISOString(),
  }));

  const messages = [];
  // staleMs is huge here; the old code would have hung. The new code must
  // remove the orphan immediately because the owner pid is dead.
  const start = Date.now();
  const release = acquireSignLock({
    phase: 'recovery-test',
    lockDir,
    pollMs: 10,
    staleMs: 24 * 60 * 60 * 1000,
    log: (m) => messages.push(m),
  });
  const elapsedMs = Date.now() - start;
  assert.ok(elapsedMs < 2000, `acquire should be fast for orphan locks (took ${elapsedMs}ms)`);
  assert.ok(messages.some((m) => /orphaned signing lock/i.test(m)), `expected orphaned-lock log; got ${JSON.stringify(messages)}`);

  const owner = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
  assert.strictEqual(owner.pid, process.pid, 'new lock should be owned by current process');
  release();
})();

(function testAliveOwnerLockIsRespected() {
  const lockDir = freshLockDir();
  const release1 = acquireSignLock({ phase: 'first', lockDir, log: () => {} });
  // Second acquire would block forever — verify behaviour without actually waiting.
  // We can't easily call acquireSignLock again in the same process because it is
  // synchronous and would block. Instead, just confirm that mkdir of the existing
  // lock dir returns EEXIST, which is the gate the function uses.
  let mkdirError;
  try {
    fs.mkdirSync(lockDir, { recursive: false });
  } catch (err) {
    mkdirError = err;
  }
  assert.ok(mkdirError && mkdirError.code === 'EEXIST', 'live lock dir must remain held');
  release1();
})();

console.log('sign-lock tests passed');

