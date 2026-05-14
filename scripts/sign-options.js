#!/usr/bin/env node
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const SIGN_SCRIPT_ENV = 'VELOCITY_SIGN_SCRIPT';
const SIGN_SHARE_DIR_ENV = 'VELOCITY_SIGN_SHARE_DIR';
const SIGN_PRODUCT_NAMES_ENV = 'VELOCITY_SIGN_PRODUCT_NAMES';
const SIGN_TIMEOUT_MINUTES_ENV = 'VELOCITY_SIGN_TIMEOUT_MINUTES';
const DEFAULT_EXTERNAL_SIGN_TIMEOUT_MINUTES = 20;
const WINDOWS_SIGN_HOOK_PATH = './scripts/windows-sign-hook.js';
const EXTERNAL_WINDOWS_SIGNING_CONFIG_ARGS = [
  `--config.win.signtoolOptions.sign=${WINDOWS_SIGN_HOOK_PATH}`,
];

function readValue(args, index, flag) {
  if (index + 1 >= args.length) {
    throw new Error(`${flag} requires a value`);
  }
  return args[index + 1];
}

function parseSignOptions(rawArgs) {
  const passthroughArgs = [];
  let signScript = '';
  let signShareDir = '';
  let signProductNames = '';
  let signTimeoutMinutes = '';

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
    } else if (arg === '--sign-product-names') {
      signProductNames = readValue(rawArgs, i, arg);
      i += 1;
    } else if (arg.startsWith('--sign-product-names=')) {
      signProductNames = arg.slice('--sign-product-names='.length);
    } else if (arg === '--sign-timeout-minutes') {
      signTimeoutMinutes = readValue(rawArgs, i, arg);
      i += 1;
    } else if (arg.startsWith('--sign-timeout-minutes=')) {
      signTimeoutMinutes = arg.slice('--sign-timeout-minutes='.length);
    } else {
      passthroughArgs.push(arg);
    }
  }

  return {
    passthroughArgs,
    signScript: resolveSignScriptPath(signScript),
    signShareDir,
    signProductNames,
    signTimeoutMinutes: normalizeSignTimeoutMinutes(signTimeoutMinutes, ''),
  };
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

function normalizeSignTimeoutMinutes(value, fallback = String(DEFAULT_EXTERNAL_SIGN_TIMEOUT_MINUTES)) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim();
  if (!/^[1-9][0-9]*$/.test(normalized)) {
    throw new Error('--sign-timeout-minutes must be a positive whole number of minutes');
  }
  return normalized;
}

function getEffectiveSignOptions(baseEnv = {}, options = {}) {
  const signScript = options.signScript || baseEnv[SIGN_SCRIPT_ENV] || '';
  if (!signScript) {
    return { signScript: '', signShareDir: '', signProductNames: '', signTimeoutMinutes: String(DEFAULT_EXTERNAL_SIGN_TIMEOUT_MINUTES) };
  }

  return {
    signScript,
    signShareDir: options.signShareDir || baseEnv[SIGN_SHARE_DIR_ENV] || '',
    signProductNames: options.signProductNames || baseEnv[SIGN_PRODUCT_NAMES_ENV] || '',
    signTimeoutMinutes: normalizeSignTimeoutMinutes(options.signTimeoutMinutes || baseEnv[SIGN_TIMEOUT_MINUTES_ENV] || ''),
  };
}

function isUsableSignScript(scriptPath) {
  if (!scriptPath) return false;
  try {
    const resolvedPath = resolveSignScriptPath(scriptPath);
    const stat = fs.statSync(resolvedPath);
    fs.accessSync(resolvedPath, fs.constants.R_OK);
    return stat.isFile();
  } catch (_) {
    return false;
  }
}

function isWindowsSigningConfigOverride(arg) {
  return /^--config\.(?:(?:win\.)?(?:signExts|forceCodeSigning)|win\.signtoolOptions\.sign)(?:[.=]|$)/.test(String(arg || ''));
}

function removeWindowsSigningConfigOverrides(args) {
  const filtered = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (isWindowsSigningConfigOverride(arg)) {
      if (!String(arg).includes('=') && i + 1 < args.length) i += 1;
      continue;
    }
    filtered.push(arg);
  }
  return filtered;
}

function shouldDisableBuiltInWindowsSigning(baseEnv, options, settings = {}) {
  if (!settings.disableBuiltInWindowsSigning) return false;
  return isUsableSignScript(getEffectiveSignOptions(baseEnv, options).signScript);
}

function withExternalWindowsSigningConfigArgs(args, baseEnv, options, settings = {}) {
  if (!shouldDisableBuiltInWindowsSigning(baseEnv, options, settings)) return args.slice();
  return removeWindowsSigningConfigOverrides(args).concat(EXTERNAL_WINDOWS_SIGNING_CONFIG_ARGS);
}

function buildSignEnv(baseEnv, options) {
  const env = { ...baseEnv };
  const effective = getEffectiveSignOptions(baseEnv, options);

  if (effective.signScript) {
    env[SIGN_SCRIPT_ENV] = effective.signScript;
  } else {
    delete env[SIGN_SCRIPT_ENV];
  }

  if (effective.signScript && effective.signShareDir) {
    env[SIGN_SHARE_DIR_ENV] = effective.signShareDir;
  } else {
    delete env[SIGN_SHARE_DIR_ENV];
  }

  if (effective.signScript && effective.signProductNames) {
    env[SIGN_PRODUCT_NAMES_ENV] = effective.signProductNames;
  } else {
    delete env[SIGN_PRODUCT_NAMES_ENV];
  }

  if (effective.signScript) {
    env[SIGN_TIMEOUT_MINUTES_ENV] = effective.signTimeoutMinutes;
  } else {
    delete env[SIGN_TIMEOUT_MINUTES_ENV];
  }

  return env;
}

function describeSignOptions(options, baseEnv = process.env) {
  const effective = getEffectiveSignOptions(baseEnv, options);

  if (!effective.signScript) {
    return 'external Windows signing: disabled (no --sign-script/-x provided)';
  }

  const parts = [`external Windows signing: ${effective.signScript}`];
  parts.push(`sign timeout: ${effective.signTimeoutMinutes} minutes`);
  if (effective.signShareDir) parts.push(`share: ${effective.signShareDir}`);
  if (effective.signProductNames) parts.push(`product names: ${effective.signProductNames}`);
  if (isUsableSignScript(effective.signScript)) {
    parts.push('built-in Windows signing: skipped for direct external-sign source files');
  }
  return parts.join(' | ');
}

module.exports = {
  SIGN_PRODUCT_NAMES_ENV,
  SIGN_TIMEOUT_MINUTES_ENV,
  SIGN_SCRIPT_ENV,
  SIGN_SHARE_DIR_ENV,
  DEFAULT_EXTERNAL_SIGN_TIMEOUT_MINUTES,
  buildSignEnv,
  describeSignOptions,
  parseSignOptions,
  resolveSignScriptPath,
  withExternalWindowsSigningConfigArgs,
};

