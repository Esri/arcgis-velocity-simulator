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

const { createHash } = require('crypto');
const {
  normalizePortalUrl, normalizeApiBaseUrl, normalizeServiceMetadataUrl, apiUrl, endpointError,
  isRecord, validateFeedConfigurations,
} = require('./velocity-endpoints');
const { DEFAULT_PORTAL_URL, jsonRequest, TokenManager, assertArcGISResponse } = require('./velocity-rest-client');

const MAX_CANDIDATES = 8;
const DISCOVERY_HELP = 'Automatic detection could not confirm a public Velocity API URL. Choose Custom and enter the complete public API base URL.';

function log(onLog, level, message) {
  if (typeof onLog === 'function') {
    try { onLog(level, message); } catch { /* Logging must not change session state. */ }
  }
}

function isMissingRoute(error) {
  return !!error && [404, 405].includes(error.httpStatus)
    && (!error.code || ['HTTP_ERROR', 'ARCGIS_ERROR'].includes(error.code))
    && (!error.arcgisCode || [404, 405].includes(error.arcgisCode));
}

function safeEndpointError(error) {
  const known = new Set([
    'INVALID_ENDPOINT', 'INVALID_RESPONSE', 'DISCOVERY_REQUIRED', 'HTTP_ERROR',
    'ARCGIS_ERROR', 'REDIRECT', 'INVALID_JSON', 'RESPONSE_TOO_LARGE', 'TIMEOUT',
    'NETWORK_ERROR', 'AUTH_REQUIRED', 'INVALID_TOKEN',
    'ENDPOINT_REQUIRED', 'SERVER_REQUIRED', 'UNKNOWN_SERVER', 'UNSUPPORTED_RESOURCE',
  ]);
  if (error && known.has(error.code)) return error.message;
  return 'The Velocity endpoint could not be verified. Check access, certificate trust, and the public API URL.';
}

async function validateVelocityEndpoint(apiBaseUrl, token, { request = jsonRequest, onLog, profile = 'current' } = {}) {
  const context = { apiBaseUrl: normalizeApiBaseUrl(apiBaseUrl), profile };
  if (!['current', 'legacy'].includes(profile)) throw endpointError('Unknown Velocity API profile.');
  const resource = profile === 'legacy' ? 'feeds' : 'feed';
  log(onLog, 'info', '[API] Validating the Velocity feed endpoint.');
  validateFeedConfigurations(assertArcGISResponse(await request(apiUrl(context, resource), { token, onLog })));
  log(onLog, 'info', '[API] Velocity feed endpoint validated.');
  return context;
}

async function validateCustomEndpoint(base, token, options) {
  try {
    return await validateVelocityEndpoint(base, token, options);
  } catch (error) {
    if (!isMissingRoute(error) || !/\/iot$/i.test(new URL(base).pathname)) throw error;
    return validateVelocityEndpoint(base, token, { ...options, profile: 'legacy' });
  }
}

function subscriptionCandidates(metadata) {
  if (!isRecord(metadata) || (metadata.orgCapabilities !== undefined && !Array.isArray(metadata.orgCapabilities))) {
    throw endpointError('Portal subscription metadata has an unexpected shape. Use Custom to specify the public API URL.', 'INVALID_RESPONSE');
  }
  const candidates = [];
  for (const capability of metadata.orgCapabilities || []) {
    if (!isRecord(capability) || !['velocity', 'a4iot'].includes(String(capability.id).toLowerCase())) continue;
    for (const key of ['velocityUrl', 'iotRegionUrl']) {
      if (typeof capability[key] === 'string' && capability[key]) candidates.push(capability[key]);
    }
  }
  return candidates;
}

function serverCandidates(metadata) {
  if (!isRecord(metadata) || !Array.isArray(metadata.servers)) {
    throw endpointError('Portal server metadata has an unexpected shape. Use Custom to specify the public API URL.', 'INVALID_RESPONSE');
  }
  const candidates = [];
  for (const server of metadata.servers) {
    if (!isVelocityServer(server)) continue;
    for (const key of ['url', 'serverUrl']) {
      if (typeof server[key] === 'string' && server[key]) candidates.push(server[key]);
    }
  }
  return candidates;
}

function isVelocityServer(server) {
  return isRecord(server) && [server.serverType, server.serverFunction, server.type]
    .some(type => typeof type === 'string' && /^(?:arcgis[_ -]?)?velocity(?:[_ -]?server)?$/i.test(type));
}

function candidateContexts(value) {
  const base = normalizeApiBaseUrl(value);
  const pathname = new URL(base).pathname.replace(/\/$/, '');
  if (/\/iot$/i.test(pathname)) return [{ apiBaseUrl: base, profile: 'current' }, { apiBaseUrl: base, profile: 'legacy' }];
  const contexts = [{ apiBaseUrl: base, profile: 'current' }];
  // Only contextless metadata permits probing an added public context.
  // Explicit Custom URLs are never rewritten.
  const contextual = /\/(?:arcgis|velocity)$/i.test(pathname) || /\/orgid\/[^/]+$/i.test(pathname);
  if (!contextual) contexts.push({ apiBaseUrl: `${base}/arcgis`, profile: 'current' });
  contexts.push({ apiBaseUrl: `${base}/iot`, profile: 'legacy' });
  return contexts;
}

function candidateValidator(token, { request, onLog }) {
  const seen = new Set();
  return async candidates => {
    for (const candidate of candidates) {
      let contexts;
      try { contexts = candidateContexts(candidate); } catch {
        throw endpointError('Portal advertised an invalid Velocity base URL. Choose Custom and enter the complete public API base URL.', 'INVALID_ENDPOINT');
      }
      for (const context of contexts) {
        const key = `${context.profile}:${context.apiBaseUrl}`;
        if (seen.has(key)) continue;
        if (seen.size >= MAX_CANDIDATES) throw endpointError(DISCOVERY_HELP, 'DISCOVERY_REQUIRED');
        seen.add(key);
        try {
          return await validateVelocityEndpoint(context.apiBaseUrl, token, { request, onLog, profile: context.profile });
        } catch (error) {
          if (!isMissingRoute(error)) throw error;
        }
      }
    }
    return null;
  };
}

async function readPortalMetadata(portal, resource, token, { request, onLog }) {
  try {
    const query = new URLSearchParams({ f: 'json' });
    if (resource === 'servers' && token) query.set('token', token);
    return assertArcGISResponse(await request(`${portal}/sharing/rest/portals/self/${resource}?${query}`, { token, onLog }));
  } catch (error) {
    if (!isMissingRoute(error) && error.apiReason !== 'UNSUPPORTED_OPERATION') throw error;
    return undefined;
  }
}

async function mapServers(servers, callback) {
  let index = 0;
  const results = new Array(servers.length);
  const worker = async () => {
    while (index < servers.length) {
      const current = index++;
      results[current] = await callback(servers[current]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, servers.length) }, worker));
  return results;
}

async function discoverVelocityEndpoint(portalUrl, token, { request = jsonRequest, onLog } = {}) {
  const portal = normalizePortalUrl(portalUrl);
  const tryCandidates = candidateValidator(token, { request, onLog });
  log(onLog, 'info', '[API] Discovering Velocity through public Portal metadata.');
  const subscription = await readPortalMetadata(portal, 'subscriptionInfo', token, { request, onLog });
  if (subscription !== undefined) {
    const context = await tryCandidates(subscriptionCandidates(subscription));
    if (context) return context;
  }
  const servers = await readPortalMetadata(portal, 'servers', token, { request, onLog });
  if (servers !== undefined) {
    const context = await tryCandidates(serverCandidates(servers));
    if (context) return context;
  }
  throw endpointError(DISCOVERY_HELP, 'DISCOVERY_REQUIRED');
}

function metadataUrl(value) {
  try { return normalizeServiceMetadataUrl(value); } catch { return ''; }
}

function legacyProfileTarget(saved, sources) {
  if (saved.endpointMode !== 'custom') return null;
  let publicApiUrl;
  try { publicApiUrl = normalizeApiBaseUrl(saved.publicApiUrl); } catch { return null; }
  const matches = sources.length === 1 ? sources : sources.filter(source =>
    (source.advertisedUrls || []).some(url => {
      try { return new URL(normalizeApiBaseUrl(url)).href === new URL(publicApiUrl).href; } catch { return false; }
    }));
  return matches.length === 1
    ? { serverId: matches[0].serverId, endpointMode: 'custom', publicApiUrl } : null;
}

function serverRecord(server, source, candidateUrls) {
  const advertisedUrls = [...new Set(candidateUrls.map(metadataUrl).filter(Boolean))];
  const publicUrl = advertisedUrls[0] || '';
  const registeredId = typeof server.id === 'string' && server.id.trim()
    && server.id.length <= 256 && !/[\u0000-\u001f\u007f]/.test(server.id) ? server.id : '';
  const serverId = registeredId || `${source}-${createHash('sha256').update(publicUrl).digest('hex').slice(0, 24)}`;
  const label = typeof server.name === 'string' && server.name.trim()
    ? server.name.slice(0, 256) : publicUrl || 'Velocity server';
  return {
    serverId, label, source,
    registered: source === 'portal-server' && !!registeredId,
    publicUrl,
    nativeUrl: metadataUrl(server.nativeUrl || server.adminUrl),
    advertisedUrls,
    status: publicUrl ? 'unverified' : 'error',
    context: null,
    endpointError: publicUrl ? '' : 'Portal did not advertise a valid public HTTPS URL for this Velocity server.',
  };
}

/**
 * Enumerate all known Velocity servers using one Portal token. Native/admin
 * URLs are metadata only and are never requested. Validation failures are
 * retained on their server records rather than hiding other servers.
 */
async function discoverVelocityServers(portalUrl, token, { request = jsonRequest, onLog, validate = true } = {}) {
  const portal = normalizePortalUrl(portalUrl);
  log(onLog, 'info', '[API] Listing Velocity servers from public Portal metadata.');
  const servers = await readPortalMetadata(portal, 'servers', token, { request, onLog });
  const records = [];
  if (servers !== undefined) {
    serverCandidates(servers);
    for (const server of servers.servers) {
      if (!isVelocityServer(server)) continue;
      records.push(serverRecord(server, 'portal-server', [server.url, server.serverUrl]));
    }
  }
  // A federated registry is authoritative. Subscription metadata is only
  // needed when that registry does not advertise any Velocity server.
  const subscription = records.length ? undefined
    : await readPortalMetadata(portal, 'subscriptionInfo', token, { request, onLog });
  if (subscription !== undefined) {
    subscriptionCandidates(subscription);
    for (const capability of subscription.orgCapabilities || []) {
      if (!isRecord(capability) || !['velocity', 'a4iot'].includes(String(capability.id).toLowerCase())) continue;
      const candidates = [capability.velocityUrl, capability.iotRegionUrl].filter(value => typeof value === 'string' && value);
      if (!candidates.length) continue;
      const record = serverRecord({ name: 'Velocity subscription' }, 'subscription', candidates);
      if (!records.some(existing => existing.serverId === record.serverId)) records.push(record);
    }
  }
  if (!records.length) throw endpointError(DISCOVERY_HELP, 'DISCOVERY_REQUIRED');
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.serverId)) {
      throw endpointError('Portal returned duplicate registered Velocity server identifiers. Resolve the registration before selecting a server.', 'INVALID_RESPONSE');
    }
    ids.add(record.serverId);
  }
  if (validate) {
    await mapServers(records, async record => {
      if (record.status === 'error') return;
      try {
        const context = await candidateValidator(token, { request, onLog })(record.advertisedUrls);
        if (!context) throw endpointError(DISCOVERY_HELP, 'DISCOVERY_REQUIRED');
        record.context = context;
        record.status = 'ready';
      } catch (error) {
        if (error.code === 'STALE_SESSION') throw error;
        record.status = 'error';
        record.endpointError = safeEndpointError(error);
      }
    });
  }
  log(onLog, 'info', `[API] Listed ${records.length} Velocity server(s).`);
  return records;
}

class VelocitySession {
  constructor({ tokenManager, request = jsonRequest, onLog } = {}) {
    this.tokenManager = tokenManager || new TokenManager({ request, onLog });
    this._request = request;
    this._onLog = onLog;
    this._generation = 0;
    this._endpointGeneration = 0;
    this._detectGeneration = 0;
    this._revision = 0;
    this._authRevision = 0;
    this._reset();
  }

  _reset() {
    this._portalUrl = DEFAULT_PORTAL_URL;
    this._servers = new Map();
    this._detectedSources = new Map();
    this._selectedServerId = 'all';
    this._initialEndpointMode = 'automatic';
    this._endpointError = '';
  }

  _serverState(server) {
    return {
      id: server.id,
      label: server.label,
      endpointMode: server.endpointMode,
      publicApiUrl: server.publicApiUrl,
      detectedUrl: server.detectedUrl,
      effectiveUrl: server.context ? server.context.apiBaseUrl : '',
      profile: server.context ? server.context.profile : '',
      status: server.status,
      error: server.error,
    };
  }

  get state() {
    const servers = [...this._servers.values()].map(server => this._serverState(server));
    const selected = this._selectedServerId !== 'all'
      ? servers.find(server => server.id === this._selectedServerId)
      : servers.length === 1 ? servers[0] : null;
    return {
      authenticated: this.tokenManager.isAuthenticated,
      portalUrl: this._portalUrl,
      endpointMode: selected ? selected.endpointMode : this._initialEndpointMode,
      publicApiUrl: selected ? selected.publicApiUrl : '',
      detectedUrl: selected ? selected.detectedUrl : '',
      effectiveUrl: selected ? selected.effectiveUrl : '',
      profile: selected ? selected.profile : '',
      expires: this.tokenManager.expires || 0,
      revision: this._revision,
      authRevision: this._authRevision,
      endpointError: selected ? selected.error || this._endpointError : this._endpointError,
      selectedServerId: this._selectedServerId,
      servers,
    };
  }

  get context() {
    return this._serverContext(this._serverForRun());
  }

  _serverForRun(serverId = this._selectedServerId) {
    if (serverId === 'all') {
      if (this._servers.size === 1) return this._servers.values().next().value;
      if (!this._servers.size) throw endpointError('No validated Velocity endpoint is active. Detect an endpoint or choose Custom.', 'ENDPOINT_REQUIRED');
      throw endpointError('Select a specific Velocity server for this operation.', 'SERVER_REQUIRED');
    }
    const server = this._servers.get(serverId);
    if (!server) throw endpointError('The selected Velocity server is not registered in this session.', 'UNKNOWN_SERVER');
    return server;
  }

  _serverContext(server) {
    if (!server.context) throw endpointError(server.error || 'No validated Velocity endpoint is active for this server.', 'ENDPOINT_REQUIRED');
    return { ...server.context, serverId: server.id, serverName: server.label };
  }

  selectServer(serverId) {
    if (serverId !== 'all' && !this._servers.has(serverId)) {
      throw endpointError('Select a registered Velocity server or All servers.', 'UNKNOWN_SERVER');
    }
    this._selectedServerId = serverId;
    return this.state;
  }

  _assertCurrent(generation, revision) {
    if (generation !== this._generation || (revision !== undefined && revision !== this._revision)) {
      throw endpointError('The Velocity session changed. Retry with the current session.', 'STALE_SESSION');
    }
  }

  async _currentToken(generation) {
    if (!this.tokenManager.isAuthenticated) {
      if (!this.tokenManager.token) throw endpointError('Sign in to ArcGIS before using Velocity.', 'AUTH_REQUIRED');
      await this.tokenManager.refresh();
      this._assertCurrent(generation);
    }
    if (!this.tokenManager.isAuthenticated) throw endpointError('Sign in to ArcGIS before using Velocity.', 'AUTH_REQUIRED');
    return this.tokenManager.token;
  }

  _sessionRequest(generation) {
    return async (url, options) => {
      this._assertCurrent(generation);
      await this._currentToken(generation);
      this._assertCurrent(generation);
      try {
        const currentUrl = /\/sharing\/rest\/portals\/self\/servers\?/.test(url)
          ? url.replace(/([?&])token=[^&]*/, (_, prefix) => `${prefix}token=${encodeURIComponent(this.tokenManager.token)}`)
          : url;
        const result = await this._request(currentUrl, { ...options, token: this.tokenManager.token });
        this._assertCurrent(generation);
        return result;
      } catch (error) {
        this._assertCurrent(generation);
        throw error;
      }
    };
  }

  _customSource() {
    return { serverId: 'custom', label: 'Custom Velocity server', source: 'custom', advertisedUrls: [], publicUrl: '' };
  }

  _serverFromSource(source, preference = {}) {
    return {
      id: source.serverId,
      label: source.label,
      endpointMode: preference.endpointMode || 'automatic',
      publicApiUrl: '',
      detectedUrl: source.context ? source.context.apiBaseUrl : source.publicUrl || '',
      context: null,
      status: source.status === 'error' ? 'error' : 'unverified',
      error: source.endpointError || '',
      source,
    };
  }

  async _validateServer(server, publicApiUrl, generation) {
    const token = await this._currentToken(generation);
    const options = { request: this._sessionRequest(generation), onLog: this._onLog };
    if (!['automatic', 'custom'].includes(server.endpointMode)) throw endpointError('Choose Automatic or Custom endpoint mode.');
    let context;
    if (server.endpointMode === 'custom') {
      server.publicApiUrl = normalizeApiBaseUrl(publicApiUrl);
      context = await validateCustomEndpoint(server.publicApiUrl, token, options);
    } else {
      context = await candidateValidator(token, options)(server.source.advertisedUrls || []);
      if (!context) throw endpointError(DISCOVERY_HELP, 'DISCOVERY_REQUIRED');
      server.publicApiUrl = '';
      server.detectedUrl = context.apiBaseUrl;
    }
    this._assertCurrent(generation);
    server.context = context;
    server.status = 'ready';
    server.error = '';
    return server;
  }

  async _discover(generation, validate = false) {
    const token = await this._currentToken(generation);
    return discoverVelocityServers(this._portalUrl, token, {
      request: this._sessionRequest(generation), onLog: this._onLog, validate,
    });
  }

  async login(options = {}) {
    const portal = normalizePortalUrl(options.portalUrl || DEFAULT_PORTAL_URL);
    const endpointMode = options.endpointMode || 'automatic';
    if (!['automatic', 'custom'].includes(endpointMode)) throw endpointError('Choose Automatic or Custom endpoint mode.');
    if (!['password', 'oauth'].includes(options.authMode)) throw endpointError('Choose password or OAuth authentication.', 'INVALID_CREDENTIALS');
    const generation = ++this._generation;
    const change = ++this._endpointGeneration;
    this._detectGeneration++;
    this._revision++;
    this._authRevision++;
    this._reset();
    this._portalUrl = portal;
    this._initialEndpointMode = endpointMode;
    this.tokenManager.logout();
    try {
      if (options.authMode === 'oauth') {
        await this.tokenManager.loginWithOAuth(portal, options.clientId, options.clientSecret);
      } else {
        await this.tokenManager.loginWithPassword(portal, options.username, options.password);
      }
    } catch (error) {
      this._assertCurrent(generation);
      throw error;
    }
    this._assertCurrent(generation);
    try {
      const profileRoot = isRecord(options.endpointProfiles) ? options.endpointProfiles : {};
      const saved = isRecord(profileRoot[portal]) ? profileRoot[portal] : profileRoot;
      const profiles = isRecord(saved.serverProfiles) ? saved.serverProfiles : {};
      const standaloneCustom = endpointMode === 'custom' && (!options.serverId || options.serverId === 'custom');
      const allCustom = endpointMode === 'custom' && options.serverId === 'all';
      let fallbackCustom = false;
      let sources;
      if (standaloneCustom) sources = [this._customSource()];
      else {
        try { sources = await this._discover(generation); } catch (error) {
          if (error.code === 'STALE_SESSION') throw error;
          if (endpointMode === 'custom' && options.publicApiUrl) fallbackCustom = true;
          else if (!isRecord(profiles.custom) || profiles.custom.endpointMode !== 'custom') throw error;
          sources = [this._customSource()];
        }
      }
      if (allCustom && sources.length !== 1) {
        this._assertCurrent(generation);
        if (change !== this._endpointGeneration) throw endpointError('The Velocity session changed. Retry with the current session.', 'STALE_SESSION');
        this._servers = new Map(sources.map(source => {
          const server = this._serverFromSource(source);
          return [server.id, server];
        }));
        this._detectedSources = new Map(sources.map(source => [source.serverId, source]));
        this._initialEndpointMode = 'automatic';
        throw endpointError('Select a specific Velocity server before configuring a Custom URL.', 'SERVER_REQUIRED');
      }
      const legacy = legacyProfileTarget(saved, sources);
      const servers = await mapServers(sources, async source => {
        let preference = isRecord(profiles[source.serverId]) ? profiles[source.serverId]
          : legacy && legacy.serverId === source.serverId ? legacy : {};
        if (options.endpointMode && (source.serverId === options.serverId || standaloneCustom || fallbackCustom || allCustom
            || (!options.serverId && sources.length === 1 && !Object.hasOwn(profiles, source.serverId) && !legacy))) {
          preference = { endpointMode, publicApiUrl: options.publicApiUrl };
        }
        const server = this._serverFromSource(source, preference);
        try { return await this._validateServer(server, preference.publicApiUrl, generation); } catch (error) {
          this._assertCurrent(generation);
          server.status = 'error';
          server.error = safeEndpointError(error);
          return server;
        }
      });
      this._assertCurrent(generation);
      if (change !== this._endpointGeneration) throw endpointError('A newer Velocity endpoint change replaced this request.', 'STALE_SESSION');
      this._servers = new Map(servers.map(server => [server.id, server]));
      this._detectedSources = new Map(sources.map(source => [source.serverId, source]));
      const selected = options.serverId || saved.selectedServerId || 'all';
      this._selectedServerId = selected === 'all' || this._servers.has(selected) ? selected : 'all';
      this._revision++;
    } catch (error) {
      this._assertCurrent(generation);
      if (error.code === 'STALE_SESSION' || change !== this._endpointGeneration) throw endpointError('The Velocity session changed. Retry with the current session.', 'STALE_SESSION');
      this._endpointError = safeEndpointError(error);
      log(this._onLog, 'warn', '[API] Endpoint validation failed; Portal authentication remains available for token-only use.');
    }
    return this.state;
  }

  async detect() {
    const generation = this._generation;
    const detection = ++this._detectGeneration;
    const sources = await this._discover(generation, true);
    this._assertCurrent(generation);
    if (detection !== this._detectGeneration) throw endpointError('A newer Velocity detection replaced this request.', 'STALE_SESSION');
    this._detectedSources = new Map(sources.map(source => [source.serverId, source]));
    if (!this._servers.size) {
      this._servers = new Map(sources.map(source => {
        const server = this._serverFromSource(source);
        return [server.id, server];
      }));
    } else {
      for (const source of sources) {
        const server = this._servers.get(source.serverId);
        if (server) server.detectedUrl = source.context ? source.context.apiBaseUrl : source.publicUrl;
      }
      const custom = this._servers.get('custom');
      if (custom && sources.length === 1) {
        custom.detectedUrl = sources[0].context ? sources[0].context.apiBaseUrl : sources[0].publicUrl;
      }
    }
    return this.state;
  }

  async setEndpoint({ serverId, endpointMode, publicApiUrl } = {}) {
    if (!['automatic', 'custom'].includes(endpointMode)) throw endpointError('Choose Automatic or Custom endpoint mode.');
    const generation = this._generation;
    const change = ++this._endpointGeneration;
    let selected = serverId === undefined ? this._selectedServerId : serverId;
    if (serverId === undefined && selected === 'all' && this._servers.size === 1) selected = this._servers.keys().next().value;
    if (!this._servers.size && endpointMode === 'custom'
        && (serverId === undefined || serverId === 'all' || serverId === 'custom')) selected = 'custom';
    if (selected === 'all' && endpointMode === 'custom') throw endpointError('Select a specific Velocity server before configuring a Custom URL.', 'SERVER_REQUIRED');
    let targets;
    let replaceAll = false;
    if (endpointMode === 'automatic' && ((selected === 'all' && !this._servers.size) || selected === 'custom')) {
      targets = (await this._discover(generation)).map(source => this._serverFromSource(source));
      replaceAll = true;
    } else if (selected === 'all') {
      targets = [...this._servers.values()];
    } else if (selected === 'custom' && !this._servers.has('custom')) {
      targets = [this._serverFromSource(this._customSource())];
    } else targets = [this._serverForRun(selected)];
    const updates = await mapServers(targets, server => {
      const preserveOverride = selected === 'all' && !replaceAll;
      return this._validateServer({
        ...server, endpointMode: preserveOverride ? server.endpointMode : endpointMode,
        publicApiUrl: '', context: null,
        source: this._detectedSources.get(server.id) || server.source,
      }, preserveOverride ? server.publicApiUrl : publicApiUrl, generation);
    });
    this._assertCurrent(generation);
    if (change !== this._endpointGeneration) throw endpointError('A newer Velocity endpoint change replaced this request.', 'STALE_SESSION');
    if (replaceAll) {
      this._servers = new Map();
      this._selectedServerId = 'all';
    }
    for (const server of updates) this._servers.set(server.id, server);
    this._initialEndpointMode = 'automatic';
    this._endpointError = '';
    this._revision++;
    return this.state;
  }

  async run(callback, serverId) {
    const generation = this._generation;
    const revision = this._revision;
    const server = this._serverForRun(serverId);
    const context = this._serverContext(server);
    await this._currentToken(generation);
    this._assertCurrent(generation, revision);
    try {
      const result = await callback(context, this.tokenManager.token, this._serverState(server));
      this._assertCurrent(generation, revision);
      return result;
    } catch (error) {
      this._assertCurrent(generation, revision);
      throw error;
    }
  }

  async runAll(callback, { serverId = 'all' } = {}) {
    const generation = this._generation;
    const revision = this._revision;
    const servers = serverId === 'all' ? [...this._servers.values()] : [this._serverForRun(serverId)];
    if (!servers.length) throw endpointError('No Velocity servers are available. Detect an endpoint or choose Custom.', 'ENDPOINT_REQUIRED');
    await this._currentToken(generation);
    this._assertCurrent(generation, revision);
    const outcomes = await mapServers(servers, async server => {
      const identity = { serverId: server.id, serverName: server.label };
      try {
        const context = this._serverContext(server);
        await this._currentToken(generation);
        this._assertCurrent(generation, revision);
        const value = await callback(context, this.tokenManager.token, this._serverState(server));
        this._assertCurrent(generation, revision);
        return { result: { ...identity, value } };
      } catch (error) {
        this._assertCurrent(generation, revision);
        if (error.code === 'STALE_SESSION') throw error;
        return { error: { ...identity, message: server.error || safeEndpointError(error) } };
      }
    });
    this._assertCurrent(generation, revision);
    return {
      results: outcomes.filter(outcome => outcome.result).map(outcome => outcome.result),
      errors: outcomes.filter(outcome => outcome.error).map(outcome => outcome.error),
      revision,
    };
  }

  logout() {
    this._generation++;
    this._endpointGeneration++;
    this._detectGeneration++;
    this._revision++;
    this._authRevision++;
    this.tokenManager.logout();
    this._reset();
    return this.state;
  }
}

module.exports = { VelocitySession, discoverVelocityEndpoint, discoverVelocityServers, validateVelocityEndpoint };
