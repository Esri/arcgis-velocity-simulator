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
  else root.VelocityEndpointUI = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function portalKey(value) {
    try {
      const url = new URL(value.trim());
      return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    } catch (_) { return ''; }
  }

  /**
   * Owns the common Portal and endpoint form. Picker callbacks never receive
   * credentials or tokens; the main process remains the session authority.
   */
  function create({
    document, api, onInvalidate = () => {},
    onChange = () => {}, onLoadItems = async () => {}, setStatus = () => {},
  }) {
    const element = id => document.getElementById(id);
    const portalInput = element('portal-url');
    const automaticMode = element('endpoint-automatic');
    const customMode = element('endpoint-custom');
    const publicApiInput = element('public-api-url');
    const rememberMe = element('remember-me');
    const detectBtn = element('detect-endpoint-btn');
    const applyEndpointBtn = element('apply-endpoint-btn');
    const useTokenBtn = element('use-token-btn');
    const endpointStatus = element('endpoint-status');
    const serverSelect = element('velocity-server-select');
    let session = null;
    let endpointProfiles = {};
    let generation = 0;
    let busy = '';
    let previewMessage = '';
    let preferencesEdited = false;
    let draftServerId = 'all';
    let listErrors = [];

    function selectedServer() {
      if (!session) return null;
      return session.servers.find(server => server.id === session.selectedServerId)
        || (session.servers.length === 1 ? session.servers[0] : null);
    }

    function allServersView() {
      return Boolean(session && session.servers.length > 1 && session.selectedServerId === 'all');
    }

    function selection() {
      const server = selectedServer();
      return {
        serverId: server ? server.id : session ? session.selectedServerId : draftServerId,
        endpointMode: !allServersView() && customMode.checked ? 'custom' : 'automatic',
        publicApiUrl: allServersView() ? '' : publicApiInput.value.trim(),
      };
    }

    function profileForPortal(value) {
      const key = portalKey(value);
      const entry = key && Object.entries(endpointProfiles).find(([portal]) => portalKey(portal) === key);
      return entry ? entry[1] : null;
    }

    function restoreSavedEditor(profile) {
      draftServerId = profile && profile.selectedServerId || 'all';
      const endpoint = profile && profile.serverProfiles && profile.serverProfiles[draftServerId]
        || (profile && profile.endpointMode ? profile : null);
      customMode.checked = Boolean(endpoint && endpoint.endpointMode === 'custom');
      automaticMode.checked = !customMode.checked;
      publicApiInput.value = endpoint && endpoint.publicApiUrl || '';
    }

    function pendingEndpoint() {
      const draft = selection();
      const server = selectedServer();
      return Boolean(server && (draft.endpointMode !== server.endpointMode
        || (draft.endpointMode === 'custom' && draft.publicApiUrl !== server.publicApiUrl)));
    }

    function canBrowse() {
      if (!session || !session.authenticated || pendingEndpoint()
        || portalKey(session.portalUrl) !== portalKey(portalInput.value)) return false;
      const server = selectedServer();
      return (server ? [server] : session.servers).some(item => item.effectiveUrl && !item.error && item.status !== 'error');
    }

    function notify() {
      const authenticated = Boolean(session && session.authenticated);
      const server = selectedServer();
      const all = allServersView();
      element('sign-in-btn').disabled = Boolean(busy);
      detectBtn.disabled = !authenticated || Boolean(busy);
      applyEndpointBtn.disabled = all || !authenticated || Boolean(busy);
      applyEndpointBtn.dataset.tooltip = all
        ? 'Select one Velocity server before applying a public API URL'
        : 'Validate and apply the endpoint selection with the current Portal session, then reload the list';
      publicApiInput.disabled = all || !customMode.checked || busy === 'apply';
      portalInput.disabled = busy === 'apply';
      automaticMode.disabled = customMode.disabled = all || busy === 'apply';
      serverSelect.disabled = !authenticated || Boolean(busy);
      element('velocity-server-row').classList.toggle('hidden', !session || session.servers.length <= 1);
      renderServerOptions();
      renderServerStatus();
      useTokenBtn.disabled = !authenticated || Boolean(busy);
      useTokenBtn.classList.toggle('hidden', !authenticated);
      element('endpoint-current-addresses').classList.toggle('hidden', all);
      element('detected-url').textContent = server && server.detectedUrl || 'Not detected';
      element('effective-url').textContent = server && server.effectiveUrl || 'Not applied';
      endpointStatus.classList.toggle('error', Boolean(server && server.error));
      endpointStatus.textContent = pendingEndpoint()
        ? 'Endpoint changes pending. Choose Apply URL before applying an item.'
        : previewMessage || (all ? 'All Velocity servers. Select one server to edit its public API URL.' : '')
          || (server && server.error) || (session && session.endpointError) || (authenticated
          ? 'Endpoint applied. Resource access depends on your permissions.'
          : 'Sign in to resolve the endpoint.');
      onChange();
    }

    function renderServerOptions() {
      serverSelect.replaceChildren();
      const allOption = document.createElement('option');
      allOption.value = 'all';
      allOption.textContent = 'All Velocity servers';
      allOption.title = 'Browse resources from all Velocity servers';
      serverSelect.appendChild(allOption);
      for (const server of session ? session.servers : []) {
        const option = document.createElement('option');
        option.value = server.id;
        const repeated = session.servers.filter(other => other.label === server.label).length > 1;
        option.textContent = repeated ? `${server.label} (${server.id})` : server.label;
        option.title = `Browse resources from ${server.label} (${server.id})`;
        serverSelect.appendChild(option);
      }
      serverSelect.value = session ? session.selectedServerId : 'all';
      const tooltip = serverSelect.selectedOptions[0] && serverSelect.selectedOptions[0].title;
      serverSelect.title = tooltip || 'Browse resources from all Velocity servers';
      serverSelect.dataset.tooltip = serverSelect.title;
    }

    function renderServerStatus() {
      const list = element('velocity-server-status');
      list.classList.toggle('hidden', !allServersView());
      list.replaceChildren();
      for (const server of session ? session.servers : []) {
        const row = document.createElement('li');
        row.dataset.serverId = server.id;
        const name = document.createElement('strong');
        name.textContent = `${server.label} (${server.id})`;
        const url = document.createElement('span');
        url.className = 'server-endpoint';
        url.textContent = `Effective URL: ${server.effectiveUrl || 'Not applied'}`;
        const detected = document.createElement('span');
        detected.className = 'server-endpoint';
        detected.textContent = `Detected URL: ${server.detectedUrl || 'Not detected'}`;
        const status = document.createElement('span');
        status.className = server.error ? 'server-error' : '';
        status.textContent = server.error || server.status || 'Not validated';
        row.append(name, url, detected, status);
        list.appendChild(row);
      }
      const errors = element('velocity-server-errors');
      errors.classList.toggle('hidden', listErrors.length === 0);
      errors.replaceChildren();
      for (const error of listErrors) {
        const row = document.createElement('li');
        row.textContent = `${error.serverName || error.serverId}: ${error.message}`;
        errors.appendChild(row);
      }
    }

    function setListErrors(errors) {
      listErrors = errors.map(error => ({
        serverId: error.serverId, serverName: error.serverName || error.serverId, message: error.message,
      }));
      notify();
    }

    function invalidate() {
      listErrors = [];
      onInvalidate();
    }

    function restoreEditor() {
      const server = selectedServer();
      automaticMode.checked = !server || server.endpointMode !== 'custom';
      customMode.checked = !automaticMode.checked;
      publicApiInput.value = server && server.publicApiUrl || '';
    }

    function acceptSession(result) {
      if (!result || result.error) throw new Error(result && result.error || 'The session response is invalid.');
      if (!result.authenticated) throw new Error('Please sign in again.');
      if (!portalKey(result.portalUrl || '') || portalKey(result.portalUrl) !== portalKey(portalInput.value)
        || !Number.isInteger(result.revision) || !Array.isArray(result.servers)
        || result.servers.some(server => !server || typeof server.id !== 'string' || !server.id
          || typeof server.label !== 'string' || !['automatic', 'custom'].includes(server.endpointMode))
        || new Set(result.servers.map(server => server.id)).size !== result.servers.length) {
        throw new Error('The session metadata is invalid. Please sign in again.');
      }
      const selectedServerId = result.selectedServerId || 'all';
      if (selectedServerId !== 'all' && !result.servers.some(server => server.id === selectedServerId)) {
        throw new Error('The selected Velocity server is unavailable. Sign in again.');
      }
      const firstMultipleServers = result.servers.length > 1 && (!session || session.servers.length <= 1);
      session = Object.freeze({
        authenticated: true, portalUrl: result.portalUrl, endpointMode: result.endpointMode,
        publicApiUrl: result.publicApiUrl || '', detectedUrl: result.detectedUrl || '',
        effectiveUrl: result.effectiveUrl || '', revision: result.revision,
        profile: result.profile || '', expires: result.expires || 0, endpointError: result.endpointError || '',
        authRevision: result.authRevision, selectedServerId,
        servers: Object.freeze(result.servers.map(server => Object.freeze({
          id: server.id, label: server.label, endpointMode: server.endpointMode,
          publicApiUrl: server.publicApiUrl || '', detectedUrl: server.detectedUrl || '',
          effectiveUrl: server.effectiveUrl || '', profile: server.profile || '',
          status: server.status || '', error: server.error || '',
        }))),
      });
      draftServerId = session.selectedServerId;
      restoreEditor();
      if (firstMultipleServers) element('velocity-endpoint').open = true;
      previewMessage = '';
      notify();
    }

    async function persistPreferences() {
      const portalUrl = portalInput.value.trim();
      const draft = selection();
      const selectedServerId = session ? session.selectedServerId : draftServerId;
      if (session && !pendingEndpoint()) {
        const profile = profileForPortal(portalUrl) || {};
        const serverProfiles = { ...profile.serverProfiles };
        if (draft.serverId !== 'all') {
          serverProfiles[draft.serverId] = { endpointMode: draft.endpointMode, publicApiUrl: draft.publicApiUrl };
        }
        endpointProfiles[portalKey(portalUrl)] = { selectedServerId, serverProfiles };
      }
      await api.storeCredentials({
        portalUrl, username: element('username').value.trim(), rememberMe: rememberMe.checked, selectedServerId, ...draft,
      });
    }

    function edited() {
      generation += 1;
      busy = '';
      previewMessage = '';
      invalidate();
      notify();
    }
    publicApiInput.addEventListener('input', edited);
    automaticMode.addEventListener('change', edited);
    customMode.addEventListener('change', edited);
    portalInput.addEventListener('input', () => {
      session = null;
      element('password').value = '';
      element('client-secret').value = '';
      restoreSavedEditor(profileForPortal(portalInput.value));
      edited();
      setStatus('info', 'Portal changed. Sign in for this Portal before browsing or applying a token.');
    });
    rememberMe.addEventListener('change', () => {
      preferencesEdited = true;
      if (!rememberMe.checked || (session && !pendingEndpoint())) {
        persistPreferences().catch(error => setStatus('error', error.message));
      }
    });
    ['username', 'password', 'client-id', 'client-secret'].forEach(id => {
      element(id).addEventListener('input', () => { preferencesEdited = true; });
    });

    async function initialize() {
      const request = generation;
      notify();
      try {
        const [stored, current] = await Promise.all([api.getStoredCredentials(), api.getSessionState()]);
        if (request !== generation || preferencesEdited) return;
        if (stored) {
          if (stored.portalUrl) portalInput.value = stored.portalUrl;
          if (stored.username) element('username').value = stored.username;
          rememberMe.checked = Boolean(stored.rememberMe);
          endpointProfiles = stored.endpointProfiles || {};
          restoreSavedEditor(profileForPortal(portalInput.value));
        }
        if (current && current.error) throw new Error(current.error);
        if (current && current.authenticated) {
          portalInput.value = current.portalUrl;
          acceptSession(current);
          if (canBrowse()) await onLoadItems();
        }
      } catch (error) {
        if (request === generation) setStatus('error', error.message);
      } finally {
        if (request === generation) notify();
      }
    }

    async function signIn(authType = 'password') {
      if (busy) return;
      const endpoint = selection();
      const request = ++generation;
      busy = 'auth';
      session = null;
      invalidate();
      notify();
      setStatus('signing-in');
      try {
        let result;
        const portalUrl = portalInput.value.trim();
        if (authType === 'password') {
          const username = element('username').value.trim();
          const password = element('password').value;
          if (!portalUrl || !username || !password) throw new Error('Please fill in all fields.');
          result = await api.login({ portalUrl, username, password, ...endpoint });
        } else if (authType === 'oauth') {
          const clientId = element('client-id').value.trim();
          const clientSecret = element('client-secret').value;
          if (!portalUrl || !clientId || !clientSecret) throw new Error('Please fill in all fields.');
          result = await api.loginOAuth({ portalUrl, clientId, clientSecret, ...endpoint });
        } else {
          throw new Error('Choose a supported sign-in method.');
        }
        if (request !== generation) return;
        acceptSession(result);
        element('password').value = '';
        element('client-secret').value = '';
        await persistPreferences();
        if (request !== generation) return;
        if (!canBrowse()) {
          element('velocity-endpoint').open = true;
          const message = session.endpointError || (selectedServer() && selectedServer().error) || 'No Velocity server is available. Review the server endpoint statuses.';
          setStatus('error', `Portal sign-in succeeded, but resource access is unavailable: ${message} Use Token Only is available for destinations accepting this Portal token.`);
        } else {
          await onLoadItems();
        }
      } catch (error) {
        if (request === generation) setStatus('error', error.message || 'Sign-in failed.');
      } finally {
        if (request === generation) { busy = ''; notify(); }
      }
    }

    async function detect() {
      if (!session || busy) return;
      const request = generation;
      busy = 'detect';
      notify();
      try {
        const result = await api.detectEndpoint();
        if (request !== generation) return;
        if (!result || result.error || !result.authenticated || portalKey(result.portalUrl || '') !== portalKey(session.portalUrl)
          || !Array.isArray(result.servers)) {
          throw new Error(result && result.error || 'Discovery returned an invalid response.');
        }
        session = Object.freeze({
          ...session, detectedUrl: result.detectedUrl || '',
          servers: Object.freeze(session.servers.map(server => {
            const preview = result.servers.find(candidate => candidate.id === server.id);
            return Object.freeze({ ...server, detectedUrl: preview ? preview.detectedUrl || '' : server.detectedUrl });
          })),
        });
        previewMessage = result.endpointError || 'Discovery refreshed. Choose Apply URL to use Automatic discovery.';
        setStatus(result.endpointError ? 'error' : 'info', previewMessage);
      } catch (error) {
        if (request === generation) setStatus('error', error.message);
      } finally {
        if (request === generation) { busy = ''; notify(); }
      }
    }

    async function applyEndpoint() {
      if (!session || busy || allServersView()) return;
      const request = ++generation;
      busy = 'endpoint';
      invalidate();
      notify();
      setStatus('info', 'Validating endpoint…');
      try {
        const result = await api.applyEndpoint(selection());
        if (request !== generation) return;
        acceptSession(result);
        await persistPreferences();
        if (request !== generation) return;
        if (!canBrowse()) throw new Error(session.endpointError || (selectedServer() && selectedServer().error) || 'No Velocity server is available. Review the server endpoint statuses.');
        await onLoadItems();
      } catch (error) {
        if (request === generation) setStatus('error', error.message);
      } finally {
        if (request === generation) { busy = ''; notify(); }
      }
    }

    async function selectServer(serverId) {
      if (!session || busy) return;
      const request = ++generation;
      busy = 'server';
      invalidate();
      notify();
      try {
        const result = await api.selectServer(serverId);
        if (request !== generation) return;
        acceptSession(result);
        await persistPreferences();
        if (request !== generation) return;
        if (canBrowse()) await onLoadItems();
        else setStatus('error', (selectedServer() && selectedServer().error) || 'The selected Velocity server is unavailable.');
      } catch (error) {
        if (request === generation) setStatus('error', error.message);
      } finally {
        if (request === generation) { busy = ''; notify(); }
      }
    }

    async function applyItem(params, isSelectionCurrent = () => true) {
      if (busy || !session || (params.tokenOnly !== true && !canBrowse())) return false;
      const request = generation;
      busy = 'apply';
      notify();
      try {
        const result = await api.applyItem(params);
        if (request !== generation || !isSelectionCurrent()) return false;
        if (!result || result.error || result.success !== true) {
          throw new Error(result && result.error || 'The connection settings could not be applied.');
        }
        api.hideWindow();
        return true;
      } catch (error) {
        if (request === generation) setStatus('error', error.message);
        return false;
      } finally {
        if (request === generation) { busy = ''; notify(); }
      }
    }

    function close() {
      generation += 1;
      busy = '';
      invalidate();
      notify();
      api.hideWindow();
    }

    detectBtn.addEventListener('click', detect);
    applyEndpointBtn.addEventListener('click', applyEndpoint);
    serverSelect.addEventListener('change', () => selectServer(serverSelect.value));
    return {
      get session() { return session; },
      get generation() { return generation; },
      get busy() { return busy; },
      get canBrowse() { return canBrowse(); },
      get pendingEndpoint() { return pendingEndpoint(); },
      get listErrorMessage() { return listErrors.map(error => `${error.serverName || error.serverId}: ${error.message}`).join(' '); },
      selection, initialize, signIn, detect, selectServer, applyEndpoint, applyItem, close, setListErrors,
    };
  }

  return { create, portalKey };
}));
