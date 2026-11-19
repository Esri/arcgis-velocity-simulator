'use strict';

const fs = require('fs');
const path = require('path');
const { getBuildTargets } = require('./artifact-version-utils');
const { formatsFor, outputDirectory, writeManifest } = require('./release-artifacts');

function prepareElectronBuild(repoDir, originalArgs) {
  const packageArgs = [];
  for (let index = 0; index < originalArgs.length; index++) {
    const arg = originalArgs[index];
    if (/^-p[^=]/.test(arg)) {
      throw new Error('Package-only builds do not accept attached short publish options; use --publish=never');
    }
    if (arg === '--publish' || arg === '-p' || arg.startsWith('--publish=') || arg.startsWith('-p=')) {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : originalArgs[++index];
      if (value !== 'never') throw new Error('Package-only builds require --publish=never; use release.sh to publish verified artifacts');
    } else {
      packageArgs.push(arg);
    }
  }
  originalArgs = packageArgs;
  const targets = [...getBuildTargets(originalArgs)];
  if (targets.length > 1) throw new Error('Build one platform per step; use package:all for multiple platforms');
  const platform = targets[0] || ({ darwin: 'mac', win32: 'win', linux: 'linux' })[process.platform];
  const architectures = originalArgs.filter((arg) => ['--x64', '--arm64', '--ia32', '--universal'].includes(arg));
  if (architectures.length > 1) throw new Error('Build one architecture per step');
  const arch = architectures[0]?.slice(2) || (platform === 'win' ? 'x64' : process.arch);
  const target = { runtime: 'electron', platform, arch };
  const output = outputDirectory(repoDir, target);
  if (originalArgs.some((arg) => arg.startsWith('--config.directories.output'))) {
    throw new Error('Output directories are managed per runtime, platform and architecture');
  }
  const targetOption = originalArgs.find((arg) => arg.startsWith(`--config.${platform}.target=`));
  let formats = formatsFor(platform);
  const positionalTargets = originalArgs.filter((arg) => !arg.startsWith('-'));
  const mapping = { zip: 'zip', dmg: 'dmg', nsis: 'setup.exe', portable: 'portable.exe', AppImage: 'AppImage', deb: 'deb' };
  if (positionalTargets.length) {
    if (positionalTargets.some((value) => !mapping[value] || !formats.includes(mapping[value]))) {
      throw new Error(`Unsupported package targets: ${positionalTargets.join(', ')}`);
    }
    formats = positionalTargets.map((value) => mapping[value]);
  }
  if (targetOption) {
    const value = targetOption.split('=')[1];
    if (!mapping[value] || !formats.includes(mapping[value])) throw new Error(`Unsupported package target: ${value}`);
    formats = [mapping[value]];
  }
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const args = [...originalArgs];
  if (!targets.length) args.push(`--${platform}`);
  if (!architectures.length) args.push(`--${arch}`);
  args.push(`--config.directories.output=${output}`);
  args.push('--publish=never');
  return { args, target, formats, output, finish: () => writeManifest(repoDir, target, formats) };
}

module.exports = { prepareElectronBuild };
