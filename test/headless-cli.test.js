'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const assert = require('assert/strict');
const { test } = require('node:test');
const entry = path.resolve(__dirname, '../src/headless-cli.js');

test('Node-only CLI help/errors do not import Electron or require a display', () => {
  const env = { ...process.env, DISPLAY: '', WAYLAND_DISPLAY: '' };
  const help = spawnSync(process.execPath, [entry, 'help=true'], { env, encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /runMode/);
  const invalid = spawnSync(process.execPath, [entry, 'invalid-option=true'], { env, encoding: 'utf8' });
  assert.equal(invalid.status, 1);
});

test('Node-only CLI replays exact data and writes completion metadata', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-cli-'));
  let received = '';
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.setEncoding('utf8');
    socket.on('data', data => { received += data; });
    socket.on('close', () => sockets.delete(socket));
  });
  let child;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    fs.writeFileSync(path.join(dir, 'input.csv'), 'one,1\ntwo,2\n');
    child = spawn(process.execPath, [entry, 'runMode=headless', `filename=${dir}/input.csv`,
      'protocol=tcp', 'mode=client', 'ip=127.0.0.1', `port=${server.address().port}`,
      'intervalMs=5', `doneFile=${dir}/done.json`],
    { cwd: dir, env: { ...process.env, DISPLAY: '', WAYLAND_DISPLAY: '', HOME: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', bytes => { output += bytes; });
    child.stdout.resume();
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error(output || 'CLI timed out')); }, 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', value => { clearTimeout(timer); resolve(value); });
    });
    assert.equal(code, 0, output);
    assert.equal(received, 'one,1\ntwo,2\n');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'done.json'))).success, true);
    assert(fs.readdirSync(path.join(dir, 'logs')).some(file => /^velocity-simulator-.*\.log$/.test(file)),
      'Development Node startup retains the working-directory log default');
  } finally {
    if (child && child.exitCode === null) child.kill();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const scenario of [
  { name: 'ready session', signal: 'SIGTERM', code: 143, args: ['autoConnect=false', 'autoStart=false', 'exitOnComplete=false'], ready: /will remain active/ },
  { name: 'pending client connection', signal: 'SIGINT', code: 130, args: ['mode=client', 'connectWaitForServer=true', 'connectRetryIntervalMs=10000'], ready: /Retrying in/ },
  { name: 'server waiting for a recipient', signal: 'SIGTERM', code: 143, args: ['mode=server', 'waitForClient=true'], ready: /Waiting for/ },
]) test(`${scenario.signal} stops a ${scenario.name} and preserves completion metadata`, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-cli-stop-'));
  let child;
  try {
    const reservation = net.createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    fs.writeFileSync(path.join(dir, 'input.csv'), 'one\n');
    child = spawn(process.execPath, [entry, 'runMode=headless', `filename=${dir}/input.csv`,
      'protocol=tcp', 'ip=127.0.0.1', `port=${port}`, ...scenario.args,
      `doneFile=${dir}/done.json`, `logFile=${dir}/run.log`], { stdio: 'ignore' });
    const stopped = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Signal cleanup timed out')); }, 10000);
      child.once('close', code => { clearTimeout(timer); resolve(code); });
    });
    const deadline = Date.now() + 5000;
    const log = path.join(dir, 'run.log');
    while (!fs.existsSync(log) || !scenario.ready.test(fs.readFileSync(log, 'utf8'))) {
      if (child.exitCode !== null) throw new Error('CLI exited before ready');
      if (Date.now() > deadline) throw new Error('CLI did not reach expected lifecycle state');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    child.kill(scenario.signal);
    assert.equal(await stopped, scenario.code);
    const done = JSON.parse(fs.readFileSync(path.join(dir, 'done.json')));
    assert.equal(done.success, false);
    assert.match(done.error.message, /interrupted/);
  } finally {
    if (child && child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
