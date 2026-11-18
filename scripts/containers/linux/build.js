#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { verifyArtifacts } = require('./verify');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env, cwd: '/work' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal || result.status})`);
}

function main() {
  const [runtime, arch, distribution] = process.argv.slice(2);
  if (!['electron', 'tauri'].includes(runtime) || !['x64', 'arm64'].includes(arch)
    || !['installer', 'portable', 'both'].includes(distribution)) {
    throw new Error('Expected runtime, architecture and distribution');
  }
  if (process.platform !== 'linux' || process.arch !== arch) {
    throw new Error(`Container is ${process.platform}/${process.arch}; requested linux/${arch}`);
  }
  fs.cpSync('/source', '/work', { recursive: true, dereference: false });
  process.env.VELOCITY_BUILD_SOURCE_FILE = '/source/build-source.json';
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  run('node', ['scripts/package-runtime.js', '--runtime', runtime, '--platform', 'linux',
    '--arch', arch, '--distribution', distribution]);
  const { collectReleaseArtifacts } = require('/work/scripts/release-artifacts.js');
  const files = collectReleaseArtifacts('/work', { runtime, platform: 'linux', arch, distribution });
  const pkg = JSON.parse(fs.readFileSync('/work/package.json', 'utf8'));
  const smoke = runtime === 'tauri' ? verifyArtifacts(pkg, files, arch) : [];
  for (const file of files) fs.copyFileSync(file, path.join('/output', path.basename(file)));
  const report = {
    platform: process.platform, arch: process.arch, node: process.version,
    rust: spawnSync('rustc', ['--version'], { encoding: 'utf8' }).stdout.trim(),
    packages: fs.readFileSync('/opt/velocity-build-packages.txt', 'utf8'),
    smoke,
  };
  fs.writeFileSync('/output/container-build.json', JSON.stringify(report, null, 2) + '\n');
}

try { main(); }
catch (error) { console.error(`[Linux container] ${error.message}`); process.exitCode = 1; }
