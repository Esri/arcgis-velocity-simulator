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
  DEFAULT_PORTAL_URL, jsonRequest, generateToken, generateOAuthToken,
  TokenManager, assertArcGISResponse,
} = require('./velocity-rest-client');
const {
  apiUrl, endpointError, isRecord, isFeedConfiguration, validateFeedConfigurations,
} = require('./velocity-endpoints');
const { discoverVelocityEndpoint, discoverVelocityServers } = require('./velocity-session');
const { buildVelocityConnectionOptions } = require('./velocity-connection-options');

const SUPPORTED_FEED_TYPES = new Set([
  'grpc', 'http-receiver', 'http-poller', 'websocket',
  'tcp', 'tcp-client', 'tcp-server', 'udp-client', 'udp-server',
]);

async function getVelocityApiUrl(portalUrl, token, options = {}) {
  return (await discoverVelocityEndpoint(portalUrl, token, options)).apiBaseUrl;
}

function profileOf(context) {
  const profile = typeof context === 'object' && context ? context.profile || 'current' : 'current';
  if (!['current', 'legacy'].includes(profile)) throw endpointError('Unknown Velocity API profile.');
  return profile;
}

async function listFeeds(context, token, adminScope = false, { request = jsonRequest, onLog } = {}) {
  const resource = profileOf(context) === 'legacy' ? 'feeds' : 'feed';
  const query = adminScope ? { view: 'admin' } : {};
  const result = assertArcGISResponse(await request(apiUrl(context, resource, query), { token, onLog }));
  return validateFeedConfigurations(result).map(parseFeedItem);
}

async function getFeedDetails(context, feedId, token, { request = jsonRequest, onLog } = {}) {
  profileOf(context);
  if (typeof feedId !== 'string' || !feedId || feedId === '.' || feedId === '..') {
    throw endpointError('Select a feed with a valid identifier.', 'INVALID_ITEM');
  }
  const result = assertArcGISResponse(await request(apiUrl(context, `feed/${encodeURIComponent(feedId)}`), { token, onLog }));
  if (!isFeedConfiguration(result) || result.id !== feedId) {
    throw endpointError('The Velocity endpoint did not return the requested feed configuration.', 'INVALID_RESPONSE');
  }
  return parseFeedItem(result);
}

async function listOutputs() {
  throw endpointError('Output connector catalogs are not configured output instances. Use a real-time analytic output adapter to list configured outputs.', 'UNSUPPORTED_RESOURCE');
}

async function getOutputDetails() {
  throw endpointError('Configured output details belong to their real-time analytic. A standalone output instance endpoint is not supported.', 'UNSUPPORTED_RESOURCE');
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function safeSchema(attributes) {
  if (!Array.isArray(attributes)) return [];
  const keys = new Set(['name', 'dataType', 'type', 'alias', 'length', 'nullable', 'tags']);
  return attributes.filter(isRecord).map(attribute => {
    const safe = {};
    for (const [key, value] of Object.entries(attribute)) {
      if (!keys.has(key)) continue;
      if (['string', 'number', 'boolean'].includes(typeof value) || value === null) safe[key] = value;
      else if (key === 'tags' && Array.isArray(value)) safe[key] = value.filter(tag => typeof tag === 'string');
    }
    return safe;
  });
}

function safeDataUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash || !['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol)) return '';
    for (const key of url.searchParams.keys()) {
      if (/token|password|secret|api[_-]?key|authorization|signature|credential/i.test(key)) return '';
    }
    return value;
  } catch { return ''; }
}

function safeGrpcAuthority(value) {
  if (typeof value !== 'string') return '';
  try {
    buildVelocityConnectionOptions({ feedType: 'grpc', url: value });
    return value.trim();
  } catch { return ''; }
}

function parseItem(item, direction) {
  const container = isRecord(item) ? item : {};
  const definition = isRecord(container[direction]) ? container[direction] : container;
  const name = text(definition.name);
  const properties = isRecord(definition.properties) ? definition.properties : {};
  const transformation = isRecord(definition.schemaTransformation) ? definition.schemaTransformation : {};
  const schema = transformation[direction === 'feed' ? 'inputSchema' : 'outputSchema'];
  const supportedTypes = direction === 'feed' ? SUPPORTED_FEED_TYPES
    : new Set(['grpc', 'http', 'websocket', 'tcp', 'tcp-client', 'tcp-server', 'udp-client', 'udp-server']);
  const parsed = {
    label: text(container.label),
    id: text(container.id),
    [direction === 'feed' ? 'feedType' : 'outputType']: name,
    format: text(definition.formatName),
    schema: safeSchema(schema && schema.attributes),
    supported: supportedTypes.has(name),
  };
  if (name === 'grpc') {
    parsed.url = safeGrpcAuthority(properties['grpc.url']);
    parsed.headerPath = text(properties['grpc.headerPath']);
    parsed.headerPathKey = text(properties['grpc.headerPathKey']) || 'grpc-path';
    parsed.authType = text(properties['grpc.authenticationType']);
  } else if (['http-receiver', 'http-poller', 'http', 'websocket'].includes(name)) {
    parsed.url = safeDataUrl(properties[`${name}.url`]);
    parsed.authType = text(properties[`${name}.${name === 'http-receiver' ? 'httpAuthenticationType' : 'authenticationType'}`]);
    if (name === 'http-poller') parsed.httpMethod = text(properties['http-poller.httpMethod']) || 'GET';
  } else if (['mqtt', 'kinetic'].includes(name)) {
    for (const key of ['host', 'port', 'topic', 'username', 'qos']) {
      const value = properties[`${name}.${key}`];
      parsed[key] = typeof value === 'number' ? value : text(value);
    }
    parsed.clientId = text(properties[`${name}.clientid`]);
  } else if (['azure-event-hub', 'azure-service-bus'].includes(name)) {
    parsed.endpoint = safeDataUrl(properties[`${name}.endpoint`]);
    parsed.entityPath = text(properties[`${name}.${name === 'azure-event-hub' ? 'entityPath' : 'topicName'}`]);
    parsed.sharedAccessKeyName = text(properties[`${name}.sharedAccessKeyName`]);
  } else if (['tcp', 'tcp-client', 'tcp-server', 'udp-client', 'udp-server'].includes(name)) {
    parsed.host = text(properties[`${name}.hostname`] ?? properties[`${name}.host`]);
    parsed.port = typeof properties[`${name}.port`] === 'number'
      ? properties[`${name}.port`] : text(properties[`${name}.port`]);
    const formatPrefix = text(definition.formatName).toLowerCase();
    if (formatPrefix) {
      parsed.xField = text(properties[`${formatPrefix}.xField`]);
      parsed.yField = text(properties[`${formatPrefix}.yField`]);
    }
    if (!Number.isInteger(Number(parsed.port)) || Number(parsed.port) < 1 || Number(parsed.port) > 65535) {
      parsed.supported = false;
      parsed.reason = 'This feed does not advertise a valid TCP or UDP port.';
    } else if (!name.endsWith('-server') && !parsed.host) {
      parsed.supported = false;
      parsed.reason = 'This feed does not advertise the host used by its client connection.';
    }
  }
  if (direction === 'feed' && name === 'http-poller' && parsed.httpMethod.toUpperCase() !== 'GET') {
    parsed.supported = false;
    parsed.reason = 'Only GET-based HTTP Poller feeds can use the Simulator HTTP server.';
  } else if (parsed.supported && Object.hasOwn(parsed, 'url') && !parsed.url) {
    parsed.supported = false;
    parsed.reason = 'This item has no valid public data URL, or its URL contains embedded credentials. Configure the connection manually.';
  } else if (!parsed.supported) {
    parsed.reason = `This ${direction} type is not yet supported by the ${direction === 'feed' ? 'Simulator' : 'Logger'}.`;
  }
  return parsed;
}

function parseFeedItem(item) { return parseItem(item, 'feed'); }
function parseOutputItem(item) { return parseItem(item, 'output'); }

module.exports = {
  DEFAULT_PORTAL_URL,
  SUPPORTED_FEED_TYPES,
  jsonRequest,
  generateToken,
  generateOAuthToken,
  getVelocityApiUrl,
  discoverVelocityServers,
  listFeeds,
  listOutputs,
  getFeedDetails,
  getOutputDetails,
  parseFeedItem,
  parseOutputItem,
  TokenManager,
};
