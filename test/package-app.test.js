'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { execFileSync } = require('child_process');
const { artifactName, collectReleaseArtifacts, fileDigest, formatsFor, outputDirectory, validateManifest, writeManifest } = require('../scripts/release-artifacts');
const { prepareElectronBuild } = require('../scripts/electron-build-context');
const { parseOptions } = require('../scripts/package-app');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-packages-'));
const pkg = { name: 'arcgis-velocity-simulator', version: '1.2.3' };
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
const target = (platform, arch) => ({ runtime: 'electron', platform, arch });
function fixture(selected, formats = formatsFor(selected.platform)) {
  const directory = outputDirectory(root, selected);
  fs.mkdirSync(directory, { recursive: true });
  const artifacts = formats.map(format => {
    const name = artifactName(pkg, selected, format), file = path.join(directory, name);
    fs.writeFileSync(file, `fixture ${selected.platform}/${selected.arch}/${format}`);
    return { name, format, ...fileDigest(file) };
  });
  const file = path.join(directory, artifactName(pkg, selected, 'manifest.json'));
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, application: pkg.name, version: pkg.version,
    ...selected, artifacts, commit: 'a'.repeat(40), dirty: false }));
  return { file, directory, artifacts };
}
async function main() {
  try {
    const mac = target('mac', 'arm64');
    const built = fixture(mac), linux = fixture(target('linux', 'arm64'));
    fixture(target('linux', 'x64')); fixture(target('win', 'x64'));
    assert.equal(artifactName(pkg, mac, 'zip'), 'arcgis-velocity-simulator-1.2.3-mac-arm64.zip');
    assert.equal(collectReleaseArtifacts(root, { packagesOnly: true }).length, 9);
    assert.equal(collectReleaseArtifacts(root).length, 13);
    for (const flags of [['--publish=always'], ['-palways'], ['-pnever'], ['--publish']]) {
      assert.throws(() => prepareElectronBuild(root, ['--mac', '--arm64', ...flags]), /Package-only/);
      assert(fs.existsSync(built.file));
    }
    const prepared = prepareElectronBuild(root, ['--mac', '--arm64', '--publish', 'never']);
    assert(prepared.args.includes('--publish=never'));
    assert(!fs.existsSync(built.file)); assert(fs.existsSync(linux.file));
    for (const arch of ['x64', 'arm64']) {
      const linuxBuild = prepareElectronBuild(root, ['--linux', `--${arch}`]);
      assert(linuxBuild.args.includes(
        `--config.linux.artifactName=arcgis-velocity-simulator-1.2.3-linux-${arch}.\${ext}`));
      fixture(target('linux', arch));
    }
    assert.throws(() => prepareElectronBuild(root, ['--mac', '--x64', '--arm64']), /one architecture/);
    assert.throws(() => prepareElectronBuild(root, ['--mac', '--config.directories.output=elsewhere']), /managed/);
    const partial = fixture(mac, ['zip']);
    assert.throws(() => collectReleaseArtifacts(root, { platform: 'mac', packagesOnly: true }), /Incomplete/);
    fs.appendFileSync(path.join(partial.directory, partial.artifacts[0].name), 'tampered');
    assert.throws(() => validateManifest(partial.file, pkg), /changed after packaging/);
    assert.throws(() => artifactName(pkg, target('linux', '../arm64'), 'deb'), /architecture/);
    assert.throws(() => parseOptions(['--runtime', 'tauri']), /Unknown option/);
    assert.throws(() => parseOptions(['--windows-cross']), /Unknown option/);
    assert.equal(parseOptions(['--platform', 'all'], 'darwin', 'arm64').targets.length, 4);
    assert.deepEqual(parseOptions(['--platform', 'linux'], 'darwin', 'arm64').targets.map(t => t.arch), ['x64', 'arm64']);
    const calls = [], moduleUnderTest = { exports: {} };
    const entry = require.resolve('../scripts/package-app'), localRequire = createRequire(entry);
    vm.runInNewContext(fs.readFileSync(entry, 'utf8'), {
      module: moduleUnderTest, __dirname: path.dirname(entry), process, console: { log() {} },
      require: name => name === './build-linux-container'
        ? { buildLinuxContainer: async (repo, options) => calls.push({ repo, ...options }) }
        : localRequire(name),
    });
    await moduleUnderTest.exports.main(['--platform', 'linux', '--linux-container'], root);
    assert.deepEqual(calls.map(c => c.arch), ['x64', 'arm64']);
    calls.length = 0;
    await moduleUnderTest.exports.main(['--platform', 'linux', '--linux-container', '--dry-run'], root);
    assert.equal(calls.length, 0);
    const { FileMatcher } = require('app-builder-lib/out/fileMatcher');
    const filter = new FileMatcher(root, root + '/output', v => v,
      ['src/**/*', 'package.json', '!**/*.map', '!**/{.env,secrets}{,/**/*}']).createFilter();
    assert(filter(path.join(root, 'src'), { isDirectory: () => true }));
    assert(filter(path.join(root, 'src/.hidden.json'), { isDirectory: () => false }));
    for (const file of ['src/.env', 'src/secrets/token.json', 'src/main.js.map'])
      assert(!filter(path.join(root, file), { isDirectory: () => false }));
    const match = createRequire(require.resolve('@electron/universal'))('minimatch').minimatch;
    assert(match('App/Contents/Info.plist', 'Info.plist', { matchBase: true }));
    assert(!match('App/Contents/Other.plist', 'Info.plist', { matchBase: true }));

    fixture(mac);
    const sourceFile = path.join(root, 'build-source.json');
    const previousSource = process.env.VELOCITY_BUILD_SOURCE_FILE;
    try {
      process.env.VELOCITY_BUILD_SOURCE_FILE = sourceFile;
      fs.writeFileSync(sourceFile, JSON.stringify({ commit: 'a'.repeat(40), dirty: true }));
      const manifestFile = writeManifest(root, mac, ['dmg', 'zip']);
      const originalManifest = fs.readFileSync(manifestFile, 'utf8');
      assert.equal(JSON.parse(originalManifest).dirty, true);
      for (const invalid of [null, { commit: 'short', dirty: false }, { commit: 'a'.repeat(40), dirty: 'false' }]) {
        fs.writeFileSync(sourceFile, JSON.stringify(invalid));
        assert.throws(() => writeManifest(root, mac, ['dmg', 'zip']), /Build source metadata/);
        assert.equal(fs.readFileSync(manifestFile, 'utf8'), originalManifest);
      }
    } finally {
      fs.unlinkSync(sourceFile);
      if (previousSource === undefined) delete process.env.VELOCITY_BUILD_SOURCE_FILE;
      else process.env.VELOCITY_BUILD_SOURCE_FILE = previousSource;
    }

    execFileSync('git', ['init', '--quiet'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'dist/\n');
    execFileSync('git', ['add', 'package.json', '.gitignore'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture'], { cwd: root });
    fixture(mac);
    assert.throws(() => collectReleaseArtifacts(root, { platform: 'mac', requireCleanSource: true }), /producer/);
    writeManifest(root, mac, ['dmg', 'zip']);
    assert.equal(collectReleaseArtifacts(root, { platform: 'mac', requireCleanSource: true }).length, 3);
    fs.appendFileSync(path.join(root, 'package.json'), '\n');
    assert.throws(() => collectReleaseArtifacts(root, { platform: 'mac', requireCleanSource: true }), /clean source/);
    console.log('Electron package selection, safety and producer-gate tests passed.');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
