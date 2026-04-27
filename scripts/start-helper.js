/**
 * Copyright 2026 Esri
 *
 * Licensed under the Apache License Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#!/usr/bin/env node
/**
 * start-helper.js
 *
 * Works around a Chromium bug on Windows where a command-line argument whose
 * value starts with a Windows drive-letter path (e.g. filename=C:\...) causes
 * Electron to crash at the native level when additional arguments follow it.
 *
 * Fix: on Windows, reorder arguments so that any Windows-path-valued args are
 * placed LAST - after all other user args.  On non-Windows platforms the args
 * are passed through unchanged.
 *
 * Usage: node scripts/start-helper.js [--electron:<flag>]... [app args...]
 *
 * Arguments prefixed with --electron: are stripped and forwarded to Electron
 * itself (before the "." app entry point), so npm scripts can pass flags like
 * --inspect=9229 cross-platform without VAR=value syntax.
 *
 * Examples:
 *   node scripts/start-helper.js --electron:--inspect=9229 filename=C:\data\f.csv
 *   node scripts/start-helper.js filename=C:\data\f.csv ip=host port=1234
 */
'use strict';
const { spawnSync } = require('child_process');
const os = require('os');

// require('electron') returns the direct path to electron.exe — more reliable
// on Windows than the .cmd shim under node_modules/.bin/
const electronBin = require('electron');

// Split argv into Electron-level flags (--electron:...) and app args
const electronFlags = [];
const userArgs = [];
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--electron:')) {
    electronFlags.push(arg.slice('--electron:'.length));
  } else {
    userArgs.push(arg);
  }
}

// On Windows, move args whose value is a Windows absolute path to the end.
// Chromium's native arg parser treats "key=C:\path" as a URL-like token and
// crashes if anything follows it in the argument list.
// Covers: drive-letter paths (C:\ or C:/), and UNC paths (\\server\share).
function orderArgsForWindows(args) {
  const isWinPathArg = (arg) => {
    const eqIdx = arg.indexOf('=');
    if (eqIdx < 1) return false;
    const value = arg.slice(eqIdx + 1);
    return /^[A-Za-z]:[\\\/]/.test(value) || /^\\\\/.test(value);
  };
  const pathArgs  = args.filter(isWinPathArg);
  const otherArgs = args.filter(a => !isWinPathArg(a));
  return [...otherArgs, ...pathArgs];
}

const orderedArgs = os.platform() === 'win32'
  ? orderArgsForWindows(userArgs)
  : userArgs;

const result = spawnSync(
  electronBin,
  [...electronFlags, '.', ...orderedArgs],
  { stdio: 'inherit', shell: false }
);

process.exit(result.status ?? (result.error ? 1 : 0));
