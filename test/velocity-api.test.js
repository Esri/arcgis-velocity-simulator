const assert = require('assert');
const api = require('../src/velocity-api');
const rest = require('../src/velocity-rest-client');

const feed = {
  id: 'feed/one ?#',
  label: 'Receiver',
  feed: {
    name: 'grpc',
    formatName: 'json',
    properties: {
      'grpc.url': 'https://data.example.com:443',
      'grpc.headerPath': 'route-one',
      'grpc.headerPathKey': 'x-feed-route',
      'grpc.authenticationType': 'arcgis',
      'grpc.password': 'password-value',
      'grpc.token': 'token-value',
    },
    schemaTransformation: { inputSchema: { attributes: [
      { name: 'speed', dataType: 'Float64', tags: ['TRACK_ID'], password: 'password-value' },
    ] } },
  },
};

async function main() {
  for (const name of ['jsonRequest', 'generateToken', 'generateOAuthToken', 'TokenManager']) {
    assert.strictEqual(api[name], rest[name]);
  }
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    return url.includes('/feed/') ? feed : [feed];
  };
  for (const base of [
    'https://example.com', 'https://example.com:443', 'https://example.com:7443/root',
    'https://example.com/arcgis/velocity', 'https://example.com/orgid/tenant',
  ]) {
    const context = { apiBaseUrl: base, profile: 'current' };
    const list = await api.listFeeds(context, 'latest-token', false, { request });
    assert.strictEqual(calls.at(-1).url, `${base}/feed`);
    assert.strictEqual(calls.at(-1).options.token, 'latest-token');
    assert.strictEqual(list[0].headerPathKey, 'x-feed-route');
    assert.strictEqual(list[0].headerPath, 'route-one');
    assert.strictEqual(list[0].url, feed.feed.properties['grpc.url']);
    assert.strictEqual(list[0].supported, true);
    assert.deepStrictEqual(list[0].schema, [{ name: 'speed', dataType: 'Float64', tags: ['TRACK_ID'] }]);
    assert.ok(!JSON.stringify(list).includes('password-value'));
    assert.ok(!JSON.stringify(list).includes('token-value'));
    await api.listFeeds(context, 'latest-token', true, { request });
    assert.strictEqual(calls.at(-1).url, `${base}/feed?view=admin`);
    await api.getFeedDetails(context, feed.id, 'latest-token', { request });
    assert.strictEqual(calls.at(-1).url, `${base}/feed/feed%2Fone%20%3F%23`);
  }
  const legacy = { apiBaseUrl: 'https://example.com/root/iot', profile: 'legacy' };
  await api.listFeeds(legacy, 'token', true, { request });
  assert.strictEqual(calls.at(-1).url, 'https://example.com/root/iot/feeds?view=admin');
  await api.getFeedDetails(legacy, feed.id, 'token', { request });
  assert.strictEqual(calls.at(-1).url, 'https://example.com/root/iot/feed/feed%2Fone%20%3F%23');
  const context = { apiBaseUrl: 'https://example.com', profile: 'current' };
  assert.deepStrictEqual(await api.listFeeds(context, 'token', false, { request: async () => [] }), []);
  for (const malformed of [{ feeds: [] }, {}, null, [{ name: 'grpc' }], [{ id: 'one', properties: {} }]]) {
    await assert.rejects(api.listFeeds(context, 'token', false, { request: async () => malformed }), /raw feed configuration array/);
  }
  for (const id of ['', '.', '..', null]) await assert.rejects(api.getFeedDetails(context, id, 'token', { request }));
  await assert.rejects(api.getFeedDetails(context, 'other', 'token', { request: async () => feed }), /requested feed/);
  await assert.rejects(api.listOutputs(context, 'token'), /not configured output instances/);
  await assert.rejects(api.getOutputDetails(context, 'output-one', 'token'), /real-time analytic/);
  const websocket = api.parseFeedItem({
    id: 'websocket', feed: { name: 'websocket', properties: { 'websocket.url': 'wss://source.example.com' } },
  });
  assert.strictEqual(websocket.supported, false);
  assert.match(websocket.reason, /outbound source/);
  for (const authority of [
    'receiver.example.com', 'receiver.example.com:443', 'receiver.example.com:7143',
    '[2001:db8::1]', '[2001:db8::1]:443', '[2001:db8::1]:7143',
    'https://receiver.example.com:443', 'http://receiver.example.com:7080',
  ]) {
    const parsed = api.parseFeedItem({
      id: 'grpc-feed', feed: { name: 'grpc', properties: { 'grpc.url': authority, 'grpc.headerPathKey': 'x-route' } },
    });
    assert.strictEqual(parsed.supported, true, authority);
    assert.strictEqual(parsed.url, authority);
    assert.strictEqual(parsed.headerPathKey, 'x-route');
  }
  for (const authority of [
    'user:password@receiver.example.com:443', 'receiver.example.com/path',
    'receiver.example.com?token=secret', 'receiver.example.com#fragment',
    'receiver.example.com:', 'receiver.example.com:0', 'receiver.example.com:65536',
    '2001:db8::1', '[not-ipv6]:443', 'receiver.example.com\\path',
    'https://receiver.example.com/path', 'https://receiver.example.com?route=one',
    'wss://receiver.example.com', 'https://user:password@receiver.example.com',
  ]) {
    const parsed = api.parseFeedItem({
      id: 'grpc-feed', feed: { name: 'grpc', properties: { 'grpc.url': authority } },
    });
    assert.strictEqual(parsed.supported, false, authority);
    assert.strictEqual(parsed.url, '');
  }
  for (const url of ['https://user:password-value@example.com', 'https://example.com?token=token-value']) {
    const parsed = api.parseFeedItem({
      id: 'http', feed: { name: 'http-receiver', properties: { 'http-receiver.url': url } },
    });
    assert.strictEqual(parsed.supported, false);
    assert.strictEqual(parsed.url, '');
    assert.ok(!JSON.stringify(parsed).includes('password-value'));
    assert.ok(!JSON.stringify(parsed).includes('token-value'));
  }
  assert.deepStrictEqual(api.parseFeedItem(null).schema, []);
  assert.strictEqual(api.parseFeedItem(null).supported, false);
  const parsedOutput = api.parseOutputItem({
    id: 'out', output: { name: 'http', properties: { 'http.url': 'http://example.com/data' } },
  });
  assert.strictEqual(parsedOutput.outputType, 'http');
  assert.strictEqual(parsedOutput.url, 'http://example.com/data');
  console.log('velocity-api tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
