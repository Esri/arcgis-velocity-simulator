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

const { StringDecoder } = require('string_decoder');
const { DATA_FORMATS } = require('./format-utils');

const SOCKET_PAYLOAD_FORMAT_IDS = Object.freeze({
  DELIMITED: DATA_FORMATS.DELIMITED,
  JSON: DATA_FORMATS.JSON,
  GEO_JSON: DATA_FORMATS.GEO_JSON,
  ESRI_JSON: DATA_FORMATS.ESRI_JSON,
});

const SOCKET_PAYLOAD_FORMATS = Object.freeze(Object.values(SOCKET_PAYLOAD_FORMAT_IDS));
const SOCKET_PAYLOAD_FORMAT_SET = new Set(SOCKET_PAYLOAD_FORMATS);
const SOCKET_PAYLOAD_FORMAT_LABELS = Object.freeze({
  [SOCKET_PAYLOAD_FORMAT_IDS.DELIMITED]: 'Delimited (CSV)',
  [SOCKET_PAYLOAD_FORMAT_IDS.JSON]: 'JSON',
  [SOCKET_PAYLOAD_FORMAT_IDS.GEO_JSON]: 'GeoJSON',
  [SOCKET_PAYLOAD_FORMAT_IDS.ESRI_JSON]: 'Esri JSON',
});
const DEFAULT_SOCKET_PAYLOAD_FORMAT = SOCKET_PAYLOAD_FORMAT_IDS.DELIMITED;
const UDP_MAX_PAYLOAD_BYTES = 65507;
const DEFAULT_MAX_TCP_RECORD_BYTES = 1024 * 1024;
const MIN_NORMAL_NUMBER = 2.2250738585072014e-308;
const DANGEROUS_FIELD_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

function requireFormat(format) {
  if (!SOCKET_PAYLOAD_FORMAT_SET.has(format)) {
    throw new Error(`Unsupported socket payload format: ${format}`);
  }
}

function requireDelimiter(delimiter) {
  if (typeof delimiter !== 'string' || delimiter.length !== 1 ||
      delimiter === '\r' || delimiter === '\n' || delimiter === '"') {
    throw new Error('Delimiter must be one character other than a quote or newline');
  }
}

function validateFieldNames(fieldNames) {
  const seen = new Set();
  fieldNames.forEach((name, index) => {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error(`Header field ${index + 1} is empty`);
    }
    if (DANGEROUS_FIELD_NAMES.has(name)) {
      throw new Error(`Header field "${name}" is not allowed`);
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate header field "${name}"`);
    }
    seen.add(name);
  });
}

/**
 * Parses all logical records while preserving each record's original text.
 * Record separators are omitted from rawRecords.
 */
function parseDelimitedRows(source, delimiter) {
  if (typeof source !== 'string') {
    throw new TypeError('Delimited source must be a string');
  }
  requireDelimiter(delimiter);

  const text = source.startsWith('\uFEFF') ? source.slice(1) : source;
  const rows = [];
  const rawRecords = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let afterQuote = false;
  let atFieldStart = true;
  let recordStart = 0;
  let hasContent = false;

  const finishRecord = (end) => {
    row.push(field);
    rows.push(row);
    rawRecords.push(text.slice(recordStart, end));
    row = [];
    field = '';
    afterQuote = false;
    atFieldStart = true;
    hasContent = false;
  };

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      hasContent = true;
      continue;
    }

    if (afterQuote) {
      if (character === delimiter) {
        row.push(field);
        field = '';
        afterQuote = false;
        atFieldStart = true;
        hasContent = true;
        continue;
      }
      if (character !== '\r' && character !== '\n') {
        throw new Error(`Unexpected character after closing quote at offset ${index}`);
      }
    } else if (character === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
      hasContent = true;
      continue;
    } else if (character === '"') {
      throw new Error(`Unexpected quote in unquoted field at offset ${index}`);
    } else if (character === delimiter) {
      row.push(field);
      field = '';
      atFieldStart = true;
      hasContent = true;
      continue;
    } else if (character !== '\r' && character !== '\n') {
      field += character;
      atFieldStart = false;
      hasContent = true;
      continue;
    }

    if (character === '\r') {
      if (text[index + 1] !== '\n') {
        throw new Error(`Delimited source contains a lone carriage return at offset ${index}`);
      }
      finishRecord(index);
      index++;
      recordStart = index + 1;
    } else {
      finishRecord(index);
      recordStart = index + 1;
    }
  }

  if (inQuotes) {
    throw new Error('Delimited source ends with an unmatched quote');
  }
  if (hasContent || row.length > 0 || field.length > 0) {
    finishRecord(text.length);
  }
  return { rows, rawRecords };
}

function inferScalar(value, options = {}) {
  if (typeof value !== 'string') return value;
  const emptyValue = options.emptyValue === undefined ? 'null' : options.emptyValue;
  if (emptyValue !== 'null' && emptyValue !== 'string') {
    throw new Error('emptyValue must be "null" or "string"');
  }
  if (value === '') return emptyValue === 'null' ? null : '';
  if (value === 'true') return true;
  if (value === 'false') return false;

  const finiteNumber = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
  const leadingZero = /^-?0\d/;
  if (finiteNumber.test(value) && !leadingZero.test(value)) {
    const number = Number(value);
    const significantDigits = value
      .replace(/^[+-]?0*/, '')
      .replace(/[eE].*$/, '')
      .replace('.', '')
      .replace(/^0+/, '')
      .length;
    const nonzeroMantissa = /[1-9]/.test(value.replace(/[eE].*$/, ''));
    if (Number.isFinite(number)
        && !(number === 0 && nonzeroMantissa)
        && !(number !== 0 && Math.abs(number) < MIN_NORMAL_NUMBER)
        && !(Object.is(number, -0) && value.startsWith('-'))
        && (!Number.isInteger(number) || Number.isSafeInteger(number))
        && significantDigits <= 15) return number;
  }
  return value;
}

function buildRecord(fieldNames, values, inferTypes, emptyValue) {
  const record = {};
  fieldNames.forEach((name, index) => {
    Object.defineProperty(record, name, {
      value: inferTypes ? inferScalar(values[index], { emptyValue }) : values[index],
      enumerable: true,
      configurable: true,
      writable: true,
    });
  });
  return record;
}

function inferSchema(fieldNames, records) {
  return fieldNames.map((name) => {
    const types = new Set(records.map((record) => {
      const value = record[name];
      return value === null ? 'null' : typeof value;
    }));
    return Object.freeze({
      name,
      type: types.size === 1 ? [...types][0] : 'mixed',
    });
  });
}

function parseDelimitedSource(source, options = {}) {
  const delimiter = options.delimiter === undefined ? ',' : options.delimiter;
  const hasHeaderRow = options.hasHeaderRow !== false;
  const inferTypes = options.inferTypes !== false;
  const emptyValue = options.emptyValue === undefined ? 'null' : options.emptyValue;
  let { rows, rawRecords } = parseDelimitedRows(source, delimiter);
  if (options.skipEmptyRecords === true) {
    const retained = rows
      .map((row, index) => ({ row, raw: rawRecords[index] }))
      .filter(({ raw }) => raw.trim() !== '');
    rows = retained.map(({ row }) => row);
    rawRecords = retained.map(({ raw }) => raw);
  }

  if (rows.length === 0) {
    if (hasHeaderRow) throw new Error('Delimited source does not contain a header row');
    return {
      delimiter,
      hasHeaderRow,
      fieldNames: [],
      schema: [],
      header: null,
      records: [],
      rawRecords: [],
      rawEventRecords: [],
    };
  }

  const columnCount = rows[0].length;
  const fieldNames = hasHeaderRow
    ? rows[0].slice()
    : Array.from({ length: columnCount }, (_, index) => `field_${index + 1}`);
  validateFieldNames(fieldNames);

  rows.forEach((row, index) => {
    if (row.length !== columnCount) {
      const logicalRow = index + 1;
      throw new Error(
        `Inconsistent column count at logical row ${logicalRow}: expected ${columnCount}, received ${row.length}`
      );
    }
  });

  const dataRows = hasHeaderRow ? rows.slice(1) : rows;
  const records = dataRows.map((values) =>
    buildRecord(fieldNames, values, inferTypes, emptyValue)
  );
  return {
    delimiter,
    hasHeaderRow,
    fieldNames,
    schema: inferSchema(fieldNames, records),
    header: hasHeaderRow ? rawRecords[0] : null,
    records,
    rawRecords,
    rawEventRecords: hasHeaderRow ? rawRecords.slice(1) : rawRecords.slice(),
  };
}

function encodeDelimitedValue(value, delimiter) {
  let text;
  if (value === null || value === undefined) text = '';
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);
  if (text.includes('"')) text = text.replace(/"/g, '""');
  return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text}"` : text;
}

function geometryOptions(options) {
  const source = options.geometry || options;
  const xField = source.xField;
  const yField = source.yField;
  const zField = source.zField;
  if ((xField === undefined) !== (yField === undefined)) {
    throw new Error('Geometry mapping requires both xField and yField');
  }
  if (zField !== undefined && xField === undefined) {
    throw new Error('Geometry mapping requires xField and yField when zField is set');
  }
  return { xField, yField, zField };
}

function buildPoint(record, options, geoJson) {
  const { xField, yField, zField } = geometryOptions(options);
  if (xField === undefined) return null;
  for (const field of [xField, yField, zField].filter((value) => value !== undefined)) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      throw new Error(`Geometry field "${field}" is missing`);
    }
    if (typeof record[field] !== 'number' || !Number.isFinite(record[field])) {
      throw new Error(`Geometry field "${field}" must be a finite number`);
    }
  }
  if (geoJson) {
    const coordinates = [record[xField], record[yField]];
    if (zField !== undefined) coordinates.push(record[zField]);
    return { type: 'Point', coordinates };
  }
  const point = { x: record[xField], y: record[yField] };
  if (zField !== undefined) point.z = record[zField];
  point.spatialReference = { wkid: options.wkid === undefined ? 4326 : options.wkid };
  return point;
}

function copyRecord(record, omittedFields = []) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('Record must be an object');
  }
  const copy = {};
  for (const [key, value] of Object.entries(record)) {
    if (DANGEROUS_FIELD_NAMES.has(key)) {
      throw new Error(`Record field "${key}" is not allowed`);
    }
    if (!omittedFields.includes(key)) copy[key] = value;
  }
  return copy;
}

function encodeRecord(record, format = DEFAULT_SOCKET_PAYLOAD_FORMAT, options = {}) {
  requireFormat(format);
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('Record must be an object');
  }
  for (const [field, value] of Object.entries(record)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`Record field "${field}" must be a finite number, not NaN or Infinity`);
    }
  }
  const { xField, yField, zField } = geometryOptions(options);
  const omitted = options.removeCoordinateFields === true
    ? [xField, yField, zField].filter((value) => value !== undefined)
    : [];

  if (format === SOCKET_PAYLOAD_FORMAT_IDS.DELIMITED) {
    const delimiter = options.delimiter === undefined ? ',' : options.delimiter;
    requireDelimiter(delimiter);
    const fieldNames = options.fieldNames || Object.keys(record);
    validateFieldNames(fieldNames);
    return fieldNames.map((name) => encodeDelimitedValue(record[name], delimiter)).join(delimiter);
  }
  if (format === SOCKET_PAYLOAD_FORMAT_IDS.JSON) {
    return JSON.stringify(copyRecord(record));
  }
  if (format === SOCKET_PAYLOAD_FORMAT_IDS.GEO_JSON) {
    const wkid = options.wkid === undefined ? 4326 : options.wkid;
    if (wkid !== 4326) {
      throw new Error('GeoJSON point coordinates require WKID 4326');
    }
    return JSON.stringify({
      type: 'Feature',
      properties: copyRecord(record, omitted),
      geometry: buildPoint(record, options, true),
    });
  }

  const wkid = options.wkid === undefined ? 4326 : options.wkid;
  if (!Number.isInteger(wkid) || wkid <= 0) {
    throw new Error('Esri JSON wkid must be a positive integer');
  }
  return JSON.stringify({
    attributes: copyRecord(record, omitted),
    geometry: buildPoint(record, { ...options, wkid }, false),
  });
}

function convertDelimitedSource(
  source,
  formatOrOptions = DEFAULT_SOCKET_PAYLOAD_FORMAT,
  legacyOptions = {}
) {
  const options = isObject(formatOrOptions) ? formatOrOptions : legacyOptions;
  const format = isObject(formatOrOptions)
    ? (formatOrOptions.format || DEFAULT_SOCKET_PAYLOAD_FORMAT)
    : formatOrOptions;
  requireFormat(format);
  const parsed = parseDelimitedSource(source, options);
  const payloads = format === SOCKET_PAYLOAD_FORMAT_IDS.DELIMITED
    ? parsed.rawEventRecords.slice()
    : parsed.records.map((record) =>
      encodeRecord(record, format, { ...options, fieldNames: parsed.fieldNames })
    );
  return {
    format,
    delimiter: parsed.delimiter,
    hasHeaderRow: parsed.hasHeaderRow,
    fieldNames: parsed.fieldNames,
    schema: parsed.schema,
    header: parsed.header,
    records: parsed.records,
    payloads,
  };
}

function parseJsonPayload(payload, label) {
  if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) {
    throw new TypeError(`${label} payload must be a string or Buffer`);
  }
  const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
  const jsonText = text.startsWith('\uFEFF') ? text.slice(1) : text;
  let value;
  try {
    value = JSON.parse(jsonText);
  } catch (_) {
    throw new Error(`Invalid ${label} payload: JSON syntax error`);
  }
  return { text, value };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateGeoJsonGeometry(geometry) {
  if (geometry === null) return;
  if (!isObject(geometry) || typeof geometry.type !== 'string') {
    throw new Error('GeoJSON geometry must be null or an object with a type');
  }
  const geometryTypes = new Set([
    'Point',
    'MultiPoint',
    'LineString',
    'MultiLineString',
    'Polygon',
    'MultiPolygon',
    'GeometryCollection',
  ]);
  if (!geometryTypes.has(geometry.type)) {
    throw new Error(`Unsupported GeoJSON geometry type "${geometry.type}"`);
  }
  if (geometry.type === 'GeometryCollection') {
    if (!Array.isArray(geometry.geometries)) {
      throw new Error('GeoJSON GeometryCollection must contain a geometries array');
    }
    geometry.geometries.forEach(validateGeoJsonGeometry);
  } else if (!Array.isArray(geometry.coordinates)) {
    throw new Error('GeoJSON geometry must contain a coordinates array');
  } else if (geometry.type === 'Point' &&
      (geometry.coordinates.length < 2 ||
       !geometry.coordinates.every((value) => typeof value === 'number' && Number.isFinite(value)))) {
    throw new Error('GeoJSON Point coordinates must contain at least two finite numbers');
  }
}

function validateGeoJsonFeature(feature, index) {
  const context = index === undefined ? 'GeoJSON Feature' : `GeoJSON feature ${index + 1}`;
  if (!isObject(feature) || feature.type !== 'Feature') {
    throw new Error(`${context} must have type "Feature"`);
  }
  if (!Object.prototype.hasOwnProperty.call(feature, 'geometry')) {
    throw new Error(`${context} must contain geometry`);
  }
  validateGeoJsonGeometry(feature.geometry);
  if (feature.properties !== null && !isObject(feature.properties)) {
    throw new Error(`${context} properties must be an object or null`);
  }
}

function validateEsriFeature(feature, index) {
  const context = index === undefined ? 'Esri JSON feature' : `Esri JSON feature ${index + 1}`;
  if (!isObject(feature) || !isObject(feature.attributes)) {
    throw new Error(`${context} must contain an attributes object`);
  }
  if (feature.geometry !== undefined && feature.geometry !== null &&
      !isObject(feature.geometry)) {
    throw new Error(`${context} geometry must be an object or null`);
  }
}

function validatePayload(payload, format = DEFAULT_SOCKET_PAYLOAD_FORMAT, options = {}) {
  requireFormat(format);
  if (format === SOCKET_PAYLOAD_FORMAT_IDS.DELIMITED) {
    const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
    if (text === '') {
      return {
        format,
        kind: 'record',
        count: 1,
        byteLength: 0,
        value: { field_1: options.emptyValue === 'string' ? '' : null },
        fields: ['field_1'],
      };
    }
    const parsed = parseDelimitedSource(text, {
      delimiter: options.delimiter,
      hasHeaderRow: false,
      inferTypes: options.inferTypes,
      emptyValue: options.emptyValue,
    });
    if (parsed.rawRecords.length !== 1) {
      throw new Error('Delimited payload must contain exactly one logical record');
    }
    return {
      format,
      kind: 'record',
      count: 1,
      byteLength: utf8ByteLength(payload),
      value: parsed.records[0],
      fields: parsed.fieldNames,
    };
  }

  const label = SOCKET_PAYLOAD_FORMAT_LABELS[format];
  const { value } = parseJsonPayload(payload, label);
  if (format === SOCKET_PAYLOAD_FORMAT_IDS.JSON) {
    if (!isObject(value) && !Array.isArray(value)) {
      throw new Error('JSON payload must be one object or array');
    }
    return {
      format,
      kind: Array.isArray(value) ? 'array' : 'object',
      count: Array.isArray(value) ? value.length : 1,
      byteLength: utf8ByteLength(payload),
      value,
    };
  }
  if (format === SOCKET_PAYLOAD_FORMAT_IDS.GEO_JSON) {
    if (isObject(value) && value.type === 'Feature') {
      validateGeoJsonFeature(value);
      return { format, kind: 'Feature', count: 1, byteLength: utf8ByteLength(payload), value };
    }
    if (isObject(value) && value.type === 'FeatureCollection' && Array.isArray(value.features)) {
      value.features.forEach(validateGeoJsonFeature);
      return {
        format,
        kind: 'FeatureCollection',
        count: value.features.length,
        byteLength: utf8ByteLength(payload),
        value,
      };
    }
    throw new Error('GeoJSON payload must be a Feature or FeatureCollection');
  }

  if (isObject(value) && Array.isArray(value.features)) {
    value.features.forEach(validateEsriFeature);
    return {
      format,
      kind: 'FeatureSet',
      count: value.features.length,
      byteLength: utf8ByteLength(payload),
      value,
    };
  }
  validateEsriFeature(value);
  return { format, kind: 'Feature', count: 1, byteLength: utf8ByteLength(payload), value };
}

function utf8ByteLength(payload) {
  if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) {
    throw new TypeError('Payload must be a string or Buffer');
  }
  return Buffer.isBuffer(payload) ? payload.length : Buffer.byteLength(payload, 'utf8');
}

function assertUdpPayloadSize(payload) {
  const length = utf8ByteLength(payload);
  if (length > UDP_MAX_PAYLOAD_BYTES) {
    throw new Error(
      `UDP payload is ${length} UTF-8 bytes; maximum is ${UDP_MAX_PAYLOAD_BYTES} bytes`
    );
  }

  return length;
}

function assertTcpPayloadSize(payload, maximum = DEFAULT_MAX_TCP_RECORD_BYTES) {
  if (!Number.isInteger(maximum) || maximum <= 0) {
    throw new Error('TCP maximum payload size must be a positive integer');
  }
  const length = utf8ByteLength(payload);
  if (length > maximum) {
    throw new Error(`TCP payload is ${length} UTF-8 bytes; maximum is ${maximum} bytes`);
  }
  return length;
}

function decodeUdpDatagram(datagram, options = {}) {
  if (!Buffer.isBuffer(datagram)) {
    throw new TypeError('UDP datagram must be a Buffer');
  }
  const format = options.format || DEFAULT_SOCKET_PAYLOAD_FORMAT;
  requireFormat(format);
  const byteLength = utf8ByteLength(datagram);
  if (byteLength > UDP_MAX_PAYLOAD_BYTES) {
    return {
      record: null,
      warnings: [
        `UDP datagram was dropped because it exceeded ${UDP_MAX_PAYLOAD_BYTES} bytes; ` +
        `droppedByteLength=${byteLength}`,
      ],
    };
  }

  let payload;
  try {
    payload = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(datagram);
  } catch (_) {
    return {
      record: null,
      warnings: [`Invalid UTF-8 UDP datagram was dropped; droppedByteLength=${byteLength}`],
    };
  }

  let validation = null;
  let warning = null;
  try {
    validation = validatePayload(payload, format, options);
  } catch (_) {
    warning = `UDP payload validation failed for ${SOCKET_PAYLOAD_FORMAT_LABELS[format]}`;
  }
  return {
    record: { payload, validation, warning },
    warnings: warning === null ? [] : [warning],
  };
}

function assertTcpRecordSize(payload, maximum) {
  const length = utf8ByteLength(payload);
  if (length > maximum) {
    throw new Error(`TCP record is ${length} UTF-8 bytes; maximum is ${maximum} bytes`);
  }
}

function createJsonFramer(format, options) {
  let buffer = '';
  const decoder = new StringDecoder('utf8');
  let started = false;
  let start = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let scanIndex = 0;

  const consume = () => {
    const payloads = [];
    let index = scanIndex;
    while (index < buffer.length) {
      if (!started) {
        while (index < buffer.length && /\s/.test(buffer[index])) index++;
        if (index === buffer.length) {
          buffer = '';
          scanIndex = 0;
          return payloads;
        }
        if (buffer[index] !== '{' && buffer[index] !== '[') {
          throw new Error(`JSON stream expected an object or array at offset ${index}`);
        }
        started = true;
        start = index;
        depth = 0;
      }

      for (; index < buffer.length; index++) {
        const character = buffer[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') inString = true;
        else if (character === '{' || character === '[') depth++;
        else if (character === '}' || character === ']') {
          depth--;
          if (depth < 0) throw new Error('JSON stream has an unexpected closing delimiter');
          if (depth === 0) {
            const payload = buffer.slice(start, index + 1);
            assertTcpRecordSize(payload, options.maxRecordBytes);
            validatePayload(payload, format, options);
            payloads.push(payload);
            buffer = buffer.slice(index + 1);
            started = false;
            start = 0;
            index = 0;
            scanIndex = 0;
            inString = false;
            escaped = false;
            break;
          }
        }
      }
      if (started) break;
    }
    scanIndex = index;
    return payloads;
  };

  return {
    push(chunk) {
      if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk)) {
        throw new TypeError('TCP decoder chunk must be a string or Buffer');
      }
      buffer += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const payloads = consume();
      if (utf8ByteLength(buffer) > options.maxRecordBytes) {
        throw new Error(
          `Incomplete TCP record exceeds ${options.maxRecordBytes} UTF-8 bytes`
        );
      }
      return payloads;
    },
    end(chunk) {
      let payloads = [];
      if (chunk !== undefined) payloads = this.push(chunk);
      buffer += decoder.end();
      payloads.push(...consume());
      if (buffer.trim() !== '') throw new Error('TCP stream ended with an incomplete JSON payload');
      return payloads;
    },
  };
}

function createDelimitedFramer(options) {
  let buffer = '';
  const decoder = new StringDecoder('utf8');

  const consume = (ending) => {
    const payloads = [];
    let inQuotes = false;
    let atFieldStart = true;
    let afterQuote = false;
    let recordStart = 0;

    for (let index = 0; index < buffer.length; index++) {
      const character = buffer[index];
      if (inQuotes) {
        if (character === '"') {
          if (buffer[index + 1] === '"') index++;
          else {
            inQuotes = false;
            afterQuote = true;
          }
        }
        continue;
      }
      if (afterQuote) {
        if (character === options.delimiter) {
          afterQuote = false;
          atFieldStart = true;
          continue;
        }
        if (character !== '\r' && character !== '\n') {
          throw new Error(`Unexpected character after closing quote at offset ${index}`);
        }
      } else if (character === '"' && atFieldStart) {
        inQuotes = true;
        atFieldStart = false;
        continue;
      } else if (character === '"') {
        throw new Error(`Unexpected quote in unquoted field at offset ${index}`);
      } else if (character === options.delimiter) {
        atFieldStart = true;
        continue;
      } else if (character !== '\r' && character !== '\n') {
        atFieldStart = false;
        continue;
      }

      if (character === '\r') {
        if (index + 1 === buffer.length && !ending) break;
        if (buffer[index + 1] !== '\n') {
          throw new Error(`Delimited stream contains a lone carriage return at offset ${index}`);
        }
      }
      const payload = buffer.slice(recordStart, index);
      assertTcpRecordSize(payload, options.maxRecordBytes);
      validatePayload(payload, SOCKET_PAYLOAD_FORMAT_IDS.DELIMITED, options);
      payloads.push(payload);
      if (character === '\r') index++;
      recordStart = index + 1;
      atFieldStart = true;
      afterQuote = false;
    }

    buffer = buffer.slice(recordStart);
    if (ending) {
      if (inQuotes) throw new Error('TCP stream ended with an unmatched delimited quote');
      if (buffer.length > 0) {
        assertTcpRecordSize(buffer, options.maxRecordBytes);
        validatePayload(buffer, SOCKET_PAYLOAD_FORMAT_IDS.DELIMITED, options);
        payloads.push(buffer);
        buffer = '';
      }
    }
    return payloads;
  };

  return {
    push(chunk) {
      if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk)) {
        throw new TypeError('TCP decoder chunk must be a string or Buffer');
      }
      buffer += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const payloads = consume(false);
      if (utf8ByteLength(buffer) > options.maxRecordBytes) {
        throw new Error(
          `Incomplete TCP record exceeds ${options.maxRecordBytes} UTF-8 bytes`
        );
      }
      return payloads;
    },
    end(chunk) {
      let payloads = [];
      if (chunk !== undefined) payloads = this.push(chunk);
      buffer += decoder.end();
      payloads.push(...consume(true));
      return payloads;
    },
  };
}

function createTcpPayloadDecoder(format = DEFAULT_SOCKET_PAYLOAD_FORMAT, options = {}) {
  requireFormat(format);
  const maxRecordBytes = options.maxRecordBytes === undefined
    ? DEFAULT_MAX_TCP_RECORD_BYTES
    : options.maxRecordBytes;
  if (!Number.isInteger(maxRecordBytes) || maxRecordBytes <= 0) {
    throw new Error('maxRecordBytes must be a positive integer');
  }
  const normalized = {
    ...options,
    delimiter: options.delimiter === undefined ? ',' : options.delimiter,
    maxRecordBytes,
  };
  requireDelimiter(normalized.delimiter);
  return format === SOCKET_PAYLOAD_FORMAT_IDS.DELIMITED
    ? createDelimitedFramer(normalized)
    : createJsonFramer(format, normalized);
}

function receiveResult() {
  return { records: [], warnings: [] };
}

function addReceiveWarning(result, warning) {
  result.warnings.push(warning);
}

function addReceiveRecord(result, payload, format, options, warning = null) {
  let validation = null;
  const byteLength = utf8ByteLength(payload);
  if (byteLength > options.maxRecordBytes) {
    const sizeWarning = `TCP record exceeded ${options.maxRecordBytes} UTF-8 bytes`;
    warning = warning === null ? sizeWarning : `${warning}; ${sizeWarning}`;
  }
  if (warning === null) {
    try {
      validation = validatePayload(payload, format, options);
    } catch (_) {
      warning = `Payload validation failed for ${SOCKET_PAYLOAD_FORMAT_LABELS[format]}`;
    }
  }
  result.records.push({ payload, validation, warning });
  if (warning !== null) addReceiveWarning(result, warning);
}

function utf8SequenceLength(bytes, offset) {
  const first = bytes[offset];
  if (first <= 0x7f) return 1;
  if (first >= 0xc2 && first <= 0xdf) return 2;
  if (first >= 0xe0 && first <= 0xef) return 3;
  if (first >= 0xf0 && first <= 0xf4) return 4;
  return 0;
}

function isValidUtf8Sequence(bytes, offset, length) {
  const second = bytes[offset + 1];
  if (length >= 2 && (second < 0x80 || second > 0xbf)) return false;
  if (length >= 3) {
    const third = bytes[offset + 2];
    if (third < 0x80 || third > 0xbf) return false;
    if (bytes[offset] === 0xe0 && second < 0xa0) return false;
    if (bytes[offset] === 0xed && second > 0x9f) return false;
  }
  if (length === 4) {
    const fourth = bytes[offset + 3];
    if (fourth < 0x80 || fourth > 0xbf) return false;
    if (bytes[offset] === 0xf0 && second < 0x90) return false;
    if (bytes[offset] === 0xf4 && second > 0x8f) return false;
  }
  return true;
}

function createFatalUtf8Stream() {
  let carry = Buffer.alloc(0);

  function decode(chunk, ending = false) {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const bytes = carry.length === 0 ? incoming : Buffer.concat([carry, incoming]);
    carry = Buffer.alloc(0);
    const segments = [];
    let validStart = 0;
    let offset = 0;

    const pushValid = (end) => {
      if (end > validStart) segments.push({ text: bytes.subarray(validStart, end).toString('utf8') });
    };

    while (offset < bytes.length) {
      const length = utf8SequenceLength(bytes, offset);
      if (length === 0) {
        pushValid(offset);
        let end = offset + 1;
        while (end < bytes.length && utf8SequenceLength(bytes, end) === 0) end++;
        segments.push({ droppedByteLength: end - offset });
        offset = end;
        validStart = offset;
        continue;
      }
      if (offset + length > bytes.length) {
        if (!ending) {
          pushValid(offset);
          carry = bytes.subarray(offset);
          return segments;
        }
        pushValid(offset);
        segments.push({ droppedByteLength: bytes.length - offset });
        return segments;
      }
      if (!isValidUtf8Sequence(bytes, offset, length)) {
        pushValid(offset);
        segments.push({ droppedByteLength: 1 });
        offset++;
        validStart = offset;
        continue;
      }
      offset += length;
    }
    pushValid(bytes.length);
    return segments;
  }

  return {
    push(chunk) {
      return decode(chunk, false);
    },
    end(chunk) {
      const segments = chunk === undefined ? [] : decode(chunk, false);
      return segments.concat(decode(Buffer.alloc(0), true));
    },
    reset() {
      carry = Buffer.alloc(0);
    },
  };
}

function createReceiveTextFramer(format, options) {
  let buffer = '';

  function consumeDelimited(result, ending) {
    let inQuotes = false;
    let atFieldStart = true;
    let malformed = false;
    let recordStart = 0;

    for (let index = 0; index < buffer.length; index++) {
      const character = buffer[index];
      if (inQuotes) {
        if (character === '"') {
          if (buffer[index + 1] === '"') index++;
          else inQuotes = false;
        }
      } else if (character === '"' && atFieldStart) {
        inQuotes = true;
        atFieldStart = false;
      } else if (character === '"') {
        malformed = true;
      } else if (character === options.delimiter) {
        atFieldStart = true;
      } else if (character === '\r' || character === '\n') {
        if (character === '\r' && index + 1 === buffer.length && !ending) break;
        const crlf = character === '\r' && buffer[index + 1] === '\n';
        if (character === '\r' && !crlf) malformed = true;
        if (!inQuotes || malformed) {
          const payload = buffer.slice(recordStart, index);
          if (options.skipEmptyRecords !== true || payload.trim() !== '') {
            addReceiveRecord(
              result,
              payload,
              format,
              options,
              malformed ? 'Malformed delimited record was recovered at a record separator' : null
            );
          }
          if (crlf) index++;
          recordStart = index + 1;
          inQuotes = false;
          atFieldStart = true;
          malformed = false;
        }
      } else {
        atFieldStart = false;
      }
    }
    buffer = buffer.slice(recordStart);
    if (ending && buffer.length > 0) {
      if (options.skipEmptyRecords !== true || buffer.trim() !== '') {
        addReceiveRecord(
          result,
          buffer,
          format,
          options,
          inQuotes || malformed ? 'TCP stream ended with an incomplete delimited record' : null
        );
      }
      buffer = '';
    }
  }

  function consumeJson(result, ending) {
    let start = 0;
    let index = 0;
    let consumedOffset = 0;
    while (index < buffer.length) {
      while (index < buffer.length && /\s/.test(buffer[index])) index++;
      start = index;
      consumedOffset = index;
      if (index === buffer.length) {
        buffer = '';
        return;
      }
      if (buffer[index] !== '{' && buffer[index] !== '[') {
        const newline = buffer.indexOf('\n', index);
        if (newline === -1 && !ending) break;
        const end = newline === -1 ? buffer.length : newline;
        addReceiveRecord(
          result,
          buffer.slice(start, end).replace(/\r$/, ''),
          format,
          options,
          'Malformed JSON record was recovered at a record boundary'
        );
        index = newline === -1 ? buffer.length : newline + 1;
        consumedOffset = index;
        continue;
      }

      const stack = [];
      let inString = false;
      let escaped = false;
      let malformed = false;
      let complete = false;
      for (; index < buffer.length; index++) {
        const character = buffer[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') inString = false;
          else if (character === '\n' || character === '\r') malformed = true;
          continue;
        }
        if (character === '"') inString = true;
        else if (character === '{' || character === '[') stack.push(character);
        else if (character === '}' || character === ']') {
          const expected = character === '}' ? '{' : '[';
          if (stack.pop() !== expected) {
            malformed = true;
            break;
          }
          if (stack.length === 0) {
            index++;
            complete = true;
            break;
          }
        }
      }

      if (complete) {
        addReceiveRecord(result, buffer.slice(start, index), format, options);
        consumedOffset = index;
        continue;
      }
      if (malformed) {
        const newline = buffer.indexOf('\n', index);
        if (newline === -1 && !ending) break;
        const end = newline === -1 ? buffer.length : newline;
        addReceiveRecord(
          result,
          buffer.slice(start, end).replace(/\r$/, ''),
          format,
          options,
          'Malformed JSON record was recovered at a record boundary'
        );
        index = newline === -1 ? buffer.length : newline + 1;
        consumedOffset = index;
        continue;
      }
      break;
    }
    buffer = buffer.slice(consumedOffset);
    if (ending && buffer.trim() !== '') {
      addReceiveRecord(
        result,
        buffer,
        format,
        options,
        'TCP stream ended with an incomplete JSON record'
      );
      buffer = '';
    }
  }

  function consume(result, ending = false) {
    if (format === SOCKET_PAYLOAD_FORMAT_IDS.DELIMITED) consumeDelimited(result, ending);
    else consumeJson(result, ending);
    if (!ending && utf8ByteLength(buffer) > options.maxRecordBytes) {
      addReceiveRecord(
        result,
        buffer,
        format,
        options,
        `Incomplete TCP record exceeded ${options.maxRecordBytes} UTF-8 bytes and was reset`
      );
      buffer = '';
    }
  }

  return {
    push(text, result) {
      buffer += text;
      consume(result);
    },
    end(result) {
      consume(result, true);
    },
    reset() {
      buffer = '';
    },
  };
}

function createTcpRecordDecoder(format = DEFAULT_SOCKET_PAYLOAD_FORMAT, options = {}) {
  requireFormat(format);
  const maxRecordBytes = options.maxRecordBytes === undefined
    ? DEFAULT_MAX_TCP_RECORD_BYTES
    : options.maxRecordBytes;
  if (!Number.isInteger(maxRecordBytes) || maxRecordBytes <= 0) {
    throw new Error('maxRecordBytes must be a positive integer');
  }
  const normalized = {
    ...options,
    delimiter: options.delimiter === undefined ? ',' : options.delimiter,
    maxRecordBytes,
  };
  requireDelimiter(normalized.delimiter);
  const utf8 = createFatalUtf8Stream();
  const framer = createReceiveTextFramer(format, normalized);

  function processSegments(segments, result) {
    for (const segment of segments) {
      if (segment.text !== undefined) {
        framer.push(segment.text, result);
      } else {
        framer.reset();
        addReceiveWarning(
          result,
          `Invalid UTF-8 bytes were dropped; droppedByteLength=${segment.droppedByteLength}`
        );
      }
    }
  }

  return {
    push(chunk) {
      if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk)) {
        throw new TypeError('TCP decoder chunk must be a string or Buffer');
      }
      const result = receiveResult();
      processSegments(utf8.push(chunk), result);
      return result;
    },
    end(chunk) {
      const result = receiveResult();
      if (chunk !== undefined) processSegments(utf8.push(chunk), result);
      processSegments(utf8.end(), result);
      framer.end(result);
      return result;
    },
  };
}

module.exports = {
  SOCKET_PAYLOAD_FORMATS,
  SOCKET_PAYLOAD_FORMAT_IDS,
  SOCKET_PAYLOAD_FORMAT_SET,
  SOCKET_PAYLOAD_FORMAT_LABELS,
  DEFAULT_SOCKET_PAYLOAD_FORMAT,
  UDP_MAX_PAYLOAD_BYTES,
  DEFAULT_MAX_TCP_RECORD_BYTES,
  parseDelimitedSource,
  inferScalar,
  encodeRecord,
  convertDelimitedSource,
  validatePayload,
  utf8ByteLength,
  assertUdpPayloadSize,
  assertTcpPayloadSize,
  decodeUdpDatagram,
  createTcpPayloadDecoder,
  createTcpRecordDecoder,
};
