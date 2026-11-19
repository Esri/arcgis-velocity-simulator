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
  const [arch, distribution] = process.argv.slice(2);
  if (!['x64', 'arm64'].includes(arch)
    || !['installer', 'portable', 'both'].includes(distribution)) {
    throw new Error('Expected architecture and distribution');
  }
  if (process.platform !== 'linux' || process.arch !== arch) {
    throw new Error(`Container is ${process.platform}/${process.arch}; requested linux/${arch}`);
  }
  fs.cpSync('/source', '/work', { recursive: true, dereference: false });
  process.env.VELOCITY_BUILD_SOURCE_FILE = '/source/build-source.json';
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  run('node', ['scripts/package-app.js', '--platform', 'linux',
    '--arch', arch, '--distribution', distribution]);
  const { collectReleaseArtifacts } = require('/work/scripts/release-artifacts.js');
  const files = collectReleaseArtifacts('/work', { platform: 'linux', arch, distribution });
  const pkg = JSON.parse(fs.readFileSync('/work/package.json', 'utf8'));
  const appImageExecutor = process.env.VELOCITY_VERIFY_APPIMAGE_QEMU === '1'
    ? '/usr/bin/qemu-x86_64-static' : null;
  if (appImageExecutor) console.log(`[Linux container] AppImage verification executor: ${appImageExecutor}`);
  const smoke = verifyArtifacts(pkg, files, arch, pkg.build.deb?.depends || [], appImageExecutor);
  for (const file of files) fs.copyFileSync(file, path.join('/output', path.basename(file)));
  const report = {
    platform: process.platform, arch: process.arch, node: process.version,
    packages: fs.readFileSync('/opt/velocity-build-packages.txt', 'utf8'),
    osRelease: fs.readFileSync('/etc/os-release', 'utf8'),
    glibc: process.report.getReport().header.glibcVersionRuntime,
    smoke,
  };
  fs.writeFileSync('/output/container-build.json', JSON.stringify(report, null, 2) + '\n');
}

try { main(); }
catch (error) { console.error(`[Linux container] ${error.message}`); process.exitCode = 1; }
