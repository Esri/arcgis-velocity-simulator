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

async function prepareTauri(repoDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
  if (!pkg.tauriRuntime?.nodeVersion) throw new Error('Missing pinned tauriRuntime.nodeVersion in package.json');
  const resources = path.join(repoDir, 'src-tauri', 'resources');
  const backend = path.join(resources, 'backend');
  fs.mkdirSync(resources, { recursive: true });
  fs.rmSync(backend, { recursive: true, force: true });
  fs.mkdirSync(backend);
  for (const name of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(repoDir, name), path.join(backend, name));
  }
  fs.cpSync(path.join(repoDir, 'src'), path.join(backend, 'src'), { recursive: true });
  const npmCli = process.env.npm_execpath;
  if (npmCli && fs.existsSync(npmCli)) {
    run(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: backend });
  } else {
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: backend, shell: process.platform === 'win32' });
  }
  const node = await officialNode(repoDir, pkg.tauriRuntime.nodeVersion, process.platform, process.arch);
  const executable = path.join(resources, process.platform === 'win32' ? 'node.exe' : 'node');
  fs.copyFileSync(node.executable, executable);
  fs.chmodSync(executable, 0o755);
  fs.copyFileSync(node.license, path.join(resources, 'node-LICENSE'));
  const frontend = stageFrontend(repoDir);
  console.log(`[Tauri] Prepared Node ${pkg.tauriRuntime.nodeVersion}, production backend and web frontend`);
  return { resources, frontend };
}

if (require.main === module) {
  prepareTauri(path.join(__dirname, '..')).catch((error) => {
    console.error(`[Tauri] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { officialNode, prepareTauri, run, stageFrontend };
