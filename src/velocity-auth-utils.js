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
 * @file velocity-auth-utils.js
 * @description Shared Velocity authentication UI and transport decision helpers.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.VelocityAuthUtils = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const TOKEN_CAPABLE_TYPES = new Set(['grpc', 'http', 'http-receiver', 'websocket']);
  const TOKEN_AUTH_TYPES = new Set(['arcgis', 'bearer', 'oauth', 'token']);
  const NON_TOKEN_AUTH_TYPES = new Set(['basic', 'none', 'noauth', 'no-auth', 'anonymous']);

  function normalizeAuthType(authType) {
    return String(authType || '').trim().toLowerCase();
  }

  function getVelocityItemType(item) {
    return String((item && (item.feedType || item.outputType || item.type)) || '').trim().toLowerCase();
  }

  function isTokenCapableItem(item) {
    if (item && item.tokenOnly) return true;
    return TOKEN_CAPABLE_TYPES.has(getVelocityItemType(item));
  }

  function shouldSendVelocityTokenByDefault(item) {
    if (!item) return false;
    if (item.tokenOnly) return true;
    if (!isTokenCapableItem(item)) return false;

    const authType = normalizeAuthType(item.authType);
    if (!authType) return true;
    if (NON_TOKEN_AUTH_TYPES.has(authType)) return false;
    if (TOKEN_AUTH_TYPES.has(authType)) return true;
    return authType.includes('token') || authType.includes('arcgis') || authType.includes('bearer');
  }

  function describeVelocityAuthType(authType) {
    const normalized = normalizeAuthType(authType);
    if (!normalized) return 'not specified; Velocity token is available';
    if (normalized === 'arcgis' || normalized === 'token' || normalized === 'bearer') return 'ArcGIS token';
    if (normalized === 'oauth') return 'OAuth bearer token';
    if (normalized === 'basic') return 'Basic auth (token not used)';
    if (normalized === 'none') return 'No auth required';
    return authType;
  }

  return {
    TOKEN_CAPABLE_TYPES,
    normalizeAuthType,
    getVelocityItemType,
    isTokenCapableItem,
    shouldSendVelocityTokenByDefault,
    describeVelocityAuthType,
  };
});

