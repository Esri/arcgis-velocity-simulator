'use strict';
/**
 * binutils-path.js
 *
 * Locates Homebrew's GNU binutils on macOS and returns a PATH string with
 * its bin directory prepended. This lets electron-builder find GNU `ar`
 * (required for valid .deb output) without forcing the developer to edit
 * their shell PATH manually.
 *
 * Usage:
 *   const { ensureGnuArPath } = require('./binutils-path');
 *   const env = { ...process.env, PATH: ensureGnuArPath(process.env.PATH) };
 *
 * On non-macOS hosts (or if binutils isn't installed) this returns the
 * input PATH unchanged.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

let cachedBinDir = null; // null = not yet probed; '' = probed, none found

function findBinutilsBinDir() {
  if (cachedBinDir !== null) return cachedBinDir;
  cachedBinDir = '';
  if (os.platform() !== 'darwin') return cachedBinDir;

  // Try common Homebrew locations first (fast path, no shell-out).
  const guesses = [
    '/opt/homebrew/opt/binutils/bin', // Apple Silicon
    '/usr/local/opt/binutils/bin',    // Intel
  ];
  for (const dir of guesses) {
    if (fs.existsSync(`${dir}/ar`)) { cachedBinDir = dir; return cachedBinDir; }
  }

  // Fallback: ask brew directly (slower, but handles non-default prefixes).
  try {
    const prefix = execSync('brew --prefix binutils 2>/dev/null', {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (prefix && fs.existsSync(`${prefix}/bin/ar`)) {
      cachedBinDir = `${prefix}/bin`;
    }
  } catch { /* brew not installed or binutils not present */ }

  return cachedBinDir;
}

function ensureGnuArPath(currentPath) {
  const dir = findBinutilsBinDir();
  if (!dir) return currentPath || '';
  const sep = os.platform() === 'win32' ? ';' : ':';
  const segments = (currentPath || '').split(sep);
  if (segments[0] === dir) return currentPath; // already prepended
  return `${dir}${sep}${currentPath || ''}`;
}

module.exports = { findBinutilsBinDir, ensureGnuArPath };

