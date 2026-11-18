const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { artifactName, collectReleaseArtifacts, fileDigest, formatsFor, outputDirectory, validateManifest } = require('../scripts/release-artifacts');
const { prepareElectronBuild } = require('../scripts/electron-build-context');
const { parseOptions, portableScript } = require('../scripts/package-runtime');
const { stageFrontend } = require('../scripts/prepare-tauri');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-packages-'));
const pkg = { name: 'arcgis-velocity-simulator', version: '1.2.3' };
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));

function fixture(target, formats = formatsFor(target.platform)) {
  const directory = outputDirectory(root, target);
  fs.mkdirSync(directory, { recursive: true });
  const artifacts = formats.map((format) => {
    const name = artifactName(pkg, target, format);
    const file = path.join(directory, name);
    fs.writeFileSync(file, `package ${target.runtime}/${target.platform}/${target.arch}/${format}`);
    return { name, format, ...fileDigest(file) };
  });
  const file = path.join(directory, artifactName(pkg, target, 'manifest.json'));
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, application: pkg.name, version: pkg.version, ...target, artifacts }));
  return { file, artifacts, directory };
}

try {
  const electron = { runtime: 'electron', platform: 'mac', arch: 'arm64' };
  const tauri = { ...electron, runtime: 'tauri' };
  const intel = { ...electron, arch: 'x64' };
  const built = fixture(electron);
  const otherRuntime = fixture(tauri);
  const otherArch = fixture(intel);
  assert.notStrictEqual(artifactName(pkg, electron, 'zip'), artifactName(pkg, tauri, 'zip'));
  assert.equal(artifactName(pkg, electron, 'zip'), 'arcgis-velocity-simulator-1.2.3-standalone-mac-arm64.zip');
  assert.equal(artifactName(pkg, tauri, 'dmg'), 'arcgis-velocity-simulator-1.2.3-compact-mac-arm64.dmg');
  assert.strictEqual(collectReleaseArtifacts(root, { runtime: 'both', platform: 'mac', arch: 'arm64' }).length, 6);

  const build = prepareElectronBuild(root, ['--mac', '--arm64']);
  assert.deepStrictEqual(build.formats, ['dmg', 'zip']);
  assert(!fs.existsSync(built.file));
  assert(fs.existsSync(otherRuntime.file), 'Electron cleanup must preserve Tauri artifacts');
  assert(fs.existsSync(otherArch.file), 'ARM cleanup must preserve Intel artifacts');
  assert(build.args.includes(`--config.directories.output=${built.directory}`));
  assert.throws(() => prepareElectronBuild(root, ['--mac', '--x64', '--arm64']), /one architecture/);
  assert.throws(() => prepareElectronBuild(root, ['--mac', '--config.directories.output=/tmp']), /managed/);
  assert.deepStrictEqual(prepareElectronBuild(root, ['--win', 'zip', '--x64']).formats, ['zip']);

  const incomplete = fixture(electron, ['zip']);
  assert.throws(() => collectReleaseArtifacts(root, { platform: 'mac', arch: 'arm64' }), /Incomplete/);
  assert.strictEqual(collectReleaseArtifacts(root, { platform: 'mac', arch: 'arm64', distribution: 'portable' }).length, 2);
  fs.appendFileSync(path.join(incomplete.directory, incomplete.artifacts[0].name), 'tampered');
  assert.throws(() => validateManifest(incomplete.file, pkg), /changed after packaging/);
  assert.throws(() => collectReleaseArtifacts(root, { platform: 'linux' }), /No current-version manifest/);
  assert.throws(() => artifactName(pkg, { ...electron, arch: '../x64' }, 'zip'), /architecture/);

  const native = parseOptions(['--runtime', 'both', '--platform', 'mac'], 'darwin', 'arm64');
  assert.deepStrictEqual(native.targets, [electron, tauri]);
  assert.throws(() => parseOptions(['--runtime', 'tauri', '--platform', 'all'], 'darwin', 'arm64'), /matching native/);
  assert.throws(() => parseOptions(['--runtime', 'tauri', '--arch', 'x64'], 'darwin', 'arm64'), /matching native/);
  assert.throws(() => parseOptions(['--distribution', 'broken']), /Unknown distribution/);
  assert.strictEqual(parseOptions(['--platform', 'win'], 'darwin', 'arm64').targets[0].arch, 'x64');

  const nsi = portableScript('C:\\a $b', 'C:\\out.exe', 'VelocitySimulator.exe');
  assert(nsi.includes('RequestExecutionLevel user'));
  assert(nsi.includes('ExecWait'));
  assert(nsi.includes('SetErrorLevel $R1'));
  assert(nsi.includes('C:\\a $$b'));
  assert(!/WriteReg|CreateShortCut/.test(nsi), 'Portable launch must not install the application');

  const src = path.join(root, 'src');
  fs.mkdirSync(path.join(src, 'themes'), { recursive: true });
  fs.writeFileSync(path.join(src, 'index.html'), '<script src="renderer.js"></script>');
  fs.writeFileSync(path.join(src, 'renderer.js'), 'load("voice.js");');
  fs.writeFileSync(path.join(src, 'voice.js'), 'window.voice = true;');
  fs.writeFileSync(path.join(src, 'themes', 'dark.css'), 'body { color: white; }');
  fs.writeFileSync(path.join(src, 'main.js'), 'require("electron");');
  fs.writeFileSync(path.join(src, 'tauri-backend.js'), 'require("./main");');
  const frontend = stageFrontend(root);
  assert(fs.existsSync(path.join(frontend, 'voice.js')), 'Dynamic local browser scripts must be staged');
  assert(fs.existsSync(path.join(frontend, 'themes', 'dark.css')), 'Theme resources must be staged');
  assert(!fs.existsSync(path.join(frontend, 'main.js')));
  assert(!fs.existsSync(path.join(frontend, 'tauri-backend.js')));
  console.log('Runtime packaging tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
