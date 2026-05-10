const assert = require('assert');
const {
  getVelocityItemType,
  isTokenCapableItem,
  shouldSendVelocityTokenByDefault,
  describeVelocityAuthType,
} = require('../src/velocity-auth-utils');

assert.strictEqual(getVelocityItemType({ outputType: 'grpc' }), 'grpc');
assert.strictEqual(getVelocityItemType({ feedType: 'http-receiver' }), 'http-receiver');
assert.strictEqual(isTokenCapableItem({ feedType: 'tcp' }), false);
assert.strictEqual(isTokenCapableItem({ feedType: 'websocket' }), true);

assert.strictEqual(shouldSendVelocityTokenByDefault({ tokenOnly: true, authType: 'token' }), true);
assert.strictEqual(shouldSendVelocityTokenByDefault({ feedType: 'grpc', authType: 'arcgis' }), true);
assert.strictEqual(shouldSendVelocityTokenByDefault({ feedType: 'http-receiver', authType: 'token' }), true);
assert.strictEqual(shouldSendVelocityTokenByDefault({ feedType: 'websocket', authType: '' }), true);
assert.strictEqual(shouldSendVelocityTokenByDefault({ feedType: 'http-receiver', authType: 'basic' }), false);
assert.strictEqual(shouldSendVelocityTokenByDefault({ feedType: 'http-receiver', authType: 'none' }), false);
assert.strictEqual(shouldSendVelocityTokenByDefault({ feedType: 'tcp', authType: '' }), false);

assert.strictEqual(describeVelocityAuthType('arcgis'), 'ArcGIS token');
assert.strictEqual(describeVelocityAuthType('basic'), 'Basic auth (token not used)');
assert.strictEqual(describeVelocityAuthType('none'), 'No auth required');

console.log('velocity-auth-utils tests passed');

