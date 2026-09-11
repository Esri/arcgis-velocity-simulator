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

const { normalizePortalUrl, normalizeApiBaseUrl } = require('./velocity-endpoints');

function serverIdentifier(value) {
  if (typeof value !== 'string' || !value || value.length > 512
      || ['__proto__', 'constructor', 'prototype'].includes(value)) {
    throw new Error('Choose a valid Velocity server.');
  }
  return value;
}

function endpointPreference(value) {
  if (!value || !['automatic', 'custom'].includes(value.endpointMode)) {
    throw new Error('Choose Automatic or Custom public URL.');
  }
  const publicApiUrl = value.publicApiUrl ? normalizeApiBaseUrl(value.publicApiUrl) : '';
  if (value.endpointMode === 'custom' && !publicApiUrl) {
    throw new Error('Enter a complete public API URL for Custom public URL.');
  }
  return { endpointMode: value.endpointMode, publicApiUrl };
}

function portalPreference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Saved Portal endpoint preferences must be an object.');
  }
  if (value.serverProfiles === undefined) {
    return { ...endpointPreference(value), selectedServerId: 'all', serverProfiles: {} };
  }
  if (!value.serverProfiles || typeof value.serverProfiles !== 'object' || Array.isArray(value.serverProfiles)) {
    throw new Error('Saved Velocity server profiles must be an object.');
  }
  const serverProfiles = {};
  for (const [id, profile] of Object.entries(value.serverProfiles)) {
    serverIdentifier(id);
    if (id === 'all') throw new Error('A public URL override must belong to one Velocity server.');
    serverProfiles[id] = endpointPreference(profile);
  }
  return { selectedServerId: serverIdentifier(value.selectedServerId || 'all'), serverProfiles };
}

function readVelocityPreferences(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Saved Velocity preferences must be an object.');
  }
  const portalUrl = normalizePortalUrl(value.portalUrl);
  const endpointProfiles = {};
  if (value.endpointProfiles !== undefined) {
    if (!value.endpointProfiles || typeof value.endpointProfiles !== 'object'
        || Array.isArray(value.endpointProfiles)) {
      throw new Error('Saved Velocity endpoint profiles must be an object.');
    }
    for (const [portal, profile] of Object.entries(value.endpointProfiles)) {
      endpointProfiles[normalizePortalUrl(portal)] = portalPreference(profile);
    }
  }
  return {
    portalUrl,
    username: typeof value.username === 'string' ? value.username : '',
    rememberMe: value.rememberMe === true,
    endpointProfiles,
  };
}

function updateVelocityPreferences(previous, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Velocity preferences must be an object.');
  }
  if (input.rememberMe !== true) return null;
  const portalUrl = normalizePortalUrl(input.portalUrl);
  const saved = readVelocityPreferences(previous);
  const profile = saved && saved.endpointProfiles[portalUrl];
  const serverId = serverIdentifier(input.serverId || 'all');
  const selectedServerId = serverIdentifier(input.selectedServerId || serverId);
  const serverProfiles = { ...(profile ? profile.serverProfiles : {}) };
  if (serverId !== 'all') {
    serverProfiles[serverId] = endpointPreference(input);
  } else if (input.endpointMode === 'custom') {
    throw new Error('Choose one Velocity server before saving a custom public URL.');
  }
  return {
    portalUrl,
    username: typeof input.username === 'string' ? input.username : '',
    rememberMe: true,
    endpointProfiles: {
      ...(saved ? saved.endpointProfiles : {}),
      [portalUrl]: { selectedServerId, serverProfiles },
    },
  };
}

module.exports = { readVelocityPreferences, updateVelocityPreferences };
