const assert = require('assert');
const os = require('os');
const path = require('path');

const { parseSignOptions, resolveSignScriptPath } = require('../scripts/sign-options');
const externalSign = require('../scripts/external-sign');

const { buildSignCommand, getArtifactSigningPlan, getOfficialProductName, getSignScriptStatus } = externalSign._private;

(function testParseSignOptions() {
  const parsed = parseSignOptions([
    '--win',
    '--sign-script', '/opt/sign/sign.sh',
    '-d', '\\\\storm\\upload\\DigitalSign\\Velocity',
    '-a', '-je',
    '--sign-arg=build@example.com',
    '--config.compression=maximum',
  ]);

  assert.deepStrictEqual(parsed.passthroughArgs, ['--win', '--config.compression=maximum']);
  assert.strictEqual(parsed.signScript, '/opt/sign/sign.sh');
  assert.strictEqual(parsed.signShareDir, '\\\\storm\\upload\\DigitalSign\\Velocity');
  assert.deepStrictEqual(parsed.signArgs, ['-je', 'build@example.com']);
})();

(function testSignScriptPathResolution() {
  const parsed = parseSignOptions(['--sign-script', 'scripts/../scripts/external-sign.js']);
  assert.strictEqual(parsed.signScript, path.join(process.cwd(), 'scripts', 'external-sign.js'));
  assert.strictEqual(resolveSignScriptPath('~/sign.sh'), path.join(os.homedir(), 'sign.sh'));
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
    extraArgs: ['-jt', 'token'],
  });

  assert.strictEqual(command.command, 'bash');
  assert.deepStrictEqual(command.args, [
    '/opt/sign/sign.sh',
    '--run',
    '--source-dirs', '/repo/dist/win-unpacked',
    '--product-names', 'ArcGIS Velocity Simulator',
    '--share-dir', '\\\\storm\\upload\\DigitalSign\\Velocity',
    '--file-mask', '*.exe;*.msi;*.msp',
    '-jt', 'token',
  ]);
})();

(function testBuildSignCommandDryRunUsesOnlyDryRunMode() {
  const command = buildSignCommand({
    scriptPath: '/opt/sign/sign.sh',
    sourceDirs: ['/repo/dist/win-unpacked'],
    productName: 'ArcGIS Velocity Simulator',
    shareDir: '',
    fileMask: '*.exe;*.msi;*.msp',
    extraArgs: [],
    mode: '--dry-run',
  });

  assert.deepStrictEqual(command.args, [
    '/opt/sign/sign.sh',
    '--dry-run',
    '--source-dirs', '/repo/dist/win-unpacked',
    '--product-names', 'ArcGIS Velocity Simulator',
    '--file-mask', '*.exe;*.msi;*.msp',
  ]);
  assert.strictEqual(command.args.includes('--run'), false);
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

(function testOfficialProductName() {
  assert.strictEqual(getOfficialProductName({}), 'ArcGIS Velocity Simulator');
})();

console.log('external-sign tests passed');

