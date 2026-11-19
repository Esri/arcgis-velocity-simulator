#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { parseSignOptions, buildSignEnv, isUsableSignScript } = require('./sign-options');
const { EDITIONS, artifactName, formatsFor, outputDirectory, validateTarget, writeManifest } = require('./release-artifacts');
const { assertWindowsBinary, copyPortableResources, prepareTauri, run } = require('./prepare-tauri');

const HELP = `Usage: node scripts/package-runtime.js [options]
  --runtime electron|tauri|both          Runtime (default: electron).
  --platform mac|win|linux|all           Target OS (default: current host).
  --arch x64|arm64                      Target architecture (default: host; Windows Electron defaults to x64).
  --distribution portable|installer|both  Package selection (default: both).
  --linux-container                    Build Linux targets in a local Docker container.
  --windows-cross                      Cross-build Compact Windows targets on macOS using cargo-xwin.
  --dev                                Run Tauri in development mode.
  --dry-run                            Print selected targets without writing or building.
  --sign-script <path>                  External Windows signing script.
  --sign-share-dir <path>               External signer share directory.
  --sign-product-names <names>          External signer product names.
  --sign-timeout-minutes <minutes>      External signer timeout.
  --help                               Show this reference.

Electron retains cross-platform packaging where supported by electron-builder.
Tauri requires a matching OS and architecture build host unless Linux targets
use --linux-container or macOS Windows builds use --windows-cross. Collect builds
with release.sh --upload-only; no command here commits, pushes or publishes.
Public editions are Standalone (electron) and Compact (tauri).
Windows portable packages still require WebView2; they do not install it.
`;

function parseOptions(args, hostPlatform = process.platform, hostArch = process.arch) {
  const signed = parseSignOptions(args);
  const options = { runtime: 'electron', platform: ({ darwin: 'mac', win32: 'win', linux: 'linux' })[hostPlatform], distribution: 'both' };
  for (let i = 0; i < signed.passthroughArgs.length; i++) {
    const arg = signed.passthroughArgs[i];
    if (['--help', '--dry-run', '--dev', '--linux-container', '--windows-cross'].includes(arg)) {
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
  if (options['linux-container'] && !platforms.includes('linux')) {
    throw new Error('--linux-container requires a Linux target');
  }
  if (options['linux-container'] && options.dev) throw new Error('--linux-container cannot be used with --dev');
  if (options['windows-cross'] && (hostPlatform !== 'darwin' || !platforms.includes('win'))) {
    throw new Error('--windows-cross requires a macOS host and a Windows target');
  }
  if (options['windows-cross'] && options.dev) throw new Error('--windows-cross cannot be used with --dev');
  const targets = runtimes.flatMap((runtime) => platforms.map((platform) => {
    const arch = options.arch || (platform === 'win' && (runtime === 'electron' || options['windows-cross']) ? 'x64' : hostArch);
    const target = { runtime, platform, arch };
    validateTarget(target);
    formatsFor(platform, options.distribution);
    if (runtime === 'tauri' && !(platform === 'linux' && options['linux-container'])
      && !(platform === 'win' && options['windows-cross'])
      && (platform !== ({ darwin: 'mac', win32: 'win', linux: 'linux' })[hostPlatform] || arch !== hostArch)) {
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

function portableScript(source, destination, executable, { productName = 'Portable application', version, icon } = {}) {
  let versionInfo = '';
  if (version) {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-[a-zA-Z0-9.-]+)?$/.exec(version);
    if (!match || match.slice(1).some(value => Number(value) > 65535)) throw new Error('Invalid Windows portable version');
    versionInfo = `VIProductVersion "${match.slice(1).join('.')}.0"
VIAddVersionKey /LANG=1033 "ProductName" "${nsisString(productName)}"
VIAddVersionKey /LANG=1033 "CompanyName" "Esri"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Copyright 2026 Esri"
VIAddVersionKey /LANG=1033 "FileDescription" "${nsisString(productName)} portable launcher"
VIAddVersionKey /LANG=1033 "FileVersion" "${nsisString(version)}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${nsisString(version)}"
`;
  }
  return `Unicode true
!include "FileFunc.nsh"
Name "${nsisString(productName)}"
OutFile "${nsisString(destination)}"
${icon ? `Icon "${nsisString(icon)}"\n` : ''}${versionInfo}RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
SetCompressor /SOLID lzma
Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\\app"
  File /r "${nsisString(source.replace(/\\/g, '/'))}/*"
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

function crossWindowsEnvironment(repoDir, target, env) {
  const prefixes = [...new Set([env.HOMEBREW_PREFIX, '/opt/homebrew', '/usr/local'].filter(Boolean))];
  const bins = [
    path.join(env.CARGO_HOME || path.join(os.homedir(), '.cargo'), 'bin'),
    ...prefixes.flatMap((prefix) => [path.join(prefix, 'opt/llvm/bin'), path.join(prefix, 'opt/lld/bin'), path.join(prefix, 'bin')]),
  ].filter((directory) => fs.existsSync(directory));
  const result = {
    ...env,
    PATH: [...bins, env.PATH || ''].join(path.delimiter),
    XWIN_ARCH: target.arch === 'x64' ? 'x86_64' : 'aarch64',
    XWIN_CACHE_DIR: env.XWIN_CACHE_DIR || path.join(repoDir, '.tauri', 'xwin-cache'),
  };
  const missing = ['cargo', 'rustup', 'clang-cl', 'llvm-rc', 'lld-link', 'makensis'].filter((tool) =>
    !result.PATH.split(path.delimiter).some((directory) => {
      try {
        const file = path.join(directory, tool);
        fs.accessSync(file, fs.constants.X_OK);
        return fs.statSync(file).isFile();
      } catch { return false; }
    }));
  if (missing.length) {
    throw new Error(`Missing Windows cross-build tools: ${missing.join(', ')}. Install Rust, then brew install llvm lld nsis.`);
  }
  run('cargo', ['xwin', '--version'], { env: result });
  const triple = `${result.XWIN_ARCH}-pc-windows-msvc`;
  const installed = execFileSync('rustup', ['target', 'list', '--installed'], { env: result, encoding: 'utf8' }).trim().split(/\s+/);
  if (!installed.includes(triple)) throw new Error(`Missing Rust target; run rustup target add ${triple}`);
  return { env: result, triple };
}

async function buildTauri(repoDir, pkg, target, options, env) {
  const cli = path.join(repoDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  if (!fs.existsSync(cli) || !fs.statSync(cli).isFile()) {
    throw new Error('Tauri CLI is missing; restore the declared dependencies with npm ci before building');
  }
  if (target.platform === 'win' && env.VELOCITY_SIGN_SCRIPT && !isUsableSignScript(env.VELOCITY_SIGN_SCRIPT)) {
    throw new Error(`External signing script is not readable: ${env.VELOCITY_SIGN_SCRIPT}`);
  }
  let triple = '';
  if (target.platform === 'win' && options['windows-cross']) {
    const cross = crossWindowsEnvironment(repoDir, target, env);
    env = cross.env;
    triple = cross.triple;
  }
  run('cargo', ['--version'], { env });
  if (target.platform === 'win' && formatsFor('win', options.distribution).includes('portable.exe')) {
    run('makensis', [process.platform === 'win32' ? '/VERSION' : '-VERSION'], { env });
  }
  const { resources } = await prepareTauri(repoDir, {
    platform: { mac: 'darwin', win: 'win32', linux: 'linux' }[target.platform], arch: target.arch,
  });
  const output = outputDirectory(repoDir, target);
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const cargoDir = path.join(repoDir, '.tauri', 'cargo', `${target.platform}-${target.arch}`);
  const releaseDir = path.join(cargoDir, triple, 'release');
  const bundleDir = path.join(releaseDir, 'bundle');
  fs.rmSync(bundleDir, { recursive: true, force: true });
  const config = {
    version: pkg.version,
    productName: `${pkg.productName} Compact`,
    mainBinaryName: `${pkg.build.executableName}${target.platform === 'linux' ? '-compact' : ''}`,
    bundle: { publisher: 'Esri' },
  };
  if (target.platform === 'win' && env.VELOCITY_SIGN_SCRIPT) {
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
    ...(triple ? ['--runner', 'cargo-xwin', '--target', triple] : []),
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
    copyPortableResources(resources, folder);
    const executable = `${pkg.build.executableName}.exe`;
    fs.copyFileSync(path.join(releaseDir, executable), path.join(folder, executable));
    assertWindowsBinary(path.join(folder, executable), target.arch);
    if (env.VELOCITY_SIGN_SCRIPT) {
      run(process.execPath, [path.join(repoDir, 'scripts', 'tauri-sign.js'), path.join(folder, executable)], { env });
    }
    if (formats.includes('zip')) {
      const destination = path.join(output, artifactName(pkg, target, 'zip'));
      if (process.platform === 'darwin') {
        run('ditto', ['-c', '-k', '--norsrc', folder, destination], { env });
      } else {
        run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          'Compress-Archive -Path (Join-Path $env:VELOCITY_PACKAGE_SOURCE "*") -DestinationPath $env:VELOCITY_PACKAGE_DESTINATION -Force'],
        { env: { ...env, VELOCITY_PACKAGE_SOURCE: folder, VELOCITY_PACKAGE_DESTINATION: destination } });
      }
    }
    if (formats.includes('portable.exe')) {
      const destination = path.join(output, artifactName(pkg, target, 'portable.exe'));
      const script = path.join(repoDir, '.tauri', 'portable.nsi');
      fs.writeFileSync(script, portableScript(folder, destination, executable, {
        productName: `${pkg.productName} Compact`, version: pkg.version,
        icon: path.join(repoDir, 'src', 'assets', 'installerIcon.ico'),
      }));
      run('makensis', [process.platform === 'win32' ? '/V2' : '-V2', script], { env });
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
    if (target.platform === 'linux' && options['linux-container']) {
      const { buildLinuxContainer } = require('./build-linux-container');
      await buildLinuxContainer(repoDir, { runtime: target.runtime, arch: target.arch, distribution: options.distribution });
    } else if (target.runtime === 'tauri') {
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
