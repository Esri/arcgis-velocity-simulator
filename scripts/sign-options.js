#!/usr/bin/env node
'use strict';

const os = require('os');
const path = require('path');

const SIGN_SCRIPT_ENV = 'VELOCITY_SIGN_SCRIPT';
const SIGN_SHARE_DIR_ENV = 'VELOCITY_SIGN_SHARE_DIR';
const SIGN_ARGS_ENV = 'VELOCITY_SIGN_ARGS';

function readValue(args, index, flag) {
  if (index + 1 >= args.length) {
    throw new Error(`${flag} requires a value`);
  }
  return args[index + 1];
}

function parseSignOptions(rawArgs) {
  const passthroughArgs = [];
  const signArgs = [];
  let signScript = '';
  let signShareDir = '';

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];

    if (arg === '--sign-script' || arg === '-x') {
      signScript = readValue(rawArgs, i, arg);
      i += 1;
    } else if (arg.startsWith('--sign-script=')) {
      signScript = arg.slice('--sign-script='.length);
    } else if (arg === '--sign-share-dir' || arg === '-d') {
      signShareDir = readValue(rawArgs, i, arg);
      i += 1;
    } else if (arg.startsWith('--sign-share-dir=')) {
      signShareDir = arg.slice('--sign-share-dir='.length);
    } else if (arg === '--sign-arg' || arg === '-a') {
      signArgs.push(readValue(rawArgs, i, arg));
      i += 1;
    } else if (arg.startsWith('--sign-arg=')) {
      signArgs.push(arg.slice('--sign-arg='.length));
    } else {
      passthroughArgs.push(arg);
    }
  }

  return { passthroughArgs, signScript: resolveSignScriptPath(signScript), signShareDir, signArgs };
}

function expandHome(input) {
  if (!input) return '';
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function resolveSignScriptPath(input, baseDir = process.cwd()) {
  if (!input) return '';
  const expanded = expandHome(String(input).trim());
  return path.resolve(baseDir, expanded);
}

function buildSignEnv(baseEnv, options) {
  const env = { ...baseEnv };

  if (options.signScript) {
    env[SIGN_SCRIPT_ENV] = options.signScript;
  } else {
    delete env[SIGN_SCRIPT_ENV];
  }

  if (options.signShareDir) {
    env[SIGN_SHARE_DIR_ENV] = options.signShareDir;
  } else {
    delete env[SIGN_SHARE_DIR_ENV];
  }

  if (options.signArgs && options.signArgs.length > 0) {
    env[SIGN_ARGS_ENV] = JSON.stringify(options.signArgs);
  } else {
    delete env[SIGN_ARGS_ENV];
  }

  return env;
}

function describeSignOptions(options) {
  if (!options.signScript) {
    return 'external Windows signing: disabled (no --sign-script/-x provided)';
  }

  const parts = [`external Windows signing: ${options.signScript}`];
  if (options.signShareDir) parts.push(`share: ${options.signShareDir}`);
  if (options.signArgs && options.signArgs.length > 0) {
    parts.push(`extra args: ${options.signArgs.join(' ')}`);
  }
  return parts.join(' | ');
}

module.exports = {
  SIGN_ARGS_ENV,
  SIGN_SCRIPT_ENV,
  SIGN_SHARE_DIR_ENV,
  buildSignEnv,
  describeSignOptions,
  parseSignOptions,
  resolveSignScriptPath,
};

