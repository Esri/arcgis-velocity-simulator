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
const {
  DEFAULT_SOCKET_PAYLOAD_FORMAT,
  SOCKET_PAYLOAD_FORMAT_SET,
  assertTcpPayloadSize,
  assertUdpPayloadSize,
  convertDelimitedSource,
} = require('./payload-format-utils');

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

async function loadReplayPayloadsFromFile(filePath, options = {}) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('A valid file path is required.');
  }
  const protocol = options.protocol;
  if (protocol !== 'tcp' && protocol !== 'udp') return loadLinesFromFile(filePath);

  const format = options.format || DEFAULT_SOCKET_PAYLOAD_FORMAT;
  if (!SOCKET_PAYLOAD_FORMAT_SET.has(format)) {
    throw new Error(`Unsupported ${protocol.toUpperCase()} payload format: ${format}`);
  }
  const source = await fs.promises.readFile(filePath, 'utf8');
  const converted = convertDelimitedSource(source, format, {
    skipEmptyRecords: true,
    hasHeaderRow: options.hasHeaderRow === true,
    xField: options.xField || undefined,
    yField: options.yField || undefined,
    wkid: options.wkid === undefined ? 4326 : options.wkid,
  });
  converted.payloads.forEach(payload => {
    if (protocol === 'udp') assertUdpPayloadSize(payload);
    else assertTcpPayloadSize(payload);
  });
  return converted.payloads;
}

module.exports = {
  loadLinesFromFile,
  loadReplayPayloadsFromFile,
};
