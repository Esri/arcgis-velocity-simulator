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

const {
  SOCKET_PAYLOAD_FORMAT_SET,
  DEFAULT_SOCKET_PAYLOAD_FORMAT,
  createTcpRecordDecoder,
  decodeUdpDatagram,
} = require('./payload-format-utils.js');
const tcpReceivers = new WeakMap();

function assertSocketPayloadFormat(format = DEFAULT_SOCKET_PAYLOAD_FORMAT, optionName = 'format') {
  if (!SOCKET_PAYLOAD_FORMAT_SET.has(format)) {
    throw new Error(`Invalid ${optionName} '${format}'. Use ${[...SOCKET_PAYLOAD_FORMAT_SET].join(', ')}.`);
  }
}

function requireCallbacks(onRecord, onWarning) {
  if (typeof onRecord !== 'function' || typeof onWarning !== 'function') {
    throw new TypeError('Payload receivers require onRecord and onWarning callbacks.');
  }
}

function deliverRecords(records, warnings, onRecord, onWarning, context) {
  if (!Array.isArray(records) || !Array.isArray(warnings)) {
    throw new TypeError('Payload decoder returned an invalid record batch.');
  }
  for (const warning of warnings) {
    if (typeof warning !== 'string') throw new TypeError('Payload decoder returned an invalid diagnostic.');
    onWarning(warning, context);
  }
  for (const record of records) {
    if (!record || typeof record.payload !== 'string') {
      throw new TypeError('Payload decoder returned an invalid raw record.');
    }
    onRecord(record.payload, context);
  }
}

function attachTcpPayloadReceiver(socket, {
  format = DEFAULT_SOCKET_PAYLOAD_FORMAT,
  onRecord,
  onWarning,
  decoderOptions = {},
  context,
}) {
  assertSocketPayloadFormat(format, 'tcpFormat');
  requireCallbacks(onRecord, onWarning);
  if (tcpReceivers.has(socket)) throw new Error('TCP socket already has a payload receiver.');
  if (!decoderOptions || typeof decoderOptions !== 'object' || Array.isArray(decoderOptions)) {
    throw new TypeError('decoderOptions must be an object.');
  }
  const decoder = createTcpRecordDecoder(format, { skipEmptyRecords: true, ...decoderOptions });
  let ended = false;
  const receive = (chunk) => {
    if (ended) return;
    const batch = decoder.push(chunk);
    deliverRecords(batch.records, batch.warnings, onRecord, onWarning, context);
  };
  const finish = () => {
    if (ended) return;
    ended = true;
    tcpReceivers.delete(socket);
    socket.removeListener('data', receive);
    socket.removeListener('end', finish);
    socket.removeListener('close', finish);
    socket.removeListener('error', finish);
    const batch = decoder.end();
    deliverRecords(batch.records, batch.warnings, onRecord, onWarning, context);
  };
  tcpReceivers.set(socket, finish);
  socket.on('data', receive);
  socket.once('end', finish);
  socket.once('close', finish);
  socket.once('error', finish);
  return { end: finish };
}

function finishTcpPayloadReceiver(socket) {
  const finish = tcpReceivers.get(socket);
  if (finish) finish();
}

function createUdpPayloadReceiver({
  format = DEFAULT_SOCKET_PAYLOAD_FORMAT,
  onRecord,
  onWarning,
  isControlDatagram,
}) {
  assertSocketPayloadFormat(format, 'udpFormat');
  requireCallbacks(onRecord, onWarning);
  if (isControlDatagram !== undefined && typeof isControlDatagram !== 'function') {
    throw new TypeError('isControlDatagram must be a function when provided.');
  }
  return (buffer, context) => {
    if (isControlDatagram && isControlDatagram(buffer, context)) return;
    const result = decodeUdpDatagram(buffer, { format });
    deliverRecords(result.record === null ? [] : [result.record], result.warnings, onRecord, onWarning, context);
  };
}

module.exports = {
  assertSocketPayloadFormat,
  attachTcpPayloadReceiver,
  finishTcpPayloadReceiver,
  createUdpPayloadReceiver,
};
