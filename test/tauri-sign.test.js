'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const externalSign = require('../scripts/external-sign');

const entry = require.resolve('../scripts/tauri-sign');
const entryRequire = createRequire(entry);
const fixtureDirectory = path.resolve('fixture', 'nsis');

async function invoke(args, regularFile = true) {
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
      if (name === 'fs') return { statSync: () => ({ isFile: () => regularFile }) };
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
  for (const filename of ['NSISdl.dll', 'nsis_tauri_utils.DLL', 'application.exe', 'setup.msi']) {
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
  console.log('Tauri signing adapter DLL selection and exact mask tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
