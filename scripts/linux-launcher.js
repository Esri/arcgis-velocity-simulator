'use strict';

const fs = require('fs');
const path = require('path');
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');

function launcherScript(executable) {
  if (!/^[A-Za-z0-9_-]+$/.test(executable)) throw new Error('Unsupported Linux executable name');
  return `#!/bin/sh
set -eu
SELF=$(readlink -f -- "$0")
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$SELF")" && pwd)
exec env ELECTRON_RUN_AS_NODE=1 "$APP_DIR/${executable}.bin" "$APP_DIR/resources/app.asar/src/linux-launcher.js" "$@"
`;
}

async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const executable = context.packager.executableName;
  const file = path.join(context.appOutDir, executable);
  const native = file + '.bin';
  if (fs.existsSync(native)) throw new Error('Linux launcher already installed; refuse to overwrite native executable');
  const wire = await getCurrentFuseWire(file);
  if (wire[FuseV1Options.RunAsNode] !== 49) throw new Error('Linux headless launcher requires the existing Electron RunAsNode fuse');
  const script = launcherScript(executable);
  fs.renameSync(file, native);
  fs.writeFileSync(file, script, { mode: 0o755 });
}

module.exports = afterPack;
module.exports.launcherScript = launcherScript;
