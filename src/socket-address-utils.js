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

const dns = require('dns').promises;
const net = require('net');
const { formatNetworkAuthority } = require('./network-address-utils');

function normalizeSocketAddressFamily(value = 'auto', { allowAuto = true } = {}) {
  if (value !== 'ipv4' && value !== 'ipv6' && !(allowAuto && value === 'auto')) {
    throw new Error(`Address family must be ${allowAuto ? 'auto, ipv4, or ipv6' : 'ipv4 or ipv6'}.`);
  }
  return value;
}

function normalizeUdpAddressFamily(value = 'ipv4') {
  return normalizeSocketAddressFamily(value, { allowAuto: false });
}

function udpSocketType(family = 'ipv4') {
  return normalizeUdpAddressFamily(family) === 'ipv6' ? 'udp6' : 'udp4';
}

function normalizeSocketHost(host, family = 'auto', { protocol = 'TCP' } = {}) {
  normalizeSocketAddressFamily(family, { allowAuto: protocol !== 'UDP' });
  if (typeof host !== 'string' || !host.trim()) throw new Error(`A ${protocol} host is required.`);
  let address = host.trim();
  if (address.startsWith('[') || address.endsWith(']')) {
    if (!address.startsWith('[') || !address.endsWith(']') || net.isIP(address.slice(1, -1)) !== 6) {
      throw new Error(`${protocol} host brackets must contain a valid IPv6 address without a port.`);
    }
    address = address.slice(1, -1);
  }
  const literalFamily = net.isIP(address);
  if (!literalFamily && !/^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.?$/i.test(address)) {
    throw new Error(`${protocol} host must be an IP address or DNS name, without a URL or port.`);
  }
  if (family !== 'auto' && literalFamily && literalFamily !== (family === 'ipv6' ? 6 : 4)) {
    throw new Error(`${protocol} host ${address} does not match the selected ${family === 'ipv6' ? 'IPv6' : 'IPv4'} address family.`);
  }
  if (literalFamily === 6) {
    const [literal, scope] = address.split('%');
    address = new URL(`http://[${literal}]/`).hostname.slice(1, -1);
    if (family !== 'auto' && address.startsWith('::ffff:')) throw new Error('IPv4-mapped IPv6 addresses require TCP Auto or an IPv4 address. Choose IPv4 instead.');
    if (scope) address += `%${scope}`;
  }
  return address;
}

function normalizeUdpHost(host, family = 'ipv4') {
  return normalizeSocketHost(host, family, { protocol: 'UDP' });
}

async function resolveSocketEndpoint(host, family = 'auto', { bind = false, lookup = dns.lookup, protocol = 'TCP' } = {}) {
  normalizeSocketAddressFamily(family, { allowAuto: protocol !== 'UDP' });
  if (bind && family === 'auto' && (host === undefined || host === '')) return { address: host, family: 0 };
  const normalized = normalizeSocketHost(host, family, { protocol });
  if (!bind && (normalized === '0.0.0.0' || normalized === '::')) {
    throw new Error(`A ${protocol} destination must be a reachable host, not a wildcard bind address.`);
  }
  if (family === 'auto') return { address: normalized, family: 0 };
  const numericFamily = family === 'ipv6' ? 6 : 4;
  let address = normalized;
  if (!net.isIP(address)) {
    let resolved;
    try {
      resolved = await lookup(address, { family: numericFamily });
    } catch (cause) {
      throw new Error(`${protocol} host ${normalized} could not be resolved to ${family === 'ipv6' ? 'IPv6' : 'IPv4'}.`, { cause });
    }
    address = normalizeSocketHost(resolved.address, family, { protocol });
    if (!net.isIP(address)) throw new Error(`${protocol} host ${normalized} did not resolve to an ${family === 'ipv6' ? 'IPv6' : 'IPv4'} address.`);
  }
  if (!bind && (address === '0.0.0.0' || address === '::')) {
    throw new Error(`A ${protocol} destination must be a reachable host, not a wildcard bind address.`);
  }
  return { address, family: numericFamily };
}

function tcpSocketOptions(endpoint, port, { bind = false } = {}) {
  return {
    host: endpoint.address,
    port,
    ...(endpoint.family && !bind ? { family: endpoint.family } : {}),
    ...(endpoint.family === 6 && bind ? { ipv6Only: true } : {}),
  };
}

async function resolveUdpEndpoint(host, family = 'ipv4', options = {}) {
  normalizeUdpAddressFamily(family);
  const endpoint = await resolveSocketEndpoint(host, family, { ...options, protocol: 'UDP' });
  return {
    ...endpoint,
    socketOptions: family === 'ipv6' ? { type: 'udp6', ipv6Only: true } : { type: 'udp4' },
  };
}

function udpEndpointKey({ address, port }) {
  if (typeof address !== 'string' || !net.isIP(address) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('A UDP recipient requires an IP address and a port between 1 and 65535.');
  }
  return JSON.stringify([address, port]);
}

function formatSocketEndpoint({ address, port }) {
  return formatNetworkAuthority(address, port);
}

module.exports = {
  normalizeSocketAddressFamily,
  normalizeSocketHost,
  resolveSocketEndpoint,
  tcpSocketOptions,
  formatSocketEndpoint,
  normalizeUdpAddressFamily,
  normalizeUdpHost,
  udpSocketType,
  resolveUdpEndpoint,
  udpEndpointKey,
  formatUdpEndpoint: formatSocketEndpoint,
};
