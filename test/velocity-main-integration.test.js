const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { readVelocityPreferences, updateVelocityPreferences } = require('../src/velocity-preferences');
const { VelocitySession } = require('../src/velocity-session');

const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
const start = source.indexOf('function handleVelocityRequest(');
const end = source.indexOf('// Forward token refresh events', start);
assert.ok(start >= 0 && end > start);
const handlers = new Map();
const listeners = new Map();
const sender = {};
const mainSender = { send: (channel, payload) => sent.push({ channel, payload }) };
const sent = [];
const logs = [];
let saved = null;
let selectedParams;
const context = {
  ipcMain: {
    handle: (name, callback) => handlers.set(name, callback),
    on: (name, callback) => listeners.set(name, callback),
  },
  velocityLoginWindow: { isDestroyed: () => false, webContents: sender },
  mainWindow: { isDestroyed: () => false, webContents: mainSender },
  velocitySession: {
    state: { authenticated: true, revision: 4, authRevision: 1, effectiveUrl: 'https://public.example.com/velocity' },
    async login(params) {
      assert.strictEqual(params.authMode, 'password');
      this.state.authRevision++;
      context.hotSwapVelocityAuthToken();
      return this.state;
    },
    async detect() { return { ...this.state, detectedUrl: 'https://detected.example.com/arcgis' }; },
    async setEndpoint() { return this.state; },
    selectServer() { return this.state; },
  },
  velocityCatalog: {
    clear() {},
    async list(params) { assert.strictEqual(params.revision, 4); return { items: [{ id: 'feed-1' }], errors: [], revision: 4 }; },
    async details() { return { id: 'feed-1' }; },
    async selected(params) {
      selectedParams = params;
      return { id: 'feed-1', supported: true, feedType: 'grpc', url: 'public.example.com:9443' };
    },
  },
  velocityTokenManager: { isAuthenticated: true, token: 'new-auth-token' },
  velocityConnectionBusy: false,
  velocityLoginPending: false,
  velocityAppliedRevision: null,
  velocityTransportRevision: 1,
  velocitySendAuthToken: false,
  grpcTransport: { authToken: 'active-auth-token' },
  httpTransport: { authToken: 'active-auth-token' },
  velocityLog: (level, message) => logs.push([level, message]),
  sendVelocityTokenState() {},
  shouldSendVelocityTokenByDefault: () => true,
  velocityCredsFile: 'memory-only-preferences',
  readVelocityPreferences,
  updateVelocityPreferences,
  fs: {
    existsSync: () => saved !== null,
    readFileSync: () => saved,
    writeFileSync: (_file, content) => { saved = content; },
    unlinkSync: () => { saved = null; },
  },
};
vm.createContext(context);
const tokenGetterStart = source.indexOf('function getVelocityAuthTokenForConnection(');
vm.runInContext(source.slice(tokenGetterStart, source.indexOf('const documentationUrlPrefix', tokenGetterStart)), context);
const hotSwapStart = source.indexOf('function hotSwapVelocityAuthToken(');
vm.runInContext(source.slice(hotSwapStart, source.indexOf('function sendVelocityTokenState(', hotSwapStart)), context);
vm.runInContext(source.slice(start, end), context);
const request = (name, params = {}, eventSender = sender) => handlers.get(name)({ sender: eventSender }, params);

(async () => {
  const unauthorized = await request('velocity:get-session-state', {}, {});
  assert.match(unauthorized.error, /sign-in dialog/);
  const invalid = await request('velocity:login', null);
  assert.match(invalid.error, /Invalid Velocity request/);
  context.velocityConnectionBusy = true;
  const signedIn = await request('velocity:login', {
    portalUrl: 'https://portal.example.com', username: 'user', password: 'private-password',
  });
  assert.strictEqual(signedIn.revision, 4);
  assert.ok(!JSON.stringify(signedIn).includes('private-password'));
  assert.ok(!JSON.stringify(logs).includes('private-password'));
  assert.strictEqual(context.velocityLoginPending, false);
  assert.strictEqual(context.grpcTransport.authToken, 'active-auth-token');
  context.hotSwapVelocityAuthToken();
  assert.strictEqual(context.httpTransport.authToken, 'active-auth-token');
  listeners.get('velocity:set-token-sending')({ sender: mainSender }, false);
  assert.strictEqual(context.grpcTransport.authToken, null);
  listeners.get('velocity:set-token-sending')({ sender: mainSender }, true);
  assert.strictEqual(context.grpcTransport.authToken, null);
  context.velocityConnectionBusy = false;
  context.velocityLoginPending = true;
  assert.match((await request('velocity:login')).error, /already in progress/);
  context.velocityLoginPending = false;
  assert.strictEqual((await request('velocity:list-items', { revision: 4 })).items.length, 1);
  assert.strictEqual((await request('velocity:detect-endpoint')).effectiveUrl, signedIn.effectiveUrl);
  context.velocitySession.state.servers = [{ id: 'server-a' }, { id: 'server-b' }];
  context.velocitySession.state.selectedServerId = 'all';
  assert.match((await request('velocity:apply-endpoint', { endpointMode: 'automatic' })).error, /Select one Velocity server/);
  assert.match((await request('velocity:apply-endpoint', { serverId: 'all', endpointMode: 'custom' })).error, /Select one Velocity server/);
  assert.strictEqual((await request('velocity:apply-endpoint', { serverId: 'server-a', endpointMode: 'automatic' })).revision, 4);

  const applied = await request('velocity:apply-item', {
    id: 'feed-1', revision: 4, url: 'https://forged.example.com',
  });
  assert.strictEqual(applied.success, true);
  assert.strictEqual(selectedParams.id, 'feed-1');
  assert.strictEqual(sent.at(-1).payload.url, 'public.example.com:9443');
  context.velocityConnectionBusy = true;
  assert.match((await request('velocity:apply-item', { tokenOnly: true })).error, /Disconnect/);
  context.velocityConnectionBusy = false;
  context.velocityTokenManager.isAuthenticated = false;
  assert.match((await request('velocity:apply-item', { tokenOnly: true })).error, /Sign in/);

  assert.strictEqual((await request('velocity:store-credentials', {
    portalUrl: 'https://portal.example.com/portal', username: 'user', rememberMe: true,
    endpointMode: 'custom', serverId: 'server-a', publicApiUrl: 'https://public.example.com/velocity',
    password: 'private-password', token: 'private-token',
  })).success, true);
  assert.ok(!saved.includes('private-'));
  const preferences = await request('velocity:get-stored-credentials');
  assert.strictEqual(preferences.endpointProfiles['https://portal.example.com/portal'].serverProfiles['server-a'].endpointMode, 'custom');
  assert.strictEqual((await request('velocity:store-credentials', { rememberMe: false })).success, true);
  assert.strictEqual(saved, null);
  saved = '{invalid';
  assert.ok((await request('velocity:get-stored-credentials')).error);
  assert.strictEqual((await request('velocity:store-credentials', { rememberMe: false })).success, true);
  assert.strictEqual(saved, null);
  const connectStart = source.indexOf("ipcMain.handle('connect',");
  const connectEnd = source.indexOf('// Disconnects any active TCP or UDP connection.', connectStart);
  const connectContext = {
    ipcMain: context.ipcMain, connection: null, grpcTransport: null,
    httpTransport: null, wsTransport: null, xmppTransport: null,
    velocityConnectionBusy: false, logStatus: message => logs.push(['status', message]),
    SOCKET_PAYLOAD_FORMAT_SET: new Set(['delimited', 'json', 'geo-json', 'esri-json']),
    activeSocketPayloadFormat: null,
  };
  vm.runInNewContext(source.slice(connectStart, connectEnd), connectContext);
  for (const invalidConnection of [{ protocol: 'unknown', mode: 'client' }, { protocol: 'tcp', mode: 'unknown' }]) {
    const result = handlers.get('connect')({}, { ip: 'example.com', port: 443, ...invalidConnection });
    assert.strictEqual(result.success, false);
    assert.match(result.error, /Unsupported/);
    assert.strictEqual(connectContext.velocityConnectionBusy, false);
  }
  const invalidFormat = handlers.get('connect')({}, {
    protocol: 'tcp', mode: 'client', ip: 'example.com', port: 443, tcpFormat: 'xml',
  });
  assert.strictEqual(invalidFormat.success, false);
  assert.match(invalidFormat.error, /payload format/);
  assert.strictEqual(connectContext.velocityConnectionBusy, false);
  const actualSession = new VelocitySession({
    request: async (url) => {
      if (url.endsWith('/sharing/rest/generateToken')) return { token: 'synthetic-session-token', expires: Date.now() + 3600000 };
      if (new URL(url).pathname.endsWith('/sharing/rest/portals/self/servers')) return { error: { code: 403 } };
      if (url === 'https://manual.example.com/velocity/feed') return [];
      throw new Error('Unexpected synthetic endpoint.');
    },
  });
  context.velocitySession = actualSession;
  context.velocityTokenManager = actualSession.tokenManager;
  try {
    const restricted = await request('velocity:login', {
      portalUrl: 'https://portal.example.com/portal', username: 'test-user',
      password: 'synthetic-password', endpointMode: 'automatic', serverId: 'all',
    });
    assert.strictEqual(restricted.authenticated, true);
    assert.strictEqual(restricted.servers.length, 0);
    const recovered = await request('velocity:apply-endpoint', {
      serverId: 'all', endpointMode: 'custom', publicApiUrl: 'https://manual.example.com/velocity',
    });
    assert.strictEqual(recovered.effectiveUrl, 'https://manual.example.com/velocity');
    assert.strictEqual(recovered.servers[0].id, 'custom');
    assert.strictEqual(recovered.authRevision, restricted.authRevision);
  } finally {
    actualSession.logout();
  }
  console.log('velocity-main-integration tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
