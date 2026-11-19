#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const externalSign = require('./external-sign');
const { isUsableSignScript } = require('./sign-options');

async function main() {
  const batch = process.argv[2] === '--batch';
  const files = process.argv.slice(batch ? 3 : 2);
  if ((!batch && files.length !== 1) || (batch && files.length < 2)
    || files.some(file => !file || !/\.(exe|msi|dll)$/i.test(file)
      || !fs.lstatSync(file).isFile())) {
    throw new Error(batch
      ? 'Expected at least two existing regular Windows executables, DLLs, or installers for --batch'
      : 'Expected exactly one existing Windows executable, DLL, or installer to sign');
  }
  const artifactPaths = files.map(file => path.resolve(file));
  if (batch) {
    const directories = new Set(artifactPaths.map(file => path.dirname(file)));
    const names = artifactPaths.map(file => path.basename(file));
    const stagedNames = names.map(name => name.toLowerCase().replace(/ /g, '-'));
    if (directories.size !== 1 || new Set(stagedNames).size !== names.length
      || names.some(name => !/^[A-Za-z0-9_. -]+$/.test(name))) {
      throw new Error('Signing batches require one directory and distinct, case-insensitive, exact-mask-safe filenames');
    }
    const directory = path.dirname(artifactPaths[0]);
    const entries = fs.readdirSync(directory);
    if (!fs.lstatSync(directory).isDirectory()
      || entries.some(name => !fs.lstatSync(path.join(directory, name)).isFile())) {
      throw new Error('Signing batches require a flat regular-file directory without links or nested directories');
    }
    const matchingEntries = entries
      .filter(name => names.some(selected => selected.toLowerCase() === name.toLowerCase()));
    if (matchingEntries.length !== names.length || matchingEntries.some(name => !names.includes(name))) {
      throw new Error('Signing batch directory contains ambiguous filename matches');
    }
  }
  if (!isUsableSignScript(process.env.VELOCITY_SIGN_SCRIPT)) throw new Error('A readable VELOCITY_SIGN_SCRIPT is required');
  await externalSign({ artifactPaths });
}

main().catch((error) => { console.error(`[Signing] ${error.message}`); process.exitCode = 1; });
