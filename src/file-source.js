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
const readline = require('readline');

async function loadLinesFromFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('A valid file path is required.');
  }

  await fs.promises.access(filePath, fs.constants.R_OK);

  const lines = [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  return new Promise((resolve, reject) => {
    rl.on('line', (line) => {
      if (line.trim() !== '') {
        lines.push(line);
      }
    });

    rl.on('close', () => {
      resolve(lines);
    });

    rl.on('error', (error) => {
      reject(error);
    });

    stream.on('error', (error) => {
      reject(error);
    });
  });
}

module.exports = {
  loadLinesFromFile,
};

