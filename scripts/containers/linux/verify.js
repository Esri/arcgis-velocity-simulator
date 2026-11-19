'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function command(executable, args, options = {}, expected = 0) {
  const result = spawnSync(executable, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    timeout: 120000, ...options });
  if (result.error) throw result.error;
  if (result.status !== expected) {
    throw new Error(`${path.basename(executable)} exited ${result.status}, expected ${expected}: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function checkElf(file, arch) {
  const descriptor = fs.openSync(file, 'r');
  const header = Buffer.alloc(20);
  try { fs.readSync(descriptor, header, 0, header.length, 0); }
  finally { fs.closeSync(descriptor); }
  if (!header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
      || header[4] !== 2 || header[5] !== 1 || header.readUInt16LE(18) !== (arch === 'arm64' ? 183 : 62)) {
    throw new Error(`Executable does not match Linux ${arch}: ${file}`);
  }
}

function verifyArtifacts(pkg, files, arch, debDependencies = []) {
  const results = [];
  for (const artifact of files.filter(file => /\.(deb|AppImage)$/.test(file))) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-package-check-'));
    try {
      const env = { ...process.env, HOME: temporary, XDG_CONFIG_HOME: temporary,
        XDG_CACHE_HOME: path.join(temporary, 'cache'), APPIMAGE_EXTRACT_AND_RUN: '1' };
      delete env.DISPLAY;
      delete env.WAYLAND_DISPLAY;
      let executable;
      let extracted;
      const format = artifact.endsWith('.deb') ? 'deb' : 'AppImage';
      if (format === 'deb') {
        const architecture = command('dpkg-deb', ['--field', artifact, 'Architecture']).trim();
        if (architecture !== (arch === 'x64' ? 'amd64' : 'arm64')) throw new Error('DEB architecture mismatch');
        const dependencies = command('dpkg-deb', ['--field', artifact, 'Depends']).trim().split(/,\s*/);
        for (const dependency of debDependencies) {
          if (!dependencies.includes(dependency)) throw new Error(`DEB runtime dependency missing: ${dependency}`);
        }
        extracted = path.join(temporary, 'deb');
        command('dpkg-deb', ['--extract', artifact, extracted]);
        executable = path.join(extracted, 'usr/bin', `${pkg.build.executableName}-compact`);
      } else {
        executable = path.join(temporary, 'application.AppImage');
        fs.copyFileSync(artifact, executable);
        fs.chmodSync(executable, 0o755);
        command(executable, ['--appimage-extract'], { cwd: temporary, env });
        extracted = path.join(temporary, 'squashfs-root');
      }
      checkElf(path.join(extracted, 'usr/bin', `${pkg.build.executableName}-compact`), arch);
      const help = command(executable, ['help=true', `logFile=${path.join(temporary, 'help.log')}`], { cwd: temporary, env });
      if (!/runMode/.test(help)) throw new Error(`Packaged ${format} did not return application help`);
      command(executable, ['definitelyInvalidOption=true', `logFile=${path.join(temporary, 'invalid.log')}`],
        { cwd: temporary, env }, 1);
      results.push({ format, arch, helpExitCode: 0, invalidArgumentExitCode: 1 });
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }
  return results;
}

module.exports = { checkElf, verifyArtifacts };
