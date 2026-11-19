#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal || result.status})`);
}

async function download(url, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(`${destination}.tmp`, bytes);
  fs.renameSync(`${destination}.tmp`, destination);
}

async function officialNode(repoDir, version, platform, arch) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('tauriRuntime.nodeVersion must be an exact Node version');
  if (!['darwin', 'win32', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) {
    throw new Error(`Unsupported Node runtime target: ${platform}/${arch}`);
  }
  const nodePlatform = platform === 'win32' ? 'win' : platform;
  const stem = `node-v${version}-${nodePlatform}-${arch}`;
  const filename = `${stem}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
  const cache = path.join(repoDir, '.tauri', 'downloads');
  fs.mkdirSync(cache, { recursive: true });
  const baseUrl = `https://nodejs.org/dist/v${version}`;
  const sumsFile = path.join(cache, `node-v${version}-SHASUMS256.txt`);
  if (!fs.existsSync(sumsFile)) await download(`${baseUrl}/SHASUMS256.txt`, sumsFile);
  const checksumLine = fs.readFileSync(sumsFile, 'utf8').split('\n')
    .find((line) => line.trim().split(/\s+/)[1] === filename);
  if (!checksumLine) throw new Error(`Official Node checksums do not include ${filename}`);
  const checksum = checksumLine.trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error(`Invalid Node checksum for ${filename}`);
  const archive = path.join(cache, filename);
  if (!fs.existsSync(archive)) await download(`${baseUrl}/${filename}`, archive);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  if (actual !== checksum) throw new Error(`Node archive checksum mismatch: ${archive}; remove this file and retry`);
  const extracted = path.join(cache, stem);
  fs.rmSync(extracted, { recursive: true, force: true });
  run('tar', ['-xf', archive, '-C', cache]);
  return {
    executable: path.join(extracted, platform === 'win32' ? 'node.exe' : 'bin/node'),
    license: path.join(extracted, 'LICENSE'),
  };
}

function stageFrontend(repoDir) {
  const src = path.join(repoDir, 'src');
  const output = path.join(repoDir, '.tauri', 'frontend');
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const queue = fs.readdirSync(src).filter((name) => /\.(html|css)$/.test(name));
  const copied = new Set();
  while (queue.length) {
    const name = queue.shift();
    if (copied.has(name)) continue;
    const source = path.resolve(src, name);
    if (!source.startsWith(`${src}${path.sep}`)) throw new Error(`Frontend path escapes src: ${name}`);
    copied.add(name);
    fs.mkdirSync(path.dirname(path.join(output, name)), { recursive: true });
    fs.copyFileSync(source, path.join(output, name));
    const text = fs.readFileSync(source, 'utf8');
    const references = name.endsWith('.html')
      ? [...text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map((match) => match[1])
      : [...text.matchAll(/["']([^"'<>]+\.js)["']/g)].map((match) => match[1]);
    for (const reference of references) {
      if (/^(?:https?:|data:|\/\/)/.test(reference)) continue;
      const relative = path.normalize(path.join(path.dirname(name), reference));
      if (fs.existsSync(path.join(src, relative))) queue.push(relative);
    }
  }
  for (const directory of ['assets', 'themes']) {
    const source = path.join(src, directory);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(output, directory), { recursive: true });
  }
  return output;
}

function assertWindowsBinary(file, arch) {
  const expected = { x64: 0x8664, arm64: 0xaa64 }[arch];
  if (!expected) throw new Error(`Unsupported Windows architecture: ${arch}`);
  const fd = fs.openSync(file, 'r');
  try {
    const dos = Buffer.alloc(64);
    if (fs.readSync(fd, dos, 0, dos.length, 0) !== dos.length || dos.readUInt16LE(0) !== 0x5a4d) {
      throw new Error(`Not a Windows executable: ${file}`);
    }
    const offset = dos.readUInt32LE(60);
    const header = Buffer.alloc(6);
    if (offset > fs.fstatSync(fd).size - header.length
      || fs.readSync(fd, header, 0, header.length, offset) !== header.length
      || header.readUInt32LE(0) !== 0x00004550 || header.readUInt16LE(4) !== expected) {
      throw new Error(`Windows executable architecture does not match ${arch}: ${file}`);
    }
  } finally { fs.closeSync(fd); }
}

function assertPortableResourceTree(directory) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
    throw new Error(`Portable resources require regular files and directories, not links or special files: ${directory}`);
  }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(directory)) assertPortableResourceTree(path.join(directory, name));
  }
}

function copyPortableResources(source, destination) {
  assertPortableResourceTree(source);
  try {
    fs.lstatSync(destination);
    assertPortableResourceTree(destination);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  fs.cpSync(source, destination, { recursive: true });
  assertPortableResourceTree(destination);
}

async function prepareTauri(repoDir, { platform = process.platform, arch = process.arch } = {}) {
  if (!['darwin', 'win32', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) {
    throw new Error(`Unsupported backend target: ${platform}/${arch}`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
  if (!pkg.tauriRuntime?.nodeVersion) throw new Error('Missing pinned tauriRuntime.nodeVersion in package.json');
  const resources = path.join(repoDir, 'src-tauri', 'resources');
  const backend = path.join(resources, 'backend');
  fs.rmSync(resources, { recursive: true, force: true });
  fs.mkdirSync(backend, { recursive: true });
  for (const name of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(repoDir, name), path.join(backend, name));
  }
  copyPortableResources(path.join(repoDir, 'src'), path.join(backend, 'src'));
  const npmCli = process.env.npm_execpath;
  const installEnv = { ...process.env, npm_config_os: platform, npm_config_cpu: arch };
  const installArgs = ['ci', '--omit=dev', '--ignore-scripts', '--bin-links=false', '--no-audit', '--no-fund'];
  if (npmCli && fs.existsSync(npmCli)) {
    run(process.execPath, [npmCli, ...installArgs], { cwd: backend, env: installEnv });
  } else {
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', installArgs,
      { cwd: backend, env: installEnv, shell: process.platform === 'win32' });
  }
  const node = await officialNode(repoDir, pkg.tauriRuntime.nodeVersion, platform, arch);
  const executable = path.join(resources, platform === 'win32' ? 'node.exe' : 'node');
  fs.copyFileSync(node.executable, executable);
  fs.chmodSync(executable, 0o755);
  if (platform === 'win32') assertWindowsBinary(executable, arch);
  fs.copyFileSync(node.license, path.join(resources, 'node-LICENSE'));
  const frontend = stageFrontend(repoDir);
  assertPortableResourceTree(resources);
  assertPortableResourceTree(frontend);
  console.log(`[Tauri] Prepared Node ${pkg.tauriRuntime.nodeVersion} for ${platform}/${arch}, production backend and web frontend`);
  return { resources, frontend };
}

if (require.main === module) {
  prepareTauri(path.join(__dirname, '..')).catch((error) => {
    console.error(`[Tauri] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { assertPortableResourceTree, assertWindowsBinary, copyPortableResources, officialNode, prepareTauri, run, stageFrontend };
