#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const EDITIONS = { electron: 'standalone', tauri: 'compact' };
const FORMATS = {
  mac: { portable: ['zip'], installer: ['dmg'] },
  win: { portable: ['portable.exe', 'zip'], installer: ['setup.exe'] },
  linux: { portable: ['AppImage'], installer: ['deb'] },
};

function validateTarget({ runtime, platform, arch }) {
  if (!['electron', 'tauri'].includes(runtime)) throw new Error(`Unknown runtime: ${runtime}`);
  if (!Object.hasOwn(FORMATS, platform)) throw new Error(`Unknown platform: ${platform}`);
  if (!['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported architecture: ${arch}; select x64 or arm64`);
}

function formatsFor(platform, distribution = 'both') {
  if (!Object.hasOwn(FORMATS, platform)) throw new Error(`Unknown platform: ${platform}`);
  if (distribution === 'both') return [...FORMATS[platform].installer, ...FORMATS[platform].portable];
  if (!Object.hasOwn(FORMATS[platform], distribution)) throw new Error(`Unknown distribution: ${distribution}`);
  return FORMATS[platform][distribution].slice();
}

function artifactName(pkg, target, format) {
  validateTarget(target);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(pkg.name) || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(pkg.version)) {
    throw new Error('Invalid application name or version');
  }
  if (!formatsFor(target.platform).includes(format) && format !== 'manifest.json') {
    throw new Error(`Unsupported ${target.platform} format: ${format}`);
  }
  const suffix = ['setup.exe', 'portable.exe', 'manifest.json'].includes(format) ? `-${format}` : `.${format}`;
  return `${pkg.name}-${pkg.version}-${EDITIONS[target.runtime]}-${target.platform}-${target.arch}${suffix}`;
}

function outputDirectory(repoDir, target) {
  validateTarget(target);
  return path.join(repoDir, 'dist', target.runtime, `${target.platform}-${target.arch}`);
}

function fileDigest(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size === 0) throw new Error(`Missing or empty regular artifact: ${file}`);
  return { size: stat.size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
}

function writeManifest(repoDir, target, formats) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
  const output = outputDirectory(repoDir, target);
  const artifacts = formats.map((format) => {
    const name = artifactName(pkg, target, format);
    return { name, format, ...fileDigest(path.join(output, name)) };
  });
  const manifest = {
    schemaVersion: 1,
    application: pkg.name,
    version: pkg.version,
    ...target,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repoDir, encoding: 'utf8' }).trim()),
    artifacts,
  };
  const destination = path.join(output, artifactName(pkg, target, 'manifest.json'));
  fs.writeFileSync(`${destination}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(`${destination}.tmp`, destination);
  return destination;
}

function validateManifest(file, pkg) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  validateTarget(manifest);
  if (manifest.schemaVersion !== 1 || manifest.application !== pkg.name || manifest.version !== pkg.version) {
    throw new Error(`Manifest does not describe ${pkg.name} ${pkg.version}: ${file}`);
  }
  if (path.basename(file) !== artifactName(pkg, manifest, 'manifest.json')) {
    throw new Error(`Unexpected manifest filename: ${file}`);
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new Error(`Manifest contains no artifacts: ${file}`);
  }
  const formats = new Set();
  const files = manifest.artifacts.map((artifact) => {
    if (artifact.name !== artifactName(pkg, manifest, artifact.format) || formats.has(artifact.format)) {
      throw new Error(`Invalid or duplicate artifact in ${file}`);
    }
    formats.add(artifact.format);
    const artifactPath = path.join(path.dirname(file), artifact.name);
    const actual = fileDigest(artifactPath);
    if (actual.size !== artifact.size || actual.sha256 !== artifact.sha256) {
      throw new Error(`Artifact changed after packaging: ${artifactPath}`);
    }
    return artifactPath;
  });
  return { manifest, files: [...files, file], formats };
}

function collectReleaseArtifacts(repoDir, { runtime = 'electron', platform = 'all', arch, distribution = 'both' } = {}) {
  if (!['electron', 'tauri', 'both'].includes(runtime)) throw new Error(`Unknown runtime: ${runtime}`);
  if (platform !== 'all' && !Object.hasOwn(FORMATS, platform)) throw new Error(`Unknown platform: ${platform}`);
  if (arch && !['x64', 'arm64'].includes(arch)) throw new Error(`Unknown architecture: ${arch}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
  const runtimes = runtime === 'both' ? ['electron', 'tauri'] : [runtime];
  const platforms = platform === 'all' ? Object.keys(FORMATS) : [platform];
  const results = [];
  for (const selectedRuntime of runtimes) {
    for (const selectedPlatform of platforms) {
      let found = false;
      for (const selectedArch of arch ? [arch] : ['x64', 'arm64']) {
        const target = { runtime: selectedRuntime, platform: selectedPlatform, arch: selectedArch };
        const directory = outputDirectory(repoDir, target);
        const file = path.join(directory, artifactName(pkg, target, 'manifest.json'));
        if (!fs.existsSync(file)) continue;
        const validated = validateManifest(file, pkg);
        if (validated.manifest.runtime !== selectedRuntime || validated.manifest.platform !== selectedPlatform
          || validated.manifest.arch !== selectedArch) throw new Error(`Manifest target mismatch: ${file}`);
        const expected = formatsFor(selectedPlatform, distribution);
        if (expected.some((format) => !validated.formats.has(format))) {
          throw new Error(`Incomplete ${selectedRuntime}/${selectedPlatform}/${selectedArch} build; expected ${expected.join(', ')}`);
        }
        results.push(...validated.files.filter((candidate) => candidate === file
          || expected.some((format) => path.basename(candidate) === artifactName(pkg, target, format))));
        found = true;
      }
      if (!found) throw new Error(`No current-version manifest for ${selectedRuntime}/${selectedPlatform}${arch ? `/${arch}` : ''}`);
    }
  }
  return results;
}

if (require.main === module) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i].replace(/^--/, '');
      if (!['runtime', 'platform', 'arch', 'distribution'].includes(key) || !process.argv[i + 1]) {
        throw new Error('Usage: node scripts/release-artifacts.js [--runtime electron|tauri|both] [--platform mac|win|linux|all] [--arch x64|arm64] [--distribution portable|installer|both]');
      }
      options[key] = process.argv[i + 1];
    }
    console.log(collectReleaseArtifacts(path.join(__dirname, '..'), options).join('\n'));
  } catch (error) {
    console.error(`[Release] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { EDITIONS, artifactName, collectReleaseArtifacts, fileDigest, formatsFor, outputDirectory, validateManifest, validateTarget, writeManifest };
