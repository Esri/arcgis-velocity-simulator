'use strict';

const fs = require('fs');
const path = require('path');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getBuildIdentity(repoDir = path.join(__dirname, '..')) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
  return {
    packageName: pkg.name,
    version: pkg.version,
  };
}

function getBuildTargets(args) {
  const values = Array.isArray(args) ? args : [];
  return new Set([
    values.some((arg) => arg === '--mac' || arg.startsWith('--mac=')) && 'mac',
    values.some((arg) => arg === '--win' || arg.startsWith('--win=') || arg.startsWith('--config.win')) && 'win',
    values.some((arg) => arg === '--linux' || arg.startsWith('--linux=')) && 'linux',
  ].filter(Boolean));
}

function isTargetArtifact(name, packageName, targets) {
  const prefix = escapeRegExp(packageName);
  if (targets.has('mac') && new RegExp(`^${prefix}-.+-mac\\.`).test(name)) return true;
  if (targets.has('win') && new RegExp(`^${prefix}-.+-(win|setup|portable)\\.`).test(name)) return true;
  if (targets.has('linux') && new RegExp(`^${prefix}-.+-linux\\.`).test(name)) return true;
  if (targets.has('mac') && name === 'latest-mac.yml') return true;
  if (targets.has('win') && name === 'latest.yml') return true;
  if (targets.has('linux') && /^latest-linux(?:-[^.]+)?\.yml$/.test(name)) return true;
  return false;
}

function cleanTargetArtifacts(repoDir, args, log = console.log) {
  const distDir = path.join(repoDir, 'dist');
  if (!fs.existsSync(distDir)) return [];

  const identity = getBuildIdentity(repoDir);
  const targets = getBuildTargets(args);
  const removed = fs.readdirSync(distDir)
    .filter((name) => isTargetArtifact(name, identity.packageName, targets));

  for (const name of removed) {
    fs.rmSync(path.join(distDir, name), { recursive: true, force: true });
  }
  if (removed.length > 0) {
    log(`   Removed ${removed.length} stale/current ${[...targets].join('/')} artifact(s) before packaging.`);
  }
  return removed;
}

function assertCurrentVersionArtifacts(artifactPaths, repoDir = path.join(__dirname, '..')) {
  const identity = getBuildIdentity(repoDir);
  const prefix = `${identity.packageName}-`;
  const expectedPrefix = `${prefix}${identity.version}-`;
  const stale = artifactPaths
    .map((artifactPath) => path.basename(artifactPath))
    .filter((name) => name.startsWith(prefix) && !name.startsWith(expectedPrefix));
  if (stale.length > 0) {
    throw new Error(
      `Refusing stale-version artifacts; expected ${identity.version}: ${stale.join(', ')}`
    );
  }
}

module.exports = {
  assertCurrentVersionArtifacts,
  cleanTargetArtifacts,
  getBuildIdentity,
  getBuildTargets,
  isTargetArtifact,
};
