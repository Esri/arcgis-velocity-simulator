#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  SIGN_ARGS_ENV,
  SIGN_SCRIPT_ENV,
  SIGN_SHARE_DIR_ENV,
  resolveSignScriptPath,
} = require('./sign-options');

const DEFAULT_FILE_MASK = '*.exe;*.msi;*.msp';
const SIGNABLE_ARTIFACT_RE = /\.(exe|msi|msp)$/i;

function log(message) {
  console.log(`[external-sign] ${message}`);
}

function warn(message) {
  console.warn(`[external-sign] Warning: ${message}`);
}

function parseExtraArgs(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch (_) {
    // Fall through to whitespace parsing for hand-authored env vars.
  }
  return String(raw).trim().split(/\s+/).filter(Boolean);
}

function getOfficialProductName(context) {
  const fromConfig = context && context.packager && context.packager.appInfo && context.packager.appInfo.productName;
  if (fromConfig) return fromConfig;

  const pkgPath = path.join(__dirname, '..', 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.productName || pkg.description || pkg.name || 'ArcGIS Velocity';
  } catch (_) {
    return 'ArcGIS Velocity';
  }
}

function getSignScriptStatus(rawScriptPath) {
  const requestedPath = rawScriptPath || '';
  const resolvedPath = resolveSignScriptPath(requestedPath, path.join(__dirname, '..'));
  if (!requestedPath) {
    return { ok: false, requestedPath, resolvedPath, reason: 'no external sign script path was provided' };
  }

  if (!fs.existsSync(resolvedPath)) {
    return { ok: false, requestedPath, resolvedPath, reason: 'file does not exist' };
  }

  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    return { ok: false, requestedPath, resolvedPath, reason: 'path exists but is not a file' };
  }

  try {
    fs.accessSync(resolvedPath, fs.constants.R_OK);
  } catch (_) {
    return { ok: false, requestedPath, resolvedPath, reason: 'file is not readable, so bash cannot run it' };
  }

  return { ok: true, requestedPath, resolvedPath, reason: 'found readable script file' };
}

function logSignScriptStatus(status) {
  if (status.ok) {
    const suffix = status.requestedPath && status.requestedPath !== status.resolvedPath
      ? ` (resolved from ${status.requestedPath})`
      : '';
    log(`Using external sign script: ${status.resolvedPath}${suffix}`);
    return;
  }

  const resolved = status.resolvedPath ? ` Resolved path: ${status.resolvedPath}.` : '';
  warn(`External sign script cannot be used: ${status.reason}.${resolved} Falling back to the current electron-builder signing/unsigned behavior.`);
}

function unique(values) {
  return [...new Set(values)];
}

function escapeMaskName(name) {
  return name.replace(/[;:]/g, '');
}

function buildSignCommand({ scriptPath, sourceDirs, productName, shareDir, fileMask, extraArgs, mode = '--run' }) {
  const args = [scriptPath, mode, '--source-dirs', sourceDirs.join(':'), '--product-names', productName];
  if (shareDir) args.push('--share-dir', shareDir);
  if (fileMask) args.push('--file-mask', fileMask);
  args.push(...extraArgs);
  return { command: 'bash', args };
}

function runExternalSign({ scriptPath, sourceDirs, productName, shareDir, fileMask, extraArgs, phase, mode = '--run' }) {
  if (!sourceDirs || sourceDirs.length === 0) {
    log(`Skipping ${phase}; no source directories to sign.`);
    return;
  }

  const missingDirs = sourceDirs.filter((dir) => !fs.existsSync(dir) || !fs.statSync(dir).isDirectory());
  if (missingDirs.length > 0) {
    warn(`Skipping ${phase}; source directory not found: ${missingDirs.join(', ')}`);
    return;
  }

  const { command, args } = buildSignCommand({ scriptPath, sourceDirs, productName, shareDir, fileMask, extraArgs, mode });
  log(`Signing ${phase} with product "${productName}"`);
  log(`Source: ${sourceDirs.join(':')}`);
  if (shareDir) log(`Share: ${shareDir}`);
  if (fileMask) log(`Mask: ${fileMask}`);

  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`External signing failed for ${phase} with exit code ${result.status || 1}`);
  }
}

function getArtifactSigningPlan(context) {
  const artifactPaths = Array.isArray(context.artifactPaths) ? context.artifactPaths : [];
  const signableArtifacts = artifactPaths.filter((artifactPath) => SIGNABLE_ARTIFACT_RE.test(artifactPath));
  if (signableArtifacts.length === 0) return null;

  const sourceDirs = unique(signableArtifacts.map((artifactPath) => path.dirname(artifactPath)));
  const fileMask = unique(signableArtifacts.map((artifactPath) => escapeMaskName(path.basename(artifactPath)))).join(';') || DEFAULT_FILE_MASK;
  return { sourceDirs, fileMask };
}

function getExistingArtifactSigningPlan(distDir) {
  if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) return null;
  const signableArtifacts = fs.readdirSync(distDir)
    .filter((name) => SIGNABLE_ARTIFACT_RE.test(name))
    .map((name) => path.join(distDir, name));
  return getArtifactSigningPlan({ artifactPaths: signableArtifacts });
}

function hasSignableFile(sourceDir, fileMask) {
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) return false;
  const patterns = String(fileMask || DEFAULT_FILE_MASK).split(';').filter(Boolean);
  const names = fs.readdirSync(sourceDir);
  return names.some((name) => patterns.some((pattern) => {
    if (pattern === '*.exe') return /\.exe$/i.test(name);
    if (pattern === '*.msi') return /\.msi$/i.test(name);
    if (pattern === '*.msp') return /\.msp$/i.test(name);
    return name === pattern;
  }));
}

function runCliDryRunPreview() {
  const status = getSignScriptStatus(process.env[SIGN_SCRIPT_ENV] || '');
  if (!status.requestedPath) return;

  logSignScriptStatus(status);
  if (!status.ok) {
    return;
  }

  const repoDir = path.join(__dirname, '..');
  const distDir = path.join(repoDir, 'dist');
  const productName = getOfficialProductName({});
  const shareDir = process.env[SIGN_SHARE_DIR_ENV] || '';
  const extraArgs = parseExtraArgs(process.env[SIGN_ARGS_ENV]);
  let invoked = false;

  const unpackedDir = path.join(distDir, 'win-unpacked');
  if (hasSignableFile(unpackedDir, DEFAULT_FILE_MASK)) {
    runExternalSign({
      scriptPath: status.resolvedPath,
      sourceDirs: [unpackedDir],
      productName,
      shareDir,
      fileMask: DEFAULT_FILE_MASK,
      extraArgs,
      phase: 'Windows unpacked app dry-run',
      mode: '--dry-run',
    });
    invoked = true;
  } else {
    log(`Skipping Windows unpacked app dry-run; no matching files found in ${unpackedDir}.`);
  }

  const artifactPlan = getExistingArtifactSigningPlan(distDir);
  if (artifactPlan) {
    runExternalSign({
      scriptPath: status.resolvedPath,
      sourceDirs: artifactPlan.sourceDirs,
      productName,
      shareDir,
      fileMask: artifactPlan.fileMask,
      extraArgs,
      phase: 'Windows final artifacts dry-run',
      mode: '--dry-run',
    });
    invoked = true;
  } else {
    log(`Skipping Windows final artifacts dry-run; no signable final artifacts found in ${distDir}.`);
  }

  if (!invoked) {
    warn('External signing dry-run was requested, but no existing signable Windows files were found in dist/. Build hooks will run the signing script after Windows artifacts are produced.');
  }
}

async function externalSign(context) {
  const rawScriptPath = process.env[SIGN_SCRIPT_ENV] || '';
  if (!rawScriptPath) return;

  if (context && context.appOutDir && context.electronPlatformName && context.electronPlatformName !== 'win32') return;
  if (!(context && context.appOutDir) && !getArtifactSigningPlan(context || {})) return;

  const status = getSignScriptStatus(rawScriptPath);
  logSignScriptStatus(status);
  if (!status.ok) {
    return;
  }

  const productName = getOfficialProductName(context);
  const shareDir = process.env[SIGN_SHARE_DIR_ENV] || '';
  const extraArgs = parseExtraArgs(process.env[SIGN_ARGS_ENV]);

  if (context && context.appOutDir) {
    runExternalSign({
      scriptPath: status.resolvedPath,
      sourceDirs: [context.appOutDir],
      productName,
      shareDir,
      fileMask: DEFAULT_FILE_MASK,
      extraArgs,
      phase: 'Windows unpacked app',
    });
    return;
  }

  const artifactPlan = getArtifactSigningPlan(context || {});
  if (!artifactPlan) return;
  runExternalSign({
    scriptPath: status.resolvedPath,
    sourceDirs: artifactPlan.sourceDirs,
    productName,
    shareDir,
    fileMask: artifactPlan.fileMask,
    extraArgs,
    phase: 'Windows final artifacts',
  });
}

module.exports = externalSign;
module.exports._private = {
  buildSignCommand,
  getSignScriptStatus,
  getExistingArtifactSigningPlan,
  getArtifactSigningPlan,
  getOfficialProductName,
  hasSignableFile,
  parseExtraArgs,
};

if (require.main === module) {
  if (process.argv.includes('--dry-run-preview')) {
    runCliDryRunPreview();
  }
}

