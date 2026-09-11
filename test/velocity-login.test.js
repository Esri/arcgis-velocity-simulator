const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(require.resolve('../src/velocity-login.html'), 'utf8');
const source = fs.readFileSync(require.resolve('../src/velocity-login-renderer.js'), 'utf8');
const PORTAL = 'https://portal.example.com/portal';
const ROOT = 'https://velocity.example.com/velocity';
const state = (extra = {}) => {
  const result = {
    authenticated: true, portalUrl: PORTAL, endpointMode: 'automatic', publicApiUrl: '',
    detectedUrl: ROOT, effectiveUrl: ROOT, revision: 7, endpointError: '',
    selectedServerId: 'all', authRevision: 1, ...extra,
  };
  result.servers = extra.servers || [{
    id: 'server-1', label: 'Primary Velocity', endpointMode: result.endpointMode,
    publicApiUrl: result.publicApiUrl, detectedUrl: result.detectedUrl, effectiveUrl: result.effectiveUrl,
    profile: result.profile || 'current', status: result.endpointError ? 'error' : 'ready', error: result.endpointError,
  }];
  return result;
};
const list = (items, errors = [], revision = 7) => ({ items, errors, revision });
const feed = (id = 'feed-1') => ({ id, label: id, feedType: 'http-receiver', url: 'https://receiver.example.com/events', format: 'json', supported: true });
const server = (id, extra = {}) => ({
  id, label: `Velocity ${id}`, endpointMode: 'automatic', publicApiUrl: '',
  detectedUrl: `https://${id}.example.com/velocity`, effectiveUrl: `https://${id}.example.com/velocity`,
  profile: 'current', status: 'ready', error: '', ...extra,
});
const multiState = (extra = {}) => state({ servers: [server('server-a'), server('server-b')], ...extra });
const sourcedFeed = (serverId, feedId = 'shared-feed') => ({
  ...feed(JSON.stringify([serverId, feedId])), label: 'Shared feed', feedId, serverId, serverName: `Velocity ${serverId}`,
});
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { await tick(); await tick(); };
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function harness(overrides = {}) {
  const calls = [];
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://local.example.com/' });
  const defaults = {
    getStoredCredentials: async () => ({ portalUrl: PORTAL, username: 'tester', rememberMe: false }),
    getSessionState: async () => ({ authenticated: false }),
    login: async () => state(), loginOAuth: async () => state(),
    storeCredentials: async () => ({ success: true }),
    listItems: async ({ revision }) => list([feed()], [], revision), getItemDetails: async ({ id }) => feed(id),
    applyItem: async () => ({ success: true }), hideWindow: () => {},
    detectEndpoint: async () => state({ detectedUrl: 'https://detected.example.com/api' }),
    applyEndpoint: async params => state({ ...params, effectiveUrl: params.publicApiUrl || ROOT, revision: 8 }),
    selectServer: async serverId => state({ selectedServerId: serverId, revision: 8 }),
  };
  dom.window.velocityApi = Object.fromEntries(Object.entries({ ...defaults, ...overrides }).map(([key, fn]) => [
    key, (...args) => { calls.push([key, ...args]); return fn(...args); },
  ]));
  dom.window.eval(fs.readFileSync(require.resolve('../src/velocity-connection-options'), 'utf8'));
  dom.window.eval(fs.readFileSync(require.resolve('../src/velocity-endpoint-ui'), 'utf8'));
  dom.window.eval(source);
  await settle();
  const element = id => dom.window.document.getElementById(id);
  const change = (id, value, event = 'input') => {
    const input = element(id);
    if (input.type === 'radio' || input.type === 'checkbox') input.checked = value;
    else input.value = value;
    input.dispatchEvent(new dom.window.Event(event, { bubbles: true }));
  };
  const signIn = async () => {
    change('password', 'form-secret');
    element('sign-in-btn').click();
    await settle();
  };
  const selectFeed = async (index = '0') => { change('item-select', index, 'change'); await settle(); };
  return { dom, calls, element, change, signIn, selectFeed, close: () => dom.window.close() };
}

let passed = 0;
async function test(name, run) {
  try { await run(); passed++; console.log(`  ✓ ${name}`); }
  catch (error) { console.error(`  ✗ ${name}\n${error.stack}`); process.exitCode = 1; }
}

(async () => {
  await test('endpoint and Portal controls are shared across auth tabs; typing sends no requests', async () => {
    const app = await harness();
    app.element('endpoint-custom').click();
    const start = app.calls.length;
    app.change('public-api-url', 'https://custom.example.com/public');
    assert.strictEqual(app.calls.length, start);
    app.dom.window.document.querySelector('[data-tab="oauth"]').click();
    assert.strictEqual(app.element('public-api-url').value, 'https://custom.example.com/public');
    assert(!app.element('velocity-endpoint').closest('.auth-form'));
    assert(!app.element('portal-url').closest('.auth-form'));
    app.close();
  });

  await test('sign-in passes endpoint preferences but all browsing uses revision metadata only', async () => {
    const app = await harness();
    app.element('endpoint-custom').click();
    app.change('public-api-url', 'https://custom.example.com/public');
    await app.signIn();
    const login = app.calls.find(([name]) => name === 'login')[1];
    assert.strictEqual(login.endpointMode, 'custom');
    assert.strictEqual(login.publicApiUrl, 'https://custom.example.com/public');
    const list = app.calls.find(([name]) => name === 'listItems')[1];
    assert.deepStrictEqual(Object.keys(list).sort(), ['adminScope', 'revision', 'serverId']);
    assert.strictEqual(list.revision, 7);
    assert.strictEqual(app.element('password').value, '');
    const stored = app.calls.find(([name]) => name === 'storeCredentials')[1];
    assert(!JSON.stringify(stored).includes('form-secret'));
    assert(!('token' in stored));
    app.close();
  });

  await test('OAuth sign-in uses the same endpoint selection', async () => {
    const app = await harness();
    app.element('endpoint-custom').click();
    app.change('public-api-url', 'https://custom.example.com/api');
    app.dom.window.document.querySelector('[data-tab="oauth"]').click();
    app.change('client-id', 'application');
    app.change('client-secret', 'current-secret');
    app.element('sign-in-btn').click();
    await settle();
    const login = app.calls.find(([name]) => name === 'loginOAuth')[1];
    assert.strictEqual(login.portalUrl, PORTAL);
    assert.strictEqual(login.endpointMode, 'custom');
    assert.strictEqual(login.publicApiUrl, 'https://custom.example.com/api');
    assert.strictEqual(app.element('client-secret').value, '');
    app.close();
  });

  await test('pending endpoint edits block item Apply; detection is preview only', async () => {
    const app = await harness();
    await app.signIn();
    await app.selectFeed();
    assert.strictEqual(app.element('apply-btn').disabled, false);
    app.element('endpoint-custom').click();
    app.change('public-api-url', 'https://custom.example.com/api');
    assert.strictEqual(app.element('apply-btn').disabled, true);
    app.element('detect-endpoint-btn').click();
    await settle();
    assert.strictEqual(app.element('public-api-url').value, 'https://custom.example.com/api');
    assert.strictEqual(app.element('effective-url').textContent, ROOT);
    assert.strictEqual(app.element('detected-url').textContent, 'https://detected.example.com/api');
    assert.strictEqual(app.element('endpoint-custom').checked, true);
    app.element('apply-endpoint-btn').click();
    await settle();
    assert.strictEqual(app.element('effective-url').textContent, 'https://custom.example.com/api');
    assert.strictEqual(app.calls.filter(([name]) => name === 'listItems').at(-1)[1].revision, 8);
    assert.strictEqual(app.element('apply-btn').disabled, true);
    app.close();
  });

  await test('Apply awaits acknowledgement and sends identity rather than renderer properties', async () => {
    const applying = deferred();
    const app = await harness({ applyItem: () => applying.promise });
    await app.signIn();
    await app.selectFeed();
    app.element('apply-btn').click();
    assert(!app.calls.some(([name]) => name === 'hideWindow'));
    const request = app.calls.find(([name]) => name === 'applyItem')[1];
    assert.deepStrictEqual(Object.keys(request).sort(), ['id', 'revision']);
    applying.resolve({ success: true });
    await settle();
    assert(app.calls.some(([name]) => name === 'hideWindow'));
    app.close();
  });

  await test('failed Apply keeps the dialog open and reports the error', async () => {
    const app = await harness({ applyItem: async () => ({ error: 'Disconnect first.' }) });
    await app.signIn();
    await app.selectFeed();
    app.element('apply-btn').click();
    await settle();
    assert(!app.calls.some(([name]) => name === 'hideWindow'));
    assert.match(app.element('status-banner-text').textContent, /Disconnect first/);
    app.close();
  });

  await test('Portal edits invalidate late authentication and do not reuse a custom profile', async () => {
    const login = deferred();
    const app = await harness({
      login: () => login.promise,
      getStoredCredentials: async () => ({
        portalUrl: PORTAL, username: 'tester', rememberMe: true,
        endpointProfiles: { [PORTAL]: { endpointMode: 'custom', publicApiUrl: 'https://custom.example.com/api' } },
      }),
    });
    assert.strictEqual(app.element('endpoint-custom').checked, true);
    app.change('password', 'secret');
    app.element('sign-in-btn').click();
    app.change('portal-url', 'https://other.example.com/portal');
    login.resolve(state());
    await settle();
    assert.strictEqual(app.element('endpoint-automatic').checked, true);
    assert.strictEqual(app.element('public-api-url').value, '');
    assert.strictEqual(app.element('use-token-btn').disabled, true);
    assert(!app.calls.some(([name]) => name === 'listItems'));
    app.close();
  });

  await test('late scope and detail responses cannot replace the newer selection', async () => {
    const first = deferred();
    const oldDetail = deferred();
    let lists = 0;
    const app = await harness({
      getSessionState: async () => state(),
      listItems: () => ++lists === 1 ? first.promise : Promise.resolve(list([feed('new'), feed('second')])),
      getItemDetails: ({ id }) => id === 'new' ? oldDetail.promise : Promise.resolve(feed(id)),
    });
    app.element('scope-my').click();
    await settle();
    first.resolve(list([feed('old')]));
    await settle();
    assert(!app.element('item-select').textContent.includes('old'));
    app.change('item-select', '0', 'change');
    app.change('item-select', '1', 'change');
    await settle();
    oldDetail.resolve(feed('new'));
    await settle();
    assert.strictEqual(app.element('info-id').textContent, 'second');
    app.close();
  });

  await test('failed discovery preserves Portal token use without claiming list success', async () => {
    const app = await harness({ login: async () => state({ effectiveUrl: '', endpointError: 'Enter a custom public API URL.' }) });
    await app.signIn();
    assert.strictEqual(app.element('use-token-btn').disabled, false);
    assert.match(app.element('status-banner-text').textContent, /resource access is unavailable/);
    assert(!app.calls.some(([name]) => name === 'listItems'));
    app.element('use-token-btn').click();
    await settle();
    assert.deepStrictEqual(Object.keys(app.calls.find(([name]) => name === 'applyItem')[1]), ['tokenOnly']);
    app.close();
  });

  await test('malformed list and failed endpoint changes remain explicit errors', async () => {
    const app = await harness({
      listItems: async () => ({ unexpected: [] }),
      applyEndpoint: async () => ({ error: 'The public API endpoint is not reachable.' }),
    });
    await app.signIn();
    assert.match(app.element('status-banner-text').textContent, /response is invalid/);
    app.element('endpoint-custom').click();
    app.change('public-api-url', 'https://custom.example.com/api');
    app.element('apply-endpoint-btn').click();
    await settle();
    assert.match(app.element('status-banner-text').textContent, /not reachable/);
    assert.strictEqual(app.element('effective-url').textContent, ROOT);
    assert.strictEqual(app.element('apply-btn').disabled, true);
    app.close();
  });

  await test('WebSocket feeds stay unsupported even if a legacy list marks them supported', async () => {
    const websocket = { ...feed(), feedType: 'websocket', url: 'wss://receiver.example.com' };
    const app = await harness({ listItems: async () => list([websocket]), getItemDetails: async () => websocket });
    await app.signIn();
    assert.strictEqual(app.element('item-select').options.length, 1);
    app.element('filter-all-btn').click();
    await app.selectFeed();
    assert.strictEqual(app.element('apply-btn').disabled, true);
    app.close();
  });

  await test('invalid advertised properties block Apply before any fields or URL preview change', async () => {
    const app = await harness({
      getItemDetails: async () => ({ ...feed(), url: 'https://receiver.example.com/events?token=do-not-display' }),
    });
    await app.signIn();
    await app.selectFeed();
    assert.strictEqual(app.element('apply-btn').disabled, true);
    assert.match(app.element('status-banner-text').textContent, /credential query parameters/);
    assert(!app.element('info-url').textContent.includes('do-not-display'));
    app.close();
  });

  await test('late endpoint validation cannot commit into a newly edited Portal', async () => {
    const applying = deferred();
    const app = await harness({ applyEndpoint: () => applying.promise });
    await app.signIn();
    app.element('endpoint-custom').click();
    app.change('public-api-url', 'https://custom.example.com/api');
    app.element('apply-endpoint-btn').click();
    app.change('portal-url', 'https://other.example.com/portal');
    applying.resolve(state({ endpointMode: 'custom', publicApiUrl: 'https://custom.example.com/api', effectiveUrl: 'https://custom.example.com/api', revision: 8 }));
    await settle();
    assert.strictEqual(app.element('effective-url').textContent, 'Not applied');
    assert.strictEqual(app.element('use-token-btn').disabled, true);
    assert.strictEqual(app.calls.filter(([name]) => name === 'listItems').length, 1);
    app.close();
  });

  await test('Remember me restores equivalent Portal profiles and clearing sends no secrets', async () => {
    const app = await harness({
      getStoredCredentials: async () => ({
        portalUrl: PORTAL, username: 'tester', rememberMe: true,
        endpointProfiles: { 'https://portal.example.com:443/portal': { endpointMode: 'custom', publicApiUrl: 'https://custom.example.com/api' } },
      }),
    });
    assert.strictEqual(app.element('endpoint-custom').checked, true);
    assert.strictEqual(app.element('public-api-url').value, 'https://custom.example.com/api');
    app.change('password', 'do-not-store');
    app.element('remember-me').click();
    await settle();
    const stored = app.calls.find(([name]) => name === 'storeCredentials')[1];
    assert.strictEqual(stored.rememberMe, false);
    assert(!JSON.stringify(stored).includes('do-not-store'));
    app.close();
  });

  await test('all static login tooltips are documented verbatim', async () => {
    const dom = new JSDOM(html);
    const documentation = fs.readFileSync(require.resolve('../docs/velocity-login.md'), 'utf8');
    for (const control of dom.window.document.querySelectorAll('[title], [data-tooltip]')) {
      const tooltip = control.dataset.tooltip || control.title;
      assert(documentation.includes(tooltip), `Undocumented tooltip: ${tooltip}`);
    }
    for (const control of dom.window.document.querySelectorAll('button, input, select, label, option, summary')) {
      assert(control.dataset.tooltip || control.title, `Missing tooltip: ${control.outerHTML}`);
    }
    dom.window.close();
  });

  await test('common controller exposes only immutable metadata and uses no role-specific picker state', async () => {
    const { create, portalKey } = require('../src/velocity-endpoint-ui');
    const dom = new JSDOM(html);
    let loads = 0;
    let invalidations = 0;
    const controller = create({
      document: dom.window.document,
      api: {
        getStoredCredentials: async () => null,
        getSessionState: async () => state({ profile: 'current', expires: 12345, token: 'must-not-retain', password: 'must-not-retain' }),
      },
      onLoadItems: async () => { loads++; },
      onInvalidate: () => { invalidations++; },
    });
    await controller.initialize();
    assert.strictEqual(loads, 1);
    assert.strictEqual(controller.canBrowse, true);
    assert.strictEqual(controller.session.authenticated, true);
    assert.strictEqual(controller.session.profile, 'current');
    assert.strictEqual(controller.session.expires, 12345);
    assert.strictEqual(controller.session.revision, 7);
    assert(Object.isFrozen(controller.session));
    assert(Object.isFrozen(controller.session.servers));
    assert(Object.isFrozen(controller.session.servers[0]));
    assert(!JSON.stringify(controller.session).includes('must-not-retain'));
    const custom = dom.window.document.getElementById('endpoint-custom');
    custom.checked = true;
    custom.dispatchEvent(new dom.window.Event('change'));
    assert.strictEqual(controller.generation, 1);
    assert.strictEqual(controller.pendingEndpoint, true);
    assert.strictEqual(controller.canBrowse, false);
    assert.strictEqual(invalidations, 1);
    assert.strictEqual(portalKey('https://PORTAL.example.com:443/portal/'), PORTAL);
    dom.window.close();
  });

  await test('All Velocity servers aggregates duplicate feed names without losing source identity', async () => {
    const items = [sourcedFeed('server-a'), sourcedFeed('server-b')];
    const app = await harness({
      getSessionState: async () => multiState(),
      listItems: async () => list(items),
      getItemDetails: async ({ id }) => items.find(item => item.id === id),
    });
    assert(!app.element('velocity-server-row').classList.contains('hidden'));
    assert.strictEqual(app.element('velocity-endpoint').open, true);
    assert.strictEqual(app.element('velocity-server-select').value, 'all');
    assert.strictEqual(app.element('velocity-server-select').options.length, 3);
    assert.strictEqual(app.element('public-api-url').disabled, true);
    assert.strictEqual(app.element('endpoint-custom').disabled, true);
    assert.strictEqual(app.element('velocity-server-status').children.length, 2);
    assert.match(app.element('item-select').textContent, /Velocity server-a/);
    assert.match(app.element('item-select').textContent, /Velocity server-b/);
    await app.selectFeed('1');
    assert.strictEqual(app.element('info-id').textContent, 'shared-feed');
    assert.strictEqual(app.element('info-server').textContent, 'Velocity server-b (server-b)');
    app.element('apply-btn').click();
    await settle();
    assert.strictEqual(app.calls.find(([name]) => name === 'applyItem')[1].id, items[1].id);
    assert.strictEqual(app.calls.find(([name]) => name === 'listItems')[1].serverId, 'all');
    app.close();
  });

  await test('a partial server failure preserves healthy feeds and displays a persistent warning', async () => {
    const item = sourcedFeed('server-a');
    const errors = [{ serverId: 'server-b', serverName: 'Velocity server-b', message: 'Resource access denied.' }];
    const app = await harness({
      getSessionState: async () => multiState({ servers: [server('server-a'), server('server-b', { status: 'error', error: 'Resource access denied.' })] }),
      listItems: async () => list([item], errors),
      getItemDetails: async () => item,
    });
    assert(app.element('status-banner').classList.contains('warning'));
    assert.match(app.element('status-banner-text').textContent, /Some Velocity servers could not be queried/);
    assert.match(app.element('velocity-server-errors').textContent, /Velocity server-b: Resource access denied/);
    assert(!app.element('picker-section').classList.contains('hidden'));
    await app.selectFeed();
    assert.strictEqual(app.element('apply-btn').disabled, false);
    assert(!app.element('velocity-server-errors').classList.contains('hidden'));
    app.close();
  });

  await test('server selection scopes endpoint edits and remembered preferences to that server only', async () => {
    const firstUrl = 'https://custom-a.example.com/public';
    const secondUrl = 'https://custom-b.example.com/public';
    let current = multiState({
      servers: [server('server-a', { endpointMode: 'custom', publicApiUrl: firstUrl, effectiveUrl: firstUrl }), server('server-b')],
    });
    const app = await harness({
      getSessionState: async () => current,
      getStoredCredentials: async () => ({ portalUrl: PORTAL, username: 'tester', rememberMe: true }),
      selectServer: async selectedServerId => {
        current = { ...current, selectedServerId, revision: current.revision + 1 };
        return current;
      },
      applyEndpoint: async params => {
        current = {
          ...current, revision: current.revision + 1,
          servers: current.servers.map(item => item.id === params.serverId
            ? { ...item, endpointMode: params.endpointMode, publicApiUrl: params.publicApiUrl, effectiveUrl: params.publicApiUrl } : item),
        };
        return current;
      },
      listItems: async ({ revision }) => list([], [], revision),
    });
    app.change('velocity-server-select', 'server-b', 'change');
    await settle();
    assert.strictEqual(app.element('endpoint-custom').disabled, false);
    app.element('endpoint-custom').click();
    app.change('public-api-url', secondUrl);
    app.element('apply-endpoint-btn').click();
    await settle();
    const applied = app.calls.find(([name]) => name === 'applyEndpoint')[1];
    assert.strictEqual(applied.serverId, 'server-b');
    assert.strictEqual(applied.publicApiUrl, secondUrl);
    const stored = app.calls.filter(([name]) => name === 'storeCredentials').at(-1)[1];
    assert.strictEqual(stored.serverId, 'server-b');
    assert.strictEqual(stored.selectedServerId, 'server-b');
    assert.strictEqual(stored.publicApiUrl, secondUrl);
    app.change('velocity-server-select', 'server-a', 'change');
    await settle();
    assert.strictEqual(app.element('public-api-url').value, firstUrl);
    assert.strictEqual(app.element('effective-url').textContent, firstUrl);
    assert.strictEqual(current.servers.find(item => item.id === 'server-b').publicApiUrl, secondUrl);
    app.close();
  });

  await test('All view cannot apply a global public URL or reset per-server overrides', async () => {
    const app = await harness({
      getSessionState: async () => multiState(),
      applyEndpoint: async () => multiState({ revision: 8 }),
    });
    app.element('apply-endpoint-btn').click();
    await settle();
    assert.strictEqual(app.element('apply-endpoint-btn').disabled, true);
    assert(!app.calls.some(([name]) => name === 'applyEndpoint'));
    assert.strictEqual(app.element('detect-endpoint-btn').disabled, false);
    app.close();
  });

  await test('multi-server discovery refreshes previews without replacing active roots or scope', async () => {
    const current = multiState({
      servers: [server('server-a', { endpointMode: 'custom', publicApiUrl: 'https://custom-a.example.com/api' }), server('server-b')],
    });
    const app = await harness({
      getSessionState: async () => current,
      detectEndpoint: async () => ({
        ...current,
        servers: current.servers.map(item => ({
          ...item, detectedUrl: `https://preview-${item.id}.example.com/api`, effectiveUrl: 'https://not-active.example.com/api',
        })),
      }),
    });
    app.element('detect-endpoint-btn').click();
    await settle();
    const summary = app.element('velocity-server-status').textContent;
    assert.match(summary, /preview-server-a\.example\.com/);
    assert.match(summary, /preview-server-b\.example\.com/);
    assert.match(summary, /Effective URL: https:\/\/server-a\.example\.com/);
    assert(!summary.includes('not-active.example.com'));
    assert.strictEqual(app.element('velocity-server-select').value, 'all');
    app.close();
  });

  await test('a newer server scope ignores a late aggregate list response', async () => {
    const oldList = deferred();
    let requests = 0;
    const app = await harness({
      getSessionState: async () => multiState(),
      selectServer: async selectedServerId => multiState({ selectedServerId, revision: 8 }),
      listItems: async ({ revision }) => ++requests === 1 ? oldList.promise : list([sourcedFeed('server-b')], [], revision),
    });
    app.change('velocity-server-select', 'server-b', 'change');
    await settle();
    oldList.resolve(list([sourcedFeed('server-a')]));
    await settle();
    assert.strictEqual(app.element('velocity-server-select').value, 'server-b');
    assert.match(app.element('item-select').textContent, /Velocity server-b/);
    assert(!app.element('item-select').textContent.includes('Velocity server-a'));
    app.close();
  });

  await test('Remember me restores a selected server profile without reusing another server override', async () => {
    const selectedUrl = 'https://selected.example.com/api';
    const app = await harness({
      getStoredCredentials: async () => ({
        portalUrl: PORTAL, username: 'tester', rememberMe: true,
        endpointProfiles: {
          [PORTAL]: {
            selectedServerId: 'server-b',
            serverProfiles: {
              'server-a': { endpointMode: 'custom', publicApiUrl: 'https://other.example.com/api' },
              'server-b': { endpointMode: 'custom', publicApiUrl: selectedUrl },
            },
          },
        },
      }),
      login: async () => multiState({
        selectedServerId: 'server-b',
        servers: [server('server-a'), server('server-b', { endpointMode: 'custom', publicApiUrl: selectedUrl, effectiveUrl: selectedUrl })],
      }),
    });
    assert.strictEqual(app.element('public-api-url').value, selectedUrl);
    await app.signIn();
    const request = app.calls.find(([name]) => name === 'login')[1];
    assert.strictEqual(request.serverId, 'server-b');
    assert.strictEqual(request.publicApiUrl, selectedUrl);
    assert.strictEqual(app.element('velocity-server-select').value, 'server-b');
    app.close();
  });

  await test('legacy saved endpoint preferences remain editable before server discovery', async () => {
    const app = await harness({
      getStoredCredentials: async () => ({
        portalUrl: PORTAL, username: 'tester', rememberMe: true,
        endpointProfiles: {
          [PORTAL]: {
            endpointMode: 'custom', publicApiUrl: 'https://legacy.example.com/api',
            selectedServerId: 'all', serverProfiles: {},
          },
        },
      }),
    });
    assert.strictEqual(app.element('public-api-url').value, 'https://legacy.example.com/api');
    assert.strictEqual(app.element('endpoint-custom').checked, true);
    app.close();
  });

  await test('an unsupported-only list reports the total and explains how to show its items', async () => {
    const items = Array.from({ length: 14 }, (_, index) => ({
      ...feed(`source-${index}`), feedType: 'http-poller', supported: false,
    }));
    const app = await harness({ listItems: async () => list(items) });
    await app.signIn();
    assert.strictEqual(app.element('item-select').options.length, 1);
    assert.match(app.element('status-banner-text').textContent, /0 supported of 14/);
    assert.match(app.element('status-banner-text').textContent, /Choose All beside Supported/);
    app.element('filter-all-btn').click();
    assert.strictEqual(app.element('item-select').options.length, 15);
    assert(!app.element('status-banner-text').textContent.includes('Choose All'));
    app.close();
  });

  await test('one-server All scope edits and saves the concrete server rather than an all override', async () => {
    const app = await harness();
    await app.signIn();
    app.element('endpoint-custom').click();
    app.change('public-api-url', 'https://single.example.com/public');
    app.element('apply-endpoint-btn').click();
    await settle();
    const request = app.calls.find(([name]) => name === 'applyEndpoint')[1];
    assert.strictEqual(request.serverId, 'server-1');
    const saved = app.calls.filter(([name]) => name === 'storeCredentials').at(-1)[1];
    assert.strictEqual(saved.serverId, 'server-1');
    assert.strictEqual(saved.selectedServerId, 'all');
    assert.strictEqual(saved.endpointMode, 'custom');
    app.close();
  });

  console.log(`velocity-login: ${passed} tests passed`);
})();
