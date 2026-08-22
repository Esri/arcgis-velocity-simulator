const crypto = require('crypto');
const net = require('net');
const tls = require('tls');
const { StringDecoder } = require('string_decoder');
const {
  TLS_POLICIES,
  RESOURCE_CONFLICT_POLICIES,
  XmppServerCore,
} = require('../src/xmpp-server-core');
const {
  XmppClientCore,
  isLoopback,
} = require('../src/xmpp-client-core');
const { generateSelfSignedCert } = require('../src/tls-utils');
const { createScramSha1Mechanism } = require('../src/xmpp-sasl-server');
const { createAccountStore } = require('../src/xmpp-accounts');
const {
  STREAM_MANAGEMENT_SUPPORT,
  XMPP_DEFAULT_RECONNECT_DELAY_MS,
  XMPP_DEFAULT_RESOURCE,
} = require('../src/xmpp-constants');
const { xml } = require('@xmpp/client');

let passed = 0;
let failed = 0;
let clientCounter = 0;

async function test(name, callback) {
  try {
    await callback();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`❌ ${name}: ${error.stack || error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function once(emitter, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeout);
    const onEvent = (...args) => {
      cleanup();
      resolve(args);
    };
    const cleanup = () => {
      clearTimeout(timer);
      emitter.removeListener(event, onEvent);
    };
    emitter.once(event, onEvent);
  });
}

async function connectRaw(serverResult) {
  const socket = net.connect(serverResult.address.port, '127.0.0.1');
  const decoder = new StringDecoder('utf8');
  let received = '';
  const waiters = new Set();
  socket.on('data', (chunk) => {
    received += decoder.write(chunk);
    for (const waiter of [...waiters]) {
      const match = received.slice(waiter.offset).match(waiter.pattern);
      if (!match) continue;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(match);
    }
  });
  socket.on('error', () => {});
  await once(socket, 'connect');
  return {
    socket,
    get received() {
      return received;
    },
    waitFor(pattern, timeout = 3000) {
      const offset = received.length;
      return new Promise((resolve, reject) => {
        const waiter = {
          offset,
          pattern,
          resolve,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(`Timed out waiting for raw XMPP pattern ${pattern}`));
          }, timeout),
        };
        waiters.add(waiter);
      });
    },
    close() {
      socket.destroy();
    },
  };
}

async function openRawStream(raw) {
  const features = raw.waitFor(/<stream:features[\s\S]*?<\/stream:features>/);
  raw.socket.write(
    '<stream:stream to="localhost" xmlns="jabber:client" ' +
    'xmlns:stream="http://etherx.jabber.org/streams" version="1.0">',
  );
  return features;
}

async function closeClient(client) {
  if (!client) return;
  client.entity.reconnect.stop();
  try {
    await client.close();
  } catch (_) {
    // Authentication and deliberate resource-conflict tests can close first.
  }
}

async function makeClient(serverResult, overrides = {}) {
  const client = new XmppClientCore({
    service: `xmpp://127.0.0.1:${serverResult.address.port}`,
    domain: 'localhost',
    username: 'external',
    password: 'external-secret',
    resource: `test-${clientCounter += 1}`,
    tlsPolicy: serverResult.tlsPolicy,
    ...overrides,
  });
  client.on('error', () => {});
  await client.connect();
  return client;
}

async function run() {
  console.log('\n=== XMPP Core Tests ===');

  await test('failed sends cancel timeout-backed stanza waiters', async () => {
    const client = new XmppClientCore({
      service: 'xmpp://127.0.0.1:5222',
      domain: 'localhost',
      username: 'external',
      password: 'external-secret',
      timeout: 20,
    });
    const initialNonzaListeners = client.entity.listenerCount('nonza');
    const unhandledRejections = [];
    const onUnhandledRejection = (error) => unhandledRejections.push(error);
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      let joinRejected = false;
      try {
        await client.joinMuc('room@conference.localhost', 'logger');
      } catch (_) {
        joinRejected = true;
      }
      assert(joinRejected, 'joining while disconnected should reject when send fails');
      assert(client.waiters.size === 0, 'failed MUC send should remove its stanza waiter');

      let ackRejected = false;
      try {
        await client.requestServerAck();
      } catch (_) {
        ackRejected = true;
      }
      assert(ackRejected, 'requesting an acknowledgement while disconnected should reject when send fails');
      assert(client.entity.listenerCount('nonza') === initialNonzaListeners,
        'failed acknowledgement send should remove its nonza waiter');

      await delay(60);
      assert(unhandledRejections.length === 0,
        'cancelled send waiters must not reject after their timeout');
      assert(client.waiters.size === 0, 'cancelled stanza waiters must not be retained');
      assert(client.entity.listenerCount('nonza') === initialNonzaListeners,
        'cancelled nonza waiters must not be retained');
    } finally {
      process.removeListener('unhandledRejection', onUnhandledRejection);
    }
  });

  await test('loopback-safe default rejects accidental remote binding', async () => {
    assert(isLoopback('127.0.0.1') && isLoopback('::1') && isLoopback('localhost'),
      'expected loopback hosts to be recognized');
    assert(!isLoopback('192.0.2.10'), 'remote host must not be recognized as loopback');
    let rejected = false;
    try {
      new XmppServerCore({ host: '0.0.0.0' });
    } catch (error) {
      rejected = error.message.includes('allowRemote');
    }
    assert(rejected, 'remote server binding should require explicit opt-in');
    rejected = false;
    try {
      new XmppClientCore({
        service: 'xmpp://192.0.2.10:5222',
        domain: 'example.test',
        username: 'u',
        password: 'p',
        rejectUnauthorized: false,
      });
    } catch (error) {
      rejected = error.message.includes('loopback');
    }
    assert(rejected, 'verification bypass should be limited to loopback');
    rejected = false;
    try {
      new XmppServerCore({ resourceConflict: 'conflict' });
    } catch (error) {
      rejected = error.message.includes('resource conflict');
    }
    assert(rejected, 'legacy conflict policy must not be accepted');
  });

  await test('required STARTTLS rejects malicious pre-TLS SCRAM without a challenge', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.REQUIRED,
      externalAccount: { username: 'external', password: 'external-secret' },
    });

    const result = await server.listen();
    const raw = await connectRaw(result);
    try {
      const features = await openRawStream(raw);
      assert(!features[0].includes('<mechanisms'), 'required pre-TLS features must not advertise SASL');
      const closed = once(raw.socket, 'close');
      const initial = Buffer.from('n,,n=external,r=attacker-nonce').toString('base64');
      raw.socket.write(
        `<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="SCRAM-SHA-1">${initial}</auth>`,
      );
      await closed;
      assert(raw.received.includes('encryption-required'), 'pre-TLS SCRAM should fail for encryption');
      assert(!raw.received.includes('<challenge'), 'server must not start SCRAM before required TLS');
    } finally {
      raw.close();
      await server.close();
    }
  });

  await test('required client aborts before SASL when STARTTLS is unavailable', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    let authentications = 0;
    server.on('authenticated', () => { authentications += 1; });
    // Counting <auth/> elements at the server proves the credential never
    // reached the wire, not merely that authentication did not succeed.
    let authElements = 0;
    const originalAuthenticate = server._authenticate.bind(server);
    server._authenticate = (...args) => {
      authElements += 1;
      return originalAuthenticate(...args);
    };
    const client = new XmppClientCore({
      service: `xmpp://127.0.0.1:${result.address.port}`,
      domain: 'localhost',
      username: 'external',
      password: 'external-secret',
      tlsPolicy: TLS_POLICIES.REQUIRED,
    });
    client.on('error', () => {});
    let rejected = false;
    try {
      await client.connect();
    } catch (error) {
      rejected = /STARTTLS is required.*SASL was not attempted/i.test(error.message);
    } finally {
      await closeClient(client);
      await server.close();
    }
    assert(rejected, 'required policy should fail with an actionable pre-SASL error');
    assert(authentications === 0, 'server must not observe a SASL authentication attempt');
    assert(authElements === 0, 'no <auth/> element may reach the server, so no credential is sent');
  });

  await test('the canonical reconnect delay replaces the xmpp.js one-second retry', async () => {
    const client = new XmppClientCore({
      service: 'xmpp://127.0.0.1:5222',
      domain: 'localhost',
      username: 'external',
      password: 'external-secret',
      tlsPolicy: TLS_POLICIES.DISABLED,
    });
    client.entity.reconnect.stop();
    assert(client.getReconnectDelayMs() === XMPP_DEFAULT_RECONNECT_DELAY_MS,
      'the default reconnect delay should be the canonical 60000ms, not the library default');

    const explicit = new XmppClientCore({
      service: 'xmpp://127.0.0.1:5222',
      domain: 'localhost',
      username: 'external',
      password: 'external-secret',
      tlsPolicy: TLS_POLICIES.DISABLED,
      reconnectDelayMs: 250,
    });
    explicit.entity.reconnect.stop();
    assert(explicit.getReconnectDelayMs() === 250, 'an explicit reconnect delay should be applied');

    for (const invalid of [0, -1, 1.5, '60000', null]) {
      let rejected = false;
      try {
        new XmppClientCore({
          service: 'xmpp://127.0.0.1:5222',
          domain: 'localhost',
          username: 'external',
          password: 'external-secret',
          reconnectDelayMs: invalid,
        }).entity.reconnect.stop();
      } catch (error) {
        rejected = /reconnectDelayMs.*millisecond or more/i.test(error.message);
      }
      assert(rejected, `reconnectDelayMs=${String(invalid)} must be rejected`);
    }
  });

  await test('inbound direct messages are filtered to chat-only in both directions', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    result.tlsPolicy = TLS_POLICIES.DISABLED;
    let client;
    const inbound = [];
    try {
      client = await makeClient(result);
      server.on('message', (event) => inbound.push(event));

      // Server route: a non-chat body addressed to the application identity is
      // refused with an actionable stanza error instead of being replayed.
      const errorReply = client.waitFor((stanza) => stanza.name === 'message' &&
        stanza.attrs.type === 'error');
      await client.entity.send(xml('message', {
        type: 'normal',
        to: `velocity-simulator@${result.domain || 'localhost'}`,
      }, xml('body', {}, 'normal must not be replayed')));
      const rejection = await errorReply;
      assert(Boolean(rejection.getChild('error')?.getChild('bad-request')),
        'a non-chat direct message should be refused with bad-request');
      assert(inbound.length === 0, 'a non-chat direct message must never surface as inbound data');

      // Client route: the same filter applies to anything a third-party server
      // sends, so an unrelated headline or notice is not treated as data.
      const surfaced = [];
      client.on('chat', (message) => surfaced.push(message));
      for (const type of ['normal', 'headline', undefined]) {
        client._onStanza(xml('message', {
          ...(type ? { type } : {}),
          from: 'notices@localhost',
        }, xml('body', {}, `${type || 'untyped'} body`)));
      }
      assert(surfaced.length === 0, 'only type=chat may be surfaced as inbound direct data');
      client._onStanza(xml('message', { type: 'chat', from: 'peer@localhost' },
        xml('body', {}, 'chat body')));
      assert(surfaced.length === 1 && surfaced[0].body === 'chat body',
        'a genuine chat body must still be surfaced');
    } finally {
      await closeClient(client);
      await server.close();
    }
  });

  await test('account, domain, and JID matching are canonicalized', async () => {
    let collisionRejected = false;
    try {
      createAccountStore({
        domain: 'Example.TEST',
        internalAppUsername: 'Velocity-Simulator',
        externalAccount: { username: 'VELOCITY-SIMULATOR', password: 'secret' },
      });
    } catch (error) {
      collisionRejected = /must differ/i.test(error.message);
    }
    assert(collisionRejected, 'mixed-case external account must not shadow the reserved identity');

    const server = new XmppServerCore({
      domain: 'Example.TEST',
      tlsPolicy: TLS_POLICIES.DISABLED,
      externalAccount: { username: 'Receiver', password: 'external-secret' },
    });
    const result = await server.listen();
    let client;
    try {
      client = new XmppClientCore({
        service: `xmpp://127.0.0.1:${result.address.port}`,
        domain: 'EXAMPLE.TEST',
        username: 'RECEIVER',
        password: 'external-secret',
        tlsPolicy: TLS_POLICIES.DISABLED,
      });
      client.on('error', () => {});
      await client.connect();
      assert(client.jid.startsWith(`receiver@example.test/${XMPP_DEFAULT_RESOURCE}`),
        'bound JID should use canonical account and domain values with the shared default resource');
    } finally {
      await closeClient(client);
      await server.close();
    }
  });

  await test('inline and path TLS certificate/key sources require pairs', async () => {
    for (const options of [
      { tlsCert: 'certificate-only' },
      { tlsKey: 'key-only' },
      { tlsCertPath: __filename },
      { tlsKeyPath: __filename },
    ]) {
      const server = new XmppServerCore(options);
      let rejected = false;
      try {
        await server.listen();
      } catch (error) {
        rejected = /both tlsCert.*tlsKey/i.test(error.message);
      } finally {
        await server.close();
      }
      assert(rejected, `unpaired TLS source should be rejected: ${Object.keys(options)[0]}`);
    }
  });
  await test('unknown SCRAM usernames receive a normal challenge and fail only at proof validation', async () => {
    const fixed = {
      iterations: 4096,
      salt: Buffer.from('0123456789abcdef'),
      serverNonce: 'server-nonce',
    };
    const known = createScramSha1Mechanism({
      lookupPassword: () => 'secret',
      ...fixed,
    });
    const unknown = createScramSha1Mechanism({
      lookupPassword: () => null,
      ...fixed,
    });
    const knownStart = known.start('n,,n=known,r=client-nonce');
    const unknownStart = unknown.start('n,,n=missing,r=client-nonce');
    assert(knownStart.status === 'challenge' && unknownStart.status === 'challenge',
      'known and unknown users must both receive challenges');
    assert(knownStart.payload === unknownStart.payload,
      'fixed SCRAM challenge shape must not reveal whether an account exists');
    const invalidFinal = `c=biws,r=client-nonceserver-nonce,p=${Buffer.alloc(20).toString('base64')}`;
    const result = unknown.next(invalidFinal);
    assert(result.status === 'failure' && result.condition === 'not-authorized',
      'unknown account must fail during proof validation');

    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      externalAccount: { username: 'known', password: 'secret' },
    });
    const serverResult = await server.listen();
    const raw = await connectRaw(serverResult);
    try {
      await openRawStream(raw);
      const challengePromise = raw.waitFor(/<challenge[^>]*>([^<]+)<\/challenge>/);
      const first = Buffer.from('n,,n=missing,r=wire-client-nonce').toString('base64');
      raw.socket.write(
        `<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="SCRAM-SHA-1">${first}</auth>`,
      );
      const challengeMatch = await challengePromise;
      const challenge = Buffer.from(challengeMatch[1], 'base64').toString('utf8');
      assert(/^r=wire-client-nonce.+,s=[A-Za-z0-9+/]+=*,i=4096$/.test(challenge),
        'unknown account should receive a well-formed SCRAM challenge on the wire');
      const nonce = challenge.match(/^r=([^,]+)/)[1];
      const failed = raw.waitFor(/<failure[\s\S]*?<not-authorized\/>[\s\S]*?<\/failure>/);
      const final = `c=biws,r=${nonce},p=${Buffer.alloc(20).toString('base64')}`;
      raw.socket.write(
        `<response xmlns="urn:ietf:params:xml:ns:xmpp-sasl">${Buffer.from(final).toString('base64')}</response>`,
      );
      await failed;
    } finally {
      raw.close();
      await server.close();
    }
  });

  await test('per-connection limit bounds repeated initial SCRAM challenges', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      maxAuthAttemptsPerConnection: 2,
      authAttempts: 10,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    const raw = await connectRaw(result);
    try {
      await openRawStream(raw);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const challenge = raw.waitFor(/<challenge[^>]*>[^<]+<\/challenge>/);
        const initial = Buffer.from(`n,,n=external,r=repeated-${attempt}`).toString('base64');
        raw.socket.write(
          `<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="SCRAM-SHA-1">${initial}</auth>`,
        );
        await challenge;
        const failed = raw.waitFor(/<failure[\s\S]*?<malformed-request\/>[\s\S]*?<\/failure>/);
        raw.socket.write('<response xmlns="urn:ietf:params:xml:ns:xmpp-sasl">=</response>');
        await failed;
      }

      const limited = raw.waitFor(
        /<failure[\s\S]*?<temporary-auth-failure\/>[\s\S]*?<\/failure>/,
      );
      const third = Buffer.from('n,,n=external,r=repeated-2').toString('base64');
      raw.socket.write(
        `<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="SCRAM-SHA-1">${third}</auth>`,
      );
      await limited;
      assert((raw.received.match(/<challenge/g) || []).length === 2,
        'attempts beyond the per-connection limit must not derive another SCRAM challenge');
    } finally {
      raw.close();
      await server.close();
    }
  });

  await test('a second auth stanza cannot replace an active SCRAM exchange', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      authAttempts: 10,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    const raw = await connectRaw(result);
    try {
      await openRawStream(raw);
      const firstChallenge = raw.waitFor(/<challenge[^>]*>[^<]+<\/challenge>/);
      const first = Buffer.from('n,,n=external,r=original-nonce').toString('base64');
      raw.socket.write(
        `<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="SCRAM-SHA-1">${first}</auth>`,
      );
      await firstChallenge;
      const connection = [...server.connections][0];
      const rejected = raw.waitFor(
        /<failure[\s\S]*?<malformed-request\/>[\s\S]*?<\/failure>/,
      );
      const replacement = Buffer.from('n,,n=external,r=replacement-nonce').toString('base64');
      raw.socket.write(
        `<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="SCRAM-SHA-1">${replacement}</auth>`,
      );
      await rejected;
      assert(connection.sasl === null && connection.authInitiations === 1,
        'the replacement must be rejected without becoming a new active exchange');
      assert((raw.received.match(/<challenge/g) || []).length === 1,
        'a replacement auth stanza must not trigger another PBKDF2 challenge');
    } finally {
      raw.close();
      await server.close();
    }
  });

  await test('an active SCRAM derivation reserves the per-address rate budget', async () => {
    const originalPbkdf2Sync = crypto.pbkdf2Sync;
    let derivations = 0;
    crypto.pbkdf2Sync = (...args) => {
      derivations += 1;
      return originalPbkdf2Sync(...args);
    };
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      authAttempts: 1,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    const firstRaw = await connectRaw(result);
    const secondRaw = await connectRaw(result);
    try {
      await openRawStream(firstRaw);
      await openRawStream(secondRaw);
      const challenge = firstRaw.waitFor(/<challenge[^>]*>[^<]+<\/challenge>/);
      const first = Buffer.from('n,,n=external,r=rate-first').toString('base64');
      firstRaw.socket.write(
        `<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="SCRAM-SHA-1">${first}</auth>`,
      );
      await challenge;

      const limited = secondRaw.waitFor(
        /<failure[\s\S]*?<temporary-auth-failure\/>[\s\S]*?<\/failure>/,
      );
      const second = Buffer.from('n,,n=external,r=rate-second').toString('base64');
      secondRaw.socket.write(
        `<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="SCRAM-SHA-1">${second}</auth>`,
      );
      await limited;
      assert(derivations === 1, 'rate limiting must happen before a second PBKDF2 derivation');
    } finally {
      crypto.pbkdf2Sync = originalPbkdf2Sync;
      firstRaw.close();
      secondRaw.close();
      await server.close();
    }
  });

  await test('STARTTLS options are isolated per client and never replace node tls.connect', async () => {
    const originalTlsConnect = tls.connect;
    const certA = generateSelfSignedCert({ force: true, hostname: 'localhost', ip: '127.0.0.1' });
    const certB = generateSelfSignedCert({ force: true, hostname: 'localhost', ip: '127.0.0.1' });
    const servers = [certA, certB].map((pems) => new XmppServerCore({
      tlsCert: pems.cert,
      tlsKey: pems.private,
      externalAccount: { username: 'external', password: 'external-secret' },
    }));
    const results = await Promise.all(servers.map((server) => server.listen()));
    let clients = [];
    try {
      clients = results.map((result, index) => new XmppClientCore({
        service: `xmpp://127.0.0.1:${result.address.port}`,
        domain: 'localhost',
        username: 'external',
        password: 'external-secret',
        resource: `concurrent-${index}`,
        ca: index === 0 ? certA.cert : certB.cert,
      }));
      clients.forEach((xmppClient) => xmppClient.on('error', () => {}));
      await Promise.all(clients.map((xmppClient) => xmppClient.connect()));
      assert(clients.every((xmppClient) => xmppClient.isSecure()),
        'concurrent clients should use their own CA option');
      assert(tls.connect === originalTlsConnect, 'XMPP client must not monkey patch node tls.connect');
    } finally {
      await Promise.all(clients.map(closeClient));
      await Promise.all(servers.map((server) => server.close()));
    }
  });

  for (const tlsPolicy of [
    TLS_POLICIES.REQUIRED,
    TLS_POLICIES.PREFERRED,
    TLS_POLICIES.DISABLED,
  ]) {
    await test(`TCP negotiation, ${tlsPolicy} STARTTLS policy, authentication, and clean close`, async () => {
      const server = new XmppServerCore({
        tlsPolicy,
        externalAccount: { username: 'external', password: 'external-secret' },
      });
      const result = await server.listen();
      let client;
      try {
        client = await makeClient(result, {
          mechanism: tlsPolicy === TLS_POLICIES.REQUIRED ? 'PLAIN' : 'SCRAM-SHA-1',
          ...(tlsPolicy === TLS_POLICIES.REQUIRED ? { ca: result.selfSignedCertificate } : {}),
          ...(tlsPolicy === TLS_POLICIES.PREFERRED ? { rejectUnauthorized: false } : {}),
        });
        assert(client.isOnline(), 'client should reach online state');
        assert(client.isSecure() === (tlsPolicy !== TLS_POLICIES.DISABLED),
          'transport security should match policy');
        assert(server.getBoundJids().includes(client.jid), 'server should bind client resource');
        await client.close();
        client = null;
        await delay(20);
        assert(server.getConnectionCount() === 0, 'clean close should remove server connection');
      } finally {
        await closeClient(client);
        await server.close();
      }
    });
  }

  await test('automatic certificate is rejected unless CA or explicit local bypass is supplied', async () => {
    const server = new XmppServerCore({
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    const client = new XmppClientCore({
      service: `xmpp://127.0.0.1:${result.address.port}`,
      domain: 'localhost',
      username: 'external',
      password: 'external-secret',
    });
    client.on('error', () => {});
    let rejected = false;
    try {
      await client.connect();
    } catch (error) {
      rejected = /certificate|self-signed/i.test(error.message);
    } finally {
      await closeClient(client);
      await server.close();
    }
    assert(rejected, 'certificate verification should remain enabled by default');
  });

  await test('server accepts supplied in-memory PEM certificate and key', async () => {
    const pems = generateSelfSignedCert({ force: true, hostname: 'localhost', ip: '127.0.0.1' });
    const server = new XmppServerCore({
      tlsCert: pems.cert,
      tlsKey: pems.private,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    let client;
    try {
      client = await makeClient(result, { ca: pems.cert, mechanism: 'PLAIN' });
      assert(client.isSecure(), 'supplied PEM should secure STARTTLS');
      assert(result.tlsInfo.includes('supplied PEM'), 'TLS metadata should identify supplied PEM');
    } finally {
      await closeClient(client);
      await server.close();
    }
  });

  await test('SASL authentication failure and per-address attempt limiting', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      authAttempts: 1,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    const bad = new XmppClientCore({
      service: `xmpp://127.0.0.1:${result.address.port}`,
      domain: 'localhost',
      username: 'external',
      password: 'wrong-secret',
      mechanism: 'SCRAM-SHA-1',
      tlsPolicy: TLS_POLICIES.DISABLED,
    });
    bad.on('error', () => {});
    let firstRejected = false;
    try {
      await bad.connect();
    } catch (error) {
      firstRejected = /not-authorized/i.test(error.message);
    }
    await closeClient(bad);

    const limited = new XmppClientCore({
      service: `xmpp://127.0.0.1:${result.address.port}`,
      domain: 'localhost',
      username: 'external',
      password: 'external-secret',
      mechanism: 'SCRAM-SHA-1',
      tlsPolicy: TLS_POLICIES.DISABLED,
    });
    limited.on('error', () => {});
    let limitedRejected = false;
    try {
      await limited.connect();
    } catch (error) {
      limitedRejected = /temporary-auth-failure/i.test(error.message);
    }
    await closeClient(limited);
    await server.close();
    assert(firstRejected, 'bad password should fail authentication');
    assert(limitedRejected, 'rate limiter should reject subsequent attempt in the window');
  });

  await test('successful SCRAM authentication refunds its provisional rate charge', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      authAttempts: 1,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    let first;
    let second;
    try {
      first = await makeClient(result, { mechanism: 'SCRAM-SHA-1' });
      await closeClient(first);
      first = null;
      second = await makeClient(result, { mechanism: 'SCRAM-SHA-1' });
      assert(second.isOnline(), 'a prior successful SCRAM exchange must not consume the address budget');
    } finally {
      await closeClient(first);
      await closeClient(second);
      await server.close();
    }
  });

  await test('one external account and the generated internal app identity authenticate', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    let external;
    let internal;
    try {
      external = await makeClient(result, { mechanism: 'SCRAM-SHA-1' });
      internal = await makeClient(result, {
        username: server.internalAccount.username,
        password: server.internalAccount.password,
        mechanism: 'SCRAM-SHA-1',
      });
      assert(external.jid.startsWith('external@'), 'external identity should bind');
      assert(internal.jid.startsWith(`${server.internalAccount.username}@`), 'internal identity should bind');
    } finally {
      await closeClient(external);
      await closeClient(internal);
      await server.close();
    }
  });

  await test('direct chat bodies route in both directions', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      externalAccount: { username: 'external', password: 'external-secret' },
      internalAccount: { username: 'app', password: 'app-secret' },
    });

    const result = await server.listen();
    let external;
    let app;
    try {
      external = await makeClient(result, { resource: 'logger' });
      app = await makeClient(result, {
        username: 'app',
        password: 'app-secret',
        resource: 'simulator',
      });
      const toApp = once(app, 'chat');
      await external.sendChat(app.jid, 'client to app');
      assert((await toApp)[0].body === 'client to app', 'app should receive exact body');
      const toExternal = once(external, 'chat');
      await app.sendChat(external.jid, 'app to client');
      assert((await toExternal)[0].body === 'app to client', 'external client should receive exact body');

      const rejected = once(external, 'messageError');
      await external.entity.send(require('@xmpp/xml').xml('message', {
        type: 'normal',
        to: app.jid,
      }, require('@xmpp/xml').xml('body', {}, 'must not route')));
      assert((await rejected)[0].condition === 'bad-request',
        'direct routing must accept only type=chat messages');
    } finally {
      await closeClient(external);
      await closeClient(app);
      await server.close();
    }
  });

  await test('UTF-8 split inside a multibyte code point is decoded without corruption', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      externalAccount: { username: 'external', password: 'external-secret' },
      internalAccount: { username: 'app', password: 'app-secret' },
    });
    const result = await server.listen();
    let sender;
    let recipient;
    try {
      sender = await makeClient(result, { resource: 'split-sender' });
      recipient = await makeClient(result, {
        username: 'app',
        password: 'app-secret',
        resource: 'split-recipient',
      });
      const received = once(recipient, 'chat');
      const stanza = Buffer.from(
        `<message type="chat" to="${recipient.jid}"><body>split 🌍 payload</body></message>`,
        'utf8',
      );
      const emoji = Buffer.from('🌍');
      const emojiOffset = stanza.indexOf(emoji);
      assert(emojiOffset >= 0, 'test fixture must contain the multibyte character');
      sender.entity.socket.write(stanza.subarray(0, emojiOffset + 2));
      await delay(10);
      sender.entity.socket.write(stanza.subarray(emojiOffset + 2));
      assert((await received)[0].body === 'split 🌍 payload',
        'split UTF-8 character should survive TCP chunk boundaries');
    } finally {
      await closeClient(sender);
      await closeClient(recipient);
      await server.close();
    }
  });

  await test('resource replacement closes the old session and reject mode rejects duplicates', async () => {
    const replacementServer = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      resourceConflict: RESOURCE_CONFLICT_POLICIES.REPLACE,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const replacementResult = await replacementServer.listen();
    let first;
    let replacement;
    try {
      first = await makeClient(replacementResult, { resource: 'same' });
      first.entity.reconnect.stop();
      const disconnected = once(first.entity, 'disconnect');
      replacement = await makeClient(replacementResult, { resource: 'same' });
      await disconnected;
      assert(replacementServer.getBoundJids().length === 1, 'replacement should own the resource');
    } finally {
      await closeClient(first);
      await closeClient(replacement);
      await replacementServer.close();
    }

    const conflictServer = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      resourceConflict: RESOURCE_CONFLICT_POLICIES.REJECT,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const conflictResult = await conflictServer.listen();
    let owner;
    const duplicate = new XmppClientCore({
      service: `xmpp://127.0.0.1:${conflictResult.address.port}`,
      domain: 'localhost',
      username: 'external',
      password: 'external-secret',
      resource: 'same',
      tlsPolicy: TLS_POLICIES.DISABLED,
    });
    duplicate.on('error', () => {});
    let rejected = false;
    try {
      owner = await makeClient(conflictResult, { resource: 'same' });
      await duplicate.connect();
    } catch (error) {
      rejected = /conflict/i.test(error.message);
    } finally {
      await closeClient(duplicate);
      await closeClient(owner);
      await conflictServer.close();
    }
    assert(rejected, 'reject policy should reject duplicate resource');
  });

  await test('MUC password, nickname, no history, self echo, send, and leave', async () => {
    const room = 'velocity@conference.localhost';
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      externalAccount: { username: 'external', password: 'external-secret' },
      internalAccount: { username: 'app', password: 'app-secret' },
      roomPasswords: { [room]: 'room-secret' },
    });
    const result = await server.listen();
    let external;
    let app;
    try {
      external = await makeClient(result, { resource: 'logger' });
      app = await makeClient(result, {
        username: 'app',
        password: 'app-secret',
        resource: 'simulator',
      });
      const autoRoom = 'new-room@conference.localhost';
      const createdPresence = await external.joinMuc(autoRoom, 'creator');
      const createdStatuses = createdPresence
        .getChild('x', 'http://jabber.org/protocol/muc#user')
        .getChildren('status')
        .map((status) => status.attrs.code);
      assert(createdStatuses.includes('201'), 'newly auto-created room must include MUC status 201');
      await external.leaveMuc(autoRoom);
      let passwordCondition;
      try {
        await external.joinMuc(room, 'wrong-password', 'wrong');
      } catch (error) {
        passwordCondition = error.condition;
      }
      assert(passwordCondition === 'not-authorized',
        'joinMuc should immediately report not-authorized for a wrong room password');
      const configuredPresence = await external.joinMuc(room, 'logger', 'room-secret');
      const configuredStatuses = configuredPresence
        .getChild('x', 'http://jabber.org/protocol/muc#user')
        .getChildren('status')
        .map((status) => status.attrs.code);
      assert(!configuredStatuses.includes('201'), 'preconfigured room must not report new creation');
      let nicknameCondition;
      try {
        await app.joinMuc(room, 'logger', 'room-secret');
      } catch (error) {
        nicknameCondition = error.condition;
      }
      assert(nicknameCondition === 'conflict',
        'joinMuc should immediately report conflict for an occupied nickname');
      const existingPresence = await app.joinMuc(room, 'simulator', 'room-secret');
      const existingStatuses = existingPresence
        .getChild('x', 'http://jabber.org/protocol/muc#user')
        .getChildren('status')
        .map((status) => status.attrs.code);
      assert(!existingStatuses.includes('201'), 'existing room join must not include MUC status 201');
      const selfEcho = once(external, 'mucMessage');
      const peerMessage = once(app, 'mucMessage');
      await external.sendMuc(room, 'feature payload');
      const self = (await selfEcho)[0];
      const peer = (await peerMessage)[0];
      assert(self.self && self.nickname === 'logger', 'sender should identify its self echo');
      assert(peer.body === 'feature payload' && !peer.self, 'peer should receive group message');
      assert(!Object.hasOwn(server.muc.getRoom(room), 'history'), 'server should not retain room history');
      const left = once(server, 'mucLeave');
      await external.leaveMuc(room);
      await left;
      assert(!server.muc.getOccupants(room).some((occupant) => occupant.nick === 'logger'),
        'leave should remove occupant');
    } finally {
      await closeClient(external);
      await closeClient(app);
      await server.close();
    }
  });

  await test('XEP-0199 ping and basic XEP-0198 negotiation/ack work', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    let client;
    try {
      client = await makeClient(result);
      await delay(50);
      assert(client.entity.streamManagement.enabled, 'stream management should negotiate after binding');
      assert(STREAM_MANAGEMENT_SUPPORT.ackRequests &&
        !STREAM_MANAGEMENT_SUPPORT.resumption &&
        !STREAM_MANAGEMENT_SUPPORT.outboundReplay,
      'published XEP-0198 support must claim acknowledgements only, never resumption or replay');
      const ping = await client.ping();
      assert(ping.attrs.type === 'result', 'ping should receive IQ result');
      await client.entity.send(require('@xmpp/xml').xml('presence'));
      await client.sendChat(client.jid, 'count this message');
      const serverAck = await client.requestServerAck();
      assert(Number(serverAck.attrs.h) === 3,
        'server acknowledgement must count handled IQ, presence, and message stanzas');
      const session = [...server.connections][0];
      server._sendTracked(session, require('@xmpp/xml').xml('message', {
        from: 'server@localhost',
        to: client.jid,
        type: 'chat',
      }, require('@xmpp/xml').xml('body', {}, 'ack me')));
      server._send(session, require('@xmpp/xml').xml('r', { xmlns: 'urn:xmpp:sm:3' }));
      for (let i = 0; i < 20 && session.sm.lastAck === 0; i += 1) await delay(10);
      assert(session.sm.enabled && session.sm.lastAck > 0, 'client should acknowledge server stanza count');
    } finally {
      await closeClient(client);
      await server.close();
    }
  });

  await test('disconnect cleanup, reconnect, resource rebind, and automatic MUC rejoin work', async () => {
    const room = 'reconnect@conference.localhost';
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    let client;
    try {
      // A short explicit delay keeps the test fast and proves the canonical
      // reconnect delay is what actually drives xmpp.js's retry scheduling.
      client = await makeClient(result, { resource: 'stable', reconnectDelayMs: 200 });
      assert(client.getReconnectDelayMs() === 200, 'the configured reconnect delay should be in effect');
      await client.joinMuc(room, 'logger');
      const onlineAgain = once(client, 'online', 5000);
      const droppedAt = Date.now();
      await client.disconnectForReconnect();
      await onlineAgain;
      assert(Date.now() - droppedAt >= 200, 'the reconnect must wait out the configured delay');
      await delay(50);
      assert(client.onlineCount === 2, 'client should reconnect once');
      assert(server.getBoundJids().includes('external@localhost/stable'), 'resource should rebind');
      assert(server.muc.getOccupants(room).some((occupant) => occupant.nick === 'logger'),
        'tracked room should be rejoined');
    } finally {
      await closeClient(client);
      await server.close();
    }
  });

  await test('oversized and restricted XML are rejected and cleaned up', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      maxXmlBytes: 512,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    const socket = net.connect(result.address.port, '127.0.0.1');
    socket.resume();
    await once(socket, 'connect');
    const oversizedClosed = once(socket, 'close');
    socket.write(`<stream:stream to="localhost" xmlns="jabber:client" xmlns:stream="http://etherx.jabber.org/streams"><message><body>${'x'.repeat(1024)}`);
    await oversizedClosed;
    assert(server.getConnectionCount() === 0, 'oversized XML connection should be removed');

    const restricted = net.connect(result.address.port, '127.0.0.1');
    restricted.resume();
    await once(restricted, 'connect');
    const restrictedClosed = once(restricted, 'close');
    restricted.write('<!DOCTYPE foo><stream:stream to="localhost">');
    await restrictedClosed;
    assert(server.getConnectionCount() === 0, 'DOCTYPE connection should be removed');
    await server.close();
  });

  await test('a failed room entry preserves the existing occupancy and client state', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      externalAccount: { username: 'external', password: 'external-secret' },
      roomPasswords: { 'guarded@conference.localhost': 'room-secret' },
    });
    const result = await server.listen();
    const room = 'guarded@conference.localhost';
    let occupant;
    let intruder;
    try {
      occupant = await makeClient(result, { resource: 'occupant' });
      await occupant.joinMuc(room, 'resident', 'room-secret');
      assert(server.muc.getOccupants(room).length === 1, 'the room should hold exactly one occupant');

      // A rejoin with the wrong password must not evict the existing occupant.
      let rejected = null;
      try {
        await occupant.joinMuc(room, 'resident', 'wrong-secret');
      } catch (error) {
        rejected = error;
      }
      assert(rejected, 'a wrong room password must be rejected');
      assert(rejected.condition === 'not-authorized', `expected not-authorized, got ${rejected && rejected.condition}`);
      const afterFailure = server.muc.getOccupants(room);
      assert(afterFailure.length === 1, 'a failed rejoin must not remove the existing occupant');
      assert(afterFailure[0].nick === 'resident', 'the existing nickname must be preserved');
      assert(occupant.joinedRooms.get(room)?.nickname === 'resident',
        'the client must still consider itself in the room after a failed rejoin');

      // The room must still work for the occupant after the failed attempt.
      const echo = new Promise((resolve) => occupant.once('mucMessage', resolve));
      await occupant.sendMuc(room, 'still here');
      const echoed = await echo;
      assert(echoed.body === 'still here' && echoed.self === true,
        'the occupant must still be able to publish and see its own echo');

      // A nickname conflict from a different session must also be atomic.
      intruder = await makeClient(result, { resource: 'intruder' });
      let conflict = null;
      try {
        await intruder.joinMuc(room, 'resident', 'room-secret');
      } catch (error) {
        conflict = error;
      }
      assert(conflict && conflict.condition === 'conflict',
        `a taken nickname should be refused with conflict, got ${conflict && conflict.condition}`);
      assert(server.muc.getOccupants(room).length === 1,
        'a refused nickname must not disturb the existing occupant');
      assert(intruder.joinedRooms.size === 0, 'a refused joiner must not record the room');
    } finally {
      await closeClient(occupant);
      await closeClient(intruder);
      await server.close();
    }
  });

  await test('an in-room nickname change is atomic and announced with status 303', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    const room = 'renamed@conference.localhost';
    let mover;
    let watcher;
    try {
      mover = await makeClient(result, { resource: 'mover' });
      await mover.joinMuc(room, 'before', undefined);
      const created = server.muc.getOccupants(room)[0];
      assert(created.affiliation === 'owner', 'the room creator should be an owner');

      watcher = await makeClient(result, { resource: 'watcher' });
      await watcher.joinMuc(room, 'watcher', undefined);

      const departure = new Promise((resolve) => {
        const onStanza = (stanza) => {
          if (stanza.name !== 'presence' || stanza.attrs.type !== 'unavailable') return;
          if (stanza.attrs.from !== `${room}/before`) return;
          watcher.removeListener('stanza', onStanza);
          resolve(stanza);
        };
        watcher.on('stanza', onStanza);
      });

      await mover.joinMuc(room, 'after', undefined);
      const stanza = await departure;
      const x = stanza.getChild('x', 'http://jabber.org/protocol/muc#user');
      const codes = x.getChildren('status').map((status) => status.attrs.code);
      assert(codes.includes('303'), `nickname change should carry status 303, got ${codes.join(',')}`);
      assert(x.getChild('item').attrs.nick === 'after', 'the 303 presence should name the new nickname');

      const occupants = server.muc.getOccupants(room);
      assert(occupants.length === 2, 'a nickname change must not add or drop an occupant');
      const renamed = occupants.find((o) => o.nick === 'after');
      assert(renamed, 'the new nickname should be present');
      assert(renamed.affiliation === 'owner' && renamed.role === 'moderator',
        'affiliation and role must survive a nickname change');
      assert(!occupants.some((o) => o.nick === 'before'), 'the old nickname must be released');
    } finally {
      await closeClient(mover);
      await closeClient(watcher);
      await server.close();
    }
  });

  await test('a non-occupant that addresses a room receives a stanza error, not a silent drop', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    let occupant;
    let outsider;
    try {
      occupant = await makeClient(result, { resource: 'inside' });
      await occupant.joinMuc('open@conference.localhost', 'inside', undefined);

      outsider = await makeClient(result, { resource: 'outside' });
      const rejected = new Promise((resolve) => outsider.once('messageError', resolve));
      await outsider.sendMuc('open@conference.localhost', 'let me in');
      const error = await rejected;
      assert(error.condition === 'not-acceptable',
        `a non-occupant groupchat should be refused with not-acceptable, got ${error.condition}`);

      const missing = new Promise((resolve) => outsider.once('messageError', resolve));
      await outsider.sendMuc('nowhere@conference.localhost', 'anybody?');
      const missingError = await missing;
      assert(missingError.condition === 'item-not-found',
        `an unknown room should be refused with item-not-found, got ${missingError.condition}`);
    } finally {
      await closeClient(occupant);
      await closeClient(outsider);
      await server.close();
    }
  });

  await test('a direct message with no available resource is answered with service-unavailable', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      externalAccount: { username: 'external', password: 'external-secret' },
      internalAccount: { username: 'app', password: 'app-secret' },
    });
    const result = await server.listen();
    let client;
    try {
      client = await makeClient(result, { resource: 'sender' });
      const rejected = new Promise((resolve) => client.once('messageError', resolve));
      await client.sendChat('nobody@localhost', 'anyone there?');
      const error = await rejected;
      assert(error.condition === 'service-unavailable',
        `an unreachable recipient should produce service-unavailable, got ${error.condition}`);
    } finally {
      await closeClient(client);
      await server.close();
    }
  });

  await test('traffic addressed to the application identity reaches the transport as inbound data', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    let client;
    try {
      client = await makeClient(result, { resource: 'replier' });
      const inbound = once(server, 'message');
      await client.sendChat(server.getServiceJid(), 'reply from the receiver');
      const [event] = await inbound;
      assert(event.body === 'reply from the receiver', 'the body should reach the server transport');
      assert(event.to === server.getServiceJid(), 'the message should be addressed to the application identity');
    } finally {
      await closeClient(client);
      await server.close();
    }
  });

  await test('IQ result and error stanzas are never answered with another error', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    let client;
    try {
      client = await makeClient(result, { resource: 'iq-rules' });
      const { xml } = require('@xmpp/client');
      const seen = [];
      client.on('stanza', (stanza) => seen.push(stanza));

      // A supported get is answered normally, which also proves the stream works.
      await client.ping('localhost');

      // An unsupported get is answered with service-unavailable rather than ignored.
      const unsupported = client.waitFor((stanza) => stanza.name === 'iq' && stanza.attrs.id === 'unsupported-1', 3000);
      await client.entity.send(xml('iq', { type: 'get', id: 'unsupported-1' },
        xml('query', { xmlns: 'jabber:iq:roster' })));
      const unsupportedStanza = await unsupported;
      assert(unsupportedStanza.attrs.type === 'error', 'an unsupported get should be answered with an error');
      assert(unsupportedStanza.getChild('error').getChild('service-unavailable'),
        `expected service-unavailable, got ${unsupportedStanza.toString()}`);

      // A result and an error must be ignored entirely — RFC 6120 §8.3.1.
      seen.length = 0;
      await client.entity.send(xml('iq', { type: 'result', id: 'result-1' }));
      await client.entity.send(xml('iq', { type: 'error', id: 'error-1' },
        xml('error', { type: 'cancel' },
          xml('service-unavailable', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' }))));
      await delay(250);
      const echoed = seen.filter((stanza) => ['result-1', 'error-1'].includes(stanza.attrs.id));
      assert(echoed.length === 0,
        `iq result/error must not be answered, got ${echoed.map((s) => s.toString()).join(' ')}`);

      // A missing type is a bad request.
      const bad = client.waitFor((stanza) => stanza.name === 'iq' && stanza.attrs.id === 'typeless-1', 3000);
      await client.entity.send(xml('iq', { id: 'typeless-1' }, xml('ping', { xmlns: 'urn:xmpp:ping' })));
      const badStanza = await bad;
      assert(badStanza.getChild('error').getChild('bad-request'),
        `an iq with no type should be bad-request, got ${badStanza.toString()}`);
    } finally {
      await closeClient(client);
      await server.close();
    }
  });

  await test('a second resource bind on the same stream is refused with not-allowed', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    let client;
    try {
      client = await makeClient(result, { resource: 'first' });
      const { xml } = require('@xmpp/client');
      const firstJid = 'external@localhost/first';
      assert(server.getBoundJids().includes(firstJid), 'the first resource should be bound');

      // Occupy a room so the orphaning regression is observable.
      const room = 'rebind@conference.localhost';
      await client.joinMuc(room, 'holder', undefined);
      assert(server.muc.getOccupants(room)[0].fullJid === firstJid,
        'the occupant should carry the first full JID');

      const refused = client.waitFor((stanza) => stanza.name === 'iq' && stanza.attrs.id === 'bind-again', 3000);
      await client.entity.send(xml('iq', { type: 'set', id: 'bind-again' },
        xml('bind', { xmlns: 'urn:ietf:params:xml:ns:xmpp-bind' }, xml('resource', {}, 'second'))));
      const refusal = await refused;
      assert(refusal.attrs.type === 'error', 'a second bind should be answered with an error');
      assert(refusal.getChild('error').getChild('not-allowed'),
        `a second bind should be refused with not-allowed, got ${refusal.toString()}`);
      assert(server.getBoundJids().length === 1, 'a refused bind must not add a second binding');
      assert(server.getBoundJids()[0] === firstJid, 'the original binding must survive');
      assert(!server.getBoundJids().includes('external@localhost/second'),
        'the refused resource must not be bound');
      assert(server.muc.getOccupants(room)[0].fullJid === firstJid,
        'the MUC occupant JID must not be orphaned by a refused rebind');
    } finally {
      await closeClient(client);
      await server.close();
    }
  });

  await test('service-side publishing routes to bound streams and room occupants', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    let client;
    try {
      assert(server.sendServiceMessage('nobody home').reason === 'no-clients',
        'publishing with no bound stream should report no-clients');

      client = await makeClient(result, { resource: 'receiver' });
      const direct = new Promise((resolve) => client.once('chat', resolve));
      const sendResult = server.sendServiceMessage('service to client');
      assert(sendResult.delivered && sendResult.recipients === 1, 'the service message should be delivered once');
      const chat = await direct;
      assert(chat.body === 'service to client', 'the client should receive the exact body');
      assert(chat.from === server.getServiceJid(), 'the service JID should be stamped as the sender');

      const room = 'service@conference.localhost';
      const joined = server.joinRoomAsService({ roomJid: room, nickname: 'simulator' });
      assert(joined.ok && joined.occupantJid === `${room}/simulator`, 'the service should occupy the room');
      assert(server.getRoomOccupantCount(room) === 0,
        'the service itself must not count as an external occupant');
      assert(server.broadcastToRoomAsService(room, 'nobody listening').reason === 'no-clients',
        'broadcasting to an otherwise empty room should report no-clients');

      await client.joinMuc(room, 'listener', undefined);
      assert(server.getRoomOccupantCount(room) === 1, 'the real client should be counted');
      const groupchat = new Promise((resolve) => client.once('mucMessage', resolve));
      const broadcast = server.broadcastToRoomAsService(room, 'service to room');
      assert(broadcast.delivered && broadcast.recipients === 1, 'the broadcast should reach one stream');
      const message = await groupchat;
      assert(message.body === 'service to room', 'the occupant should receive the exact body');
      assert(message.nickname === 'simulator', 'the service nickname should be stamped');
      assert(message.self === false, 'a service broadcast is not a client self echo');

      server.leaveRoomsAsService();
      assert(server.broadcastToRoomAsService(room, 'gone').delivered === false,
        'the service cannot broadcast after leaving');
    } finally {
      await closeClient(client);
      await server.close();
    }
  });

  await test('private messages to a room occupant are refused with feature-not-implemented', async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.DISABLED,
      externalAccount: { username: 'external', password: 'external-secret' },
    });
    const result = await server.listen();
    let client;
    try {
      client = await makeClient(result, { resource: 'private' });
      await client.joinMuc('private@conference.localhost', 'me', undefined);
      const rejected = new Promise((resolve) => client.once('messageError', resolve));
      await client.sendChat('private@conference.localhost/me', 'psst');
      const error = await rejected;
      assert(error.condition === 'feature-not-implemented',
        `a private MUC message should be refused, got ${error.condition}`);
    } finally {
      await closeClient(client);
      await server.close();
    }
  });

  console.log(`\nXMPP core: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
