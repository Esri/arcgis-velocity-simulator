#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseSignOptions, buildSignEnv, isUsableSignScript } = require('./sign-options');
const { formatsFor, validateTarget } = require('./release-artifacts');

const HELP = `Usage: node scripts/package-app.js [options]
  --platform mac|win|linux|all          Target OS (default: current host).
  --arch x64|arm64                     Default: both Linux; Windows x64; host otherwise.
  --distribution portable|installer|both  Package selection (default: both).
  --linux-container                   Build Linux in a local Ubuntu container.
  --dry-run                           Print targets without changing files.
  --sign-script <path>                 Existing external Windows signer.
  --help                              Show this reference.

Packages are built locally and never published. Use release.sh --upload-only
only after validating a complete clean-source package matrix.
`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal || result.status})`);
}

function parseOptions(args, hostPlatform = process.platform, hostArch = process.arch) {
  const signed = parseSignOptions(args);
  const options = { platform: ({ darwin: 'mac', win32: 'win', linux: 'linux' })[hostPlatform], distribution: 'both' };
  for (let i = 0; i < signed.passthroughArgs.length; i++) {
    const arg = signed.passthroughArgs[i];
    if (['--help', '--dry-run', '--linux-container'].includes(arg)) {
      options[arg.slice(2)] = true;
      continue;
    }
    const equals = arg.indexOf('=');
    const flag = equals < 0 ? arg : arg.slice(0, equals);
    if (!['--platform', '--arch', '--distribution'].includes(flag)) throw new Error(`Unknown option: ${arg}`);
    const value = equals < 0 ? signed.passthroughArgs[++i] : arg.slice(equals + 1);
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    options[flag.slice(2)] = value;
  }
  if (options.help) return { ...options, signed, targets: [] };
  if (!['mac', 'win', 'linux', 'all'].includes(options.platform)) throw new Error(`Unknown platform: ${options.platform}`);
  const platforms = options.platform === 'all' ? ['mac', 'win', 'linux'] : [options.platform];
  if (options['linux-container'] && !platforms.includes('linux')) throw new Error('--linux-container requires a Linux target');
  const targets = platforms.flatMap(platform => (options.arch ? [options.arch]
    : platform === 'linux' ? ['x64', 'arm64'] : [platform === 'win' ? 'x64' : hostArch]).map(arch => {
    const target = { runtime: 'electron', platform, arch };
    validateTarget(target);
    formatsFor(platform, options.distribution);
    return target;
  }));
  return { ...options, signed, targets };
}

async function main(args = process.argv.slice(2), repoDir = path.join(__dirname, '..')) {
  const options = parseOptions(args);
  if (options.help) { console.log(HELP); return; }
  const env = buildSignEnv(process.env, options.signed);
  if (options.targets.some(target => target.platform === 'win') && env.VELOCITY_SIGN_SCRIPT
      && !isUsableSignScript(env.VELOCITY_SIGN_SCRIPT)) {
    throw new Error(`External signing script is not readable: ${env.VELOCITY_SIGN_SCRIPT}`);
  }
  for (const target of options.targets) {
    const formats = formatsFor(target.platform, options.distribution);
    console.log(`[Package] ${target.platform}/${target.arch}: ${formats.join(', ')}`);
    if (options['dry-run']) continue;
    if (target.platform === 'linux' && options['linux-container']) {
      await require('./build-linux-container').buildLinuxContainer(repoDir, { arch: target.arch, distribution: options.distribution });
    } else {
      if (!fs.existsSync(path.join(repoDir, 'node_modules/electron-builder'))) {
        throw new Error('Electron build tooling is missing; run npm ci first');
      }
      run(process.execPath, [path.join(repoDir, 'scripts/check-build-prereqs.js'), `--${target.platform}`, '--quiet'], { env });
      const aliases = { 'setup.exe': 'nsis', 'portable.exe': 'portable' };
      run(process.execPath, [path.join(repoDir, 'scripts/timed-build.js'), `--${target.platform}`,
        ...formats.map(format => aliases[format] || format), `--${target.arch}`], { env });
    }
  }
}

if (require.main === module) main().catch(error => { console.error(`[Package] ${error.message}`); process.exitCode = 1; });
module.exports = { main, parseOptions };
