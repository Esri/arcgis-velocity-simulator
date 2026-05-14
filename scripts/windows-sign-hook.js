#!/usr/bin/env node
'use strict';

const path = require('path');
const { log } = require('builder-util');

const SIGNABLE_RE = /\.(exe|msi|msp)$/i;

function getProjectDir(packager) {
  return (packager && packager.projectDir) || path.join(__dirname, '..');
}

function getExternalSignSourceDirs(projectDir) {
  const distDir = path.resolve(projectDir, 'dist');
  return [
    distDir,
    path.join(distDir, 'win-unpacked'),
  ];
}

function isDirectExternalSignableFile(filePath, projectDir) {
  if (!SIGNABLE_RE.test(String(filePath || ''))) return false;

  const resolvedFile = path.resolve(filePath);
  const parentDir = path.dirname(resolvedFile);
  return getExternalSignSourceDirs(projectDir).some((sourceDir) => parentDir === sourceDir);
}

async function runDefaultWindowsSign(configuration, packager) {
  const signingManager = await packager.signingManager.value;
  if (typeof signingManager.doSign !== 'function') {
    throw new Error('Default electron-builder Windows signing implementation is not available for delegation');
  }
  return signingManager.doSign(configuration, packager);
}

async function sign(configuration, packager) {
  const projectDir = getProjectDir(packager);
  if (isDirectExternalSignableFile(configuration.path, projectDir)) {
    log.info({ file: log.filePath(configuration.path) }, 'file signing skipped; external signer handles direct source file');
    return;
  }

  if (!configuration.cscInfo) {
    log.debug({ file: log.filePath(configuration.path) }, 'no electron-builder Windows signing info identified; signing is skipped');
    return;
  }

  await runDefaultWindowsSign(configuration, packager);
}

module.exports = sign;
module.exports.sign = sign;
module.exports._private = {};
module.exports._private.getExternalSignSourceDirs = getExternalSignSourceDirs;
module.exports._private.isDirectExternalSignableFile = isDirectExternalSignableFile;
