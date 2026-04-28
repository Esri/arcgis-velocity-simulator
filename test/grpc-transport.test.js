/**
 * gRPC Transport Unit Tests
 * Run with: node test/grpc-transport.test.js
 *
 * Tests gRPC transport with all three serialization formats.
 */

const path = require('path');
const {
  GrpcClientTransport,
  GrpcServerTransport,
  createGrpcClientTransport,
  createGrpcServerTransport,
  SERIALIZATION_FORMATS,
} = require('../src/grpc-transport.js');

async function runGrpcTransportTests() {
  console.log('\n=== gRPC Transport Test Suite ===');
  let passed = 0;
  let failed = 0;

  const runTest = async (testName, testFn) => {
    try {
      const result = await testFn();
      if (result) {
        console.log(`✅ ${testName}`);
        passed += 1;
      } else {
        console.log(`❌ ${testName}`);
        failed += 1;
      }
    } catch (error) {
      console.log(`❌ ${testName} - Error: ${error.message}`);
      failed += 1;
    }
  };

  // --- Test 1: Protobuf Server lifecycle ---
  console.log('\n--- Test 1: Protobuf GrpcServerTransport lifecycle ---');
  await runTest('GrpcServerTransport binds successfully', async () => {
    const server = new GrpcServerTransport({ ip: '127.0.0.1', port: 0 , useTls: false});
    const result = await server.connect();
    const listening = server.isConnected();
    await server.disconnect();
    return listening === true && result.protocol === 'grpc';
  });

  await runTest('GrpcServerTransport reports no recipients initially', async () => {
    const server = new GrpcServerTransport({ ip: '127.0.0.1', port: 0 , useTls: false});
    await server.connect();
    const hasClients = server.hasRecipients();
    await server.disconnect();
    return hasClients === false;
  });

  await runTest('GrpcServerTransport.send returns no-watchers when no Watch clients connected', async () => {
    const server = new GrpcServerTransport({ ip: '127.0.0.1', port: 0 , useTls: false});
    await server.connect();
    const result = await server.send('test-data');
    await server.disconnect();
    return result.delivered === false && result.reason === 'no-watchers';
  });

  // --- Test 2: Protobuf Client connects to server ---
  console.log('\n--- Test 2: Protobuf GrpcClientTransport connects to server ---');
  await runTest('GrpcClientTransport connects to a running GrpcServerTransport', async () => {
    const server = new GrpcServerTransport({ ip: '127.0.0.1', port: 0 , useTls: false});
    const serverResult = await server.connect();
    const serverPort = serverResult.address.port;

    const client = new GrpcClientTransport({ ip: '127.0.0.1', port: serverPort , useTls: false});
    await client.connect();
    const connected = client.isConnected();

    await client.disconnect();
    await server.disconnect();
    return connected === true;
  });

  // --- Test 3: End-to-end data flow (client → server) ---
  console.log('\n--- Test 3: End-to-end Protobuf client → server data flow ---');
  await runTest('GrpcClientTransport.send delivers data and server decodes it', async () => {
    let receivedData = null;
    const server = createGrpcServerTransport({
      ip: '127.0.0.1', port: 0, useTls: false, grpcSerialization: 'protobuf',
      onData: (csv) => { receivedData = csv; },
    });
    const serverResult = await server.connect();
    const serverPort = serverResult.address.port;

    const client = createGrpcClientTransport({ ip: '127.0.0.1', port: serverPort, useTls: false, grpcSerialization: 'protobuf' });
    await client.connect();

    const sendResult = await client.send('hello,42,true');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await client.disconnect();
    await server.disconnect();
    return sendResult.delivered === true && receivedData === 'hello,42,true';
  });

  // --- Test 4: Server-push via Watch (server → logger client) ---
  console.log('\n--- Test 4: Server-push via Watch (server → client) ---');
  await runTest('GrpcServerTransport.send pushes data to a Watch subscriber (protobuf)', async () => {
    let received = null;
    let clientConnectedFired = false;
    const server = createGrpcServerTransport({
      ip: '127.0.0.1', port: 0, useTls: false, grpcSerialization: 'protobuf',
      onClientConnected: () => { clientConnectedFired = true; },
    });
    const serverResult = await server.connect();
    const serverPort = serverResult.address.port;

    // Simulate a logger-style client using the server's own Watch RPC
    const grpc = require('@grpc/grpc-js');
    const protoLoader = require('@grpc/proto-loader');
    const path = require('path');
    const PROTO_DIR = path.join(__dirname, '../src/proto');
    const packageDef = protoLoader.loadSync(path.join(PROTO_DIR, 'velocity-grpc.proto'), { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true, includeDirs: [PROTO_DIR] });
    const proto = grpc.loadPackageDefinition(packageDef).esri.realtime.core.grpc;
    const watchClient = new proto.GrpcFeed(`127.0.0.1:${serverPort}`, grpc.credentials.createInsecure());
    const stream = watchClient.Watch({ client_id: 'test-watcher' });
    stream.on('data', (req) => {
      if (req.features && req.features[0] && req.features[0].attributes) {
        received = 'data-received';
      }
    });
    stream.on('error', () => {}); // suppress CANCELLED error on stream.cancel()

    // Wait for Watch to register
    await new Promise((resolve) => setTimeout(resolve, 200));
    const hasRecipients = server.hasRecipients();
    const sendResult = await server.send('push,42,true');
    await new Promise((resolve) => setTimeout(resolve, 200));
    stream.cancel();
    watchClient.close();
    await server.disconnect();
    return clientConnectedFired === true && hasRecipients === true &&
      sendResult.delivered === true && sendResult.recipients === 1 && received === 'data-received';
  });

  await runTest('GrpcServerTransport.send pushes data to a Watch subscriber (text)', async () => {
    let received = null;
    const server = createGrpcServerTransport({
      ip: '127.0.0.1', port: 0, useTls: false, grpcSerialization: 'text',
    });
    const serverResult = await server.connect();
    const serverPort = serverResult.address.port;

    const grpc = require('@grpc/grpc-js');
    const protoLoader = require('@grpc/proto-loader');
    const path = require('path');
    const PROTO_DIR = path.join(__dirname, '../src/proto');
    const packageDef = protoLoader.loadSync(path.join(PROTO_DIR, 'feature-service.proto'), { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true, includeDirs: [PROTO_DIR] });
    const proto = grpc.loadPackageDefinition(packageDef).grpc;
    const watchClient = new proto.GrpcFeatureService(`127.0.0.1:${serverPort}`, grpc.credentials.createInsecure());
    const stream = watchClient.watch({ client_id: 'test-watcher' });
    stream.on('data', (req) => {
      received = req.bytes ? Buffer.from(req.bytes).toString('utf-8') : null;
    });
    stream.on('error', () => {}); // suppress CANCELLED error on stream.cancel()

    await new Promise((resolve) => setTimeout(resolve, 200));
    const sendResult = await server.send('hello,text,push');
    await new Promise((resolve) => setTimeout(resolve, 200));
    stream.cancel();
    watchClient.close();
    await server.disconnect();
    return sendResult.delivered === true && received === 'hello,text,push';
  });

  await runTest('GrpcServerTransport.send pushes data to a Watch subscriber (kryo)', async () => {
    let received = null;
    let clientConnectedFired = false;
    const server = createGrpcServerTransport({
      ip: '127.0.0.1', port: 0, useTls: false, grpcSerialization: 'kryo',
      onClientConnected: () => { clientConnectedFired = true; },
    });
    const serverResult = await server.connect();
    const serverPort = serverResult.address.port;

    const grpc = require('@grpc/grpc-js');
    const protoLoader = require('@grpc/proto-loader');
    const path = require('path');
    const PROTO_DIR = path.join(__dirname, '../src/proto');
    const packageDef = protoLoader.loadSync(path.join(PROTO_DIR, 'feature-service.proto'), { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true, includeDirs: [PROTO_DIR] });
    const proto = grpc.loadPackageDefinition(packageDef).grpc;
    const watchClient = new proto.GrpcFeatureService(`127.0.0.1:${serverPort}`, grpc.credentials.createInsecure());
    const stream = watchClient.watch({ client_id: 'test-watcher' });
    stream.on('data', (req) => {
      received = req.bytes ? Buffer.from(req.bytes).toString('utf-8') : null;
    });
    stream.on('error', () => {});

    await new Promise((resolve) => setTimeout(resolve, 200));
    const hasRecipients = server.hasRecipients();
    const sendResult = await server.send('kryo,data,push');
    await new Promise((resolve) => setTimeout(resolve, 200));
    stream.cancel();
    watchClient.close();
    await server.disconnect();
    return clientConnectedFired === true && hasRecipients === true &&
      sendResult.delivered === true && sendResult.recipients === 1 && received === 'kryo,data,push';
  });

  await runTest('GrpcServerTransportInternal (text) reports no-watchers when no Watch client connected', async () => {
    const server = createGrpcServerTransport({ ip: '127.0.0.1', port: 0, useTls: false, grpcSerialization: 'text' });
    await server.connect();
    const result = await server.send('test');
    await server.disconnect();
    return result.delivered === false && result.reason === 'no-watchers';
  });

  await runTest('GrpcServerTransportInternal (kryo) reports no-watchers when no Watch client connected', async () => {
    const server = createGrpcServerTransport({ ip: '127.0.0.1', port: 0, useTls: false, grpcSerialization: 'kryo' });
    await server.connect();
    const result = await server.send('test');
    await server.disconnect();
    return result.delivered === false && result.reason === 'no-watchers';
  });

  await runTest('GrpcClientTransportInternal.isConnected returns false after disconnect', async () => {
    const server = createGrpcServerTransport({ ip: '127.0.0.1', port: 0, useTls: false, grpcSerialization: 'text' });
    const serverResult = await server.connect();
    const client = createGrpcClientTransport({ ip: '127.0.0.1', port: serverResult.address.port, useTls: false, grpcSerialization: 'text' });
    await client.connect();
    await client.disconnect();
    await server.disconnect();
    return client.isConnected() === false;
  });

  // --- Test 5: Text serialization end-to-end ---
  console.log('\n--- Test 5: Text serialization end-to-end ---');
  await runTest('Text format: client sends CSV line, server receives it', async () => {
    let receivedData = null;
    const server = createGrpcServerTransport({
      ip: '127.0.0.1', port: 0, useTls: false, grpcSerialization: 'text',
      onData: (text) => { receivedData = text; },
    });
    const serverResult = await server.connect();
    const serverPort = serverResult.address.port;

    const client = createGrpcClientTransport({ ip: '127.0.0.1', port: serverPort, useTls: false, grpcSerialization: 'text' });
    await client.connect();

    const sendResult = await client.send('sensor-001,37.5,-122.4,98.6');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await client.disconnect();
    await server.disconnect();
    return sendResult.delivered === true && receivedData === 'sensor-001,37.5,-122.4,98.6';
  });

  // --- Test 6: Kryo serialization end-to-end ---
  console.log('\n--- Test 6: Kryo serialization end-to-end ---');
  await runTest('Kryo format: client sends data, server receives it', async () => {
    let receivedData = null;
    const server = createGrpcServerTransport({
      ip: '127.0.0.1', port: 0, useTls: false, grpcSerialization: 'kryo',
      onData: (text) => { receivedData = text; },
    });
    const serverResult = await server.connect();
    const serverPort = serverResult.address.port;

    const client = createGrpcClientTransport({ ip: '127.0.0.1', port: serverPort, useTls: false, grpcSerialization: 'kryo' });
    await client.connect();

    const sendResult = await client.send('vehicle-42,-117.19,34.05');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await client.disconnect();
    await server.disconnect();
    return sendResult.delivered === true && receivedData === 'vehicle-42,-117.19,34.05';
  });

  // --- Test 7: Disconnect cleanup ---
  console.log('\n--- Test 7: Disconnect cleanup ---');
  await runTest('GrpcClientTransport.isConnected returns false after disconnect', async () => {
    const server = new GrpcServerTransport({ ip: '127.0.0.1', port: 0 , useTls: false});
    const serverResult = await server.connect();
    const serverPort = serverResult.address.port;

    const client = new GrpcClientTransport({ ip: '127.0.0.1', port: serverPort , useTls: false});
    await client.connect();
    await client.disconnect();
    await server.disconnect();
    return client.isConnected() === false;
  });

  await runTest('GrpcServerTransport.isConnected returns false after disconnect', async () => {
    const server = new GrpcServerTransport({ ip: '127.0.0.1', port: 0 , useTls: false});
    await server.connect();
    await server.disconnect();
    return server.isConnected() === false;
  });

  // --- Test 8: Connection failure handling ---
  console.log('\n--- Test 8: Connection failure handling ---');
  await runTest('GrpcClientTransport rejects when server is not running', async () => {
    const client = new GrpcClientTransport({ ip: '127.0.0.1', port: 19999 , useTls: false});
    try {
      await client.connect();
      return false; // should have thrown
    } catch (error) {
      return error.message.includes('failed to connect');
    }
  });

  // --- Test 9: Factory function validation ---
  console.log('\n--- Test 9: Factory function validation ---');
  await runTest('createGrpcClientTransport with invalid serialization throws', async () => {
    try {
      createGrpcClientTransport({ ip: '127.0.0.1', port: 50051, useTls: false, grpcSerialization: 'invalid' });
      return false;
    } catch (error) {
      return error.message.includes('Unknown gRPC serialization format');
    }
  });

  await runTest('SERIALIZATION_FORMATS has all three values', async () => {
    return SERIALIZATION_FORMATS.PROTOBUF === 'protobuf' &&
      SERIALIZATION_FORMATS.KRYO === 'kryo' &&
      SERIALIZATION_FORMATS.TEXT === 'text';
  });

  // --- Test 11: tlsInfo in server connect result ---
  console.log('\n--- Test 11: tlsInfo in server connect result ---');
  await runTest('GrpcServerTransportProtobuf connect result includes tlsInfo when useTls=false', async () => {
    const server = createGrpcServerTransport({ ip: '127.0.0.1', port: 0, useTls: false, grpcSerialization: 'protobuf' });
    const result = await server.connect();
    await server.disconnect();
    return typeof result.tlsInfo === 'string' && result.tlsInfo.includes('tls=off');
  });

  await runTest('GrpcServerTransportInternal (text) connect result includes tlsInfo when useTls=false', async () => {
    const server = createGrpcServerTransport({ ip: '127.0.0.1', port: 0, useTls: false, grpcSerialization: 'text' });
    const result = await server.connect();
    await server.disconnect();
    return typeof result.tlsInfo === 'string' && result.tlsInfo.includes('tls=off');
  });

  await runTest('GrpcServerTransportInternal (kryo) connect result includes tlsInfo when useTls=false', async () => {
    const server = createGrpcServerTransport({ ip: '127.0.0.1', port: 0, useTls: false, grpcSerialization: 'kryo' });
    const result = await server.connect();
    await server.disconnect();
    return typeof result.tlsInfo === 'string' && result.tlsInfo.includes('tls=off');
  });

  await runTest('GrpcClientTransportProtobuf connect result includes tlsInfo when useTls=false', async () => {
    const server = createGrpcServerTransport({ ip: '127.0.0.1', port: 0, useTls: false, grpcSerialization: 'protobuf' });
    const serverResult = await server.connect();
    const client = createGrpcClientTransport({ ip: '127.0.0.1', port: serverResult.address.port, useTls: false, grpcSerialization: 'protobuf' });
    const result = await client.connect();
    await client.disconnect();
    await server.disconnect();
    return typeof result.tlsInfo === 'string' && result.tlsInfo.includes('tls=off');
  });

  await runTest('buildServerCredentials throws with helpful message when cert/key missing (useTls=true)', async () => {
    const server = createGrpcServerTransport({ ip: '127.0.0.1', port: 0, useTls: true, grpcSerialization: 'protobuf' });
    try {
      await server.connect();
      return false; // should have thrown
    } catch (error) {
      return error.message.includes('tlsCertPath') &&
        error.message.includes('tlsKeyPath') &&
        error.message.includes('OS/system certificates cannot be used as a fallback');
    }
  });

  await runTest('GrpcServerTransportInternal.isConnected returns false after disconnect', async () => {
    const server = createGrpcServerTransport({ ip: '127.0.0.1', port: 0, useTls: false, grpcSerialization: 'text' });
    await server.connect();
    await server.disconnect();
    return server.isConnected() === false;
  });

  await runTest('GrpcServerTransportInternal (kryo).isConnected returns false after disconnect', async () => {
    const server = createGrpcServerTransport({ ip: '127.0.0.1', port: 0, useTls: false, grpcSerialization: 'kryo' });
    await server.connect();
    await server.disconnect();
    return server.isConnected() === false;
  });

  // --- Test 10: gRPC header path metadata ---
  console.log('\n--- Test 10: gRPC header path metadata ---');
  await runTest('GrpcClientTransportProtobuf builds metadata with custom headerPathKey and headerPath', async () => {
    const server = createGrpcServerTransport({ ip: '127.0.0.1', port: 0, useTls: false, grpcSerialization: 'protobuf' });
    const serverResult = await server.connect();
    const serverPort = serverResult.address.port;

    const client = createGrpcClientTransport({
      ip: '127.0.0.1', port: serverPort, useTls: false, grpcSerialization: 'protobuf',
      headerPathKey: 'x-custom-header', headerPath: 'test.feed.uid',
    });
    await client.connect();
    const metadata = client._buildMetadata();
    const value = metadata.get('x-custom-header');
    await client.disconnect();
    await server.disconnect();
    return Array.isArray(value) && value[0] === 'test.feed.uid';
  });

  await runTest('GrpcClientTransportInternal builds metadata with custom headerPathKey and headerPath', async () => {
    const server = createGrpcServerTransport({ ip: '127.0.0.1', port: 0, useTls: false, grpcSerialization: 'text' });
    const serverResult = await server.connect();
    const serverPort = serverResult.address.port;

    const client = createGrpcClientTransport({
      ip: '127.0.0.1', port: serverPort, useTls: false, grpcSerialization: 'text',
      headerPathKey: 'grpc-path', headerPath: 'my.dedicated.uid',
    });
    await client.connect();
    const metadata = client._buildMetadata();
    const value = metadata.get('grpc-path');
    await client.disconnect();
    await server.disconnect();
    return Array.isArray(value) && value[0] === 'my.dedicated.uid';
  });

  await runTest('GrpcClientTransportProtobuf uses default headerPathKey and headerPath when not provided', async () => {
    const server = createGrpcServerTransport({ ip: '127.0.0.1', port: 0, useTls: false, grpcSerialization: 'protobuf' });
    const serverResult = await server.connect();
    const serverPort = serverResult.address.port;

    const client = createGrpcClientTransport({ ip: '127.0.0.1', port: serverPort, useTls: false, grpcSerialization: 'protobuf' });
    await client.connect();
    const metadata = client._buildMetadata();
    const value = metadata.get('grpc-path');
    await client.disconnect();
    await server.disconnect();
    return Array.isArray(value) && value[0] === 'replace.with.dedicated.uid';
  });

  await runTest('End-to-end: protobuf client with custom header sends data successfully', async () => {
    let receivedData = null;
    const server = createGrpcServerTransport({
      ip: '127.0.0.1', port: 0, useTls: false, grpcSerialization: 'protobuf',
      onData: (csv) => { receivedData = csv; },
    });
    const serverResult = await server.connect();
    const serverPort = serverResult.address.port;

    const client = createGrpcClientTransport({
      ip: '127.0.0.1', port: serverPort, useTls: false, grpcSerialization: 'protobuf',
      headerPathKey: 'grpc-path', headerPath: 'test.feed.uid',
    });
    await client.connect();
    const sendResult = await client.send('alpha,1,true');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await client.disconnect();
    await server.disconnect();
    return sendResult.delivered === true && receivedData === 'alpha,1,true';
  });

  // --- Results ---
  console.log(`\n=== Test Results ===`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runGrpcTransportTests().catch((error) => {
    console.error('Test suite error:', error);
    process.exit(1);
  });
}

module.exports = { runGrpcTransportTests };
