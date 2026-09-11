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

class VelocityCatalog {
  constructor({ session, listItems, getItemDetails, validateItem }) {
    this.session = session;
    this.listItems = listItems;
    this.getItemDetails = getItemDetails;
    this.validateItem = validateItem;
    this.items = new Map();
    this.generation = 0;
  }

  clear() {
    this.generation += 1;
    this.items.clear();
  }

  assertRevision(revision) {
    if (!Number.isInteger(revision) || revision !== this.session.state.revision) {
      throw new Error('The Velocity session changed. Refresh the list before selecting an item.');
    }
  }

  async list({ adminScope = false, revision, serverId = this.session.state.selectedServerId || 'all' } = {}) {
    this.assertRevision(revision);
    this.clear();
    const generation = this.generation;
    const aggregate = await this.session.runAll(async (context, token, server) => {
      const items = await this.listItems(context, token, adminScope === true);
      if (!Array.isArray(items) || items.some(item => !item || typeof item.id !== 'string' || !item.id)) {
        throw new Error('Velocity returned an invalid item list.');
      }
      const identifiers = new Set();
      return items.map((item) => {
        if (identifiers.has(item.id)) throw new Error('Velocity returned duplicate item identifiers.');
        identifiers.add(item.id);
        return {
          ...item,
          feedId: item.id,
          id: JSON.stringify([server.id, item.id]),
          serverId: server.id,
          serverName: server.label,
          serverApiUrl: context.apiBaseUrl,
        };
      });
    }, { serverId });
    this.assertRevision(revision);
    if (generation !== this.generation) {
      throw new Error('A newer Velocity list request replaced this response.');
    }
    const items = aggregate.results.flatMap(result => result.value);
    const registry = new Map();
    for (const item of items) {
      if (registry.has(item.id)) throw new Error('Velocity returned duplicate item identifiers.');
      registry.set(item.id, item);
    }
    this.items = registry;
    return { items, errors: aggregate.errors, revision };
  }

  async details({ id, revision } = {}) {
    this.assertRevision(revision);
    if (typeof id !== 'string' || !this.items.has(id)) {
      throw new Error('Select an item from the current Velocity list.');
    }
    const generation = this.generation;
    const selected = this.items.get(id);
    const item = await this.session.run(
      (context, token) => this.getItemDetails(context, selected.feedId, token), selected.serverId,
    );
    this.assertRevision(revision);
    if (generation !== this.generation) {
      throw new Error('The Velocity list changed. Select the item again.');
    }
    if (!item || item.id !== selected.feedId) throw new Error('Velocity returned details for a different item.');
    const qualified = {
      ...item, id, feedId: selected.feedId, serverId: selected.serverId,
      serverName: selected.serverName, serverApiUrl: selected.serverApiUrl,
    };
    this.items.set(id, qualified);
    return qualified;
  }

  async selected(input) {
    const item = await this.details(input);
    if (!item.supported) {
      throw new Error(item.unsupportedReason || item.reason || 'This item cannot be applied automatically.');
    }
    const connectionOptions = this.validateItem(item);
    return { ...item, connectionOptions };
  }
}

module.exports = { VelocityCatalog };
