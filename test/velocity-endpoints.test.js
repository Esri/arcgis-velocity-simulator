const assert = require('assert');
const {
  normalizePortalUrl, normalizeApiBaseUrl, apiUrl, validateFeedConfigurations,
} = require('../src/velocity-endpoints');

for (const [input, expected] of [
  ['https://example.com', 'https://example.com'],
  ['https://example.com/', 'https://example.com'],
  ['https://example.com:443/arcgis/velocity/', 'https://example.com:443/arcgis/velocity'],
  ['https://example.com:7443/custom/nested/', 'https://example.com:7443/custom/nested'],
  ['https://example.com:0443', 'https://example.com:443'],
  ['https://EXAMPLE.com/orgid/AbC123', 'https://example.com/orgid/AbC123'],
  ['https://[::1]:443/root', 'https://[::1]:443/root'],
  ['https://example.com/tenant%20name', null],
]) {
  if (expected) assert.strictEqual(normalizeApiBaseUrl(input), expected);
  else assert.throws(() => normalizeApiBaseUrl(input));
}
assert.strictEqual(normalizePortalUrl('https://example.com:7443/nested/portal/'), 'https://example.com:7443/nested/portal');
for (const invalid of [
  '', null, {}, 'example.com', 'http://example.com', 'ftp://example.com',
  'https://user:secret@example.com/root', 'https://example.com/?token=secret',
  'https://example.com/?', 'https://example.com/#', 'https://example.com/#fragment',
  'https://example.com/a/../b', 'https://example.com/a/./b',
  'https://example.com/%2e%2e/b', 'https://example.com/%252e%252e/b',
  'https://example.com/a//b', 'https://example.com//', 'https://example.com/a\\b',
  'https://example.com/%2Fhome', 'https://example.com/%5chome', 'https://example.com/%',
  'https://example.com:99999', 'https://example.com:',
  'https://example.com/arcgis/home', 'https://example.com/feed',
  'https://example.com/root/feed/id', 'https://example.com/root/%66eed/id',
  'https://example.com/root/feeds', 'https://example.com/admin',
  'https://example.com/index.html', 'https://example.com/root/output',
]) {
  assert.throws(() => normalizeApiBaseUrl(invalid), undefined, String(invalid));
}
assert.throws(() => normalizePortalUrl('https://example.com/portal/home'));
assert.throws(() => normalizePortalUrl('https://example.com/portal/sharing/rest'));
const context = { apiBaseUrl: 'https://example.com:443/nested/root', profile: 'current' };
assert.strictEqual(apiUrl(context, `feed/${encodeURIComponent('a/b ?#')}`, { view: 'admin' }),
  'https://example.com:443/nested/root/feed/a%2Fb%20%3F%23?view=admin');
assert.strictEqual(apiUrl(context, 'feed'), 'https://example.com:443/nested/root/feed');
for (const invalid of ['/feed', '../feed', 'feed/..', 'feed/%2e%2e', 'feed?token=secret', 'feed//one']) {
  assert.throws(() => apiUrl(context, invalid));
}
assert.deepStrictEqual(validateFeedConfigurations([]), []);
assert.strictEqual(validateFeedConfigurations([{ id: 'one', feed: { name: 'grpc', properties: {} } }]).length, 1);
for (const invalid of [null, 0, '[]', {}, { feeds: [] }, [{ name: 'grpc', properties: {} }], [{}]]) {
  assert.throws(() => validateFeedConfigurations(invalid), /raw feed configuration array/);
}
console.log('velocity-endpoints tests passed');
