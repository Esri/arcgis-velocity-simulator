#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { artifactName, formatsFor, outputDirectory, validateManifest, validateTarget } = require('./release-artifacts');

const IMAGES = {
  arm64: {
    base: 'ubuntu:24.04@sha256:c92376659a7f14cc1f51615d73c9f4b7d8e18d59f370e02b4ed683ab4485c66c',
    node: 'node:24.22.3-bookworm-slim@sha256:5f8fabfed57b75127de2f584593d67a9e8c90e6b0f65652871f9ef0f759c0299',
    rust: 'rust:1.100.0-slim-bookworm@sha256:a05e7b80377ed6099c177cad2b9f536e182b9574490c7b4c07acaa29a44fda57',
  },
  x64: {
    base: 'ubuntu:24.04@sha256:77eb101c607d6e3d4f5ad0c8a02c2136c689b98aba1f359e6502ba517e5c57ec',
    node: 'node:24.22.3-bookworm-slim@sha256:0e2646ab57e77b7a384a0cb59b6815b182c77e1f9c3ba36bd8435bd9c4e6680e',
    rust: 'rust:1.100.0-slim-bookworm@sha256:476f6598b8d14a1f1bc7e58efc67af206ac8a559c37a3401ce512db2582d0ff7',
  },
};
const NEW_BUILD_FILES = new Set([
  'scripts/build-linux-container.js',
  'scripts/containers/linux/Dockerfile',
  'scripts/containers/linux/build.js',
  'scripts/containers/linux/verify.js',
]);
const ROOT_FILES = new Set(['package.json', 'package-lock.json', 'LICENSE', 'LICENSE.md', 'NOTICE', 'NOTICE.md']);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw new Error(`Cannot run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal || result.status})`);
  return result.stdout;
}

function git(repoDir, args) {
  return run('git', args, { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function buildInput(name) {
  if (name.includes('\\') || path.posix.isAbsolute(name) || name.split('/').includes('..')) return false;
  if (ROOT_FILES.has(name)) return true;
  const parts = name.split('/');
  if (!['src', 'scripts', 'src-tauri'].includes(parts[0])) return false;
  if (parts.some(part => part.startsWith('.') || ['node_modules', 'target', 'resources', 'gen'].includes(part))) return false;
  if (/\.(?:pem|p12|pfx|key|crt|cer|mobileprovision)$/i.test(name)) return false;
  return true;
}

function sourceMetadata(repoDir) {
  const commit = git(repoDir, ['rev-parse', 'HEAD']).trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error('Invalid source Git commit');
  return { commit, dirty: Boolean(git(repoDir, ['status', '--porcelain']).trim()) };
}

function snapshotSource(repoDir, destination, includeFiles = []) {
  const tracked = git(repoDir, ['ls-files', '-z']).split('\0').filter(Boolean);
  const untracked = git(repoDir, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  const explicit = new Set([...NEW_BUILD_FILES, ...includeFiles]);
  for (const name of includeFiles) {
    if (!buildInput(name)) throw new Error(`Additional build input is not permitted: ${name}`);
    const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', name], { cwd: repoDir });
    if (ignored.status !== 1) throw new Error(`Additional build input is ignored or cannot be checked: ${name}`);
  }
  const unknown = untracked.filter(name => buildInput(name) && !explicit.has(name));
  if (unknown.length) throw new Error(`Untracked build inputs require explicit review before inclusion: ${unknown.join(', ')}`);
  const metadata = sourceMetadata(repoDir);
  const files = [...new Set([...tracked, ...untracked.filter(name => explicit.has(name))])].filter(buildInput).sort();
  const digest = crypto.createHash('sha256');
  const copied = [];
  fs.mkdirSync(destination, { recursive: true });
  for (const name of files) {
    const source = path.join(repoDir, name);
    let current = repoDir;
    let missing = false;
    for (const part of name.split('/')) {
      current = path.join(current, part);
      let stat;
      try { stat = fs.lstatSync(current); }
      catch (error) { if (error.code === 'ENOENT') { missing = true; break; } throw error; }
      if (stat.isSymbolicLink()) throw new Error(`Symlink build input is not permitted: ${name}`);
    }
    if (missing) continue; // Tracked deletions stay absent in the snapshot.
    const stat = fs.lstatSync(source);
    if (!stat.isFile()) throw new Error(`Build input is not a regular file: ${name}`);
    const bytes = fs.readFileSync(source);
    const output = path.join(destination, name);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, bytes, { mode: stat.mode & 0o777 });
    digest.update(name + '\0').update(String(stat.mode & 0o777) + '\0').update(bytes).update('\0');
    copied.push(name);
  }
  for (const name of ['package.json', 'package-lock.json', 'src-tauri/Cargo.lock', 'scripts/package-runtime.js']) {
    if (!copied.includes(name)) throw new Error(`Required build input is missing: ${name}`);
  }
  metadata.sourceSha256 = digest.digest('hex');
  fs.writeFileSync(path.join(destination, 'build-source.json'), JSON.stringify(metadata) + '\n');
  return { ...metadata, files: copied };
}

function normalizeOptions(options = {}) {
  const target = { runtime: options.runtime || 'tauri', platform: 'linux', arch: options.arch || process.arch };
  validateTarget(target);
  const distribution = options.distribution || 'both';
  formatsFor('linux', distribution);
  return { ...target, distribution, docker: options.docker || 'docker', includeFiles: options.includeFiles || [] };
}

function dockerRunArgs(options, source, output, image) {
  for (const directory of [source, output]) {
    if (/[,\r\n]/.test(directory)) throw new Error('Container bind paths cannot contain commas or line breaks');
  }
  return [
    'run', '--rm', '--init', '--platform', `linux/${options.arch === 'x64' ? 'amd64' : 'arm64'}`,
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--mount', `type=bind,source=${source},target=/source,readonly`,
    '--mount', `type=bind,source=${output},target=/output`,
    '--env', 'APPIMAGE_EXTRACT_AND_RUN=1',
    image, options.runtime, options.arch, options.distribution,
  ];
}

function assertLocalEngine(endpoint) {
  if (typeof endpoint !== 'string'
    || !/^(?:unix:\/\/\/|npipe:\/\/\/\/[.]\/pipe\/)/.test(endpoint)) {
    throw new Error('Linux builds require a local Unix socket or named-pipe engine, not a remote Docker endpoint');
  }
}

function resolveEndpoint(env, inspectContext) {
  const endpoint = env.DOCKER_CONTEXT ? inspectContext(env.DOCKER_CONTEXT)
    : env.DOCKER_HOST || inspectContext();
  assertLocalEngine(endpoint);
  return endpoint;
}

function promoteOutput(repoDir, output, options, source, imageId) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
  const manifestName = artifactName(pkg, options, 'manifest.json');
  const checked = validateManifest(path.join(output, manifestName), pkg);
  if (checked.manifest.runtime !== options.runtime || checked.manifest.platform !== 'linux'
      || checked.manifest.arch !== options.arch || checked.manifest.commit !== source.commit
      || checked.manifest.dirty !== source.dirty) throw new Error('Container artifact provenance does not match the source snapshot');
  const expected = formatsFor('linux', options.distribution);
  if (checked.formats.size !== expected.length || expected.some(format => !checked.formats.has(format))) {
    throw new Error('Container did not return the exact requested artifact formats');
  }
  const reportFile = path.join(output, 'container-build.json');
  if (!fs.lstatSync(reportFile).isFile()) throw new Error('Container build report is not a regular file');
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  if (report.platform !== 'linux' || report.arch !== options.arch) throw new Error('Container architecture report mismatch');
  const destination = outputDirectory(repoDir, options);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const incoming = fs.mkdtempSync(path.join(path.dirname(destination), '.linux-incoming-'));
  const previous = `${incoming}-previous`;
  let movedPrevious = false;
  try {
    for (const file of checked.files) fs.copyFileSync(file, path.join(incoming, path.basename(file)));
    checked.manifest.container = { ...report, imageId, sourceSha256: source.sourceSha256 };
    fs.writeFileSync(path.join(incoming, manifestName), JSON.stringify(checked.manifest, null, 2) + '\n');
    if (fs.existsSync(destination)) {
      if (fs.lstatSync(destination).isSymbolicLink()) throw new Error('Output target cannot be a symlink');
      fs.renameSync(destination, previous);
      movedPrevious = true;
    }
    try { fs.renameSync(incoming, destination); }
    catch (error) {
      if (movedPrevious) { fs.renameSync(previous, destination); movedPrevious = false; }
      throw error;
    }
    if (movedPrevious) fs.rmSync(previous, { recursive: true, force: true });
  } finally { fs.rmSync(incoming, { recursive: true, force: true }); }
  return destination;
}

async function buildLinuxContainer(repoDir, input = {}) {
  repoDir = fs.realpathSync(repoDir);
  const options = normalizeOptions(input);
  const platform = `linux/${options.arch === 'x64' ? 'amd64' : 'arm64'}`;
  if (input['dry-run']) {
    console.log(`[Linux container] ${options.runtime}/${options.arch}: ${formatsFor('linux', options.distribution).join(', ')}; ${platform}`);
    return;
  }
  let endpoint;
  const dockerEnv = { ...process.env };
  delete dockerEnv.DOCKER_CONTEXT;
  delete dockerEnv.DOCKER_HOST;
  const docker = (args, settings = {}) => run(options.docker, ['--host', endpoint, ...args], { ...settings, env: dockerEnv });
  try {
    endpoint = resolveEndpoint(process.env, context => run(options.docker,
      ['context', 'inspect', ...(context ? [context] : []), '--format', '{{(index .Endpoints "docker").Host}}'],
      { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }).trim());
    const os = docker(['info', '--format', '{{.OSType}}'], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }).trim();
    if (os !== 'linux') throw new Error(`Container engine runs ${os}, not Linux`);
  }
  catch (error) { throw new Error(`A running Linux Docker-compatible engine is required. Start your approved local engine and retry. ${error.message}`); }
  const state = path.join(repoDir, '.tauri');
  fs.mkdirSync(state, { recursive: true });
  const lock = path.join(state, `container-${options.runtime}-${options.arch}.lock`);
  try { fs.mkdirSync(lock); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`A container build already owns ${lock}; do not remove it while that build is running`);
    throw error;
  }
  const workspace = fs.mkdtempSync(path.join(state, 'linux-build-'));
  try {
    const sourceDir = path.join(workspace, 'source');
    const output = path.join(workspace, 'output');
    const context = path.join(workspace, 'image');
    fs.mkdirSync(output); fs.mkdirSync(context);
    const source = snapshotSource(repoDir, sourceDir, options.includeFiles);
    for (const name of ['Dockerfile', 'build.js', 'verify.js']) {
      fs.copyFileSync(path.join(sourceDir, 'scripts', 'containers', 'linux', name), path.join(context, name));
    }
    const identity = crypto.createHash('sha256').update(fs.readFileSync(path.join(context, 'Dockerfile')))
      .update(fs.readFileSync(path.join(context, 'build.js')))
      .update(fs.readFileSync(path.join(context, 'verify.js'))).update(JSON.stringify(IMAGES[options.arch])).digest('hex').slice(0, 20);
    const image = `velocity-linux-builder:${options.arch}-${identity}`;
    docker(['build', '--platform', platform, '--tag', image,
      '--build-arg', `BASE_IMAGE=${IMAGES[options.arch].base}`,
      '--build-arg', `NODE_IMAGE=${IMAGES[options.arch].node}`,
      '--build-arg', `RUST_IMAGE=${IMAGES[options.arch].rust}`, context]);
    const imageId = docker(['image', 'inspect', '--format', '{{.Id}}', image],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('Container engine returned an invalid image digest');
    console.log(`[Linux container] Building ${source.commit}${source.dirty ? ' with local changes' : ''} (${source.sourceSha256})`);
    docker(dockerRunArgs(options, sourceDir, output, imageId));
    const destination = promoteOutput(repoDir, output, options, source, imageId);
    console.log(`[Linux container] Validated artifacts: ${destination}`);
    return destination;
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmdirSync(lock);
  }
}

if (require.main === module) {
  const options = {};
  try {
    for (let i = 2; i < process.argv.length; i++) {
      const flag = process.argv[i];
      if (flag === '--dry-run') options['dry-run'] = true;
      else if (['--arch', '--runtime', '--distribution'].includes(flag) && process.argv[i + 1]) options[flag.slice(2)] = process.argv[++i];
      else throw new Error('Usage: node scripts/build-linux-container.js [--runtime electron|tauri] [--arch arm64|x64] [--distribution both|portable|installer] [--dry-run]');
    }
    buildLinuxContainer(path.join(__dirname, '..'), options).catch(error => {
      console.error(`[Linux container] ${error.message}`); process.exitCode = 1;
    });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { assertLocalEngine, buildLinuxContainer, buildInput, dockerRunArgs, normalizeOptions, promoteOutput, resolveEndpoint, snapshotSource };
