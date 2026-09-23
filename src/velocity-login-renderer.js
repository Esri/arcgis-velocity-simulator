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

document.addEventListener('DOMContentLoaded', () => {
  const element = id => document.getElementById(id);
  const api = window.velocityApi;
  if (api && api.onLoadSavedTheme) {
    api.onLoadSavedTheme(theme => {
      if (window.SecondaryWindowTheme) window.SecondaryWindowTheme.applyTheme(theme);
      else document.documentElement.dataset.theme = theme || 'dark';
    });
  }

  const tabs = document.querySelectorAll('.auth-tab');
  const pickerSection = element('picker-section');
  const itemTypeSelect = element('item-type-select');
  const itemSelect = element('item-select');
  const infoPanel = element('info-panel');
  const applyBtn = element('apply-btn');
  const scopeMyBtn = element('scope-my');
  const scopeOrgBtn = element('scope-org');
  const filterSupportedBtn = element('filter-supported-btn');
  const filterAllBtn = element('filter-all-btn');
  const statusBanner = element('status-banner');
  const statusBannerIcon = element('status-banner-icon');
  const statusBannerText = element('status-banner-text');
  const statusBannerDismiss = element('status-banner-dismiss');
  let currentTab = 'password';
  let allItems = [];
  let selectedItem = null;
  let listGeneration = 0;
  let detailGeneration = 0;
  let loadingItems = false;
  let listedRevision = null;
  let useAdminScope = true;
  let showUnsupported = false;

  const endpointUI = window.VelocityEndpointUI.create({
    document, api, onInvalidate: invalidateItems, onChange: syncControls,
    onLoadItems: loadItems, setStatus,
  });

  const TYPE_META = {
    grpc: { icon: '\u2B21', label: 'gRPC', color: '#7c4dff' },
    'http-receiver': { icon: '\u25A0', label: 'HTTP', color: '#0097a7' },
    'http-poller': { icon: '\u21BB', label: 'HTTP Poller', color: '#00838f' },
    websocket: { icon: '\u25C6', label: 'WebSocket', color: '#00897b' },
    mqtt: { icon: '\u25CE', label: 'MQTT', color: '#f57c00' },
    kafka: { icon: '\u25B2', label: 'Kafka', color: '#e53935' },
    tcp: { icon: '\u25D7', label: 'TCP', color: '#546e7a' },
    'tcp-client': { icon: '\u25D7', label: 'TCP Client', color: '#546e7a' },
    'tcp-server': { icon: '\u25D7', label: 'TCP Server', color: '#455a64' },
    udp: { icon: '\u25D6', label: 'UDP', color: '#78909c' },
    'udp-client': { icon: '\u25D6', label: 'UDP Client (receiving feed)', color: '#78909c' },
    'udp-server': { icon: '\u25D6', label: 'UDP Server (receiving feed)', color: '#607d8b' },
    'azure-event-hub': { icon: '\u2756', label: 'Azure Event Hub', color: '#0078d4' },
    'azure-service-bus': { icon: '\u2756', label: 'Azure Svc Bus', color: '#0062ad' },
    kinetic: { icon: '\u25C9', label: 'Kinetic', color: '#43a047' },
    file: { icon: '\u25A3', label: 'File', color: '#8d6e63' },
  };
  function typeMeta(key) {
    return TYPE_META[key] || { icon: '\u25EF', label: key, color: '#888' };
  }
  function setTooltip(control, text) {
    control.title = text;
    control.dataset.tooltip = text;
    control.setAttribute('aria-label', text);
  }

  function syncControls() {
    const { canBrowse, busy, pendingEndpoint } = endpointUI;
    element('refresh-btn').disabled = !canBrowse || Boolean(busy);
    scopeMyBtn.disabled = scopeOrgBtn.disabled = !canBrowse || Boolean(busy);
    itemTypeSelect.disabled = itemSelect.disabled = !canBrowse || Boolean(busy) || loadingItems;
    filterSupportedBtn.disabled = filterAllBtn.disabled = busy === 'apply';
    applyBtn.disabled = !canBrowse || Boolean(busy) || loadingItems || !selectedItem || !selectedItem.supported;
    setTooltip(applyBtn, pendingEndpoint
      ? 'Apply the pending endpoint selection before applying a feed.'
      : selectedItem && !selectedItem.supported
        ? selectedItem.reason || 'Cannot apply - this feed type is not yet supported by the Simulator.'
        : "Apply the selected feed's connection settings to the main window.");
  }

  function invalidateItems() {
    listGeneration += 1;
    detailGeneration += 1;
    loadingItems = false;
    listedRevision = null;
    allItems = [];
    selectedItem = null;
    populateTypeDropdown();
    pickerSection.classList.add('hidden');
  }

  function setScope(admin) {
    useAdminScope = admin;
    scopeMyBtn.classList.toggle('active', !admin);
    scopeOrgBtn.classList.toggle('active', admin);
  }
  setScope(true);
  scopeMyBtn.addEventListener('click', () => { setScope(false); loadItems(); });
  scopeOrgBtn.addEventListener('click', () => { setScope(true); loadItems(); });
  element('refresh-btn').addEventListener('click', loadItems);

  function setSupportedFilter(includeUnsupported) {
    showUnsupported = includeUnsupported;
    filterSupportedBtn.classList.toggle('active', !showUnsupported);
    filterAllBtn.classList.toggle('active', showUnsupported);
    populateTypeDropdown();
    if (listedRevision !== null && !loadingItems) reportListStatus();
  }
  filterSupportedBtn.addEventListener('click', () => setSupportedFilter(false));
  filterAllBtn.addEventListener('click', () => setSupportedFilter(true));

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(other => other.classList.toggle('active', other === tab));
      currentTab = tab.dataset.tab;
      element('auth-form-password').classList.toggle('hidden', currentTab !== 'password');
      element('auth-form-oauth').classList.toggle('hidden', currentTab !== 'oauth');
    });
  });
  element('sign-in-btn').addEventListener('click', () => endpointUI.signIn(currentTab));
  element('use-token-btn').addEventListener('click', () => endpointUI.applyItem({ tokenOnly: true }));
  element('close-btn').addEventListener('click', () => endpointUI.close());
  ['password', 'client-secret'].forEach(id => {
    element(id).addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        element('sign-in-btn').click();
      }
    });
  });

  async function loadItems() {
    if (!endpointUI.canBrowse) return;
    const request = ++listGeneration;
    const epoch = endpointUI.generation;
    const revision = endpointUI.session.revision;
    detailGeneration += 1;
    selectedItem = null;
    allItems = [];
    listedRevision = null;
    endpointUI.setListErrors([]);
    populateTypeDropdown();
    loadingItems = true;
    syncControls();
    setStatus('info', 'Loading feeds…');
    try {
      const result = await api.listItems({
        adminScope: useAdminScope, revision, serverId: endpointUI.session.selectedServerId,
      });
      if (request !== listGeneration || epoch !== endpointUI.generation) return;
      if (!result || !Array.isArray(result.items) || !Array.isArray(result.errors)
        || result.revision !== revision
        || result.errors.some(error => !error || typeof error.serverId !== 'string' || typeof error.message !== 'string')) {
        throw new Error(result && result.error || 'The feed list response is invalid.');
      }
      listedRevision = result.revision;
      allItems = result.items.map(item => ({ ...item, supported: Boolean(item.supported) }));
      endpointUI.setListErrors(result.errors);
      populateTypeDropdown();
      pickerSection.classList.remove('hidden');
      reportListStatus();
    } catch (error) {
      if (request === listGeneration && epoch === endpointUI.generation) {
        pickerSection.classList.add('hidden');
        setStatus('error', error.message);
      }
    } finally {
      if (request === listGeneration && epoch === endpointUI.generation) { loadingItems = false; syncControls(); }
    }
  }

  function reportListStatus() {
    const supported = allItems.filter(item => item.supported).length;
    const unsupportedOnly = supported === 0 && allItems.length > 0 && !showUnsupported;
    const count = `${supported} supported of ${allItems.length} feed(s).`;
    const hint = unsupportedOnly ? ' Choose All beside Supported to view unsupported feeds.' : '';
    const errors = endpointUI.listErrorMessage;
    setStatus(errors ? 'warning' : unsupportedOnly ? 'info' : 'success', errors
      ? `${count}${hint} Some Velocity servers could not be queried. ${errors}` : `${count}${hint}`);
  }

  function populateTypeDropdown() {
    const visible = showUnsupported ? allItems : allItems.filter(item => item.supported);
    const types = [...new Set(visible.map(item => item.feedType || item.outputType))].sort();
    itemTypeSelect.innerHTML = '<option value="" title="Show all feed types">All Types</option>';
    types.forEach(type => {
      const option = document.createElement('option');
      const supported = allItems.some(item => (item.feedType || item.outputType) === type && item.supported);
      option.value = type;
      option.textContent = supported ? `${typeMeta(type).icon} ${type}` : `\u26A0 ${type}`;
      if (!supported) option.classList.add('type-option-unsupported');
      option.title = supported ? `Show ${type} feeds` : `${type} - not yet supported by the Simulator`;
      itemTypeSelect.appendChild(option);
    });
    populateItemDropdown();
  }

  function populateItemDropdown() {
    const filter = itemTypeSelect.value;
    const visible = showUnsupported ? allItems : allItems.filter(item => item.supported);
    const filtered = filter ? visible.filter(item => (item.feedType || item.outputType) === filter) : visible;
    detailGeneration += 1;
    itemSelect.innerHTML = '<option value="" title="Select a feed to view its details">- Select -</option>';
    filtered.forEach(item => {
      const option = document.createElement('option');
      const type = item.feedType || item.outputType || '';
      const meta = typeMeta(type);
      option.value = allItems.indexOf(item);
      const source = item.serverName ? ` — ${item.serverName}` : '';
      option.textContent = `${item.supported ? meta.icon : '\u26A0'} ${item.label}  [${type}]${source}`;
      option.style.color = item.supported ? meta.color : '#f5a623';
      if (!item.supported) option.classList.add('item-option-unsupported');
      option.title = item.supported
        ? `${item.label} - ${meta.label} feed${source}`
        : `${item.label} - ${meta.label} (not yet supported by the Simulator)${source}`;
      itemSelect.appendChild(option);
    });
    infoPanel.classList.add('hidden');
    selectedItem = null;
    setTooltip(itemTypeSelect, itemTypeSelect.selectedOptions[0].title);
    setTooltip(itemSelect, 'Select a feed to view its details');
    syncControls();
  }
  itemTypeSelect.addEventListener('change', populateItemDropdown);
  itemSelect.addEventListener('change', async () => {
    const request = ++detailGeneration;
    const epoch = endpointUI.generation;
    selectedItem = null;
    infoPanel.classList.add('hidden');
    syncControls();
    if (!endpointUI.canBrowse || itemSelect.value === '') return;
    const item = allItems[Number(itemSelect.value)];
    setTooltip(itemSelect, itemSelect.selectedOptions[0].title);
    try {
      const details = await api.getItemDetails({ id: item.id, revision: listedRevision });
      if (request !== detailGeneration || epoch !== endpointUI.generation) return;
      if (!details || details.error) throw new Error(details && details.error || 'The feed detail response is invalid.');
      if (details.id !== item.id) throw new Error('The feed detail response does not match the selected feed.');
      const candidate = { ...details, supported: Boolean(details.supported) };
      if (candidate.supported) window.VelocityConnectionOptions.buildVelocityConnectionOptions(candidate);
      selectedItem = candidate;
      showInfo(candidate);
      if (!candidate.supported) setStatus('warning', candidate.reason || 'This feed cannot be applied automatically.');
      else if ((candidate.feedType || '').startsWith('udp-')) {
        setStatus('info', 'Apply selects UDP Client: the Simulator sends payload datagrams to this receiving feed without registration or a handshake. Verify that the advertised host is reachable from the Simulator.');
      }
    } catch (error) {
      if (request === detailGeneration && epoch === endpointUI.generation) setStatus('error', error.message);
    } finally {
      if (request === detailGeneration && epoch === endpointUI.generation) syncControls();
    }
  });

  function showInfo(item) {
    const type = item.feedType || item.outputType || '';
    const meta = typeMeta(type);
    const badge = element('info-type-badge');
    badge.textContent = `${meta.icon} `;
    badge.style.color = meta.color;
    badge.title = meta.label;
    element('info-label').textContent = item.label || '-';
    element('info-id').textContent = item.feedId || item.id || '-';
    element('info-server').textContent = item.serverName
      ? `${item.serverName} (${item.serverId})` : item.serverId || '-';
    element('info-type').textContent = meta.label || type || '-';
    element('info-url').textContent = item.url
      || (item.host && item.port ? `${item.host}:${item.port}` : item.host)
      || (!(type.startsWith('udp-')) && item.port && item.serverApiUrl ? `${new URL(item.serverApiUrl).hostname}:${item.port}` : '-');
    element('info-auth').textContent = item.authType || 'none';
    element('info-format').textContent = item.format || '-';
    element('info-schema').textContent = Array.isArray(item.schema)
      ? item.schema.map(field => field.name || field.fieldName || field).join(', ') || '-' : '-';
    infoPanel.classList.remove('hidden');
  }

  applyBtn.addEventListener('click', () => {
    if (!endpointUI.canBrowse || !selectedItem || !selectedItem.supported) return;
    const selection = detailGeneration;
    endpointUI.applyItem({ id: selectedItem.id, revision: listedRevision }, () => selection === detailGeneration);
  });

  const EYE_CLOSED_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3.27 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>';
  function setupPasswordToggle(toggleId, inputId) {
    const toggle = element(toggleId);
    const input = element(inputId);
    const openIcon = toggle.innerHTML;
    toggle.addEventListener('click', () => {
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      toggle.innerHTML = visible ? openIcon : EYE_CLOSED_SVG;
      setTooltip(toggle, `${visible ? 'Show' : 'Hide'} ${inputId === 'client-secret' ? 'client secret' : 'password'}`);
    });
  }
  setupPasswordToggle('toggle-password', 'password');
  setupPasswordToggle('toggle-client-secret', 'client-secret');

  function setStatus(type, message) {
    statusBanner.className = 'status-banner';
    statusBannerDismiss.classList.toggle('hidden', type === 'signing-in');
    if (type === 'signing-in') {
      statusBanner.classList.add('info');
      statusBannerIcon.innerHTML = '<span class="spinner"></span>';
      statusBannerText.textContent = 'Signing in…';
    } else if (['error', 'success', 'info', 'warning'].includes(type)) {
      statusBanner.classList.add(type);
      statusBannerIcon.textContent = { error: '✕', success: '✓', info: 'i', warning: '!' }[type];
      statusBannerText.textContent = message;
    } else {
      statusBanner.classList.add('hidden');
    }
  }
  statusBannerDismiss.addEventListener('click', () => statusBanner.classList.add('hidden'));
  endpointUI.initialize();
});
