const assert = require('assert');
const { readVelocityPreferences, updateVelocityPreferences } = require('../src/velocity-preferences');

const firstPortal = 'https://portal.example.com/portal';
const secondPortal = 'https://other.example.com/portal';
assert.strictEqual(readVelocityPreferences(null), null);
const legacy = readVelocityPreferences({
  portalUrl: firstPortal, username: 'user', rememberMe: true, password: 'discard', token: 'discard',
});
assert.deepStrictEqual(legacy, {
  portalUrl: firstPortal, username: 'user', rememberMe: true, endpointProfiles: {},
});
const first = updateVelocityPreferences(legacy, {
  portalUrl: `${firstPortal}/`,
  username: 'user',
  rememberMe: true,
  serverId: 'server-a',
  endpointMode: 'custom',
  publicApiUrl: 'https://public.example.com:8443/team/velocity/',
  password: 'not-saved',
  token: 'not-saved',
});
assert.deepStrictEqual(first.endpointProfiles[firstPortal].serverProfiles['server-a'], {
  endpointMode: 'custom', publicApiUrl: 'https://public.example.com:8443/team/velocity',
});
assert.ok(!JSON.stringify(first).includes('not-saved'));
const second = updateVelocityPreferences(first, {
  portalUrl: secondPortal, username: 'other', rememberMe: true,
  endpointMode: 'automatic', publicApiUrl: '',
});
assert.deepStrictEqual(second.endpointProfiles[firstPortal], first.endpointProfiles[firstPortal]);
assert.deepStrictEqual(second.endpointProfiles[secondPortal], { selectedServerId: 'all', serverProfiles: {} });
const secondServer = updateVelocityPreferences(first, {
  portalUrl: firstPortal, rememberMe: true, username: 'user',
  serverId: 'server-b', selectedServerId: 'all',
  endpointMode: 'custom', publicApiUrl: 'https://another.example.com/velocity',
});
assert.strictEqual(secondServer.endpointProfiles[firstPortal].selectedServerId, 'all');
assert.strictEqual(secondServer.endpointProfiles[firstPortal].serverProfiles['server-a'].publicApiUrl,
  first.endpointProfiles[firstPortal].serverProfiles['server-a'].publicApiUrl);
assert.strictEqual(secondServer.endpointProfiles[firstPortal].serverProfiles['server-b'].publicApiUrl,
  'https://another.example.com/velocity');
const migrated = readVelocityPreferences({
  portalUrl: firstPortal, rememberMe: true,
  endpointProfiles: { [firstPortal]: { endpointMode: 'custom', publicApiUrl: 'https://legacy.example.com/arcgis' } },
});
assert.strictEqual(migrated.endpointProfiles[firstPortal].publicApiUrl, 'https://legacy.example.com/arcgis');
assert.deepStrictEqual(migrated.endpointProfiles[firstPortal].serverProfiles, {});
assert.throws(() => updateVelocityPreferences(first, {
  portalUrl: firstPortal, rememberMe: true, serverId: 'all',
  endpointMode: 'custom', publicApiUrl: 'https://example.com/velocity',
}), /one Velocity server/);
assert.strictEqual(updateVelocityPreferences(second, { rememberMe: false }), null);
assert.throws(() => readVelocityPreferences([]), /object/);
assert.throws(() => readVelocityPreferences({ portalUrl: firstPortal, endpointProfiles: [] }), /object/);
assert.throws(() => updateVelocityPreferences(null, {
  portalUrl: firstPortal, rememberMe: true, serverId: 'server-a', endpointMode: 'custom', publicApiUrl: '',
}), /complete public API URL/);
assert.throws(() => updateVelocityPreferences(null, {
  portalUrl: firstPortal, rememberMe: true, serverId: 'server-a', endpointMode: 'custom',
  publicApiUrl: 'https://user:secret@public.example.com/velocity',
}));
assert.throws(() => updateVelocityPreferences(null, {
  portalUrl: firstPortal, rememberMe: true, serverId: 'server-a', endpointMode: 'custom',
  publicApiUrl: 'https://public.example.com/velocity?token=secret',
}));
console.log('velocity-preferences tests passed');
