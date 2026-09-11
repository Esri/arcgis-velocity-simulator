const assert = require('assert');
const { VelocitySession, discoverVelocityEndpoint, discoverVelocityServers } = require('../src/velocity-session');
const { TokenManager } = require('../src/velocity-rest-client');

const portal = 'https://portal.example.com:443/nested/portal';
const subscriptionUrl = `${portal}/sharing/rest/portals/self/subscriptionInfo?f=json`;
const serversUrl = `${portal}/sharing/rest/portals/self/servers?f=json`;
const feed = { id: 'feed-one', feed: { name: 'grpc', properties: { 'grpc.url': 'https://data.example.com' } } };
const passwordLogin = { authMode: 'password', portalUrl: portal, username: 'user', password: 'password-value' };

function fail(status, code = 'HTTP_ERROR', arcgisCode) {
  const error = new Error(`Request failed (HTTP ${status}).`);
  Object.assign(error, { httpStatus: status, code });
  if (arcgisCode) error.arcgisCode = arcgisCode;
  return error;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(routes = {}, now = Date.now) {
  const calls = [];
  let issues = 0;
  const request = async (url, options) => {
    const requestUrl = url;
    url = url.replace(/&token=[^&]*/, '');
    calls.push({ url, requestUrl, options });
    if (url.endsWith('/generateToken')) return { token: `token-${++issues}`, expires: now() + 60000 };
    if (url.endsWith('/oauth2/token')) return { access_token: `token-${++issues}`, expires_in: 60 };
    if (!Object.hasOwn(routes, url)) {
      if (url === serversUrl) throw fail(404);
      throw new Error('Unexpected URL');
    }
    const value = routes[url];
    if (value instanceof Error) throw value;
    return typeof value === 'function' ? value(options) : value;
  };
  const tokenManager = new TokenManager({ request, now });
  const session = new VelocitySession({ tokenManager, request });
  return { session, tokenManager, request, calls, routes, issues: () => issues };
}

async function main() {
  for (const base of [
    'https://velocity.example.com',
    'https://velocity.example.com:443/arcgis/velocity',
    'https://velocity.example.com:7443/custom/nested',
    'https://region.example.com/orgid/tenant123',
  ]) {
    const f = fixture({
      [subscriptionUrl]: { orgCapabilities: [{ id: 'velocity', velocityUrl: base }] },
      [`${base}/feed`]: [feed],
    });
    const state = await f.session.login(passwordLogin);
    assert.strictEqual(state.effectiveUrl, base);
    assert.strictEqual(state.profile, 'current');
    assert.strictEqual(state.authenticated, true);
    assert.strictEqual(state.endpointError, '');
    assert.strictEqual(f.issues(), 1);
    assert.deepStrictEqual(f.calls.map(call => call.url), [
      `${portal}/sharing/rest/generateToken`, serversUrl, subscriptionUrl, `${base}/feed`,
    ]);
    assert.strictEqual(f.calls[1].options.token, 'token-1');
    assert.strictEqual(f.calls[2].options.token, 'token-1');
    assert.ok(!JSON.stringify(state).includes('password-value'));
    assert.ok(!JSON.stringify(state).includes('token-1'));
    f.session.logout();
  }

  const instance = 'https://velocity.example.com:7443/reverse-proxy';
  const f = fixture({
    [subscriptionUrl]: { orgCapabilities: [{ id: 'A4IoT', iotRegionUrl: instance }] },
    [`${instance}/feed`]: fail(404),
    [`${instance}/arcgis/feed`]: [],
  });
  const first = await f.session.login(passwordLogin);
  assert.strictEqual(first.effectiveUrl, `${instance}/arcgis`);
  assert.strictEqual(first.profile, 'current');
  assert.strictEqual(f.calls.length, 5);
  f.session.logout();
  f.routes[`${instance}/arcgis/feed`] = fail(405);
  f.routes[`${instance}/iot/feeds`] = [feed];
  assert.strictEqual((await f.session.login(passwordLogin)).profile, 'legacy');
  assert.strictEqual(f.session.context.apiBaseUrl, `${instance}/iot`);
  f.session.logout();

  for (const error of [
    fail(401), fail(403), fail(498), fail(500), fail(404, 'INVALID_JSON'),
    fail(404, 'ARCGIS_ERROR', 498), Object.assign(new Error('TLS failure'), { code: 'NETWORK_ERROR' }),
  ]) {
    const request = fixture({
      [subscriptionUrl]: { orgCapabilities: [{ id: 'velocity', velocityUrl: instance }] },
      [`${instance}/feed`]: error,
    });
    await assert.rejects(discoverVelocityEndpoint(portal, 'token', { request: request.request }), e => e === error);
    assert.strictEqual(request.calls.length, 2, `No fallback for ${error.code}/${error.httpStatus}`);
  }
  for (const shape of [{ feeds: [] }, { outputs: [] }, [{ name: 'grpc' }], 'catalog', null]) {
    const request = fixture({
      [subscriptionUrl]: { orgCapabilities: [{ id: 'velocity', velocityUrl: instance }] },
      [`${instance}/feed`]: shape,
    });
    await assert.rejects(discoverVelocityEndpoint(portal, 'token', { request: request.request }), /raw feed configuration array/);
    assert.strictEqual(request.calls.length, 2);
  }

  for (const subscription of [fail(404), { orgCapabilities: [] }, { error: { code: 400, message: 'Subscription info is not supported.' } }]) {
    const server = fixture({
      [subscriptionUrl]: subscription,
      [serversUrl]: { servers: [{ serverType: 'ARCGIS_VELOCITY', url: `${instance}/arcgis/velocity` }] },
      [`${instance}/arcgis/velocity/feed`]: [],
    });
    assert.strictEqual((await discoverVelocityEndpoint(portal, 'token', { request: server.request })).apiBaseUrl, `${instance}/arcgis/velocity`);
  }
  for (const metadata of [null, [], 'not-metadata', { orgCapabilities: {} }]) {
    const request = fixture({ [subscriptionUrl]: metadata });
    await assert.rejects(discoverVelocityEndpoint(portal, 'token', { request: request.request }), /unexpected shape/);
    assert.strictEqual(request.calls.length, 1);
  }
  for (const status of [401, 403, 498, 500]) {
    const request = fixture({ [subscriptionUrl]: fail(status) });
    await assert.rejects(discoverVelocityEndpoint(portal, 'token', { request: request.request }));
    assert.strictEqual(request.calls.length, 1);
  }
  const malformed = fixture({
    [subscriptionUrl]: { error: { code: 400, message: 'Invalid user permissions.' } },
  });
  await assert.rejects(discoverVelocityEndpoint(portal, 'token', { request: malformed.request }), /API error/);
  assert.strictEqual(malformed.calls.length, 1);
  const missing = fixture({ [subscriptionUrl]: {}, [serversUrl]: { servers: [{ serverType: 'ARCGIS_SERVER', url: instance }] } });
  const noEndpoint = await missing.session.login(passwordLogin);
  assert.strictEqual(noEndpoint.authenticated, true);
  assert.strictEqual(noEndpoint.effectiveUrl, '');
  assert.match(noEndpoint.endpointError, /Choose Custom/);
  assert.throws(() => missing.session.context, /No validated/);
  assert.strictEqual(missing.tokenManager.token, 'token-1');
  const recoveryUrl = 'https://manual.example.com/public-context';
  missing.routes[`${recoveryUrl}/feed`] = [];
  const recovered = await missing.session.setEndpoint({ serverId: 'all', endpointMode: 'custom', publicApiUrl: recoveryUrl });
  assert.strictEqual(recovered.servers.length, 1);
  assert.strictEqual(recovered.servers[0].id, 'custom');
  assert.strictEqual(recovered.effectiveUrl, recoveryUrl);
  assert.strictEqual(recovered.authRevision, noEndpoint.authRevision);
  assert.strictEqual(missing.issues(), 1);
  missing.session.logout();

  const restrictedRegistry = fixture({ [serversUrl]: fail(403), [`${recoveryUrl}/feed`]: [] });
  const restrictedState = await restrictedRegistry.session.login(passwordLogin);
  assert.strictEqual(restrictedState.authenticated, true);
  assert.strictEqual(restrictedState.servers.length, 0);
  assert.strictEqual((await restrictedRegistry.session.setEndpoint({
    serverId: 'all', endpointMode: 'custom', publicApiUrl: recoveryUrl,
  })).effectiveUrl, recoveryUrl);
  assert.strictEqual(restrictedRegistry.issues(), 1);
  restrictedRegistry.session.logout();

  const custom = 'https://custom.example.com:443/deep/complete-root';
  const preview = 'https://detected.example.com/arcgis/velocity';
  const customFixture = fixture({
    [`${custom}/feed`]: [],
    [subscriptionUrl]: { orgCapabilities: [{ id: 'velocity', velocityUrl: preview }] },
    [`${preview}/feed`]: [],
  });
  await customFixture.session.login({ ...passwordLogin, endpointMode: 'custom', publicApiUrl: custom });
  assert.strictEqual(customFixture.calls.length, 2);
  const beforePreview = customFixture.session.state;
  const detection = await customFixture.session.detect();
  assert.strictEqual(detection.detectedUrl, preview);
  assert.strictEqual(detection.effectiveUrl, custom);
  assert.strictEqual(detection.endpointMode, 'custom');
  assert.strictEqual(detection.revision, beforePreview.revision);
  assert.strictEqual(customFixture.issues(), 1);
  const beforeChange = customFixture.session.state;
  customFixture.routes['https://unavailable.example.com/root/feed'] = fail(404);
  await assert.rejects(customFixture.session.setEndpoint({ endpointMode: 'custom', publicApiUrl: 'https://unavailable.example.com/root' }));
  assert.deepStrictEqual(customFixture.session.state, beforeChange);
  assert.strictEqual(customFixture.calls.at(-1).url, 'https://unavailable.example.com/root/feed');
  const automatic = await customFixture.session.setEndpoint({ endpointMode: 'automatic' });
  assert.strictEqual(automatic.effectiveUrl, preview);
  assert.strictEqual(automatic.revision, beforeChange.revision + 1);
  const runOne = deferred();
  const runTwo = deferred();
  const operationOne = customFixture.session.run(() => runOne.promise);
  const operationTwo = customFixture.session.run(() => runTwo.promise);
  await new Promise(resolve => setImmediate(resolve));
  await customFixture.session.setEndpoint({ endpointMode: 'custom', publicApiUrl: custom });
  runOne.resolve('old');
  runTwo.resolve('old');
  await assert.rejects(operationOne, /session changed/);
  await assert.rejects(operationTwo, /session changed/);
  const results = await Promise.all([
    customFixture.session.run((context, token) => ({ context, token })),
    customFixture.session.run((context, token) => ({ context, token })),
  ]);
  assert.strictEqual(results[0].token, 'token-1');
  assert.deepStrictEqual(results[0], results[1]);
  const changedContext = customFixture.session.context;
  changedContext.apiBaseUrl = 'https://changed.example.com';
  assert.strictEqual(customFixture.session.context.apiBaseUrl, custom);
  customFixture.session.logout();
  assert.strictEqual(customFixture.session.state.detectedUrl, '');
  assert.strictEqual(customFixture.session.state.effectiveUrl, '');
  assert.strictEqual(customFixture.session.state.authenticated, false);
  assert.strictEqual(customFixture.tokenManager.token, null);

  const legacyCustom = fixture({
    [`${custom}/iot/feed`]: fail(404),
    [`${custom}/iot/feeds`]: [],
  });
  assert.strictEqual((await legacyCustom.session.login({
    ...passwordLogin, endpointMode: 'custom', publicApiUrl: `${custom}/iot`,
  })).profile, 'legacy');
  assert.deepStrictEqual(legacyCustom.calls.slice(1).map(call => call.url), [`${custom}/iot/feed`, `${custom}/iot/feeds`]);
  legacyCustom.session.logout();

  const atomic = fixture({ [`${custom}/feed`]: [] });
  await atomic.session.login({ ...passwordLogin, endpointMode: 'custom', publicApiUrl: custom });
  const pendingChange = deferred();
  atomic.routes[`${preview}/feed`] = () => pendingChange.promise;
  const firstChange = atomic.session.setEndpoint({ endpointMode: 'custom', publicApiUrl: preview });
  await new Promise(resolve => setImmediate(resolve));
  await atomic.session.setEndpoint({ endpointMode: 'custom', publicApiUrl: custom });
  pendingChange.resolve([]);
  await assert.rejects(firstChange, /newer Velocity endpoint change/);
  assert.strictEqual(atomic.session.state.effectiveUrl, custom);
  atomic.session.logout();

  const latest = fixture({ [`${preview}/feed`]: [] });
  latest.routes[subscriptionUrl] = () => {
    latest.tokenManager._token = 'newly-refreshed';
    return { orgCapabilities: [{ id: 'velocity', velocityUrl: preview }] };
  };
  await latest.session.login(passwordLogin);
  assert.strictEqual(latest.calls.at(-1).options.token, 'newly-refreshed');
  assert.strictEqual(await latest.session.run((context, token) => token), 'newly-refreshed');
  assert.strictEqual(latest.issues(), 1);
  latest.session.logout();

  let time = Date.now();
  const expired = fixture({ [`${custom}/feed`]: [] }, () => time);
  await expired.session.login({ ...passwordLogin, endpointMode: 'custom', publicApiUrl: custom });
  time += 61000;
  const tokens = await Promise.all([expired.session.run((context, token) => token), expired.session.run((context, token) => token)]);
  assert.deepStrictEqual(tokens, ['token-2', 'token-2']);
  assert.strictEqual(expired.issues(), 2);
  expired.session.logout();

  const endpointPending = deferred();
  const old = fixture({
    [subscriptionUrl]: { orgCapabilities: [{ id: 'velocity', velocityUrl: instance }] },
    [`${instance}/feed`]: () => endpointPending.promise,
    [`${custom}/feed`]: [],
  });
  const oldLogin = old.session.login(passwordLogin);
  await new Promise(resolve => setImmediate(resolve));
  await old.session.login({ ...passwordLogin, endpointMode: 'custom', publicApiUrl: custom });
  endpointPending.resolve([]);
  await assert.rejects(oldLogin, /session changed/);
  assert.strictEqual(old.session.state.effectiveUrl, custom);
  assert.strictEqual(old.tokenManager.token, 'token-2');
  const detectPending = deferred();
  old.routes[subscriptionUrl] = () => detectPending.promise;
  const oldDetect = old.session.detect();
  await new Promise(resolve => setImmediate(resolve));
  old.session.logout();
  const callCount = old.calls.length;
  detectPending.resolve({ orgCapabilities: [{ id: 'velocity', velocityUrl: instance }] });
  await assert.rejects(oldDetect, /session changed/);
  assert.strictEqual(old.calls.length, callCount);

  const authFailure = new VelocitySession({ request: async () => ({ error: { code: 498, message: 'private-value' } }) });
  await assert.rejects(authFailure.login(passwordLogin), /authorization failed/);
  assert.strictEqual(authFailure.state.authenticated, false);

  const firstServer = 'https://one.example.com:443/team/velocity';
  const secondServer = 'https://two.example.com:7443';
  const registered = [
    { id: 'registered-one', name: 'Team One', serverType: 'ARCGIS_VELOCITY', url: firstServer, adminUrl: 'https://native-one.example.com:11443/arcgis/admin' },
    { id: 'registered-two', name: 'Team Two', serverType: 'ARCGIS_SERVER', serverFunction: 'VelocityServer', url: secondServer, nativeUrl: 'https://native-two.example.com/arcgis' },
    { id: 'not-velocity', name: 'Other service', serverType: 'ARCGIS_SERVER', url: 'https://other.example.com' },
  ];
  const multiple = fixture({
    [serversUrl]: { servers: registered },
    [subscriptionUrl]: { orgCapabilities: [{ id: 'velocity', velocityUrl: firstServer }] },
    [`${firstServer}/feed`]: [feed],
    [`${secondServer}/feed`]: [],
  });
  await multiple.tokenManager.loginWithPassword(portal, 'user', 'password-value');
  const detectedServers = await discoverVelocityServers(portal, multiple.tokenManager.token, { request: multiple.request });
  assert.strictEqual(multiple.issues(), 1);
  assert.deepStrictEqual(detectedServers.map(server => server.serverId), ['registered-one', 'registered-two']);
  assert.deepStrictEqual(detectedServers.map(server => server.label), ['Team One', 'Team Two']);
  assert.ok(detectedServers.every(server => server.status === 'ready' && server.registered));
  assert.strictEqual(detectedServers[0].context.apiBaseUrl, firstServer);
  assert.strictEqual(detectedServers[1].context.apiBaseUrl, secondServer);
  assert.strictEqual(detectedServers[0].nativeUrl, 'https://native-one.example.com:11443/arcgis/admin');
  assert.ok(!multiple.calls.some(call => call.url.includes('native-')));
  assert.ok(!multiple.calls.some(call => call.url === subscriptionUrl));
  assert.ok(multiple.calls.slice(1).every(call => call.options.token === 'token-1'));
  assert.ok(!JSON.stringify(detectedServers).includes('token-1'));

  multiple.routes[`${secondServer}/feed`] = fail(403);
  const partial = await discoverVelocityServers(portal, 'token-1', { request: multiple.request });
  assert.deepStrictEqual(partial.map(server => server.status), ['ready', 'error']);
  assert.strictEqual(partial[1].context, null);
  assert.ok(partial[1].endpointError);
  assert.ok(!multiple.calls.some(call => call.url === `${secondServer}/arcgis/feed`));
  multiple.routes[`${secondServer}/feed`] = fail(404, 'INVALID_JSON');
  assert.strictEqual((await discoverVelocityServers(portal, 'token-1', { request: multiple.request }))[1].status, 'error');
  assert.ok(!multiple.calls.some(call => call.url === `${secondServer}/arcgis/feed`));

  multiple.routes[serversUrl] = { servers: [registered[1], registered[0]] };
  const beforeEnumeration = multiple.calls.length;
  const unverified = await discoverVelocityServers(portal, 'token-1', { request: multiple.request, validate: false });
  assert.strictEqual(multiple.calls.length, beforeEnumeration + 1);
  assert.deepStrictEqual(unverified.map(server => server.serverId), ['registered-two', 'registered-one']);
  assert.ok(unverified.every(server => server.status === 'unverified' && server.context === null));
  multiple.routes[serversUrl] = { servers: [{ ...registered[1], id: 'registered-one' }, registered[0]] };
  await assert.rejects(discoverVelocityServers(portal, 'token-1', { request: multiple.request }), /duplicate registered/);
  multiple.routes[serversUrl] = { servers: Array.from({ length: 33 }, (_, index) => ({ ...registered[0], id: `server-${index}` })) };
  let activeRequests = 0;
  let maximumRequests = 0;
  const allRegistered = await discoverVelocityServers(portal, 'token-1', {
    request: async (...args) => {
      activeRequests++;
      maximumRequests = Math.max(maximumRequests, activeRequests);
      try {
        await new Promise(resolve => setImmediate(resolve));
        return await multiple.request(...args);
      } finally {
        activeRequests--;
      }
    },
  });
  assert.strictEqual(allRegistered.length, 33);
  assert.ok(allRegistered.every(server => server.status === 'ready'));
  assert.ok(maximumRequests > 1 && maximumRequests <= 4);
  multiple.tokenManager.logout();

  const variant = fixture({
    [serversUrl]: { servers: [{ id: 'variant', name: 'Variant', serverType: 'ARCGIS_VELOCITY_SERVER', url: firstServer }] },
    [`${firstServer}/feed`]: [],
  });
  assert.strictEqual((await discoverVelocityServers(portal, 'shared-token', { request: variant.request }))[0].serverId, 'variant');

  const subscriptionOnly = fixture({
    [serversUrl]: fail(404),
    [subscriptionUrl]: { orgCapabilities: [{ id: 'A4IoT', velocityUrl: firstServer, iotRegionUrl: secondServer }] },
    [`${firstServer}/feed`]: [],
  });
  const subscriptionServers = await discoverVelocityServers(portal, 'shared-token', { request: subscriptionOnly.request });
  assert.strictEqual(subscriptionServers.length, 1);
  assert.strictEqual(subscriptionServers[0].source, 'subscription');
  assert.strictEqual(subscriptionServers[0].registered, false);
  assert.deepStrictEqual(subscriptionServers[0].advertisedUrls, [firstServer, secondServer]);
  const again = await discoverVelocityServers(portal, 'shared-token', { request: subscriptionOnly.request });
  assert.strictEqual(again[0].serverId, subscriptionServers[0].serverId);
  subscriptionOnly.routes[subscriptionUrl] = {
    orgCapabilities: [
      ...Array.from({ length: 100 }, () => ({ id: 'unrelated-capability' })),
      { id: 'velocity', velocityUrl: firstServer },
    ],
  };
  assert.strictEqual((await discoverVelocityServers(portal, 'shared-token', { request: subscriptionOnly.request })).length, 1);

  const thirdServer = 'https://three.example.com/arcgis';
  const manualSecond = 'https://custom-two.example.com/team/velocity';
  const aggregate = fixture({
    [serversUrl]: { servers: [
      registered[0], registered[1],
      { id: 'registered-three', name: 'Unavailable', serverType: 'ARCGIS_VELOCITY_SERVER', url: thirdServer },
    ] },
    [`${firstServer}/feed`]: [],
    [`${secondServer}/feed`]: [],
    [`${manualSecond}/feed`]: [],
    [`${thirdServer}/feed`]: fail(503),
  });
  const aggregateState = await aggregate.session.login({
    ...passwordLogin,
    endpointProfiles: {
      [portal]: {
        serverProfiles: { 'registered-two': { endpointMode: 'custom', publicApiUrl: manualSecond } },
        selectedServerId: 'all',
      },
    },
  });
  assert.strictEqual(aggregate.issues(), 1);
  assert.strictEqual(aggregateState.authRevision, 1);
  assert.strictEqual(aggregateState.selectedServerId, 'all');
  assert.strictEqual(aggregateState.effectiveUrl, '');
  assert.strictEqual(aggregateState.servers.length, 3);
  assert.deepStrictEqual(aggregateState.servers.map(server => server.status), ['ready', 'ready', 'error']);
  assert.strictEqual(aggregateState.servers[1].effectiveUrl, manualSecond);
  assert.strictEqual(aggregateState.servers[1].endpointMode, 'custom');
  assert.ok(!aggregate.calls.some(call => call.url === `${secondServer}/feed`));
  const registryRequest = aggregate.calls.find(call => call.url === serversUrl);
  assert.strictEqual(new URL(registryRequest.requestUrl).searchParams.get('token'), 'token-1');
  assert.ok(!JSON.stringify(aggregateState).includes('token-1'));
  assert.ok(!JSON.stringify(aggregateState).includes('native-'));
  const allResults = await aggregate.session.runAll((context, token, server) => {
    assert.strictEqual(context.serverId, server.id);
    assert.strictEqual(context.serverName, server.label);
    assert.strictEqual(token, 'token-1');
    return context.apiBaseUrl;
  });
  assert.deepStrictEqual(allResults.results.map(result => result.serverId), ['registered-one', 'registered-two']);
  assert.deepStrictEqual(allResults.errors.map(error => error.serverId), ['registered-three']);
  assert.strictEqual(allResults.results[1].value, manualSecond);
  assert.strictEqual(allResults.revision, aggregateState.revision);
  const revision = aggregate.session.state.revision;
  aggregate.session.selectServer('registered-one');
  assert.strictEqual(aggregate.session.state.effectiveUrl, firstServer);
  assert.strictEqual(aggregate.session.state.revision, revision);
  assert.strictEqual(aggregate.session.state.authRevision, 1);
  assert.strictEqual(await aggregate.session.run(context => context.serverId), 'registered-one');
  assert.strictEqual(await aggregate.session.run(context => context.serverId, 'registered-two'), 'registered-two');
  aggregate.session.selectServer('all');
  await assert.rejects(aggregate.session.run(() => 'unused'), /specific Velocity server/);
  assert.throws(() => aggregate.session.selectServer('not-registered'), /registered Velocity server/);
  await assert.rejects(aggregate.session.setEndpoint({ serverId: 'all', endpointMode: 'custom', publicApiUrl: manualSecond }), /specific Velocity server/);
  assert.strictEqual((await aggregate.session.runAll(() => 'unused', { serverId: 'registered-three' })).errors.length, 1);

  aggregate.routes[`${firstServer}/feed`] = [];
  const beforeDetection = aggregate.session.state;
  await aggregate.session.detect();
  assert.strictEqual(aggregate.session.state.revision, beforeDetection.revision);
  assert.strictEqual(aggregate.session.state.authRevision, beforeDetection.authRevision);
  assert.strictEqual(aggregate.session.state.servers[1].effectiveUrl, manualSecond);
  assert.strictEqual(aggregate.session.state.servers[1].detectedUrl, secondServer);
  assert.strictEqual(aggregate.session.state.servers[1].endpointMode, 'custom');
  const beforeFailedChange = aggregate.session.state;
  aggregate.routes['https://bad.example.com/feed'] = fail(403);
  await assert.rejects(aggregate.session.setEndpoint({ serverId: 'registered-two', endpointMode: 'custom', publicApiUrl: 'https://bad.example.com' }));
  assert.deepStrictEqual(aggregate.session.state, beforeFailedChange);
  await aggregate.session.setEndpoint({ serverId: 'registered-two', endpointMode: 'automatic' });
  assert.strictEqual(aggregate.session.state.servers[1].effectiveUrl, secondServer);
  assert.strictEqual(aggregate.session.state.servers[0].effectiveUrl, firstServer);
  assert.strictEqual(aggregate.session.state.authRevision, 1);
  const beforeBatch = aggregate.session.state;
  await assert.rejects(aggregate.session.setEndpoint({ serverId: 'all', endpointMode: 'automatic' }));
  assert.deepStrictEqual(aggregate.session.state, beforeBatch);

  const pendingValues = [deferred(), deferred()];
  let pendingIndex = 0;
  const viewOnlyRun = aggregate.session.runAll(() => pendingValues[pendingIndex++].promise);
  await new Promise(resolve => setImmediate(resolve));
  aggregate.session.selectServer('registered-two');
  pendingValues[0].resolve('one');
  pendingValues[1].resolve('two');
  assert.strictEqual((await viewOnlyRun).results.length, 2);
  const staleValues = [deferred(), deferred()];
  pendingIndex = 0;
  const staleAggregate = aggregate.session.runAll(() => staleValues[pendingIndex++].promise);
  await new Promise(resolve => setImmediate(resolve));
  await aggregate.session.setEndpoint({ serverId: 'registered-two', endpointMode: 'custom', publicApiUrl: manualSecond });
  staleValues[0].resolve('old-one');
  staleValues[1].resolve('old-two');
  await assert.rejects(staleAggregate, /session changed/);
  aggregate.routes[`${thirdServer}/feed`] = [];
  const beforeAllValidation = aggregate.calls.length;
  await aggregate.session.setEndpoint({ serverId: 'all', endpointMode: 'automatic' });
  assert.deepStrictEqual(aggregate.session.state.servers.map(server => server.endpointMode), ['automatic', 'custom', 'automatic']);
  assert.strictEqual(aggregate.session.state.servers[1].effectiveUrl, manualSecond);
  assert.strictEqual(aggregate.session.state.servers[1].publicApiUrl, manualSecond);
  assert.ok(!aggregate.calls.slice(beforeAllValidation).some(call => call.url === `${secondServer}/feed`));
  assert.ok(aggregate.session.state.servers.every(server => server.status === 'ready'));
  const beforeRefresh = aggregate.session.state;
  await aggregate.tokenManager.refresh();
  assert.strictEqual(aggregate.session.state.authRevision, beforeRefresh.authRevision);
  assert.strictEqual(aggregate.session.state.revision, beforeRefresh.revision);
  assert.strictEqual(await aggregate.session.run((context, token) => token, 'registered-one'), 'token-2');
  aggregate.session.logout();
  assert.strictEqual(aggregate.session.state.authRevision, 2);
  assert.deepStrictEqual(aggregate.session.state.servers, []);
  assert.strictEqual(aggregate.session.state.selectedServerId, 'all');

  const unavailableRegistry = fixture({
    [serversUrl]: fail(403),
    [`${manualSecond}/feed`]: [],
  });
  const customWithoutRegistry = await unavailableRegistry.session.login({
    ...passwordLogin, serverId: 'unavailable-registration', endpointMode: 'custom', publicApiUrl: manualSecond,
  });
  assert.strictEqual(customWithoutRegistry.servers[0].id, 'custom');
  assert.strictEqual(customWithoutRegistry.effectiveUrl, manualSecond);
  assert.strictEqual(unavailableRegistry.issues(), 1);
  unavailableRegistry.session.logout();

  for (const [sourceRecords, oldUrl, expectedModes] of [
    [[registered[0]], manualSecond, ['custom']],
    [[registered[0], registered[1]], manualSecond, ['automatic', 'automatic']],
    [[registered[0], registered[1]], secondServer, ['automatic', 'custom']],
  ]) {
    const migration = fixture({
      [serversUrl]: { servers: sourceRecords },
      [`${firstServer}/feed`]: [],
      [`${secondServer}/feed`]: [],
      [`${manualSecond}/feed`]: [],
    });
    const migrated = await migration.session.login({
      ...passwordLogin,
      endpointMode: 'automatic',
      endpointProfiles: {
        [portal]: { selectedServerId: 'all', serverProfiles: {}, endpointMode: 'custom', publicApiUrl: oldUrl },
      },
    });
    assert.deepStrictEqual(migrated.servers.map(server => server.endpointMode), expectedModes);
    if (sourceRecords.length > 1 && oldUrl === manualSecond) {
      assert.ok(!migration.calls.some(call => call.url === `${manualSecond}/feed`));
    }
    migration.session.logout();
  }

  for (const sourceRecords of [[registered[0]], [registered[0], registered[1]]]) {
    const firstCustom = fixture({
      [serversUrl]: { servers: sourceRecords },
      [`${manualSecond}/feed`]: [],
    });
    const firstCustomState = await firstCustom.session.login({
      ...passwordLogin, serverId: 'all', endpointMode: 'custom', publicApiUrl: manualSecond,
    });
    assert.strictEqual(firstCustomState.authenticated, true);
    assert.strictEqual(firstCustomState.selectedServerId, 'all');
    assert.strictEqual(firstCustom.issues(), 1);
    if (sourceRecords.length === 1) {
      assert.strictEqual(firstCustomState.servers[0].id, 'registered-one');
      assert.strictEqual(firstCustomState.effectiveUrl, manualSecond);
      assert.strictEqual(firstCustomState.endpointMode, 'custom');
    } else {
      assert.match(firstCustomState.endpointError, /specific Velocity server/);
      assert.strictEqual(firstCustomState.servers.length, 2);
      assert.ok(firstCustomState.servers.every(server => !server.effectiveUrl));
      assert.ok(!firstCustom.calls.some(call => call.url === `${manualSecond}/feed`));
      firstCustom.session.selectServer('registered-two');
      await firstCustom.session.setEndpoint({ serverId: 'registered-two', endpointMode: 'custom', publicApiUrl: manualSecond });
      assert.strictEqual(firstCustom.session.state.effectiveUrl, manualSecond);
      const result = await firstCustom.session.runAll(() => []);
      assert.strictEqual(result.results.length, 1);
      assert.strictEqual(result.errors.length, 1);
    }
    firstCustom.session.logout();
  }
  console.log('velocity-session tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
