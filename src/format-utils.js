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

/**
 * @file format-utils.js
 * @description
 * Shared data format constants used by HTTP and WebSocket transports.
 * Extracted as a DRY shared module (same pattern as tls-utils.js).
 *
 * Supported formats match ArcGIS Velocity's TCP, HTTP, and WebSocket feeds:
 *   - delimited   (text/plain)        — CSV rows, one per line
 *   - json        (application/json)  — JSON objects or arrays
 *   - esri-json   (application/json)  — Esri Feature JSON schema
 *   - geo-json    (application/geo+json) — GeoJSON per RFC 7946
 *   - xml         (application/xml)   — XML payloads
 */

/**
 * Valid data format identifiers (matching Velocity's supportedFormats).
 * Delimited (CSV) is listed first and is the default, matching the order
 * used by ArcGIS Velocity TCP, HTTP, and WebSocket feeds.
 */
const DATA_FORMATS = Object.freeze({
  DELIMITED: 'delimited',
  JSON: 'json',
  ESRI_JSON: 'esri-json',
  GEO_JSON: 'geo-json',
  XML: 'xml',
});

const VALID_DATA_FORMATS = new Set(Object.values(DATA_FORMATS));

/**
 * Maps format identifiers to HTTP/WebSocket Content-Type headers.
 */
const FORMAT_CONTENT_TYPES = Object.freeze({
  [DATA_FORMATS.DELIMITED]: 'text/plain',
  [DATA_FORMATS.JSON]: 'application/json',
  [DATA_FORMATS.ESRI_JSON]: 'application/json',
  [DATA_FORMATS.GEO_JSON]: 'application/geo+json',
  [DATA_FORMATS.XML]: 'application/xml',
});

/**
 * The default format when none is specified.
 */
const DEFAULT_FORMAT = DATA_FORMATS.DELIMITED;

module.exports = {
  DATA_FORMATS,
  VALID_DATA_FORMATS,
  FORMAT_CONTENT_TYPES,
  DEFAULT_FORMAT,
};

