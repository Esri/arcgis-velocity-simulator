'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const externalSign = require('../scripts/external-sign');

const entry = require.resolve('../scripts/sign-windows-files');
const entryRequire = createRequire(entry);
const fixtureDirectory = path.resolve('fixture', 'nsis');

async function invoke(args, regularFile = true, directoryEntries, nestedEntry = false) {
  const calls = [];
  const errors = [];
  const process = {
    argv: ['node', entry, ...args],
    env: { VELOCITY_SIGN_SCRIPT: '/fixture/sign.sh' },
    exitCode: 0,
  };
  vm.runInNewContext(fs.readFileSync(entry, 'utf8'), {
    process,
    console: { error: message => errors.push(message) },
    require: name => {
      if (name === 'fs') return {
        lstatSync: file => ({
          isFile: () => regularFile && !(nestedEntry && path.basename(file) === 'nested'),
          isDirectory: () => file === fixtureDirectory,
        }),
        readdirSync: () => directoryEntries || args.slice(1).map(file => path.basename(file)),
      };
      if (name === './sign-options') return { isUsableSignScript: () => true };
      if (name === './external-sign') return async context => {
        const plan = externalSign._private.getArtifactSigningPlan(context);
        assert.ok(plan, 'Accepted adapter input must produce a signing plan');
        calls.push(externalSign._private.buildSignCommand({
          scriptPath: '/fixture/sign.sh', sourceDirs: plan.sourceDirs,
          productNames: ['Fixture'], fileMask: plan.fileMask,
        }));
      };
      return entryRequire(name);
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { calls, errors, exitCode: process.exitCode };
}

(async () => {
  for (const filename of ['NSISdl.dll', 'helper.DLL', 'application.exe', 'setup.msi']) {
    const result = await invoke([path.join(fixtureDirectory, filename)]);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.errors, []);
    assert.equal(result.calls.length, 1);
    const args = result.calls[0].args;
    assert.equal(args[args.indexOf('--file-mask') + 1], filename);
    assert.equal(args[args.indexOf('--source-dirs') + 1], fixtureDirectory);
  }
  for (const args of [[], ['/fixture/settings.json'], ['/fixture/application.exe', '/fixture/helper.dll']]) {
    const result = await invoke(args);
    assert.equal(result.exitCode, 1);
    assert.equal(result.calls.length, 0);
    assert.match(result.errors.join('\n'), /Expected exactly one/);
  }
  const directory = await invoke(['/fixture/not-a-file.dll'], false);
  assert.equal(directory.exitCode, 1);
  assert.equal(directory.calls.length, 0);
  const batch = await invoke(['--batch', path.join(fixtureDirectory, 'application.exe'),
    path.join(fixtureDirectory, 'node.exe'), path.join(fixtureDirectory, 'helper.dll')]);
  assert.equal(batch.exitCode, 0);
  assert.equal(batch.calls.length, 1, 'One ready batch must invoke the guarded signer once');
  const batchArgs = batch.calls[0].args;
  assert.equal(batchArgs[batchArgs.indexOf('--file-mask') + 1], 'application.exe;node.exe;helper.dll');
  assert.equal(batchArgs[batchArgs.indexOf('--source-dirs') + 1], fixtureDirectory);
  for (const names of [
    ['application.exe'], ['application.exe', 'application.exe'],
    ['app.exe', 'APP.exe'], ['app name.exe', 'app-name.exe'],
    ['app.exe', '*.dll'], ['app.exe', 'semi;colon.dll'], ['app.exe', 'nested/helper.dll'],
  ]) {
    const result = await invoke(['--batch', ...names.map(name => path.join(fixtureDirectory, name))]);
    assert.equal(result.exitCode, 1, names.join(','));
    assert.equal(result.calls.length, 0, 'Unsafe batches must not reach signing');
  }
  const nonRegularBatch = await invoke(['--batch', path.join(fixtureDirectory, 'app.exe'),
    path.join(fixtureDirectory, 'link.dll')], false);
  assert.equal(nonRegularBatch.exitCode, 1);
  assert.equal(nonRegularBatch.calls.length, 0);
  const ambiguous = await invoke(['--batch', path.join(fixtureDirectory, 'app.exe'),
    path.join(fixtureDirectory, 'helper.dll')], true, ['app.exe', 'APP.exe', 'helper.dll']);
  assert.equal(ambiguous.exitCode, 1);
  assert.equal(ambiguous.calls.length, 0);
  const nested = await invoke(['--batch', path.join(fixtureDirectory, 'app.exe'),
    path.join(fixtureDirectory, 'helper.dll')], true, ['app.exe', 'helper.dll', 'nested'], true);
  assert.equal(nested.exitCode, 1);
  assert.equal(nested.calls.length, 0, 'Nested inputs must not broaden selection through signer scan-depth settings');
  console.log('Windows signing adapter DLL selection and exact mask tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
