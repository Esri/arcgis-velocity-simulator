const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { artifactName, collectReleaseArtifacts, fileDigest, formatsFor, outputDirectory, validateManifest, writeManifest } = require('../scripts/release-artifacts');
const { prepareElectronBuild } = require('../scripts/electron-build-context');
const { parseOptions, portableScript } = require('../scripts/package-runtime');
const { assertPortableResourceTree, assertWindowsBinary, stageFrontend } = require('../scripts/prepare-tauri');

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

async function test() {
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
  const windowsCross = parseOptions(['--runtime', 'both', '--platform', 'win', '--windows-cross'], 'darwin', 'arm64');
  assert.deepStrictEqual(windowsCross.targets, [
    { runtime: 'electron', platform: 'win', arch: 'x64' },
    { runtime: 'tauri', platform: 'win', arch: 'x64' },
  ]);
  const fullMatrix = parseOptions(['--runtime', 'both', '--platform', 'all', '--windows-cross', '--linux-container'], 'darwin', 'arm64');
  assert.equal(fullMatrix.targets.length, 6);
  assert(fullMatrix.targets.every(target => target.arch === (target.platform === 'win' ? 'x64' : 'arm64')));
  assert.throws(() => parseOptions(['--platform', 'win', '--windows-cross'], 'linux', 'arm64'), /macOS host/);
  assert.throws(() => parseOptions(['--platform', 'mac', '--windows-cross'], 'darwin', 'arm64'), /Windows target/);
  assert.throws(() => parseOptions(['--runtime', 'tauri', '--platform', 'win', '--windows-cross', '--dev'], 'darwin', 'arm64'), /cannot be used with --dev/);
  assert.throws(() => parseOptions(['--distribution', 'broken']), /Unknown distribution/);
  assert.strictEqual(parseOptions(['--platform', 'win'], 'darwin', 'arm64').targets[0].arch, 'x64');
  const linuxContainer = parseOptions(['--runtime', 'both', '--platform', 'linux', '--linux-container'], 'darwin', 'arm64');
  assert.deepStrictEqual(linuxContainer.targets, [
    { runtime: 'electron', platform: 'linux', arch: 'arm64' },
    { runtime: 'tauri', platform: 'linux', arch: 'arm64' },
  ]);
  assert.throws(() => parseOptions(['--runtime', 'tauri', '--platform', 'linux'], 'darwin', 'arm64'), /matching native/);
  assert.throws(() => parseOptions(['--linux-container', '--platform', 'mac']), /requires a Linux/);
  assert.throws(() => parseOptions(['--runtime', 'tauri', '--linux-container', '--platform', 'linux', '--dev']), /cannot be used with --dev/);
  const calls = [];
  const runtimePath = require.resolve('../scripts/package-runtime');
  const runtimeRequire = createRequire(runtimePath);
  const runtimeModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(runtimePath, 'utf8'), {
    module: runtimeModule, __dirname: path.dirname(runtimePath), process, console: { log() {} },
    require: name => name === './build-linux-container'
      ? { buildLinuxContainer: async (repoDir, options) => calls.push({ repoDir, ...options }) }
      : runtimeRequire(name),
  });
  await runtimeModule.exports.main(['--runtime', 'both', '--platform', 'linux',
    '--arch', 'arm64', '--distribution', 'portable', '--linux-container'], root);
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls.map(call => ({ ...call })), [
    { repoDir: root, runtime: 'electron', arch: 'arm64', distribution: 'portable' },
    { repoDir: root, runtime: 'tauri', arch: 'arm64', distribution: 'portable' },
  ]);
  calls.length = 0;
  await runtimeModule.exports.main(['--runtime', 'tauri', '--platform', 'linux',
    '--arch', 'arm64', '--linux-container', '--dry-run'], root);
  assert.strictEqual(calls.length, 0, 'Dry runs must never invoke Docker');

  const nsi = portableScript('C:\\a $b', 'C:\\out.exe', 'VelocitySimulator.exe', { productName: 'Example $App Compact', version: '1.2.3' });
  assert(nsi.includes('RequestExecutionLevel user'));
  assert(nsi.includes('ExecWait'));
  assert(nsi.includes('SetErrorLevel $R1'));
  assert(nsi.includes('C:/a $$b/*'));
  assert(nsi.includes('VIProductVersion "1.2.3.0"'));
  assert(nsi.includes('"ProductName" "Example $$App Compact"'));
  assert.throws(() => portableScript('src', 'out', 'app.exe', { version: '1.2.70000' }), /Invalid Windows portable version/);
  assert(!/WriteReg|CreateShortCut/.test(nsi), 'Portable launch must not install the application');
  const peFile = path.join(root, 'backend-node.exe');
  const pe = Buffer.alloc(70);
  pe.writeUInt16LE(0x5a4d, 0);
  pe.writeUInt32LE(64, 60);
  pe.writeUInt32LE(0x00004550, 64);
  pe.writeUInt16LE(0x8664, 68);
  fs.writeFileSync(peFile, pe);
  assert.doesNotThrow(() => assertWindowsBinary(peFile, 'x64'));
  assert.throws(() => assertWindowsBinary(peFile, 'arm64'), /architecture does not match/);
  fs.writeFileSync(peFile, 'not a Windows executable');
  assert.throws(() => assertWindowsBinary(peFile, 'x64'), /Not a Windows executable/);

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

  const simulatedLinks = new Set();
  const resourceFs = {
    ...fs,
    lstatSync(file, ...args) {
      const stat = fs.lstatSync(file, ...args);
      if (simulatedLinks.has(file)) stat.isSymbolicLink = () => true;
      return stat;
    },
    rmSync(file, options) {
      fs.rmSync(file, options);
      for (const link of simulatedLinks) {
        if (link === file || link.startsWith(file + path.sep)) simulatedLinks.delete(link);
      }
    },
  };
  function createResourceLink(target, link) {
    if (process.platform === 'win32') {
      // Exercise link metadata without requiring Windows symlink privileges.
      fs.writeFileSync(link, target);
      simulatedLinks.add(link);
    } else {
      fs.symlinkSync(target, link);
    }
  }
  function removeResourceLink(link) {
    fs.unlinkSync(link);
    simulatedLinks.delete(link);
  }
  const preparationPath = require.resolve('../scripts/prepare-tauri');
  const preparationRequire = createRequire(preparationPath);
  const resourceModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(preparationPath, 'utf8'), {
    module: resourceModule, process, Buffer, console,
    require: name => name === 'fs' ? resourceFs : preparationRequire(name),
  });
  const copyResourcesUnderTest = resourceModule.exports.copyPortableResources;
  const resources = path.join(root, 'portable-resources');
  fs.mkdirSync(resources);
  fs.writeFileSync(path.join(resources, 'target.js'), 'module.exports = 42;');
  const copiedResources = path.join(root, 'portable-copy');
  copyResourcesUnderTest(resources, copiedResources);
  assert.strictEqual(fs.readFileSync(path.join(copiedResources, 'target.js'), 'utf8'), 'module.exports = 42;');
  for (const target of ['target.js', '../outside.js', path.join(root, 'outside.js'), 'missing.js']) {
    const link = path.join(resources, 'shim');
    createResourceLink(target, link);
    assert.throws(() => copyResourcesUnderTest(resources, path.join(root, 'rejected-copy')),
      /not links or special files/);
    assert(!fs.existsSync(path.join(root, 'rejected-copy')), 'Reject links before copying');
    removeResourceLink(link);
  }
  const stagedRepo = path.join(root, 'staged-repo');
  fs.mkdirSync(path.join(stagedRepo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(stagedRepo, 'src', 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(stagedRepo, 'package.json'), JSON.stringify({ ...pkg, tauriRuntime: { nodeVersion: '1.2.3' } }));
  fs.writeFileSync(path.join(stagedRepo, 'package-lock.json'), '{}');
  const cache = path.join(stagedRepo, '.tauri', 'downloads');
  fs.mkdirSync(cache, { recursive: true });
  const archiveBytes = Buffer.from('fixture archive');
  fs.writeFileSync(path.join(cache, 'node-v1.2.3-darwin-arm64.tar.gz'), archiveBytes);
  fs.writeFileSync(path.join(cache, 'node-v1.2.3-SHASUMS256.txt'),
    `${require('crypto').createHash('sha256').update(archiveBytes).digest('hex')}  node-v1.2.3-darwin-arm64.tar.gz\n`);
  const preparationModule = { exports: {} };
  let installedWithoutLinks = false;
  vm.runInNewContext(fs.readFileSync(preparationPath, 'utf8'), {
    module: preparationModule, process, Buffer, console: { log() {} },
    require: name => name === 'fs' ? resourceFs : name === 'child_process' ? {
      spawnSync(command, args, options) {
        if (args.includes('ci')) {
          installedWithoutLinks = args.includes('--bin-links=false');
          const dependency = path.join(options.cwd, 'node_modules', 'fixture');
          fs.mkdirSync(dependency, { recursive: true });
          fs.writeFileSync(path.join(dependency, 'cli.js'), 'module.exports = 42;');
          if (!installedWithoutLinks) {
            fs.mkdirSync(path.join(options.cwd, 'node_modules', '.bin'));
            createResourceLink('../fixture/cli.js', path.join(options.cwd, 'node_modules', '.bin', 'fixture'));
          }
        } else {
          assert.strictEqual(command, 'tar');
          const extracted = path.join(cache, 'node-v1.2.3-darwin-arm64');
          fs.mkdirSync(path.join(extracted, 'bin'), { recursive: true });
          fs.writeFileSync(path.join(extracted, 'bin', 'node'), 'fixture runtime');
          fs.writeFileSync(path.join(extracted, 'LICENSE'), 'fixture notice');
        }
        return { status: 0 };
      },
    } : preparationRequire(name),
  });
  const staged = await preparationModule.exports.prepareTauri(stagedRepo, { platform: 'darwin', arch: 'arm64' });
  assert(installedWithoutLinks, 'Only staged production installs must disable npm executable shims');
  assertPortableResourceTree(staged.resources);
  assert(!fs.existsSync(path.join(staged.resources, 'backend', 'node_modules', '.bin')));
  assert(fs.existsSync(path.join(staged.resources, 'backend', 'node_modules', 'fixture', 'cli.js')),
    'Dependency implementation files must remain intact');
  const staleBin = path.join(staged.resources, 'backend', 'node_modules', '.bin');
  fs.mkdirSync(staleBin);
  createResourceLink(path.join(root, 'missing-old-build'), path.join(staleBin, 'fixture'));
  const restaged = await preparationModule.exports.prepareTauri(stagedRepo, { platform: 'darwin', arch: 'arm64' });
  assert(!fs.existsSync(path.join(restaged.resources, 'backend', 'node_modules', '.bin')),
    'Reused staging must replace old generated shims, not retain cached build-host links');
  const staleDestination = path.join(root, 'stale-destination');
  createResourceLink(path.join(root, 'missing-output'), staleDestination);
  assert.throws(() => copyResourcesUnderTest(resources, staleDestination), /not links or special files/);
  removeResourceLink(staleDestination);

  const { FileMatcher } = require('app-builder-lib/out/fileMatcher');
  const selectedFiles = new FileMatcher(root, path.join(root, 'output'), value => value,
    ['src/**/*', 'package.json', '!**/*.map', '!**/{.env,secrets}{,/**/*}']).createFilter();
  const fileStat = { isDirectory: () => false };
  const directoryStat = { isDirectory: () => true };
  assert(selectedFiles(path.join(root, 'src'), directoryStat), 'Partial directory matches must allow traversal');
  assert(selectedFiles(path.join(root, 'src', '.visible-config.json'), fileStat));
  assert(selectedFiles(path.join(root, 'src', 'nested', 'main.js'), fileStat));
  assert(selectedFiles(path.join(root, 'package.json'), fileStat));
  assert(!selectedFiles(path.join(root, 'src', '.env'), fileStat));
  assert(!selectedFiles(path.join(root, 'src', 'secrets', 'token.json'), fileStat));
  assert(!selectedFiles(path.join(root, 'src', 'nested', 'main.js.map'), fileStat));
  assert(!selectedFiles(path.join(root, 'node_modules'), directoryStat));
  const universalMatch = createRequire(require.resolve('@electron/universal'))('minimatch').minimatch;
  assert(universalMatch('Application.app/Contents/Info.plist', 'Info.plist', { matchBase: true }));
  assert(!universalMatch('Application.app/Contents/Other.plist', 'Info.plist', { matchBase: true }));
  assert(universalMatch('Application.app/Contents/helper-x64', '*-x64', { matchBase: true }));

  const sourceFile = path.join(root, 'build-source.json');
  const previousSource = process.env.VELOCITY_BUILD_SOURCE_FILE;
  try {
    process.env.VELOCITY_BUILD_SOURCE_FILE = sourceFile;
    const source = { commit: 'a'.repeat(40), dirty: true };
    fs.writeFileSync(sourceFile, JSON.stringify(source));
    const manifestFile = writeManifest(root, tauri, ['dmg', 'zip']);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    assert.strictEqual(manifest.commit, source.commit, 'Snapshot builds preserve host commit without .git');
    assert.strictEqual(manifest.dirty, true);
    for (const invalid of [null, { commit: 'short', dirty: false }, { commit: source.commit, dirty: 'false' }]) {
      fs.writeFileSync(sourceFile, JSON.stringify(invalid));
      assert.throws(() => writeManifest(root, tauri, ['dmg', 'zip']), /Build source metadata/);
      assert.strictEqual(JSON.parse(fs.readFileSync(manifestFile, 'utf8')).dirty, true,
        'Invalid provenance must not overwrite an existing manifest');
    }
  } finally {
    if (previousSource === undefined) delete process.env.VELOCITY_BUILD_SOURCE_FILE;
    else process.env.VELOCITY_BUILD_SOURCE_FILE = previousSource;
  }
  console.log('Runtime packaging tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
}

test().catch(error => { console.error(error); process.exitCode = 1; });
