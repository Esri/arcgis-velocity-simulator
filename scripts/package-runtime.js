#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseSignOptions, buildSignEnv, isUsableSignScript } = require('./sign-options');
const { EDITIONS, artifactName, formatsFor, outputDirectory, validateTarget, writeManifest } = require('./release-artifacts');
const { prepareTauri, run } = require('./prepare-tauri');

const HELP = `Usage: node scripts/package-runtime.js [options]
  --runtime electron|tauri|both          Runtime (default: electron).
  --platform mac|win|linux|all           Target OS (default: current host).
  --arch x64|arm64                      Target architecture (default: host; Windows Electron defaults to x64).
  --distribution portable|installer|both  Package selection (default: both).
  --dev                                Run Tauri in development mode.
  --dry-run                            Print selected targets without writing or building.
  --sign-script <path>                  External Windows signing script.
  --sign-share-dir <path>               External signer share directory.
  --sign-product-names <names>          External signer product names.
  --sign-timeout-minutes <minutes>      External signer timeout.
  --help                               Show this reference.

Electron retains cross-platform packaging where supported by electron-builder.
Tauri requires a matching OS and architecture build host. Collect native builds
with release.sh --upload-only; no command here commits, pushes or publishes.
Public editions are Standalone (electron) and Compact (tauri).
Windows portable packages still require WebView2; they do not install it.
`;

function parseOptions(args, hostPlatform = process.platform, hostArch = process.arch) {
  const signed = parseSignOptions(args);
  const options = { runtime: 'electron', platform: ({ darwin: 'mac', win32: 'win', linux: 'linux' })[hostPlatform], distribution: 'both' };
  for (let i = 0; i < signed.passthroughArgs.length; i++) {
    const arg = signed.passthroughArgs[i];
    if (['--help', '--dry-run', '--dev'].includes(arg)) {
      options[arg.slice(2)] = true;
      continue;
    }
    const [flag, inline] = arg.split('=');
    if (!['--runtime', '--platform', '--arch', '--distribution'].includes(flag)) throw new Error(`Unknown option: ${arg}`);
    const value = inline === undefined ? signed.passthroughArgs[++i] : inline;
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    options[flag.slice(2)] = value;
  }
  if (options.help) return { ...options, signed, targets: [] };
  if (!['electron', 'tauri', 'both'].includes(options.runtime)) throw new Error(`Unknown runtime: ${options.runtime}`);
  if (!['mac', 'win', 'linux', 'all'].includes(options.platform)) throw new Error(`Unknown platform: ${options.platform}`);
  const runtimes = options.runtime === 'both' ? ['electron', 'tauri'] : [options.runtime];
  const platforms = options.platform === 'all' ? ['mac', 'win', 'linux'] : [options.platform];
  const targets = runtimes.flatMap((runtime) => platforms.map((platform) => {
    const arch = options.arch || (runtime === 'electron' && platform === 'win' ? 'x64' : hostArch);
    const target = { runtime, platform, arch };
    validateTarget(target);
    formatsFor(platform, options.distribution);
    if (runtime === 'tauri' && (platform !== ({ darwin: 'mac', win32: 'win', linux: 'linux' })[hostPlatform] || arch !== hostArch)) {
      throw new Error(`Tauri ${platform}/${arch} requires a matching native build host; this host is ${hostPlatform}/${hostArch}`);
    }
    return target;
  }));
  if (options.dev && (options.runtime !== 'tauri' || targets.length !== 1)) throw new Error('--dev requires --runtime tauri and one native target');
  return { ...options, signed, targets };
}

function nsisString(value) {
  if (/[\r\n]/.test(value)) throw new Error('NSIS paths cannot contain line breaks');
  return value.replace(/\$/g, () => '$$').replace(/"/g, '$\\"');
}

function portableScript(source, destination, executable) {
  return `Unicode true
!include "FileFunc.nsh"
Name "Portable application"
OutFile "${nsisString(destination)}"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
SetCompressor /SOLID lzma
Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\\app"
  File /r "${nsisString(source)}\\*"
  \${GetParameters} $R0
  ClearErrors
  ExecWait '"$PLUGINSDIR\\app\\${nsisString(executable)}" $R0' $R1
  IfErrors launch_failed
  SetErrorLevel $R1
  Goto done
launch_failed:
  MessageBox MB_ICONSTOP "Unable to launch the portable application. Check the WebView2 prerequisite."
  SetErrorLevel 1
done:
SectionEnd
`;
}

function findBundle(directory, extension) {
  const matches = fs.existsSync(directory)
    ? fs.readdirSync(directory).filter((name) => name.endsWith(extension)) : [];
  if (matches.length !== 1) throw new Error(`Expected one ${extension} bundle in ${directory}, found ${matches.length}`);
  return path.join(directory, matches[0]);
}

async function buildTauri(repoDir, pkg, target, options, env) {
  run('cargo', ['--version'], { env });
  if (target.platform === 'win' && formatsFor('win', options.distribution).includes('portable.exe')) {
    run('makensis', ['/VERSION'], { env });
  }
  const { resources } = await prepareTauri(repoDir);
  const output = outputDirectory(repoDir, target);
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const cargoDir = path.join(repoDir, '.tauri', 'cargo', `${target.platform}-${target.arch}`);
  const bundleDir = path.join(cargoDir, 'release', 'bundle');
  fs.rmSync(bundleDir, { recursive: true, force: true });
  const cli = path.join(repoDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  const config = {
    version: pkg.version,
    productName: `${pkg.productName} Compact`,
    mainBinaryName: `${pkg.build.executableName}${target.platform === 'linux' ? '-compact' : ''}`,
    bundle: { publisher: 'Esri' },
  };
  if (target.platform === 'win' && env.VELOCITY_SIGN_SCRIPT) {
    if (!isUsableSignScript(env.VELOCITY_SIGN_SCRIPT)) throw new Error(`External signing script is not readable: ${env.VELOCITY_SIGN_SCRIPT}`);
    config.bundle.windows = { signCommand: { cmd: process.execPath, args: [path.join(repoDir, 'scripts', 'tauri-sign.js'), '%1'] } };
  }
  if (target.platform === 'mac') {
    const identity = env.APPLE_SIGNING_IDENTITY || '-';
    const signingArgs = ['--force', '--sign', identity, '--entitlements', path.join(repoDir, 'scripts', 'node-entitlements.plist')];
    if (identity !== '-') signingArgs.push('--options', 'runtime', '--timestamp');
    run('codesign', [...signingArgs, path.join(resources, 'node')], { env });
  }
  const configPath = path.join(repoDir, '.tauri', 'build-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  const buildEnv = { ...env, CARGO_TARGET_DIR: cargoDir };
  if (target.platform === 'mac' && !buildEnv.APPLE_SIGNING_IDENTITY) buildEnv.APPLE_SIGNING_IDENTITY = '-';
  if (options.dev) {
    run(process.execPath, [cli, 'dev', '--config', configPath], { cwd: repoDir, env: buildEnv });
    return;
  }
  const formats = formatsFor(target.platform, options.distribution);
  const bundles = target.platform === 'mac' ? ['app', ...(formats.includes('dmg') ? ['dmg'] : [])]
    : target.platform === 'linux' ? formats.map((format) => format.toLowerCase())
      : formats.includes('setup.exe') ? ['nsis'] : [];
  run(process.execPath, [cli, 'build', '--config', configPath,
    ...(bundles.length ? ['--bundles', bundles.join(',')] : ['--no-bundle'])], { cwd: repoDir, env: buildEnv });
  for (const format of formats.filter((format) => ['dmg', 'setup.exe', 'AppImage', 'deb'].includes(format))) {
    const directory = ({ dmg: 'dmg', 'setup.exe': 'nsis', AppImage: 'appimage', deb: 'deb' })[format];
    const extension = format === 'setup.exe' ? '.exe' : `.${format}`;
    fs.copyFileSync(findBundle(path.join(bundleDir, directory), extension), path.join(output, artifactName(pkg, target, format)));
  }
  if (target.platform === 'mac' && formats.includes('zip')) {
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', findBundle(path.join(bundleDir, 'macos'), '.app'),
      path.join(output, artifactName(pkg, target, 'zip'))]);
  }
  if (target.platform === 'win' && formats.some((format) => ['zip', 'portable.exe'].includes(format))) {
    const folder = path.join(output, 'unpacked');
    fs.mkdirSync(folder);
    fs.cpSync(resources, folder, { recursive: true });
    const executable = `${pkg.build.executableName}.exe`;
    fs.copyFileSync(path.join(cargoDir, 'release', executable), path.join(folder, executable));
    if (env.VELOCITY_SIGN_SCRIPT) {
      run(process.execPath, [path.join(repoDir, 'scripts', 'tauri-sign.js'), path.join(folder, executable)], { env });
    }
    if (formats.includes('zip')) {
      run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Compress-Archive -Path (Join-Path $env:VELOCITY_PACKAGE_SOURCE "*") -DestinationPath $env:VELOCITY_PACKAGE_DESTINATION -Force'],
      { env: { ...env, VELOCITY_PACKAGE_SOURCE: folder, VELOCITY_PACKAGE_DESTINATION: path.join(output, artifactName(pkg, target, 'zip')) } });
    }
    if (formats.includes('portable.exe')) {
      const destination = path.join(output, artifactName(pkg, target, 'portable.exe'));
      const script = path.join(repoDir, '.tauri', 'portable.nsi');
      fs.writeFileSync(script, portableScript(folder, destination, executable));
      run('makensis', ['/V2', script], { env });
      if (env.VELOCITY_SIGN_SCRIPT) run(process.execPath, [path.join(repoDir, 'scripts', 'tauri-sign.js'), destination], { env });
    }
  }
  writeManifest(repoDir, target, formats);
}

async function main(args = process.argv.slice(2), repoDir = path.join(__dirname, '..')) {
  const options = parseOptions(args);
  if (options.help) { console.log(HELP); return; }
  const pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
  const env = buildSignEnv(process.env, options.signed);
  for (const target of options.targets) {
    console.log(`[Package] ${EDITIONS[target.runtime]} (${target.runtime})/${target.platform}/${target.arch}: ${formatsFor(target.platform, options.distribution).join(', ')}`);
    if (options['dry-run']) continue;
    if (target.runtime === 'tauri') {
      await buildTauri(repoDir, pkg, target, options, env);
    } else {
      const formatNames = { 'setup.exe': 'nsis', 'portable.exe': 'portable' };
      const formats = formatsFor(target.platform, options.distribution).map((format) => formatNames[format] || format);
      run(process.execPath, [path.join(repoDir, 'scripts', 'check-build-prereqs.js'), `--${target.platform}`, '--quiet'], { env });
      run(process.execPath, [path.join(repoDir, 'scripts', 'timed-build.js'), `--${target.platform}`, ...formats, `--${target.arch}`], { env });
    }
  }
}

if (require.main === module) main().catch((error) => { console.error(`[Package] ${error.message}`); process.exitCode = 1; });

module.exports = { main, parseOptions, portableScript };
