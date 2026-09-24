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

  function socketFormat(value) {
    const mapped = format(value);
    if (mapped === 'xml') throw new Error('XML is not supported for TCP or UDP payloads.');
    return mapped;
  }

  function endpointHost(value) {
    const url = endpointUrl(value, ['https:', 'http:']);
    return host(url);
  }

  function socketHost(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} host is missing.`);
    const text = value.trim();
    if (/[\s/?#@\\]/.test(text)) throw new Error(`${label} host is invalid.`);
    if (text.includes(':') || text.startsWith('[') || text.endsWith(']')) {
      const authority = text.startsWith('[') && text.endsWith(']') ? text : `[${text}]`;
      let url;
      try { url = new URL(`http://${authority}`); } catch (_) { throw new Error(`${label} host is invalid.`); }
      if (url.port || !url.hostname.startsWith('[') || !url.hostname.endsWith(']')) {
        throw new Error(`${label} host is invalid.`);
      }
      return host(url);
    }
    if (!/^[a-z0-9._~-]+$/i.test(text) || text.startsWith('.') || text.endsWith('.')) {
      throw new Error(`${label} host is invalid.`);
    }
    return text;
  }

  function socketPort(value, label) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`${label} port must be between 1 and 65535.`);
    }
    return port;
  }

  function buildVelocityConnectionOptions(item) {
    if (!item || typeof item !== 'object') throw new Error('Select a data endpoint before applying settings.');
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
    if (type === 'http-receiver') {
      const url = endpointUrl(item.url, ['http:', 'https:']);
      const tls = url.protocol === 'https:';
      return {
        connectionType: 'http-client', ip: host(url), port: Number(url.port || (tls ? 443 : 80)),
        httpTls: tls, httpPath: `${url.pathname}${url.search}`, httpFormat: format(item.format),
      };
    }
    if (!item.feedType && type === 'http') {
      const url = endpointUrl(item.url, ['http:', 'https:']);
      const tls = url.protocol === 'https:';
      return {
        connectionType: 'http-server', ip: host(url), port: Number(url.port || (tls ? 443 : 80)),
        httpTls: tls, httpPath: `${url.pathname}${url.search}`, httpFormat: format(item.format),
      };
    }
    if (item.feedType === 'http-poller') {
      if (String(item.httpMethod || 'GET').toUpperCase() !== 'GET') {
        throw new Error('Only GET-based HTTP Poller feeds can use the Simulator HTTP server.');
      }
      const url = endpointUrl(item.url, ['http:', 'https:']);
      const tls = url.protocol === 'https:';
      return {
        connectionType: 'http-server', ip: host(url), port: Number(url.port || (tls ? 443 : 80)),
        httpTls: tls, httpPath: `${url.pathname}${url.search}`,
        httpFormat: format(item.format), httpPolling: true,
      };
    }
    if (item.feedType === 'websocket') {
      const url = endpointUrl(item.url, ['ws:', 'wss:']);
      const tls = url.protocol === 'wss:';
      return {
        connectionType: 'ws-server', ip: host(url), port: Number(url.port || (tls ? 443 : 80)),
        wsTls: tls, wsPath: url.pathname, wsFormat: format(item.format),
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
    if (['udp-client', 'udp-server'].includes(type)) {
      const isFeed = Boolean(item.feedType);
      if (!item.host || item.host === '0.0.0.0' || item.host === '*') {
        throw new Error(isFeed
          ? 'This UDP feed needs a routable data host. Configure UDP Client manually with the reachable feed host, address family, and advertised port; the management API URL is not a data endpoint.'
          : 'This UDP output needs an advertised destination host. Ensure its destination routes to the Logger; the management API URL is not a data endpoint.');
      }
      const configuredHost = socketHost(item.host, 'UDP');
      const literalIpv6 = configuredHost.includes(':');
      const udpAddressFamily = item.udpAddressFamily ?? (literalIpv6 ? 'ipv6' : 'ipv4');
      if (!['ipv4', 'ipv6'].includes(udpAddressFamily)) throw new Error('UDP address family must be ipv4 or ipv6.');
      if ((literalIpv6 && udpAddressFamily !== 'ipv6')
          || (/^\d+\.\d+\.\d+\.\d+$/.test(configuredHost) && udpAddressFamily !== 'ipv4')) {
        throw new Error('The advertised UDP host does not match its address family.');
      }
      if (configuredHost.startsWith('::ffff:')) throw new Error('IPv4-mapped IPv6 addresses are not supported for UDP. Choose IPv4 instead.');
      if (configuredHost === '0.0.0.0' || configuredHost === '::') throw new Error('UDP automatic configuration requires a routable data host, not a wildcard bind address.');
      if (item.feedType === 'udp-server' && udpAddressFamily === 'ipv6') {
        throw new Error('Velocity UDP Server feeds bind IPv4 only. Use an advertised IPv4 data host or an IPv4 forwarding endpoint.');
      }
      const port = socketPort(item.port, 'UDP');
      const options = {
        connectionType: isFeed ? 'udp-client' : 'udp-server',
        ip: isFeed ? configuredHost : udpAddressFamily === 'ipv6' ? '::1' : '127.0.0.1',
        port,
        udpAddressFamily,
        udpFormat: socketFormat(item.format),
      };
      if (isFeed) options.udpAppendNewline = options.udpFormat === 'delimited';
      if (!isFeed) {
        options.expectedDestination = { host: configuredHost, port, family: udpAddressFamily };
        options.routingWarning = `Velocity sends UDP datagrams to ${literalIpv6 ? `[${configuredHost}]` : configuredHost}:${port}. The Logger bind address defaults to ${options.ip}; choose a local interface and ensure the advertised destination routes to this Logger.`
          + (type === 'udp-server' ? ' A UDP Server output destination may be fixed by the deployment public host name.' : '')
          + ' No registration datagram is sent.';
      }
      return options;
    }
    if (['tcp', 'tcp-client', 'tcp-server'].includes(type)) {
      const protocol = 'tcp';
      const connectorServer = type.endsWith('-server');
      const configuredHost = connectorServer
        ? (item.host ? socketHost(item.host, 'TCP') : endpointHost(item.serverApiUrl))
        : socketHost(item.host, protocol.toUpperCase());
      const ipv6 = configuredHost.includes(':');
      const tcpAddressFamily = item.tcpAddressFamily ?? (ipv6 ? 'ipv6' : connectorServer ? 'ipv4' : 'auto');
      if (!['auto', 'ipv4', 'ipv6'].includes(tcpAddressFamily)) throw new Error('TCP address family must be auto, ipv4, or ipv6.');
      if (tcpAddressFamily !== 'auto' && configuredHost.startsWith('::ffff:')) {
        throw new Error('IPv4-mapped IPv6 addresses require TCP Auto or an IPv4 address. Choose IPv4 instead.');
      }
      if ((ipv6 && tcpAddressFamily === 'ipv4')
          || (/^\d+\.\d+\.\d+\.\d+$/.test(configuredHost) && tcpAddressFamily === 'ipv6')) {
        throw new Error('The advertised TCP host does not match its address family.');
      }
      if (connectorServer && (ipv6 || tcpAddressFamily === 'ipv6')) {
        throw new Error('Velocity TCP Server feeds and outputs bind IPv4 only. Use an advertised IPv4 data host or an IPv4 forwarding endpoint.');
      }
      const port = socketPort(item.port, protocol.toUpperCase());
      return {
        connectionType: `${protocol}-${connectorServer ? 'client' : 'server'}`,
        ip: configuredHost,
        port,
        tcpAddressFamily: connectorServer ? 'ipv4' : tcpAddressFamily,
        tcpHandshakeText: '',
        tcpHandshakeUseEscapes: true,
        [`${protocol}Format`]: socketFormat(item.format),
      };
    }
    throw new Error('This item does not advertise a supported data endpoint.');
  }

  return { buildVelocityConnectionOptions };
}));
