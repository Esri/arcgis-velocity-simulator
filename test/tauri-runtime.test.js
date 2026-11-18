const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { isAllowedChannel } = require('../src/tauri-policy');
const { encodeFrames, MAX_FRAME } = require('../src/tauri-wire');

const backend = path.resolve(__dirname, '../src/tauri-backend.js');
const executable = process.env.VELOCITY_TEST_TAURI_BINARY || process.execPath;
const prefix = process.env.VELOCITY_TEST_TAURI_BINARY ? [] : [backend];

test('large Unicode backend replies retain their contents across bounded wire frames', () => {
  const message = { type: 'response', id: 7, value: 'λ🚀'.repeat(3 * 1024 * 1024) };
  const frames = [...encodeFrames(message)];
  assert(frames.length > 1);
  const chunks = frames.map((frame, index) => {
    assert(Buffer.byteLength(frame) <= MAX_FRAME);
    const chunk = JSON.parse(frame);
    assert.equal(chunk.type, 'chunk');
    assert.equal(chunk.last, index === frames.length - 1);
    return Buffer.from(chunk.data, 'base64');
  });
  assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString('utf8')), message);
});

test('Tauri keeps transport and settings IPC scoped to their documents', () => {
  assert.equal(isAllowedChannel('index.html', 'connect'), true);
  assert.equal(isAllowedChannel('index.html', 'send-data'), true);
  assert.equal(isAllowedChannel('protocol-settings.html', 'connect'), false);
  assert.equal(isAllowedChannel('help.html', 'send-data'), false);
  assert.equal(isAllowedChannel('config.html', 'read-replay-file'), false);
  assert.equal(isAllowedChannel('https://example.com/index.html', 'connect'), false);
});

test('Tauri probe and headless help need no Electron or native window', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-tauri-help-'));
  try {
    const probe = spawnSync(process.execPath, [backend, '--tauri-probe', 'help=true'], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    assert.equal(probe.stdout, 'cli');
    const help = spawnSync(executable, [...prefix, 'help=true', `logFile=${path.join(root, 'help.log')}`], {
      env: { ...process.env, HOME: root, APPDATA: root, XDG_CONFIG_HOME: root, VELOCITY_TAURI_CLI: '1' },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /runMode/);
    assert.doesNotMatch(help.stdout, /"type":"native"/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Tauri Node backend replays TCP and persists completion with the original exit code', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-tauri-replay-'));
  const sockets = new Set();
  let received = '';
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding('utf8');
    socket.on('data', (data) => { received += data; });
    socket.on('close', () => sockets.delete(socket));
  });
  let child;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const source = path.join(root, 'replay.csv');
    const done = path.join(root, 'done.json');
    fs.writeFileSync(source, 'one,1\ntwo,2\n');
    child = spawn(executable, [...prefix, 'runMode=headless', `filename=${source}`,
      'protocol=tcp', 'mode=client', 'ip=127.0.0.1', `port=${server.address().port}`,
      'autoConnect=true', 'autoStart=true', 'loop=false', 'exitOnComplete=true',
      'linesPerInterval=1', 'intervalMs=10', `doneFile=${done}`, `logFile=${path.join(root, 'run.log')}`], {
      env: { ...process.env, HOME: root, APPDATA: root, XDG_CONFIG_HOME: root, VELOCITY_TAURI_CLI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error(`Tauri replay timed out: ${output}`)); }, 15000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (status) => { clearTimeout(timer); resolve(status); });
    });
    assert.equal(code, 0, output);
    assert.equal(received, 'one,1\ntwo,2\n');
    assert.equal(JSON.parse(fs.readFileSync(done, 'utf8')).success, true);
  } finally {
    if (child && child.exitCode === null) child.kill();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
