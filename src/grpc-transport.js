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
 * @file grpc-transport.js
 * @description
 * gRPC transport for the ArcGIS Velocity Simulator.
 *
 * Supports three gRPC Feature Serialization Formats:
 *
 * 1. "protobuf" (default) — Velocity external gRPC Feed protocol (velocity-grpc.proto):
 *    service GrpcFeed { rpc Send(Request) returns (Response); rpc Stream(stream Request) returns (Response); }
 *    message Request { repeated Feature features = 1; }
 *    message Feature { repeated google.protobuf.Any attributes = 1; }
 *    Each attribute is a google.protobuf.Any wrapping a well-known wrapper type.
 *
 * 2. "kryo" — Velocity internal protocol (feature-service.proto):
 *    service GrpcFeatureService { rpc execute(GrpcFeatureRequest) returns (GrpcFeatureResponse); ... }
 *    GrpcFeatureRequest { string itemId, bytes bytes } — bytes contains the raw feature payload.
 *    Note: True Kryo serialization requires Java; this mode sends raw UTF-8 bytes as a stand-in
 *    for testing connectivity with the internal protocol.
 *
 * 3. "text" — Velocity internal protocol (feature-service.proto):
 *    Same service as kryo, but the bytes field contains plain UTF-8 text (e.g. a CSV line).
 *    This is useful for simple text-based testing where no binary serialization is needed.
 *
 * Client mode: sends features to a Velocity gRPC endpoint.
 * Server mode: hosts a gRPC service, receives features from gRPC clients.
 */
const path = require('path');
const fs = require('fs');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const { getSystemRootCertificates, formatTlsCertSummary } = require('./tls-utils');

const PROTO_DIR = path.join(__dirname, 'proto');
const VELOCITY_PROTO_PATH = path.join(PROTO_DIR, 'velocity-grpc.proto');
const FEATURE_SERVICE_PROTO_PATH = path.join(PROTO_DIR, 'feature-service.proto');
const WRAPPERS_PROTO_PATH = path.join(PROTO_DIR, 'google', 'protobuf', 'wrappers.proto');

// Type URL prefix for google.protobuf wrapper types (matches Velocity server expectations)
const TYPE_URL_PREFIX = 'type.googleapis.com/';

/**
 * Valid serialization format identifiers.
 */
const SERIALIZATION_FORMATS = Object.freeze({
  PROTOBUF: 'protobuf',
  KRYO: 'kryo',
  TEXT: 'text',
});

const VALID_SERIALIZATION_FORMATS = new Set(Object.values(SERIALIZATION_FORMATS));

function loadVelocityProto() {
  const packageDefinition = protoLoader.loadSync(VELOCITY_PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [PROTO_DIR],
  });
  return grpc.loadPackageDefinition(packageDefinition);
}

function loadFeatureServiceProto() {
  const packageDefinition = protoLoader.loadSync(FEATURE_SERVICE_PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [PROTO_DIR],
  });
  return grpc.loadPackageDefinition(packageDefinition);
}

/**
 * Supported attribute data types matching Velocity's schema model.
 */
const DataType = {
  String: 'esriFieldTypeString',
  Int32: 'esriFieldTypeSmallInteger',
  Int64: 'esriFieldTypeInteger',
  Float32: 'esriFieldTypeSingle',
  Float64: 'esriFieldTypeDouble',
  Boolean: 'esriFieldTypeBoolean',
  Date: 'esriFieldTypeDate',
};

/**
 * Infers the data type of a string value.
 */
function inferType(value) {
  if (value === '' || value === null || value === undefined) return DataType.String;
  if (value === 'true' || value === 'false') return DataType.Boolean;
  if (/^-?\d+$/.test(value)) {
    const num = parseInt(value, 10);
    return (num >= -2147483648 && num <= 2147483647) ? DataType.Int32 : DataType.Int64;
  }
  if (/^-?\d+\.\d+$/.test(value) || /^-?\d+[eE][+-]?\d+$/.test(value)) return DataType.Float64;
  return DataType.String;
}

/**
 * Loads wrapper message types with encode/decode capabilities using protobufjs.
 */
function loadWrapperTypes() {
  const protobuf = require('protobufjs');
  const root = protobuf.loadSync(WRAPPERS_PROTO_PATH);
  return {
    StringValue: root.lookupType('google.protobuf.StringValue'),
    Int32Value: root.lookupType('google.protobuf.Int32Value'),
    Int64Value: root.lookupType('google.protobuf.Int64Value'),
    FloatValue: root.lookupType('google.protobuf.FloatValue'),
    DoubleValue: root.lookupType('google.protobuf.DoubleValue'),
    BoolValue: root.lookupType('google.protobuf.BoolValue'),
  };
}

/**
 * Packs a typed value into a google.protobuf.Any message.
 */
function packAttribute(value, dataType, wrapperTypes) {
  if (value === null || value === undefined || value === '') {
    return { type_url: '', value: Buffer.alloc(0) };
  }

  let typeUrl;
  let encoded;

  switch (dataType) {
    case DataType.String:
      typeUrl = TYPE_URL_PREFIX + 'google.protobuf.StringValue';
      encoded = wrapperTypes.StringValue.encode(wrapperTypes.StringValue.create({ value: String(value) })).finish();
      break;
    case DataType.Int32:
      typeUrl = TYPE_URL_PREFIX + 'google.protobuf.Int32Value';
      encoded = wrapperTypes.Int32Value.encode(wrapperTypes.Int32Value.create({ value: parseInt(value, 10) })).finish();
      break;
    case DataType.Int64:
      typeUrl = TYPE_URL_PREFIX + 'google.protobuf.Int64Value';
      encoded = wrapperTypes.Int64Value.encode(wrapperTypes.Int64Value.create({ value: parseInt(value, 10) })).finish();
      break;
    case DataType.Float32:
      typeUrl = TYPE_URL_PREFIX + 'google.protobuf.FloatValue';
      encoded = wrapperTypes.FloatValue.encode(wrapperTypes.FloatValue.create({ value: parseFloat(value) })).finish();
      break;
    case DataType.Float64:
      typeUrl = TYPE_URL_PREFIX + 'google.protobuf.DoubleValue';
      encoded = wrapperTypes.DoubleValue.encode(wrapperTypes.DoubleValue.create({ value: parseFloat(value) })).finish();
      break;
    case DataType.Boolean:
      typeUrl = TYPE_URL_PREFIX + 'google.protobuf.BoolValue';
      encoded = wrapperTypes.BoolValue.encode(wrapperTypes.BoolValue.create({ value: value === 'true' || value === true })).finish();
      break;
    case DataType.Date:
      typeUrl = TYPE_URL_PREFIX + 'google.protobuf.Int64Value';
      const epoch = /^\d+$/.test(String(value)) ? parseInt(value, 10) : new Date(value).getTime();
      encoded = wrapperTypes.Int64Value.encode(wrapperTypes.Int64Value.create({ value: epoch })).finish();
      break;
    default:
      typeUrl = TYPE_URL_PREFIX + 'google.protobuf.StringValue';
      encoded = wrapperTypes.StringValue.encode(wrapperTypes.StringValue.create({ value: String(value) })).finish();
  }

  return { type_url: typeUrl, value: Buffer.from(encoded) };
}

/**
 * Unpacks a google.protobuf.Any into a human-readable value.
 */
function unpackAttribute(any, wrapperTypes) {
  if (!any || !any.type_url || any.type_url === '') return null;

  const typeName = any.type_url.replace(TYPE_URL_PREFIX, '');
  const buf = (any.value instanceof Uint8Array || Buffer.isBuffer(any.value))
    ? Buffer.from(any.value)
    : Buffer.alloc(0);

  switch (typeName) {
    case 'google.protobuf.StringValue':
      return wrapperTypes.StringValue.decode(buf).value;
    case 'google.protobuf.Int32Value':
      return wrapperTypes.Int32Value.decode(buf).value;
    case 'google.protobuf.Int64Value':
      return wrapperTypes.Int64Value.decode(buf).value;
    case 'google.protobuf.FloatValue':
      return wrapperTypes.FloatValue.decode(buf).value;
    case 'google.protobuf.DoubleValue':
      return wrapperTypes.DoubleValue.decode(buf).value;
    case 'google.protobuf.BoolValue':
      return wrapperTypes.BoolValue.decode(buf).value;
    default:
      return `<unknown:${typeName}>`;
  }
}

/**
 * Parses a CSV line into field values. Handles quoted fields.
 */
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Converts a CSV line to a list of Any-wrapped attributes.
 */
function lineToFeatureAttributes(line, schema, wrapperTypes) {
  const values = parseCsvLine(line);
  const attributes = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const dataType = (schema && schema[i]) ? schema[i].dataType : inferType(value);
    attributes.push(packAttribute(value, dataType, wrapperTypes));
  }
  return attributes;
}

/**
 * Converts a Feature's Any attributes back to a CSV string for display.
 */
function featureAttributesToCsv(attributes, wrapperTypes) {
  return attributes.map((any) => {
    const val = unpackAttribute(any, wrapperTypes);
    if (val === null) return '';
    const str = String(val);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }).join(',');
}


// TLS certificate utilities are now provided by tls-utils.js

/**
 * Builds gRPC channel credentials based on TLS options.
 *
 * When useTls is true with no custom certs, loads both the Node.js bundled
 * root certificates AND the OS certificate store so that connections to
 * servers using enterprise/internal CAs (e.g. Esri Root CA) succeed even
 * when running inside Electron.
 *
 * @returns {{ credentials: object, tlsInfo: string }}
 */
function buildChannelCredentials({ useTls = true, tlsCaPath, tlsCertPath, tlsKeyPath } = {}) {
  if (!useTls) {
    return { credentials: grpc.credentials.createInsecure(), tlsInfo: 'tls=off (unsecure)' };
  }
  const hasCustomCerts = tlsCaPath || tlsCertPath || tlsKeyPath;
  if (!hasCustomCerts) {
    const certResult = getSystemRootCertificates();
    return {
      credentials: grpc.credentials.createSsl(certResult.pemBuffer),
      tlsInfo: `tls=on, ${formatTlsCertSummary(certResult)}`,
    };
  }
  const rootCerts = tlsCaPath ? fs.readFileSync(tlsCaPath) : undefined;
  const privateKey = tlsKeyPath ? fs.readFileSync(tlsKeyPath) : undefined;
  const certChain = tlsCertPath ? fs.readFileSync(tlsCertPath) : undefined;
  const customParts = [];
  if (tlsCaPath) customParts.push(`ca=${tlsCaPath}`);
  if (tlsCertPath) customParts.push(`cert=${tlsCertPath}`);
  if (tlsKeyPath) customParts.push(`key=${tlsKeyPath}`);
  return {
    credentials: grpc.credentials.createSsl(rootCerts, privateKey, certChain),
    tlsInfo: `tls=on, custom certs: ${customParts.join(', ')}`,
  };
}

/**
 * Builds gRPC server credentials based on TLS options.
 *
 * NOTE — why server-mode TLS cannot fall back to OS/system certificates:
 *
 * Client TLS only needs *trust anchors* (CA root certs) to verify the server's
 * identity, which is exactly what the OS certificate store provides. That is why
 * {@link buildChannelCredentials} can fall back to OS root CAs automatically.
 *
 * Server TLS is fundamentally different: the server must *present its own identity
 * certificate* to connecting clients. OS root CAs are trust anchors for verifying
 * others — they are not server identity certificates. A gRPC server has no
 * certificate to present unless a `tlsCertPath` + `tlsKeyPath` pair is explicitly
 * provided. There is nothing to fall back to, so missing cert/key is a hard error.
 *
 * Practical options when cert/key are unavailable:
 *   1. Omit `useTls` (or set it to `false`) to use plaintext (unsecure) mode.
 *   2. Generate a self-signed cert+key pair and pass their paths.
 *
 * @returns {{ credentials: object, tlsInfo: string }}
 */
function buildServerCredentials({ useTls = true, tlsCaPath, tlsCertPath, tlsKeyPath } = {}) {
  if (!useTls) return { credentials: grpc.ServerCredentials.createInsecure(), tlsInfo: 'tls=off (unsecure)' };
  const rootCerts = tlsCaPath ? fs.readFileSync(tlsCaPath) : null;
  const privateKey = tlsKeyPath ? fs.readFileSync(tlsKeyPath) : null;
  const certChain = tlsCertPath ? fs.readFileSync(tlsCertPath) : null;
  if (!privateKey || !certChain) {
    throw new Error('TLS server mode requires both tlsCertPath and tlsKeyPath. OS/system certificates cannot be used as a fallback — see buildServerCredentials JSDoc for details.');
  }
  const parts = [];
  if (tlsCaPath) parts.push(`ca=${tlsCaPath}`);
  if (tlsCertPath) parts.push(`cert=${tlsCertPath}`);
  if (tlsKeyPath) parts.push(`key=${tlsKeyPath}`);
  return {
    credentials: grpc.ServerCredentials.createSsl(rootCerts, [{ private_key: privateKey, cert_chain: certChain }], false),
    tlsInfo: `tls=on, server certs: ${parts.join(', ')}`,
  };
}


// =============================================================================
// PROTOBUF FORMAT — GrpcFeed service (velocity-grpc.proto)
// =============================================================================

class GrpcClientTransportProtobuf {
  constructor({ ip, port, schema = null, useStreaming = false, headerPathKey = 'grpc-path', headerPath = 'replace.with.dedicated.uid', useTls = true, tlsCaPath, tlsCertPath, tlsKeyPath }) {
    this.ip = ip;
    this.port = port;
    this.schema = schema;
    this.useStreaming = useStreaming;
    this.headerPathKey = headerPathKey;
    this.headerPath = headerPath;
    this.useTls = useTls;
    this.tlsCaPath = tlsCaPath;
    this.tlsCertPath = tlsCertPath;
    this.tlsKeyPath = tlsKeyPath;
    this.client = null;
    this.stream = null;
    this._connected = false;
    this.wrapperTypes = loadWrapperTypes();
  }

  _buildMetadata() {
    const metadata = new grpc.Metadata();
    metadata.set(this.headerPathKey, this.headerPath);
    return metadata;
  }

  async connect() {
    const loaded = loadVelocityProto();
    const proto = loaded.esri.realtime.core.grpc;
    const address = this.ip + ':' + this.port;
    const { credentials, tlsInfo } = buildChannelCredentials(this);
    this.client = new proto.GrpcFeed(address, credentials);
    return new Promise((resolve, reject) => {
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 10);
      this.client.waitForReady(deadline, (error) => {
        if (error) {
          reject(new Error('gRPC client failed to connect to ' + address + ': ' + error.message));
          return;
        }
        if (this.useStreaming) {
          this.stream = this.client.Stream(this._buildMetadata(), (err, response) => {
            if (err && err.code !== grpc.status.CANCELLED) this._connected = false;
          });
          this.stream.on('error', (err) => {
            if (err.code !== grpc.status.CANCELLED) this._connected = false;
          });
        }
        this._connected = true;
        resolve({ protocol: 'grpc', mode: 'client', grpcSerialization: 'protobuf', address, tlsInfo });
      });
    });
  }

  isConnected() { return this._connected; }

  async send(data) {
    if (!this.client) throw new Error('gRPC client not available.');
    const attributes = lineToFeatureAttributes(data, this.schema, this.wrapperTypes);
    const request = { features: [{ attributes }] };

    if (this.useStreaming && this.stream) {
      this.stream.write(request);
      return { delivered: true, recipients: 1 };
    }

    return new Promise((resolve, reject) => {
      this.client.Send(request, this._buildMetadata(), (err, response) => {
        if (err) reject(new Error('gRPC Send failed: ' + err.message));
        else resolve({ delivered: true, recipients: 1, response });
      });
    });
  }

  async disconnect() {
    if (this.stream) { this.stream.end(); this.stream = null; }
    if (this.client) { this.client.close(); this.client = null; }
    this._connected = false;
  }
}

class GrpcServerTransportProtobuf {
  constructor({ ip, port, onData = null, onClientConnected = null, useTls = true, tlsCaPath, tlsCertPath, tlsKeyPath }) {
    this.ip = ip;
    this.port = port;
    this.onData = onData;
    this.onClientConnected = onClientConnected || null;
    this.useTls = useTls;
    this.tlsCaPath = tlsCaPath;
    this.tlsCertPath = tlsCertPath;
    this.tlsKeyPath = tlsKeyPath;
    this.server = null;
    this._listening = false;
    this._clientCount = 0;
    this._watcherCalls = new Set();
    this.wrapperTypes = loadWrapperTypes();
  }

  async connect() {
    const loaded = loadVelocityProto();
    const proto = loaded.esri.realtime.core.grpc;
    this.server = new grpc.Server();

    const self = this;
    this.server.addService(proto.GrpcFeed.service, {
      Send: (call, callback) => {
        const request = call.request;
        if (request.features) {
          request.features.forEach((feature) => {
            const csv = featureAttributesToCsv(feature.attributes || [], self.wrapperTypes);
            if (self.onData) self.onData(csv);
          });
        }
        callback(null, { message: 'OK', code: 0 });
      },
      Stream: (call, callback) => {
        self._clientCount++;
        call.on('data', (request) => {
          if (request.features) {
            request.features.forEach((feature) => {
              const csv = featureAttributesToCsv(feature.attributes || [], self.wrapperTypes);
              if (self.onData) self.onData(csv);
            });
          }
        });
        call.on('end', () => { self._clientCount--; callback(null, { message: 'OK', code: 0 }); });
        call.on('error', () => { self._clientCount--; });
        call.on('cancelled', () => { self._clientCount--; });
      },
      Watch: (call) => {
        self._watcherCalls.add(call);
        self._clientCount++;
        if (self.onClientConnected) self.onClientConnected();
        call.on('cancelled', () => { self._watcherCalls.delete(call); self._clientCount--; });
        call.on('error', () => { self._watcherCalls.delete(call); self._clientCount--; });
        call.on('close', () => { self._watcherCalls.delete(call); });
      },
    });

    const address = this.ip + ':' + this.port;
    return new Promise((resolve, reject) => {
      const { credentials: serverCreds, tlsInfo: serverTlsInfo } = buildServerCredentials(this);
      this.server.bindAsync(address, serverCreds, (error, boundPort) => {
        if (error) {
          reject(new Error('gRPC server failed to bind on ' + address + ': ' + error.message));
          return;
        }
        this._listening = true;
        resolve({ protocol: 'grpc', mode: 'server', grpcSerialization: 'protobuf', address: { address: this.ip, port: boundPort }, tlsInfo: serverTlsInfo });
      });
    });
  }

  isConnected() { return this._listening; }
  hasRecipients() { return this._watcherCalls.size > 0; }

  async send(data) {
    if (this._watcherCalls.size === 0) {
      return { delivered: false, recipients: 0, reason: 'no-watchers' };
    }
    const attributes = lineToFeatureAttributes(data, null, this.wrapperTypes);
    const request = { features: [{ attributes }] };
    const dead = [];
    for (const call of this._watcherCalls) {
      try {
        call.write(request);
      } catch (_) {
        dead.push(call);
      }
    }
    for (const call of dead) { this._watcherCalls.delete(call); }
    const sent = this._watcherCalls.size;
    return { delivered: sent > 0, recipients: sent };
  }

  async disconnect() {
    for (const call of this._watcherCalls) { try { call.end(); } catch (_) {} }
    this._watcherCalls.clear();
    if (this.server) { this.server.forceShutdown(); this.server = null; }
    this._listening = false;
    this._clientCount = 0;
  }
}


// =============================================================================
// KRYO / TEXT FORMAT — GrpcFeatureService (feature-service.proto)
// =============================================================================

class GrpcClientTransportInternal {
  constructor({ ip, port, itemId = 'simulator', grpcSerialization = 'text', useStreaming = false, headerPathKey = 'grpc-path', headerPath = 'replace.with.dedicated.uid', useTls = true, tlsCaPath, tlsCertPath, tlsKeyPath }) {
    this.ip = ip;
    this.port = port;
    this.itemId = itemId;
    this.grpcSerialization = grpcSerialization;
    this.useStreaming = useStreaming;
    this.headerPathKey = headerPathKey;
    this.headerPath = headerPath;
    this.useTls = useTls;
    this.tlsCaPath = tlsCaPath;
    this.tlsCertPath = tlsCertPath;
    this.tlsKeyPath = tlsKeyPath;
    this.client = null;
    this.stream = null;
    this._connected = false;
  }

  _buildMetadata() {
    const metadata = new grpc.Metadata();
    metadata.set(this.headerPathKey, this.headerPath);
    return metadata;
  }

  async connect() {
    const loaded = loadFeatureServiceProto();
    const proto = loaded.grpc;
    const address = this.ip + ':' + this.port;
    const { credentials, tlsInfo } = buildChannelCredentials(this);
    this.client = new proto.GrpcFeatureService(address, credentials);
    return new Promise((resolve, reject) => {
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 10);
      this.client.waitForReady(deadline, (error) => {
        if (error) {
          reject(new Error('gRPC client failed to connect to ' + address + ': ' + error.message));
          return;
        }
        if (this.useStreaming) {
          this.stream = this.client.executeMulti(this._buildMetadata());
          this.stream.on('data', () => {}); // consume responses
          this.stream.on('error', (err) => {
            if (err.code !== grpc.status.CANCELLED) this._connected = false;
          });
        }
        this._connected = true;
        resolve({ protocol: 'grpc', mode: 'client', grpcSerialization: this.grpcSerialization, address, tlsInfo });
      });
    });
  }

  isConnected() { return this._connected; }

  async send(data) {
    if (!this.client) throw new Error('gRPC client not available.');
    const bytes = Buffer.from(data, 'utf-8');
    const request = { itemId: this.itemId, bytes };

    if (this.useStreaming && this.stream) {
      this.stream.write(request);
      return { delivered: true, recipients: 1 };
    }

    return new Promise((resolve, reject) => {
      this.client.execute(request, this._buildMetadata(), (err, response) => {
        if (err) reject(new Error('gRPC execute failed: ' + err.message));
        else resolve({ delivered: true, recipients: 1, response });
      });
    });
  }

  async disconnect() {
    if (this.stream) { this.stream.end(); this.stream = null; }
    if (this.client) { this.client.close(); this.client = null; }
    this._connected = false;
  }
}

class GrpcServerTransportInternal {
  constructor({ ip, port, itemId = 'simulator', grpcSerialization = 'text', onData = null, onClientConnected = null, useTls = true, tlsCaPath, tlsCertPath, tlsKeyPath }) {
    this.ip = ip;
    this.port = port;
    this.itemId = itemId;
    this.grpcSerialization = grpcSerialization;
    this.onData = onData;
    this.onClientConnected = onClientConnected || null;
    this.useTls = useTls;
    this.tlsCaPath = tlsCaPath;
    this.tlsCertPath = tlsCertPath;
    this.tlsKeyPath = tlsKeyPath;
    this.server = null;
    this._listening = false;
    this._clientCount = 0;
    this._watcherCalls = new Set();
  }

  async connect() {
    const loaded = loadFeatureServiceProto();
    const proto = loaded.grpc;
    this.server = new grpc.Server();

    const self = this;
    this.server.addService(proto.GrpcFeatureService.service, {
      execute: (call, callback) => {
        const request = call.request;
        const text = request.bytes ? Buffer.from(request.bytes).toString('utf-8') : '';
        if (self.onData) self.onData(text);
        callback(null, { itemId: request.itemId || self.itemId, success: true });
      },
      executeMulti: (call) => {
        self._clientCount++;
        call.on('data', (request) => {
          const text = request.bytes ? Buffer.from(request.bytes).toString('utf-8') : '';
          if (self.onData) self.onData(text);
          call.write({ itemId: request.itemId || self.itemId, success: true });
        });
        call.on('end', () => { self._clientCount--; call.end(); });
        call.on('error', () => { self._clientCount--; });
        call.on('cancelled', () => { self._clientCount--; });
      },
      watch: (call) => {
        self._watcherCalls.add(call);
        self._clientCount++;
        if (self.onClientConnected) self.onClientConnected();
        call.on('cancelled', () => { self._watcherCalls.delete(call); self._clientCount--; });
        call.on('error', () => { self._watcherCalls.delete(call); self._clientCount--; });
        call.on('close', () => { self._watcherCalls.delete(call); });
      },
    });

    const address = this.ip + ':' + this.port;
    return new Promise((resolve, reject) => {
      const { credentials: serverCreds, tlsInfo: serverTlsInfo } = buildServerCredentials(this);
      this.server.bindAsync(address, serverCreds, (error, boundPort) => {
        if (error) {
          reject(new Error('gRPC server failed to bind on ' + address + ': ' + error.message));
          return;
        }
        this._listening = true;
        resolve({ protocol: 'grpc', mode: 'server', grpcSerialization: self.grpcSerialization, address: { address: this.ip, port: boundPort }, tlsInfo: serverTlsInfo });
      });
    });
  }

  isConnected() { return this._listening; }
  hasRecipients() { return this._watcherCalls.size > 0; }

  async send(data) {
    if (this._watcherCalls.size === 0) {
      return { delivered: false, recipients: 0, reason: 'no-watchers' };
    }
    const bytes = Buffer.from(data, 'utf-8');
    const request = { itemId: this.itemId, bytes };
    const dead = [];
    for (const call of this._watcherCalls) {
      try {
        call.write(request);
      } catch (_) {
        dead.push(call);
      }
    }
    for (const call of dead) { this._watcherCalls.delete(call); }
    const sent = this._watcherCalls.size;
    return { delivered: sent > 0, recipients: sent };
  }

  async disconnect() {
    for (const call of this._watcherCalls) { try { call.end(); } catch (_) {} }
    this._watcherCalls.clear();
    if (this.server) { this.server.forceShutdown(); this.server = null; }
    this._listening = false;
    this._clientCount = 0;
  }
}


// =============================================================================
// FACTORY — Creates the appropriate transport based on serialization format
// =============================================================================

/**
 * Creates a gRPC client transport for the given serialization format.
 * @param {object} opts - { ip, port, grpcSerialization, itemId, schema, useStreaming }
 */
function createGrpcClientTransport(opts) {
  const grpcSerialization = opts.grpcSerialization || SERIALIZATION_FORMATS.PROTOBUF;
  switch (grpcSerialization) {
    case SERIALIZATION_FORMATS.PROTOBUF:
      return new GrpcClientTransportProtobuf(opts);
    case SERIALIZATION_FORMATS.KRYO:
    case SERIALIZATION_FORMATS.TEXT:
      return new GrpcClientTransportInternal({ ...opts, grpcSerialization });
    default:
      throw new Error(`Unknown gRPC serialization format: ${grpcSerialization}`);
  }
}

/**
 * Creates a gRPC server transport for the given serialization format.
 * @param {object} opts - { ip, port, grpcSerialization, itemId, onData }
 */
function createGrpcServerTransport(opts) {
  const grpcSerialization = opts.grpcSerialization || SERIALIZATION_FORMATS.PROTOBUF;
  switch (grpcSerialization) {
    case SERIALIZATION_FORMATS.PROTOBUF:
      return new GrpcServerTransportProtobuf(opts);
    case SERIALIZATION_FORMATS.KRYO:
    case SERIALIZATION_FORMATS.TEXT:
      return new GrpcServerTransportInternal({ ...opts, grpcSerialization });
    default:
      throw new Error(`Unknown gRPC serialization format: ${grpcSerialization}`);
  }
}

module.exports = {
  // Factory functions (preferred API)
  createGrpcClientTransport,
  createGrpcServerTransport,
  // Legacy direct class exports
  GrpcClientTransport: GrpcClientTransportProtobuf,
  GrpcServerTransport: GrpcServerTransportProtobuf,
  // Constants
  SERIALIZATION_FORMATS,
  VALID_SERIALIZATION_FORMATS,
  DataType,
  // Utilities (exported for testing)
  inferType,
  packAttribute,
  unpackAttribute,
  loadWrapperTypes,
  parseCsvLine,
  lineToFeatureAttributes,
  featureAttributesToCsv,
};
