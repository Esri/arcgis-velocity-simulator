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

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VelocityConnectionOptions = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FORMATS = {
    delimited: 'delimited', json: 'json', geojson: 'geo-json', 'geo-json': 'geo-json',
    esrijson: 'esri-json', 'esri-json': 'esri-json', xml: 'xml',
  };
  const SECRET_QUERY = /token|password|passwd|secret|credential|authorization|api[-_]?key|signature|^sig$|^key$|^auth$/i;

  function endpointUrl(value, protocols) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('The advertised data endpoint is missing.');
    const text = value.trim();
    if (/[\s\\]/.test(text) || !/^[a-z]+:\/\/[^/]/i.test(text)) throw new Error('The advertised data endpoint contains invalid characters.');
    if (/^[a-z]+:\/\/[^/?#]*:(?:[/?#]|$)/i.test(text)) throw new Error('The advertised data endpoint has an empty port.');
    let url;
    try { url = new URL(text); } catch (_) { throw new Error('The advertised data endpoint is not a valid URL.'); }
    if (!protocols.includes(url.protocol) || !url.hostname) throw new Error('The advertised data endpoint uses an unsupported URL scheme.');
    if (url.username || url.password || text.includes('#')) throw new Error('Data endpoints must not contain credentials or fragments.');
    for (const [name, value] of url.searchParams) {
      if (SECRET_QUERY.test(name) || /^(?:bearer|basic)\s/i.test(value) || /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) {
        throw new Error('Data endpoints must not contain credential query parameters. Use the token controls instead.');
      }
    }
    if (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) throw new Error('The advertised port must be between 1 and 65535.');
    return url;
  }

  function host(url) {
    return url.hostname.replace(/^\[|\]$/g, '');
  }

  function format(value) {
    if (value === undefined || value === null || value === '') return 'delimited';
    const mapped = FORMATS[String(value).toLowerCase()];
    if (!mapped) throw new Error('The advertised data format is not supported.');
    return mapped;
  }

  function buildVelocityConnectionOptions(item) {
    if (!item || typeof item !== 'object') throw new Error('Select a data endpoint before applying settings.');
    if (item.feedType === 'websocket') throw new Error('A WebSocket feed is an outbound source, not a receiver the Simulator can publish to.');
    const type = item.feedType || item.outputType;
    const isStream = !item.feedType && item.connectionType === 'ws-client' && (!type || type === 'stream-layer');
    if (type === 'grpc') {
      const advertised = item.url || item.host;
      if (typeof advertised !== 'string' || !advertised.trim()) throw new Error('The advertised gRPC authority is missing.');
      const text = advertised.trim();
      const historicalUrl = /^https?:\/\//i.test(text);
      if (!historicalUrl && !/^(?:\[[0-9a-f:.]+\]|[^:/?#@\s\\]+)(?::[0-9]+)?$/i.test(text)) {
        throw new Error('The gRPC endpoint must be a host or bracketed IPv6 authority with an optional port.');
      }
      const url = endpointUrl(historicalUrl ? text : `https://${text}`, ['http:', 'https:']);
      if (url.pathname !== '/' || url.search) throw new Error('The gRPC endpoint must not contain an RPC path or query; use routing metadata.');
      const tls = url.protocol === 'https:';
      const headerPathKey = item.headerPathKey === undefined || item.headerPathKey === '' ? 'grpc-path' : item.headerPathKey;
      const headerPath = item.headerPath === undefined ? '' : item.headerPath;
      if (typeof headerPathKey !== 'string' || !/^[0-9a-z_.-]+$/.test(headerPathKey) || headerPathKey.endsWith('-bin')) {
        throw new Error('The advertised gRPC routing header key is invalid.');
      }
      if (typeof headerPath !== 'string' || /[^\x20-\x7e]/.test(headerPath)) throw new Error('The advertised gRPC routing header value is invalid.');
      return {
        connectionType: 'grpc-client', ip: host(url), port: Number(url.port || (tls ? 443 : 80)),
        grpcTls: tls, grpcSerialization: 'protobuf', grpcHeaderPathKey: headerPathKey, grpcHeaderPath: headerPath,
      };
    }
    if (type === 'http-receiver' || (!item.feedType && type === 'http')) {
      const url = endpointUrl(item.url, ['http:', 'https:']);
      const tls = url.protocol === 'https:';
      return {
        connectionType: 'http-client', ip: host(url), port: Number(url.port || (tls ? 443 : 80)),
        httpTls: tls, httpPath: `${url.pathname}${url.search}`, httpFormat: format(item.format),
      };
    }
    if ((!item.feedType && type === 'websocket') || isStream) {
      const url = endpointUrl(item.url, ['ws:', 'wss:']);
      const tls = url.protocol === 'wss:';
      return {
        connectionType: 'ws-client', ip: host(url), port: Number(url.port || (tls ? 443 : 80)),
        wsTls: tls, wsPath: `${url.pathname}${url.search}`, wsFormat: format(item.format),
      };
    }
    throw new Error('This item does not advertise a supported data endpoint.');
  }

  return { buildVelocityConnectionOptions };
}));
