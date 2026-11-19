'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { EventEmitter } = require('events');
const assert = require('assert/strict');
const { test } = require('node:test');
const { launcherScript } = require('../scripts/linux-launcher');

test('Linux shell launcher resolves its installation and preserves arguments', () => {
  const script = launcherScript('VelocitySimulator');
  assert(script.includes('ELECTRON_RUN_AS_NODE=1'));
  assert(script.includes('resources/app.asar/src/linux-launcher.js" "$@"'));
  assert(script.includes('VelocitySimulator.bin'));
  assert.throws(() => launcherScript('bad";exec'), /Unsupported/);
});

test('dispatcher routes CLI without spawning and GUI without RunAsNode', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/linux-launcher.js'), 'utf8');
  let mode = 'headless', spawned, parsedCalls = 0, cliCalls = 0, parsedArgs, parseOptions;
  const fakeProcess = new EventEmitter();
  Object.assign(fakeProcess, { execPath: '/app/VelocitySimulator.bin', env: { ELECTRON_RUN_AS_NODE: '1', KEEP: 'yes' } });
  const moduleUnderTest = { exports: {} };
  vm.runInNewContext(source, {
    module: moduleUnderTest, process: fakeProcess, console,
    require: name => {
      if (name === './cli-options') return { parseCommandLineArgs: (args, options) => {
        parsedCalls++; parsedArgs = args; parseOptions = options; return { mode };
      } };
      if (name === './headless-cli') return { runCli: async () => { cliCalls++; return 0; } };
      if (name === 'child_process') return { spawn: (...args) => {
        spawned = args;
        const child = new EventEmitter();
        process.nextTick(() => child.emit('close', 0));
        return child;
      } };
      throw Error(name);
    },
  });
  const args = ['node', 'entry', 'config=/path with spaces/config.json'];
  assert.equal(await moduleUnderTest.exports.main(args), 0);
  assert.equal(spawned, undefined); assert.equal(cliCalls, 1);
  mode = 'ui';
  assert.equal(await moduleUnderTest.exports.main(args), 0);
  assert.equal(spawned[0], fakeProcess.execPath);
  assert.deepEqual(Array.from(spawned[1]), args.slice(2));
  assert.equal(spawned[2].env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(spawned[2].env.KEEP, 'yes'); assert.equal(parsedCalls, 2);
  fakeProcess.env.APPIMAGE = '/app/package.AppImage';
  const imageArgs = [...args, '--no-sandbox', '--unknown-option'];
  await moduleUnderTest.exports.main(imageArgs);
  assert.deepEqual(Array.from(parsedArgs), imageArgs);
  assert.equal(parseOptions.isAppImage, true);
  assert.deepEqual(Array.from(spawned[1]), imageArgs.slice(2), 'GUI keeps native AppRun flags');
  delete fakeProcess.env.APPIMAGE;
  await moduleUnderTest.exports.main(imageArgs);
  assert.deepEqual(Array.from(parsedArgs), imageArgs, 'Non-AppImage unknown flags are not hidden');
  assert.equal(parseOptions.isAppImage, false);
});

test('real parser accepts AppRun flags at both GUI stages without weakening unknown-option validation', async () => {
  const { parseCommandLineArgs } = require('../src/cli-options');
  const source = fs.readFileSync(path.join(__dirname, '../src/linux-launcher.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const mainParse = mainSource.match(/const cliOptions = (parseCommandLineArgs\([\s\S]*?\));/)[1];
  const fakeProcess = new EventEmitter();
  Object.assign(fakeProcess, {
    execPath: '/app/VelocitySimulator.bin',
    env: { ELECTRON_RUN_AS_NODE: '1', APPIMAGE: '/app/package.AppImage' },
  });
  let spawned, startupResult;
  const moduleUnderTest = { exports: {} };
  vm.runInNewContext(source, {
    module: moduleUnderTest, process: fakeProcess, console,
    require: name => {
      if (name === './cli-options') return { parseCommandLineArgs };
      if (name === './headless-cli') return { runCli: async parsed => { startupResult = parsed; return 1; } };
      if (name === 'child_process') return { spawn: (...args) => {
        spawned = args;
        const child = new EventEmitter();
        process.nextTick(() => child.emit('close', 0));
        return child;
      } };
      throw Error(name);
    },
  });
  for (const appArgs of [[], ['runMode=ui']]) {
    const argv = ['node', 'entry', '--no-sandbox', ...appArgs];
    assert.equal(await moduleUnderTest.exports.main(argv), 0);
    assert.deepEqual(Array.from(spawned[1]), argv.slice(2));
    assert.equal(spawned[2].env.ELECTRON_RUN_AS_NODE, undefined);
    const guiProcess = {
      argv: [spawned[0], ...spawned[1]], env: spawned[2].env, platform: 'linux',
    };
    const parseGui = () => vm.runInNewContext(mainParse, {
      parseCommandLineArgs, process: guiProcess, app: { isPackaged: true },
    });
    assert.equal(parseGui().mode, 'ui', 'The actual main-process parser call must accept the GUI handoff');
    guiProcess.argv.push('--unknown-option');
    assert.equal(parseGui().mode, 'error');
    guiProcess.argv.pop();
    delete guiProcess.env.APPIMAGE;
    assert.equal(parseGui().mode, 'error', 'The exception is specific to AppImage startup');
  }
  spawned = undefined;
  assert.equal(await moduleUnderTest.exports.main(['node', 'entry', '--no-sandbox', '--unknown-option']), 1);
  assert.equal(spawned, undefined);
  assert.equal(startupResult.mode, 'error');
  assert(startupResult.errors.some(error => error.includes('--unknown-option')));
  for (const flag of ['--no-sandbox=true', '--disable-gpu-sandbox']) {
    assert.equal(parseCommandLineArgs(['app', flag], { isPackaged: true, isAppImage: true }).mode, 'error');
  }
});
