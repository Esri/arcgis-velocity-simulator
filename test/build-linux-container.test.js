'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { assertLocalEngine, buildInput, dockerRunArgs, normalizeOptions, promoteOutput, resolveEndpoint, snapshotSource } = require('../scripts/build-linux-container');
const { artifactName, fileDigest } = require('../scripts/release-artifacts');
const { checkElf } = require('../scripts/containers/linux/verify');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-container-test-'));
const repo = path.join(temporary, 'repo');
const pkg = { name: 'velocity-fixture', version: '1.0.0' };
const target = { runtime: 'tauri', platform: 'linux', arch: 'arm64', distribution: 'both' };
const write = (name, value) => {
  const file = path.join(repo, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
};
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

try {
  const binary = path.join(temporary, 'binary');
  const header = Buffer.alloc(20);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(header);
  header.writeUInt16LE(183, 18);
  fs.writeFileSync(binary, header);
  assert.doesNotThrow(() => checkElf(binary, 'arm64'));
  assert.throws(() => checkElf(binary, 'x64'), /does not match/);
  fs.writeFileSync(binary, 'not a native executable');
  assert.throws(() => checkElf(binary, 'arm64'), /does not match/);
  const verifierPath = require.resolve('../scripts/containers/linux/verify');
  for (const dependencies of ['zenity, libdbus-1-3', 'libc6 (>= 2.36), zenity']) {
    const commands = [];
    const verifier = { exports: {} };
    const verifierRequire = createRequire(verifierPath);
    vm.runInNewContext(fs.readFileSync(verifierPath, 'utf8'), {
      module: verifier, process, Buffer,
      require: name => name === 'child_process' ? {
        spawnSync(command, args) {
          commands.push({ command, args });
          assert.equal(command, 'dpkg-deb');
          assert.equal(args[0], '--field', 'Invalid dependencies must fail before extraction or execution');
          return { status: 0, stdout: args.at(-1) === 'Architecture' ? 'arm64' : dependencies };
        },
      } : verifierRequire(name),
    });
    assert.throws(() => verifier.exports.verifyArtifacts(
      pkg, ['candidate.deb'], 'arm64', ['libc6 (>= 2.39)']),
    /DEB runtime dependency missing: libc6 \(>= 2.39\)/);
    assert.equal(commands.length, 2, 'Rejected DEBs must not reach payload verification or promotion');
  }

  fs.mkdirSync(repo);
  git('init', '--quiet');
  write('.gitignore', '.tauri/\n.env\n.npmrc\nsrc/ignored-secret.js\n');
  write('package.json', JSON.stringify(pkg));
  write('package-lock.json', '{}');
  write('src-tauri/Cargo.lock', '# fixture');
  write('scripts/package-runtime.js', '// fixture');
  write('src/main.js', '// original');
  write('src/removed.js', '// removed');
  write('docs/private-notes.md', 'not a build input');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'test fixture');
  const commit = git('rev-parse', 'HEAD').trim();
  write('src/main.js', '// current local content');
  fs.unlinkSync(path.join(repo, 'src/removed.js'));
  write('.env', 'SECRET=never-copy');
  write('.npmrc', '//registry.example/:_authToken=never-copy');
  write('src/ignored-secret.js', 'never-copy');
  write('src-tauri/resources/secret.json', 'never-copy');
  write('scripts/containers/linux/Dockerfile', '# reviewed new helper');
  const snapshot = path.join(temporary, 'snapshot');
  const source = snapshotSource(repo, snapshot);
  assert.equal(source.commit, commit);
  assert.equal(source.dirty, true);
  assert.match(source.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.readFileSync(path.join(snapshot, 'src/main.js'), 'utf8'), '// current local content');
  for (const name of ['.git', '.env', '.npmrc', 'docs', 'src/removed.js', 'src/ignored-secret.js', 'src-tauri/resources']) {
    assert.equal(fs.existsSync(path.join(snapshot, name)), false, `${name} must not enter the container`);
  }
  assert.ok(fs.existsSync(path.join(snapshot, 'scripts/containers/linux/Dockerfile')));
  const repeated = snapshotSource(repo, path.join(temporary, 'repeat'));
  assert.equal(source.sourceSha256, repeated.sourceSha256, 'Identical source snapshots must have identical digests');
  write('src/new-helper.js', '// needs explicit review');
  assert.throws(() => snapshotSource(repo, path.join(temporary, 'unknown')), /Untracked build inputs require explicit review/);
  const included = snapshotSource(repo, path.join(temporary, 'included'), ['src/new-helper.js']);
  assert.ok(included.files.includes('src/new-helper.js'));
  assert.throws(() => snapshotSource(repo, path.join(temporary, 'ignored'), ['src/ignored-secret.js']), /ignored/);
  fs.unlinkSync(path.join(repo, 'src/new-helper.js'));
  fs.unlinkSync(path.join(repo, 'src/main.js'));
  fs.symlinkSync(path.join(repo, '.env'), path.join(repo, 'src/main.js'));
  assert.throws(() => snapshotSource(repo, path.join(temporary, 'symlink')), /Symlink build input/);
  for (const name of ['../secret', '/tmp/secret', 'src/../secret', 'src/key.pem', 'scripts/.env', 'src-tauri/target/cache']) {
    assert.equal(buildInput(name), false, name);
  }
  const options = normalizeOptions(target);
  const args = dockerRunArgs(options, '/source path', '/output path', 'image:exact');
  assert.ok(args.includes('ALL'));
  assert.ok(args.includes('no-new-privileges'));
  assert.ok(args.includes('type=bind,source=/source path,target=/source,readonly'));
  assert.ok(!args.some(arg => /--privileged|docker.sock|--device|--network=host/.test(arg)));
  assert.equal(args.at(-2), 'arm64');
  assert.throws(() => dockerRunArgs(options, '/path,readonly=false', '/out', 'image'), /commas/);
  assert.throws(() => normalizeOptions({ arch: 'universal' }), /architecture/);
  assert.doesNotThrow(() => assertLocalEngine('unix:///Users/example/.docker/run/docker.sock'));
  for (const endpoint of ['ssh://build-host', 'tcp://build-host:2376', 'https://example.com']) {
    assert.throws(() => assertLocalEngine(endpoint), /local Unix socket/);
  }
  assert.throws(() => resolveEndpoint({ DOCKER_HOST: 'unix:///local.sock', DOCKER_CONTEXT: 'remote' },
    context => { assert.equal(context, 'remote'); return 'ssh://remote'; }), /local Unix socket/);
  assert.equal(resolveEndpoint({ DOCKER_HOST: 'unix:///explicit.sock' }, () => { throw new Error('must not inspect context'); }),
    'unix:///explicit.sock');
  assert.equal(resolveEndpoint({}, () => 'unix:///default.sock'), 'unix:///default.sock');

  const output = path.join(temporary, 'output');
  fs.mkdirSync(output);
  const artifacts = ['deb', 'AppImage'].map(format => {
    const name = artifactName(pkg, target, format);
    fs.writeFileSync(path.join(output, name), format);
    return { name, format, ...fileDigest(path.join(output, name)) };
  });
  const manifestName = artifactName(pkg, target, 'manifest.json');
  const manifest = { schemaVersion: 1, application: pkg.name, version: pkg.version,
    runtime: target.runtime, platform: 'linux', arch: 'arm64', commit, dirty: true, artifacts };
  fs.writeFileSync(path.join(output, manifestName), JSON.stringify(manifest));
  const platformReport = { platform: 'linux', arch: 'arm64', node: 'v24.22.3',
    osRelease: 'ID=ubuntu\nVERSION_ID="24.04"\n', glibc: '2.39' };
  fs.writeFileSync(path.join(output, 'container-build.json'), JSON.stringify(platformReport));
  const destination = path.join(repo, 'dist/tauri/linux-arm64');
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'existing-artifact'), 'preserve until validated');
  assert.throws(() => promoteOutput(repo, output, target, { ...source, commit: '0'.repeat(40) }, 'sha256:image'), /provenance/);
  assert.ok(fs.existsSync(path.join(destination, 'existing-artifact')));
  promoteOutput(repo, output, target, source, 'sha256:image');
  const final = JSON.parse(fs.readFileSync(path.join(destination, manifestName)));
  assert.equal(final.container.sourceSha256, source.sourceSha256);
  assert.equal(final.container.imageId, 'sha256:image');
  assert.equal(final.container.osRelease, platformReport.osRelease);
  assert.equal(final.container.glibc, platformReport.glibc);
  assert.equal(fs.existsSync(path.join(destination, 'existing-artifact')), false);
  fs.appendFileSync(path.join(output, artifacts[0].name), 'tamper');
  assert.throws(() => promoteOutput(repo, output, target, source, 'sha256:image'), /changed after packaging/);
  assert.equal(fs.readFileSync(path.join(destination, artifacts[0].name), 'utf8'), 'deb');
  console.log('Linux container snapshot, isolation, provenance and output promotion tests passed.');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
