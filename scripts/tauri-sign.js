#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const externalSign = require('./external-sign');
const { isUsableSignScript } = require('./sign-options');

async function main() {
  const file = process.argv[2];
  if (process.argv.length !== 3 || !file || !fs.statSync(file).isFile() || !/\.(exe|msi)$/i.test(file)) {
    throw new Error('Expected exactly one existing Windows executable or installer to sign');
  }
  if (!isUsableSignScript(process.env.VELOCITY_SIGN_SCRIPT)) throw new Error('A readable VELOCITY_SIGN_SCRIPT is required');
  await externalSign({ artifactPaths: [path.resolve(file)] });
}

main().catch((error) => { console.error(`[Signing] ${error.message}`); process.exitCode = 1; });
