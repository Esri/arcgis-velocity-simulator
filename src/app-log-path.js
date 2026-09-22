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

'use strict';

const path = require('path');

function formatLogTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
}

function resolveDefaultLogDirectory({
  appSlug,
  isPackaged,
  platform = process.platform,
  cwd = process.cwd(),
  homePath,
  userDataPath,
}) {
  if (!isPackaged) {
    return path.resolve(cwd, 'logs');
  }
  if (platform === 'darwin') {
    return path.join(homePath, 'Library', 'Logs', appSlug);
  }
  return path.join(userDataPath, 'logs');
}

function resolveAppLogFile({
  explicitLogFile,
  appSlug,
  filePrefix,
  isPackaged,
  platform = process.platform,
  cwd = process.cwd(),
  homePath,
  userDataPath,
  date = new Date(),
}) {
  if (explicitLogFile) {
    return explicitLogFile;
  }
  const logDir = resolveDefaultLogDirectory({
    appSlug,
    isPackaged,
    platform,
    cwd,
    homePath,
    userDataPath,
  });
  return path.join(logDir, `${filePrefix}-${formatLogTimestamp(date)}.log`);
}

module.exports = {
  formatLogTimestamp,
  resolveAppLogFile,
  resolveDefaultLogDirectory,
};
