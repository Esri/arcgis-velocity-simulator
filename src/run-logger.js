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

const fs = require('fs');
const path = require('path');

const LOG_LEVEL_PRIORITY = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

class RunLogger {
  constructor({ logLevel = 'info', stdout = true, logFile = null, runId = null } = {}) {
    this.logLevel = LOG_LEVEL_PRIORITY[logLevel] !== undefined ? logLevel : 'info';
    this.stdout = stdout !== false;
    this.logFile = logFile ? path.resolve(logFile) : null;
    this.runId = runId || null;

    if (this.logFile) {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
    }
  }

  shouldLog(level) {
    return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[this.logLevel];
  }

  format(level, message) {
    const timestamp = new Date().toISOString();
    const parts = [timestamp, level.toUpperCase()];

    if (this.runId) {
      parts.push(this.runId);
    }

    parts.push(message);
    return `[${parts.join('] [')}]`;
  }

  write(level, message) {
    if (!this.shouldLog(level)) {
      return;
    }

    const line = this.format(level, message);
    if (this.stdout) {
      const stream = level === 'error' ? process.stderr : process.stdout;
      stream.write(`${line}\n`);
    }

    if (this.logFile) {
      fs.appendFileSync(this.logFile, `${line}\n`, 'utf8');
    }
  }

  error(message) {
    this.write('error', message);
  }

  warn(message) {
    this.write('warn', message);
  }

  info(message) {
    this.write('info', message);
  }

  debug(message) {
    this.write('debug', message);
  }
}

module.exports = {
  RunLogger,
};

