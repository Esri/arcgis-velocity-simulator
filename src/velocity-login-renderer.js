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
 * @file velocity-login-renderer.js
 * @description Renderer-side logic for the Velocity Login / Feed Picker dialog.
 * Communicates with the main process via window.velocityApi (exposed by preload).
 */

document.addEventListener('DOMContentLoaded', () => {
  // ─── Element References ────────────────────────────────────────────────────
  const tabs = document.querySelectorAll('.auth-tab');
  const formPassword = document.getElementById('auth-form-password');
  const formOAuth = document.getElementById('auth-form-oauth');
  const signInBtn = document.getElementById('sign-in-btn');
  const statusBanner = document.getElementById('status-banner');
  const statusBannerIcon = document.getElementById('status-banner-icon');
  const statusBannerText = document.getElementById('status-banner-text');
  const statusBannerDismiss = document.getElementById('status-banner-dismiss');
  const pickerSection = document.getElementById('picker-section');
  const itemTypeSelect = document.getElementById('item-type-select');
  const itemSelect = document.getElementById('item-select');
  const infoPanel = document.getElementById('info-panel');
  const applyBtn = document.getElementById('apply-btn');
  const closeBtn = document.getElementById('close-btn');
  const refreshBtn = document.getElementById('refresh-btn');
  const scopeMyBtn = document.getElementById('scope-my');
  const scopeOrgBtn = document.getElementById('scope-org');
  const toggleUnsupportedBtn = document.getElementById('toggle-unsupported-btn');
  const filterSupportedBtn = document.getElementById('filter-supported-btn');
  const filterAllBtn = document.getElementById('filter-all-btn');
  const rememberMe = document.getElementById('remember-me');

  // Info fields
  const infoLabel = document.getElementById('info-label');
  const infoId = document.getElementById('info-id');
  const infoType = document.getElementById('info-type');
  const infoUrl = document.getElementById('info-url');
  const infoAuth = document.getElementById('info-auth');
  const infoFormat = document.getElementById('info-format');
  const infoSchema = document.getElementById('info-schema');

  let currentTab = 'password';
  let allItems = []; // populated after sign-in
  let selectedItem = null;
  let lastVelocityUrl = null; // stored for refresh
  let lastToken = null;
  let useAdminScope = true; // default: org feeds
  let showUnsupported = false; // default: show supported only

  // ─── Type icons and colors (for option prefix and info-panel badge) ─────────
  const TYPE_META = {
    'grpc':             { icon: '\u2B21', label: 'gRPC',          color: '#7c4dff' }, // hexagon
    'http-receiver':    { icon: '\u25A0', label: 'HTTP',           color: '#0097a7' }, // square
    'websocket':        { icon: '\u25C6', label: 'WebSocket',      color: '#00897b' }, // diamond
    'mqtt':             { icon: '\u25CE', label: 'MQTT',           color: '#f57c00' }, // bullseye
    'kafka':            { icon: '\u25B2', label: 'Kafka',          color: '#e53935' }, // triangle up
    'tcp':              { icon: '\u25D7', label: 'TCP',            color: '#546e7a' }, // half circle
    'udp':              { icon: '\u25D6', label: 'UDP',            color: '#78909c' }, // half circle left
    'azure-event-hub':  { icon: '\u2756', label: 'Azure Event Hub',color: '#0078d4' }, // diamond
    'azure-service-bus':{ icon: '\u2756', label: 'Azure Svc Bus', color: '#0062ad' },
    'kinetic':          { icon: '\u25C9', label: 'Kinetic',        color: '#43a047' },
    'file':             { icon: '\u25A3', label: 'File',           color: '#8d6e63' },
  };
  function typeMeta(typeKey) {
    return TYPE_META[typeKey] || { icon: '\u25EF', label: typeKey, color: '#888' };
  }

  // ─── Show/Hide Unsupported Toggle (radio-style) ───────────────────────────
  function syncFilterBtns() {
    if (filterSupportedBtn) filterSupportedBtn.classList.toggle('active', !showUnsupported);
    if (filterAllBtn) filterAllBtn.classList.toggle('active', showUnsupported);
  }

  if (filterSupportedBtn) {
    filterSupportedBtn.addEventListener('click', () => {
      if (showUnsupported) {
        showUnsupported = false;
        syncFilterBtns();
        populateTypeDropdown();
      }
    });
  }

  if (filterAllBtn) {
    filterAllBtn.addEventListener('click', () => {
      if (!showUnsupported) {
        showUnsupported = true;
        syncFilterBtns();
        populateTypeDropdown();
      }
    });
  }

  syncFilterBtns(); // set initial state

  // ─── Scope Toggle ──────────────────────────────────────────────────────────
  function setScope(admin) {
    useAdminScope = admin;
    if (scopeMyBtn) scopeMyBtn.classList.toggle('active', !admin);
    if (scopeOrgBtn) scopeOrgBtn.classList.toggle('active', admin);
  }

  setScope(true); // default to Org Feeds

  if (scopeMyBtn) scopeMyBtn.addEventListener('click', async () => {
    if (useAdminScope) {
      setScope(false);
      if (lastVelocityUrl && lastToken) {
        setStatus('info', 'Loading my feeds…');
        try {
          await loadItems(lastVelocityUrl, lastToken);
          setStatus('success', `${allItems.filter(i=>i.supported).length} supported of ${allItems.length} feed(s)`);
        } catch (err) { setStatus('error', err.message); }
      }
    }
  });

  if (scopeOrgBtn) scopeOrgBtn.addEventListener('click', async () => {
    if (!useAdminScope) {
      setScope(true);
      if (lastVelocityUrl && lastToken) {
        setStatus('info', 'Loading org feeds…');
        try {
          await loadItems(lastVelocityUrl, lastToken);
          setStatus('success', `${allItems.filter(i=>i.supported).length} supported of ${allItems.length} feed(s)`);
        } catch (err) { setStatus('error', err.message); }
      }
    }
  });

  // ─── Load stored credentials ───────────────────────────────────────────────
  (async () => {
    try {
      const stored = await window.velocityApi.getStoredCredentials();
      if (stored) {
        if (stored.portalUrl) {
          document.getElementById('portal-url').value = stored.portalUrl;
          document.getElementById('oauth-portal-url').value = stored.portalUrl;
        }
        if (stored.username) document.getElementById('username').value = stored.username;
        if (stored.rememberMe) rememberMe.checked = true;
      }
    } catch (_) { /* ignore */ }
  })();

  // ─── Tab Switching ─────────────────────────────────────────────────────────
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      formPassword.classList.toggle('hidden', currentTab !== 'password');
      formOAuth.classList.toggle('hidden', currentTab !== 'oauth');
    });
  });

  // ─── Sign In ───────────────────────────────────────────────────────────────
  signInBtn.addEventListener('click', async () => {
    setStatus('signing-in');
    try {
      let result;
      if (currentTab === 'password') {
        const portalUrl = document.getElementById('portal-url').value.trim();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        if (!portalUrl || !username || !password) {
          setStatus('error', 'Please fill in all fields.');
          return;
        }
        result = await window.velocityApi.login({ portalUrl, username, password });
        // Persist if remember me
        if (rememberMe.checked) {
          await window.velocityApi.storeCredentials({ portalUrl, username, rememberMe: true });
        }
      } else {
        const portalUrl = document.getElementById('oauth-portal-url').value.trim();
        const clientId = document.getElementById('client-id').value.trim();
        const clientSecret = document.getElementById('client-secret').value;
        if (!portalUrl || !clientId || !clientSecret) {
          setStatus('error', 'Please fill in all fields.');
          return;
        }
        result = await window.velocityApi.loginOAuth({ portalUrl, clientId, clientSecret });
      }

      if (result.error) {
        setStatus('error', result.error);
        return;
      }

      setStatus('success', 'Signed in. Loading feeds…');
      await loadItems(result.velocityUrl, result.token);
      setStatus('success', `Signed in${allItems.length > 0 ? ` • ${allItems.filter(i=>i.supported).length} supported feed(s) of ${allItems.length} total` : ' • No feeds found (check org permissions)'}`);
    } catch (err) {
      setStatus('error', err.message || 'Sign-in failed.');
    }
  });

  // ─── Refresh Button ────────────────────────────────────────────────────────
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      if (!lastVelocityUrl || !lastToken) {
        setStatus('error', 'Please sign in first.');
        return;
      }
      setStatus('info', 'Refreshing feeds…');
      try {
        await loadItems(lastVelocityUrl, lastToken);
        setStatus('success', `Refreshed • ${allItems.filter(i=>i.supported).length} supported of ${allItems.length} total feed(s)`);
      } catch (err) {
        setStatus('error', `Refresh failed: ${err.message}`);
      }
    });
  }

  // ─── Load Items ────────────────────────────────────────────────────────────
  async function loadItems(velocityUrl, token) {
    lastVelocityUrl = velocityUrl;
    lastToken = token;
    const items = await window.velocityApi.listItems({ velocityUrl, token, adminScope: useAdminScope });
    if (items && items.error) throw new Error(items.error);
    allItems = Array.isArray(items) ? items : [];
    populateTypeDropdown();
    pickerSection.classList.remove('hidden');
  }

  function populateTypeDropdown() {
    const visibleItems = showUnsupported ? allItems : allItems.filter(i => i.supported);
    const types = [...new Set(visibleItems.map(i => i.feedType || i.outputType))].sort();
    itemTypeSelect.innerHTML = '<option value="">All Types</option>';
    types.forEach(type => {
      const opt = document.createElement('option');
      opt.value = type;
      const supported = allItems.some(i => (i.feedType || i.outputType) === type && i.supported);
      const meta = typeMeta(type);
      opt.textContent = supported ? `${meta.icon} ${type}` : `\u26A0 ${type}`;
      if (!supported) opt.classList.add('type-option-unsupported');
      opt.title = supported ? `Show ${type} feeds` : `${type} - not yet supported by the Simulator`;
      itemTypeSelect.appendChild(opt);
    });
    populateItemDropdown();
  }

  function populateItemDropdown() {
    const filterType = itemTypeSelect.value;
    const visibleItems = showUnsupported ? allItems : allItems.filter(i => i.supported);
    const filtered = filterType
      ? visibleItems.filter(i => (i.feedType || i.outputType) === filterType)
      : visibleItems;
    itemSelect.innerHTML = '<option value="">- Select -</option>';
    filtered.forEach((item) => {
      const opt = document.createElement('option');
      const globalIdx = allItems.indexOf(item);
      opt.value = globalIdx;
      opt.dataset.globalIdx = globalIdx;
      const typeKey = item.feedType || item.outputType || '';
      const meta = typeMeta(typeKey);
      opt.textContent = item.supported
        ? `${meta.icon} ${item.label}  [${typeKey}]`
        : `\u26A0 ${item.label}  [${typeKey}]`;
      opt.style.color = item.supported ? meta.color : '#f5a623';
      if (!item.supported) opt.classList.add('item-option-unsupported');
      opt.title = item.supported
        ? `${item.label} - ${meta.label} feed`
        : `${item.label} - ${meta.label} (not yet supported by the Simulator)`;
      itemSelect.appendChild(opt);
    });
    infoPanel.classList.add('hidden');
    applyBtn.disabled = true;
    selectedItem = null;
  }

  // ─── Dropdown Events ───────────────────────────────────────────────────────
  itemTypeSelect.addEventListener('change', populateItemDropdown);

  itemSelect.addEventListener('change', () => {
    const opt = itemSelect.selectedOptions[0];
    if (!opt || opt.value === '') {
      infoPanel.classList.add('hidden');
      applyBtn.disabled = true;
      selectedItem = null;
      return;
    }
    const globalIdx = parseInt(opt.dataset.globalIdx, 10);
    const item = allItems[globalIdx];
    selectedItem = item;
    showInfo(item);
    applyBtn.disabled = !item.supported;
    if (!item.supported) {
      applyBtn.title = 'Cannot apply - this feed type is not yet supported by the Simulator.';
    } else {
      applyBtn.title = 'Apply the selected feed connection settings to the main window.';
    }
  });

  // ─── Info Panel ────────────────────────────────────────────────────────────
  function showInfo(item) {
    const typeKey = item.feedType || item.outputType || '';
    const meta = typeMeta(typeKey);
    const badge = document.getElementById('info-type-badge');
    if (badge) {
      badge.textContent = meta.icon + ' ';
      badge.style.color = meta.color;
      badge.title = meta.label;
    }
    infoLabel.textContent = item.label || '-';
    infoId.textContent = item.id || '-';
    infoType.textContent = meta.label || typeKey || '-';
    infoUrl.textContent = item.url || item.host || '-';
    infoAuth.textContent = item.authType || 'none';
    infoFormat.textContent = item.format || '-';
    const schemaFields = Array.isArray(item.schema) ? item.schema.map(f => f.name || f.fieldName || f).join(', ') : '-';
    infoSchema.textContent = schemaFields || '-';
    infoPanel.classList.remove('hidden');
  }

  // ─── Apply ─────────────────────────────────────────────────────────────────
  applyBtn.addEventListener('click', () => {
    if (!selectedItem) return;
    window.velocityApi.applyItem(selectedItem);
    window.velocityApi.hideWindow();
  });

  // ─── Close ─────────────────────────────────────────────────────────────────
  closeBtn.addEventListener('click', () => { window.velocityApi.hideWindow(); });

  // ─── Enter key in password / secret fields triggers Sign In ────────────────
  function handleEnterKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      signInBtn.click();
    }
  }
  const passwordInput = document.getElementById('password');
  const clientSecretInput = document.getElementById('client-secret');
  if (passwordInput) passwordInput.addEventListener('keydown', handleEnterKey);
  if (clientSecretInput) clientSecretInput.addEventListener('keydown', handleEnterKey);

  // ─── Password Visibility Toggle ────────────────────────────────────────────
  const EYE_OPEN_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>';
  const EYE_CLOSED_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>';

  function setupPasswordToggle(toggleId, inputId) {
    const toggle = document.getElementById(toggleId);
    const input = document.getElementById(inputId);
    if (!toggle || !input) return;
    toggle.addEventListener('click', () => {
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      toggle.innerHTML = visible ? EYE_OPEN_SVG : EYE_CLOSED_SVG;
      toggle.title = visible ? 'Show password' : 'Hide password';
    });
  }
  setupPasswordToggle('toggle-password', 'password');
  setupPasswordToggle('toggle-client-secret', 'client-secret');

  // ─── Status Helper ─────────────────────────────────────────────────────────
  function setStatus(type, message) {
    statusBanner.className = 'status-banner';
    if (type === 'signing-in') {
      statusBanner.classList.add('info');
      statusBannerIcon.innerHTML = '<span class="spinner"></span>';
      statusBannerText.textContent = 'Signing in…';
      statusBannerDismiss.classList.add('hidden');
      statusBanner.classList.remove('hidden');
      signInBtn.disabled = true;
    } else if (type === 'error') {
      statusBanner.classList.add('error');
      statusBannerIcon.textContent = '✕';
      statusBannerText.textContent = message;
      statusBannerDismiss.classList.remove('hidden');
      statusBanner.classList.remove('hidden');
      signInBtn.disabled = false;
    } else if (type === 'success') {
      statusBanner.classList.add('success');
      statusBannerIcon.textContent = '✓';
      statusBannerText.textContent = message;
      statusBannerDismiss.classList.remove('hidden');
      statusBanner.classList.remove('hidden');
      signInBtn.disabled = false;
    } else {
      statusBanner.classList.add('hidden');
      signInBtn.disabled = false;
    }
  }

  statusBannerDismiss.addEventListener('click', () => {
    statusBanner.classList.add('hidden');
  });
});

