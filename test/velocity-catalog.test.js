const assert = require('assert');
const { VelocityCatalog } = require('../src/velocity-catalog');

async function main() {
  const state = { revision: 1 };
  let token = 'initial';
  let detail = { id: 'feed-1', supported: true };
  let list = async () => [detail];
  const calls = [];
  let servers = [{ id: 'server-a', label: 'Server A' }];
  const qualifiedId = JSON.stringify(['server-a', 'feed-1']);
  const contextFor = serverId => ({ apiBaseUrl: 'https://example.com/velocity', serverId });
  const session = {
    state,
    run(callback, serverId) { return callback(contextFor(serverId), token); },
    async runAll(callback, { serverId = 'all' }) {
      const results = [];
      const errors = [];
      for (const server of servers.filter(source => serverId === 'all' || source.id === serverId)) {
        try {
          results.push({ serverId: server.id, serverName: server.label, value: await callback(contextFor(server.id), token, server) });
        } catch (error) {
          errors.push({ serverId: server.id, serverName: server.label, message: error.message });
        }
      }
      return { results, errors, revision: state.revision };
    },
  };
  const catalog = new VelocityCatalog({
    session,
    listItems: (...args) => { calls.push(args); return list(...args); },
    getItemDetails: (...args) => { calls.push(args); return Promise.resolve(detail); },
    validateItem(item) { if (!item.url) throw new Error('Missing endpoint.'); },
  });
  await assert.rejects(catalog.list({}), /session changed/);
  await assert.rejects(catalog.details({ id: 'feed-1', revision: 1 }), /current Velocity list/);
  const initial = await catalog.list({ revision: 1, adminScope: true });
  assert.strictEqual(initial.items[0].id, qualifiedId);
  assert.strictEqual(initial.items[0].feedId, 'feed-1');
  assert.deepStrictEqual(initial.errors, []);
  assert.strictEqual(calls[0][1], 'initial');
  assert.strictEqual(calls[0][2], true);
  token = 'refreshed';
  await catalog.details({ id: qualifiedId, revision: 1 });
  assert.strictEqual(calls.at(-1)[2], 'refreshed');
  await assert.rejects(catalog.selected({ id: qualifiedId, revision: 1 }), /Missing endpoint/);
  detail = { id: 'feed-1', supported: false, reason: 'Outbound source.' };
  await assert.rejects(catalog.selected({ id: qualifiedId, revision: 1 }), /Outbound source/);
  detail = { id: 'feed-1', supported: true, url: 'https://example.com/receiver' };
  assert.strictEqual((await catalog.selected({ id: qualifiedId, revision: 1 })).url, detail.url);
  detail = { id: 'other', supported: true };
  await assert.rejects(catalog.details({ id: qualifiedId, revision: 1 }), /different item/);
  state.revision = 2;
  await assert.rejects(catalog.selected({ id: 'feed-1', revision: 1 }), /session changed/);
  list = async () => [{ id: 'duplicate' }, { id: 'duplicate' }];
  assert.match((await catalog.list({ revision: 2 })).errors[0].message, /duplicate/);
  assert.strictEqual(catalog.items.size, 0);
  list = async () => [{ label: 'missing-id' }];
  assert.match((await catalog.list({ revision: 2 })).errors[0].message, /invalid item list/);

  let finishOld;
  list = () => new Promise(resolve => { finishOld = resolve; });
  const pending = catalog.list({ revision: 2 });
  list = async () => [{ id: 'new' }];
  await catalog.list({ revision: 2 });
  finishOld([{ id: 'old' }]);
  await assert.rejects(pending, /newer Velocity list/);
  const newId = JSON.stringify(['server-a', 'new']);
  assert.deepStrictEqual([...catalog.items.keys()], [newId]);

  let finishDetails;
  catalog.getItemDetails = () => new Promise(resolve => { finishDetails = resolve; });
  const pendingDetails = catalog.details({ id: newId, revision: 2 });
  catalog.clear();
  finishDetails({ id: 'new', supported: true });
  await assert.rejects(pendingDetails, /list changed/);

  servers = [{ id: 'server-a', label: 'Server A' }, { id: 'server-b', label: 'Server B' }];
  list = async () => [{ id: 'same-id' }];
  const combined = await catalog.list({ revision: 2 });
  assert.strictEqual(combined.items.length, 2);
  assert.notStrictEqual(combined.items[0].id, combined.items[1].id);
  assert.strictEqual(combined.items[1].serverId, 'server-b');
  catalog.getItemDetails = async (context, id) => {
    assert.strictEqual(context.serverId, 'server-b');
    return { id, supported: true };
  };
  assert.strictEqual((await catalog.details({ id: combined.items[1].id, revision: 2 })).serverId, 'server-b');
  list = async (context) => {
    if (context.serverId === 'server-b') throw new Error('Server unavailable.');
    return [{ id: 'healthy' }];
  };
  const partial = await catalog.list({ revision: 2 });
  assert.strictEqual(partial.items.length, 1);
  assert.strictEqual(partial.errors[0].serverId, 'server-b');
  assert.match(partial.errors[0].message, /unavailable/);
  const filtered = await catalog.list({ revision: 2, serverId: 'server-a' });
  assert.strictEqual(filtered.items.length, 1);
  assert.deepStrictEqual(filtered.errors, []);
  state.selectedServerId = 'server-a';
  const selected = await catalog.list({ revision: 2 });
  assert.strictEqual(selected.items.length, 1);
  assert.deepStrictEqual(selected.errors, []);
  assert.strictEqual(selected.items[0].serverId, 'server-a');
  console.log('velocity-catalog tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
