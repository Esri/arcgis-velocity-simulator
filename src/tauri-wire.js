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

const MAX_FRAME = 16 * 1024 * 1024;
const CHUNK_BYTES = 768 * 1024;

function* encodeFrames(message) {
  const json = JSON.stringify(message);
  if (Buffer.byteLength(json) + 1 <= MAX_FRAME) {
    yield json + '\n';
    return;
  }
  const bytes = Buffer.from(json);
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    yield JSON.stringify({
      type: 'chunk',
      data: bytes.subarray(offset, offset + CHUNK_BYTES).toString('base64'),
      last: offset + CHUNK_BYTES >= bytes.length,
    }) + '\n';
  }
}

module.exports = { encodeFrames, MAX_FRAME };
