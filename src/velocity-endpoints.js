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

function endpointError(message, code = 'INVALID_ENDPOINT') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeBaseUrl(value, kind) {
  const invalid = () => endpointError(`${kind} must be a complete HTTPS base URL without credentials, query parameters, fragments, or resource paths.`);
  if (typeof value !== 'string' || !value.trim()) throw invalid();
  const raw = value.trim();
  if (/[\s\\?#]/.test(raw)) throw invalid();
  const match = /^https:\/\/([^/]+)(\/.*)?$/i.exec(raw);
  if (!match || match[1].includes('@')) throw invalid();
  const path = match[2] || '';
  if (path.includes('//')) throw invalid();
  const segments = path.split('/').filter(Boolean);
  for (const segment of segments) {
    let decoded;
    try { decoded = decodeURIComponent(segment); } catch { throw invalid(); }
    if (decoded === '.' || decoded === '..' || /[/\\?#%\s\u0000-\u001f\u007f]/.test(decoded)) throw invalid();
  }
  const lower = segments.map(segment => decodeURIComponent(segment).toLowerCase());
  const reserved = kind === 'Portal URL'
    ? ['home', 'sharing']
    : kind === 'Service metadata URL' ? []
      : ['home', 'feed', 'feeds', 'output', 'outputs', 'analytic', 'analytics', 'realtime', 'bigdata', 'admin'];
  if (lower.some(segment => reserved.includes(segment)) || /\.(?:html?|json)$/i.test(lower.at(-1) || '')) throw invalid();
  let parsed;
  try { parsed = new URL(raw); } catch { throw invalid(); }
  if (!parsed.hostname || parsed.username || parsed.password) throw invalid();
  // URL removes an explicit default port. Keep it so the configured public URL
  // remains recognizable, including through reverse proxies.
  const port = /:(\d+)$/.exec(match[1]);
  if (match[1].endsWith(':')) throw invalid();
  return `https://${parsed.hostname}${port ? `:${Number(port[1])}` : ''}${parsed.pathname.replace(/\/$/, '')}`;
}

function normalizePortalUrl(value) {
  return normalizeBaseUrl(value, 'Portal URL');
}

function normalizeApiBaseUrl(value) {
  return normalizeBaseUrl(value, 'Public API URL');
}

function normalizeServiceMetadataUrl(value) {
  return normalizeBaseUrl(value, 'Service metadata URL');
}

function apiUrl(context, resource, query = {}) {
  const base = normalizeApiBaseUrl(typeof context === 'string' ? context : context && context.apiBaseUrl);
  if (typeof resource !== 'string' || !resource || /[?#\\\s]/.test(resource)
      || resource.startsWith('/') || resource.endsWith('/') || resource.includes('//')) {
    throw endpointError('Use a relative API resource path with individually encoded identifiers.');
  }
  for (const segment of resource.split('/')) {
    let decoded;
    try { decoded = decodeURIComponent(segment); } catch { throw endpointError('Invalid API resource path.'); }
    if (decoded === '.' || decoded === '..') throw endpointError('Invalid API resource path.');
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  return `${base}/${resource}${params.size ? `?${params}` : ''}`;
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFeedConfiguration(item) {
  return isRecord(item) && typeof item.id === 'string' && item.id.length > 0
    && isRecord(item.feed) && typeof item.feed.name === 'string' && item.feed.name.length > 0
    && isRecord(item.feed.properties);
}

function validateFeedConfigurations(value) {
  if (!Array.isArray(value) || !value.every(isFeedConfiguration)) {
    throw endpointError('The Velocity endpoint did not return a raw feed configuration array. Check the public API URL; connector catalogs and response envelopes are not feed instances.', 'INVALID_RESPONSE');
  }
  return value;
}

module.exports = {
  normalizePortalUrl,
  normalizeApiBaseUrl,
  normalizeServiceMetadataUrl,
  apiUrl,
  endpointError,
  isRecord,
  isFeedConfiguration,
  validateFeedConfigurations,
};
