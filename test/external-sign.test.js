const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  SIGN_PRODUCT_NAMES_ENV,
  SIGN_SCRIPT_ENV,
  SIGN_SHARE_DIR_ENV,
  SIGN_TIMEOUT_MINUTES_ENV,
  buildSignEnv,
  parseSignOptions,
  resolveSignScriptPath,
  withExternalWindowsSigningConfigArgs,
} = require('../scripts/sign-options');
const externalSign = require('../scripts/external-sign');
const windowsSignHook = require('../scripts/windows-sign-hook');

const {
  buildSignCommand,
  getArtifactSigningPlan,
  getExistingArtifactSigningPlan,
  getOfficialProductName,
  getSignScriptStatus,
  getSignTimeoutMs,
  hasSignableFile,
  redactSignArgs,
  runSignProcess,
} = externalSign._private;
const { isDirectExternalSignableFile } = windowsSignHook._private;

(function testParseSignOptions() {
  const parsed = parseSignOptions([
    '--win',
    '--sign-script', '/opt/sign/sign.sh',
    '-d', '\\\\storm\\upload\\DigitalSign\\Velocity',
    '--sign-timeout-minutes', '30',
    '--sign-product-names', 'ArcGIS Velocity Simulator:ArcGIS Velocity Logger',
    '--config.compression=maximum',
  ]);

  assert.deepStrictEqual(parsed.passthroughArgs, ['--win', '--config.compression=maximum']);
  assert.strictEqual(parsed.signScript, '/opt/sign/sign.sh');
  assert.strictEqual(parsed.signShareDir, '\\\\storm\\upload\\DigitalSign\\Velocity');
  assert.strictEqual(parsed.signTimeoutMinutes, '30');
  assert.strictEqual(parsed.signProductNames, 'ArcGIS Velocity Simulator:ArcGIS Velocity Logger');
})();

(function testParseSignOptionsRejectsInvalidTimeout() {
  assert.throws(() => parseSignOptions(['--sign-timeout-minutes', '0']), /positive whole number/);
  assert.throws(() => parseSignOptions(['--sign-timeout-minutes=abc']), /positive whole number/);
})();

(function testSignScriptPathResolution() {
  const parsed = parseSignOptions(['--sign-script', 'scripts/../scripts/external-sign.js']);
  assert.strictEqual(parsed.signScript, path.join(process.cwd(), 'scripts', 'external-sign.js'));
  assert.strictEqual(resolveSignScriptPath('~/sign.sh'), path.join(os.homedir(), 'sign.sh'));
})();

(function testBuildSignEnvPreservesReleaseProvidedSigningEnv() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-simulator-sign-env-test-'));
  try {
    const inheritedScript = path.join(tempDir, 'release-sign.sh');
    const cliScript = path.join(tempDir, 'cli-sign.sh');
    fs.writeFileSync(inheritedScript, '#!/usr/bin/env bash\nexit 0\n');
    fs.writeFileSync(cliScript, '#!/usr/bin/env bash\nexit 0\n');

    const inheritedEnv = {
      [SIGN_SCRIPT_ENV]: inheritedScript,
      [SIGN_SHARE_DIR_ENV]: '\\storm\\upload\\DigitalSign\\Velocity',
      [SIGN_PRODUCT_NAMES_ENV]: 'Inherited Product',
      [SIGN_TIMEOUT_MINUTES_ENV]: '33',
      CSC_IDENTITY_AUTO_DISCOVERY: 'true',
      WIN_CSC_LINK: 'windows-cert',
      CSC_LINK: 'generic-cert',
    };
    const noCliSignOptions = { passthroughArgs: ['--win'], signScript: '', signShareDir: '', signProductNames: '' };

    const nonWindowsEnv = buildSignEnv(inheritedEnv, noCliSignOptions, { disableBuiltInWindowsSigning: false });
    assert.strictEqual(nonWindowsEnv[SIGN_SCRIPT_ENV], inheritedScript);
    assert.strictEqual(nonWindowsEnv[SIGN_SHARE_DIR_ENV], '\\storm\\upload\\DigitalSign\\Velocity');
    assert.strictEqual(nonWindowsEnv[SIGN_PRODUCT_NAMES_ENV], 'Inherited Product');
    assert.strictEqual(nonWindowsEnv[SIGN_TIMEOUT_MINUTES_ENV], '33');
    assert.strictEqual(nonWindowsEnv.CSC_IDENTITY_AUTO_DISCOVERY, 'true');
    assert.strictEqual(nonWindowsEnv.WIN_CSC_LINK, 'windows-cert');
    assert.strictEqual(nonWindowsEnv.CSC_LINK, 'generic-cert');

    const windowsEnv = buildSignEnv(inheritedEnv, noCliSignOptions, { disableBuiltInWindowsSigning: true });
    assert.strictEqual(windowsEnv[SIGN_SCRIPT_ENV], inheritedScript);
    assert.strictEqual(windowsEnv.CSC_IDENTITY_AUTO_DISCOVERY, 'true');
    assert.strictEqual(windowsEnv.WIN_CSC_LINK, 'windows-cert');
    assert.strictEqual(windowsEnv.CSC_LINK, 'generic-cert');

    const missingScriptEnv = buildSignEnv(
      { ...inheritedEnv, [SIGN_SCRIPT_ENV]: path.join(tempDir, 'missing-sign.sh') },
      noCliSignOptions,
      { disableBuiltInWindowsSigning: true }
    );
    assert.strictEqual(missingScriptEnv.CSC_IDENTITY_AUTO_DISCOVERY, 'true');
    assert.strictEqual(missingScriptEnv.WIN_CSC_LINK, 'windows-cert');

    const cliEnv = buildSignEnv(inheritedEnv, {
      passthroughArgs: ['--win'],
      signScript: cliScript,
      signShareDir: '\\storm\\upload\\DigitalSign\\CLI',
      signProductNames: 'CLI Product',
      signTimeoutMinutes: '44',
    });
    assert.strictEqual(cliEnv[SIGN_SCRIPT_ENV], cliScript);
    assert.strictEqual(cliEnv[SIGN_SHARE_DIR_ENV], '\\storm\\upload\\DigitalSign\\CLI');
    assert.strictEqual(cliEnv[SIGN_PRODUCT_NAMES_ENV], 'CLI Product');
    assert.strictEqual(cliEnv[SIGN_TIMEOUT_MINUTES_ENV], '44');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})();

(function testExternalSigningAddsPathAwareWindowsSignHook() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-simulator-sign-config-test-'));
  try {
    const scriptFile = path.join(tempDir, 'sign.sh');
    fs.writeFileSync(scriptFile, '#!/usr/bin/env bash\nexit 0\n');

    const parsed = parseSignOptions(['--win', '--sign-script', scriptFile, '--config.compression=maximum']);
    const args = withExternalWindowsSigningConfigArgs(parsed.passthroughArgs, {}, parsed, { disableBuiltInWindowsSigning: true });

    assert.deepStrictEqual(args, [
      '--win',
      '--config.compression=maximum',
      '--config.win.signtoolOptions.sign=./scripts/windows-sign-hook.js',
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})();

(function testExternalSigningReplacesConflictingSigningOverrides() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-simulator-sign-config-conflict-test-'));
  try {
    const scriptFile = path.join(tempDir, 'sign.sh');
    fs.writeFileSync(scriptFile, '#!/usr/bin/env bash\nexit 0\n');

    const parsed = parseSignOptions([
      '--win',
      '--sign-script', scriptFile,
      '--config.win.signExts=.exe',
      '--config.win.forceCodeSigning=true',
      '--config.forceCodeSigning=true',
      '--config.win.signtoolOptions.sign=./custom-sign.js',
    ]);
    const args = withExternalWindowsSigningConfigArgs(parsed.passthroughArgs, {}, parsed, { disableBuiltInWindowsSigning: true });

    assert.strictEqual(args.includes('--config.win.signExts=.exe'), false);
    assert.strictEqual(args.includes('--config.win.forceCodeSigning=true'), false);
    assert.strictEqual(args.includes('--config.forceCodeSigning=true'), false);
    assert.strictEqual(args.includes('--config.win.signtoolOptions.sign=./custom-sign.js'), false);
    assert.strictEqual(args[args.length - 1], '--config.win.signtoolOptions.sign=./scripts/windows-sign-hook.js');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})();

(function testWindowsSignHookSkipsOnlyDirectExternalSignSourceFiles() {
  const projectDir = path.join('/repo', 'velocity-simulator');

  assert.strictEqual(isDirectExternalSignableFile(path.join(projectDir, 'dist', 'arcgis-velocity-simulator-1.0.3-setup.exe'), projectDir), true);
  assert.strictEqual(isDirectExternalSignableFile(path.join(projectDir, 'dist', 'arcgis-velocity-simulator-1.0.3-portable.exe'), projectDir), true);
  assert.strictEqual(isDirectExternalSignableFile(path.join(projectDir, 'dist', 'patch.msp'), projectDir), true);
  assert.strictEqual(isDirectExternalSignableFile(path.join(projectDir, 'dist', 'installer.msi'), projectDir), true);
  assert.strictEqual(isDirectExternalSignableFile(path.join(projectDir, 'dist', 'win-unpacked', 'VelocitySimulator.exe'), projectDir), true);

  assert.strictEqual(isDirectExternalSignableFile(path.join(projectDir, 'dist', 'win-unpacked', 'resources', 'elevate.exe'), projectDir), false);
  assert.strictEqual(isDirectExternalSignableFile(path.join(projectDir, 'dist', 'win-unpacked', 'resources', 'helper.msi'), projectDir), false);
  assert.strictEqual(isDirectExternalSignableFile(path.join(projectDir, 'dist', 'arcgis-velocity-simulator-1.0.3-win.zip'), projectDir), false);
})();

(function testPackageUsesAfterSignHookForUnpackedExternalSigning() {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

  assert.strictEqual(pkg.build.productName, 'ArcGIS Velocity Simulator');
  assert.strictEqual(pkg.build.executableName, 'VelocitySimulator');
  assert.strictEqual(pkg.build.afterPack, undefined);
  assert.strictEqual(pkg.build.afterSign, 'scripts/external-sign.js');
  assert.strictEqual(pkg.build.afterAllArtifactBuild, 'scripts/external-sign.js');
})();

(function testSignScriptStatus() {
  const ok = getSignScriptStatus('scripts/external-sign.js');
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.resolvedPath, path.join(process.cwd(), 'scripts', 'external-sign.js'));

  const missing = getSignScriptStatus('missing-sign.sh');
  assert.strictEqual(missing.ok, false);
  assert.strictEqual(missing.reason, 'file does not exist');
  assert.strictEqual(missing.resolvedPath, path.join(process.cwd(), 'missing-sign.sh'));
})();

(function testBuildSignCommandDefaultsToRun() {
  const command = buildSignCommand({
    scriptPath: '/opt/sign/sign.sh',
    sourceDirs: ['/repo/dist/win-unpacked'],
    productName: 'ArcGIS Velocity Simulator',
    shareDir: '\\\\storm\\upload\\DigitalSign\\Velocity',
    fileMask: '*.exe;*.msi;*.msp',
  });

  assert.strictEqual(command.command, 'bash');
  assert.deepStrictEqual(command.args, [
    '/opt/sign/sign.sh',
    '--run',
    '--timeout-minutes', '20',
    '--source-dirs', '/repo/dist/win-unpacked',
    '--product-names', 'ArcGIS Velocity Simulator',
    '--share-dir', '\\\\storm\\upload\\DigitalSign\\Velocity',
    '--file-mask', '*.exe;*.msi;*.msp',
  ]);
})();

(function testBuildSignCommandDryRunUsesOnlyDryRunMode() {
  const command = buildSignCommand({
    scriptPath: '/opt/sign/sign.sh',
    sourceDirs: ['/repo/dist/win-unpacked'],
    productName: 'ArcGIS Velocity Simulator',
    shareDir: '',
    fileMask: '*.exe;*.msi;*.msp',
    mode: '--dry-run',
  });

  assert.deepStrictEqual(command.args, [
    '/opt/sign/sign.sh',
    '--dry-run',
    '--timeout-minutes', '20',
    '--source-dirs', '/repo/dist/win-unpacked',
    '--product-names', 'ArcGIS Velocity Simulator',
    '--file-mask', '*.exe;*.msi;*.msp',
  ]);
  assert.strictEqual(command.args.includes('--run'), false);
})();

(function testBuildSignCommandUsesTimeoutOverride() {
  const command = buildSignCommand({
    scriptPath: '/opt/sign/sign.sh',
    sourceDirs: ['/repo/dist/win-unpacked'],
    productName: 'ArcGIS Velocity Simulator',
    shareDir: '',
    fileMask: '*.exe;*.msi;*.msp',
    timeoutMinutes: '30',
  });

  assert.deepStrictEqual(command.args.slice(0, 4), ['/opt/sign/sign.sh', '--run', '--timeout-minutes', '30']);
})();

(function testRedactSignArgsScrubsSensitiveValues() {
  const redacted = redactSignArgs([
    '/opt/sign/sign.sh',
    '--run',
    '--timeout-minutes', '20',
    '--source-dirs', '/repo/dist/win-unpacked',
    '--product-names', 'ArcGIS Velocity Simulator',
    '--share-dir', '\\\\storm\\upload\\DigitalSign\\Velocity',
    '--file-mask', '*.exe;*.msi;*.msp',
    '-je', 'build@example.com',
    '-jt', 'super-secret-token',
    '--jenkins-api-token=another-secret',
    '--smb-user', 'DOMAIN\\builduser',
    '--smb-pass', 'p@ssw0rd',
  ]);

  // Non-sensitive args are preserved verbatim so we can see --timeout-minutes 20.
  assert.ok(redacted.includes('--timeout-minutes'));
  assert.strictEqual(redacted[redacted.indexOf('--timeout-minutes') + 1], '20');
  assert.ok(redacted.includes('--source-dirs'));
  assert.ok(redacted.includes('--share-dir'));
  assert.ok(redacted.includes('*.exe;*.msi;*.msp'));

  // Sensitive values must be replaced with <redacted>.
  assert.ok(!redacted.includes('super-secret-token'));
  assert.ok(!redacted.includes('another-secret'));
  assert.ok(!redacted.includes('build@example.com'));
  assert.ok(!redacted.includes('p@ssw0rd'));
  assert.ok(!redacted.includes('DOMAIN\\builduser'));
  assert.strictEqual(redacted[redacted.indexOf('-jt') + 1], '<redacted>');
  assert.strictEqual(redacted[redacted.indexOf('-je') + 1], '<redacted>');
  assert.ok(redacted.includes('--jenkins-api-token=<redacted>'));
})();

(function testWatchdogTimeoutFollowsSignTimeoutWithBuffer() {
  const previousSignTimeout = process.env[SIGN_TIMEOUT_MINUTES_ENV];
  const previousWatchdogTimeout = process.env.VELOCITY_SIGN_TIMEOUT_MS;
  try {
    delete process.env.VELOCITY_SIGN_TIMEOUT_MS;
    process.env[SIGN_TIMEOUT_MINUTES_ENV] = '15';
    assert.strictEqual(getSignTimeoutMs(), 20 * 60 * 1000);

    process.env.VELOCITY_SIGN_TIMEOUT_MS = '0';
    assert.strictEqual(getSignTimeoutMs(), 0);
  } finally {
    if (previousSignTimeout === undefined) delete process.env[SIGN_TIMEOUT_MINUTES_ENV];
    else process.env[SIGN_TIMEOUT_MINUTES_ENV] = previousSignTimeout;
    if (previousWatchdogTimeout === undefined) delete process.env.VELOCITY_SIGN_TIMEOUT_MS;
    else process.env.VELOCITY_SIGN_TIMEOUT_MS = previousWatchdogTimeout;
  }
})();

(function testArtifactSigningPlanUsesOnlyBuiltSignableFiles() {
  const plan = getArtifactSigningPlan({
    artifactPaths: [
      path.join('/repo/dist', 'arcgis-velocity-simulator-1.0.2-setup.exe'),
      path.join('/repo/dist', 'arcgis-velocity-simulator-1.0.2-portable.exe'),
      path.join('/repo/dist', 'arcgis-velocity-simulator-1.0.2-win.zip'),
      path.join('/repo/dist', 'arcgis-velocity-simulator-1.0.2-linux.AppImage'),
    ],
  });

  assert.deepStrictEqual(plan.sourceDirs, ['/repo/dist']);
  assert.strictEqual(plan.fileMask, 'arcgis-velocity-simulator-1.0.2-setup.exe;arcgis-velocity-simulator-1.0.2-portable.exe');
})();

(function testExistingArtifactSigningPlanAndSignableFileDetection() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-simulator-sign-test-'));
  try {
    fs.writeFileSync(path.join(tempDir, 'simulator-setup.exe'), 'fake');
    fs.writeFileSync(path.join(tempDir, 'simulator-win.zip'), 'fake');

    assert.strictEqual(hasSignableFile(tempDir, '*.exe;*.msi;*.msp'), true);
    const plan = getExistingArtifactSigningPlan(tempDir);
    assert.deepStrictEqual(plan.sourceDirs, [tempDir]);
    assert.strictEqual(plan.fileMask, 'simulator-setup.exe');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})();

(function testOfficialProductName() {
  assert.strictEqual(getOfficialProductName({}), 'ArcGIS Velocity Simulator');
})();

(function testExternalSignLockSerializesConcurrentProcesses() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-simulator-sign-lock-test-'));
  try {
    const lockDir = path.join(tempDir, 'sign.lock');
    const eventsFile = path.join(tempDir, 'events.log');
    const workerFile = path.join(tempDir, 'worker.js');
    const signLockPath = path.join(process.cwd(), 'scripts', 'sign-lock.js');

    fs.writeFileSync(workerFile, `
      const fs = require('fs');
      const { withSignLock } = require(${JSON.stringify(signLockPath)});
      const [id, lockDir, eventsFile, holdMs] = process.argv.slice(2);
      function sleepSync(ms) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      }
      withSignLock({ phase: 'test ' + id, lockDir, pollMs: 25, log: () => {} }, () => {
        fs.appendFileSync(eventsFile, id + ':start:' + Date.now() + '\\n');
        sleepSync(Number(holdMs));
        fs.appendFileSync(eventsFile, id + ':end:' + Date.now() + '\\n');
      });
    `);

    const runner = `
      const { spawn } = require('child_process');
      const workerFile = ${JSON.stringify(workerFile)};
      const lockDir = ${JSON.stringify(lockDir)};
      const eventsFile = ${JSON.stringify(eventsFile)};
      const children = ['a', 'b'].map((id) => spawn(process.execPath, [workerFile, id, lockDir, eventsFile, '250'], { stdio: 'inherit' }));
      Promise.all(children.map((child) => new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => code === 0 ? resolve() : reject(new Error('child failed: ' + code)));
      }))).then(() => {}, (error) => {
        console.error(error.stack || error.message);
        process.exit(1);
      });
    `;

    const result = spawnSync(process.execPath, ['-e', runner], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const events = fs.readFileSync(eventsFile, 'utf8').trim().split('\n').map((line) => line.split(':'));
    assert.strictEqual(events.length, 4);
    assert.strictEqual(events[0][1], 'start');
    assert.strictEqual(events[1][1], 'end');
    assert.strictEqual(events[2][1], 'start');
    assert.strictEqual(events[3][1], 'end');
    assert.notStrictEqual(events[0][0], events[2][0]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})();

async function testRunExternalSignDoesNotWaitForStdin() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-simulator-sign-stdin-test-'));
  const previousLockDir = process.env.VELOCITY_SIGN_LOCK_DIR;
  const previousTimeout = process.env.VELOCITY_SIGN_TIMEOUT_MS;
  const previousSignScript = process.env[SIGN_SCRIPT_ENV];
  const previousProductNames = process.env[SIGN_PRODUCT_NAMES_ENV];
  try {
    const sourceFile = path.join(tempDir, 'simulator.exe');
    const markerFile = path.join(tempDir, 'marker.txt');
    const argsFile = path.join(tempDir, 'args.txt');
    const scriptFile = path.join(tempDir, 'fake-sign.sh');
    fs.writeFileSync(sourceFile, 'fake');
    fs.writeFileSync(scriptFile, `#!/usr/bin/env bash
if read -t 1 line; then
  echo "unexpected stdin: $line"
  exit 8
fi
printf '%s\n' "$@" > ${JSON.stringify(argsFile)}
echo ok > ${JSON.stringify(markerFile)}
echo "stdin is closed"
`);
    fs.chmodSync(scriptFile, 0o700);

    process.env.VELOCITY_SIGN_LOCK_DIR = path.join(tempDir, 'sign.lock');
    process.env.VELOCITY_SIGN_TIMEOUT_MS = '5000';
    process.env[SIGN_SCRIPT_ENV] = scriptFile;
    process.env[SIGN_PRODUCT_NAMES_ENV] = 'Override Product';

    await externalSign({
      appOutDir: tempDir,
      electronPlatformName: 'win32',
      packager: { appInfo: { productName: 'ArcGIS Velocity Simulator' } },
    });

    assert.strictEqual(fs.readFileSync(markerFile, 'utf8').trim(), 'ok');
    const signCommandArgs = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
    assert.strictEqual(signCommandArgs[signCommandArgs.indexOf('--product-names') + 1], 'Override Product');
  } finally {
    if (previousLockDir === undefined) delete process.env.VELOCITY_SIGN_LOCK_DIR;
    else process.env.VELOCITY_SIGN_LOCK_DIR = previousLockDir;
    if (previousTimeout === undefined) delete process.env.VELOCITY_SIGN_TIMEOUT_MS;
    else process.env.VELOCITY_SIGN_TIMEOUT_MS = previousTimeout;
    if (previousSignScript === undefined) delete process.env[SIGN_SCRIPT_ENV];
    else process.env[SIGN_SCRIPT_ENV] = previousSignScript;
    if (previousProductNames === undefined) delete process.env[SIGN_PRODUCT_NAMES_ENV];
    else process.env[SIGN_PRODUCT_NAMES_ENV] = previousProductNames;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testWindowsSignHookSkipsDirectDistAndDelegatesNestedFiles() {
  const projectDir = path.join('/repo', 'velocity-simulator');
  const directArtifact = path.join(projectDir, 'dist', 'arcgis-velocity-simulator-1.0.3-setup.exe');
  const directUnpackedExe = path.join(projectDir, 'dist', 'win-unpacked', 'VelocitySimulator.exe');
  const nestedHelper = path.join(projectDir, 'dist', 'win-unpacked', 'resources', 'elevate.exe');
  const signed = [];
  const packager = {
    projectDir,
    signingManager: {
      value: Promise.resolve({
        doSign: async (configuration) => {
          signed.push(configuration.path);
        },
      }),
    },
  };

  await windowsSignHook({ path: directArtifact, cscInfo: { file: '/cert.pfx' } }, packager);
  assert.deepStrictEqual(signed, []);

  await windowsSignHook({ path: directUnpackedExe, cscInfo: { file: '/cert.pfx' } }, packager);
  assert.deepStrictEqual(signed, []);

  await windowsSignHook({ path: nestedHelper, cscInfo: { file: '/cert.pfx' } }, packager);
  assert.deepStrictEqual(signed, [nestedHelper]);

  await windowsSignHook({ path: path.join(projectDir, 'dist', 'win-unpacked', 'resources', 'optional-helper.exe') }, packager);
  assert.deepStrictEqual(signed, [nestedHelper]);
}

async function testRunSignProcessPrintsHeartbeatWhileQuiet() {
  const previousInterval = process.env.VELOCITY_SIGN_PROGRESS_INTERVAL_MS;
  const logs = [];
  const originalLog = console.log;
  try {
    process.env.VELOCITY_SIGN_PROGRESS_INTERVAL_MS = '50';
    console.log = (message) => logs.push(String(message));
    const result = await runSignProcess({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 160);'],
      timeoutMs: 1000,
    });

    assert.strictEqual(result.status, 0);
    assert(logs.some((line) => line.includes('Still waiting for signing process')), logs.join('\n'));
  } finally {
    console.log = originalLog;
    if (previousInterval === undefined) delete process.env.VELOCITY_SIGN_PROGRESS_INTERVAL_MS;
    else process.env.VELOCITY_SIGN_PROGRESS_INTERVAL_MS = previousInterval;
  }
}

(async function runAsyncTests() {
  await testRunExternalSignDoesNotWaitForStdin();
  await testWindowsSignHookSkipsDirectDistAndDelegatesNestedFiles();
  await testRunSignProcessPrintsHeartbeatWhileQuiet();
  console.log('external-sign tests passed');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

