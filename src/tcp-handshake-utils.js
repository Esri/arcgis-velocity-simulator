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

const { DEFAULT_MAX_TCP_RECORD_BYTES } = require('./payload-format-utils');

function decodeTcpHandshake(text = '', { useEscapes = true } = {}) {
  if (typeof text !== 'string') throw new TypeError('TCP handshake text must be a string.');
  if (text.length > DEFAULT_MAX_TCP_RECORD_BYTES) throw new Error('TCP handshake text exceeds the 1,048,576-character input limit.');
  if (typeof useEscapes !== 'boolean') throw new TypeError('TCP handshake Use escapes must be true or false.');
  let decoded = '';
  const escapes = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '\\': '\\', '"': '"', "'": "'" };
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (!useEscapes || character !== '\\') {
      decoded += character;
    } else {
      const next = text[++i];
      if (next === undefined) throw new Error('TCP handshake contains an incomplete escape.');
      if (Object.hasOwn(escapes, next)) decoded += escapes[next];
      else if (next === 'u') {
        while (text[i + 1] === 'u') i++;
        const digits = text.slice(i + 1, i + 5);
        if (!/^[0-9a-f]{4}$/i.test(digits)) throw new Error('TCP handshake contains an invalid Unicode escape.');
        decoded += String.fromCharCode(Number.parseInt(digits, 16));
        i += 4;
      } else if (/[0-7]/.test(next)) {
        let digits = next;
        const maximum = /[0-3]/.test(next) ? 3 : 2;
        while (digits.length < maximum && /[0-7]/.test(text[i + 1] || '')) digits += text[++i];
        decoded += String.fromCharCode(Number.parseInt(digits, 8));
      } else throw new Error('TCP handshake contains an unsupported escape.');
    }
    if (decoded.length > DEFAULT_MAX_TCP_RECORD_BYTES) throw new Error('TCP handshake exceeds the 1 MiB UTF-8 limit.');
  }
  for (let i = 0; i < decoded.length; i++) {
    const code = decoded.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = decoded.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) throw new Error('TCP handshake contains an invalid Unicode sequence.');
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error('TCP handshake contains an invalid Unicode sequence.');
  }
  const bytes = Buffer.from(decoded, 'utf8');
  if (bytes.length > DEFAULT_MAX_TCP_RECORD_BYTES) throw new Error('TCP handshake exceeds the 1 MiB UTF-8 limit.');
  return bytes;
}

function writeTcpHandshake(socket, bytes, { signal, timeoutMs = 0 } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length > DEFAULT_MAX_TCP_RECORD_BYTES) {
    return Promise.reject(new Error('TCP handshake requires a validated buffer of at most 1 MiB.'));
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647) {
    return Promise.reject(new Error('TCP handshake write timeout must be between 0 and 2147483647 milliseconds.'));
  }
  if (bytes.length === 0) return Promise.resolve({ bytesWritten: 0 });
  return new Promise((resolve, reject) => {
    let settled = false;
    let callbackDone = false;
    let drainDone = false;
    let writeReturned = false;
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
      socket.removeListener('drain', onDrain);
      signal?.removeEventListener('abort', onAbort);
    };
    const fail = (cancelled = false, timedOut = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      const error = new Error(timedOut ? 'TCP handshake timed out before completion.'
        : cancelled ? 'TCP handshake cancelled before completion.' : 'TCP handshake could not be sent.');
      error.code = timedOut ? 'TCP_HANDSHAKE_TIMEOUT' : cancelled ? 'TCP_HANDSHAKE_CANCELLED' : 'TCP_HANDSHAKE_FAILED';
      socket.destroy();
      reject(error);
    };
    const finish = () => {
      if (!settled && writeReturned && callbackDone && drainDone) {
        settled = true;
        cleanup();
        resolve({ bytesWritten: bytes.length });
      }
    };
    const onError = () => fail();
    const onClose = () => fail(false);
    const onAbort = () => fail(true);
    const onDrain = () => { drainDone = true; finish(); };
    socket.once('error', onError);
    socket.once('close', onClose);
    socket.once('drain', onDrain);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted || socket.destroyed || !socket.writable) {
      fail(signal?.aborted === true);
      return;
    }
    if (timeoutMs > 0) timer = setTimeout(() => fail(false, true), timeoutMs);
    try {
      const accepted = socket.write(bytes, error => {
        if (error) fail();
        else { callbackDone = true; finish(); }
      });
      drainDone ||= accepted;
      writeReturned = true;
      finish();
    } catch {
      fail();
    }
  });
}

module.exports = { decodeTcpHandshake, writeTcpHandshake };
