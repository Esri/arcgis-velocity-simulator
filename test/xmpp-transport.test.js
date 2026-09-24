const crypto = require('crypto');
const net = require('net');
const { StringDecoder } = require('string_decoder');
const {
  createXmppClientTransport,
  createXmppServerTransport,
  formatClientSettings,
} = require('../src/xmpp-transport');
const {
  XMPP_DEFAULT_CONNECT_TIMEOUT_MS,
  XMPP_DEFAULT_PING_INTERVAL_MS,
  XMPP_DEFAULT_RECONNECT_DELAY_MS,
  XMPP_DEFAULT_REPLY_TIMEOUT_MS,
  XMPP_MAX_BODY_BYTES,
  XMPP_TIMING_OPTIONS,
} = require('../src/xmpp-constants');
const { INTERNAL_APP_USERNAME } = require('../src/xmpp-accounts');

/**
 * Every XMPP timing is a positive integer, so a suite that wants a keepalive
 * or a reconnect to stay out of the way asks for a long one rather than zero.
 * The transport's timers are unref'd, so a pending long timer never keeps the
 * test process alive.
 */
const IDLE_TIMING_MS = 600000;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

function waitFor(predicate, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started >= timeout) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for XMPP transport state'));
      }
    }, 10);
  });
}

/**
 * Signs in over a deliberately unencrypted stream using SCRAM-SHA-1.
 *
 * `@xmpp/client` always accepts a STARTTLS offer, so a real client can never
 * produce a plaintext stream against a Preferred server. This minimal raw
 * client can, which is exactly what the per-connection TLS metadata assertions
 * need: a TLS-capable server holding a stream that never upgraded.
 */
async function signInWithoutTls(port, username, password, domain = 'localhost') {
  const socket = net.connect(port, '127.0.0.1');
  const decoder = new StringDecoder('utf8');
  let received = '';
  const waiters = new Set();
  socket.on('error', () => {});
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
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  const waitFor = (pattern, timeout = 5000) => {
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
      const match = received.slice(offset).match(pattern);
      if (!match) return;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      resolve(match);
    });
  };

  const openStream = () => {
    const features = waitFor(/<stream:features[\s\S]*?<\/stream:features>/);
    socket.write(`<stream:stream to="${domain}" xmlns="jabber:client" ` +
      'xmlns:stream="http://etherx.jabber.org/streams" version="1.0">');
    return features;
  };

  const hmac = (key, data) => crypto.createHmac('sha1', key).update(data).digest();

  await openStream();
  const clientNonce = crypto.randomBytes(12).toString('base64');
  const clientFirstBare = `n=${username},r=${clientNonce}`;
  const challenge = waitFor(/<challenge[^>]*>([^<]*)<\/challenge>/);
  socket.write('<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="SCRAM-SHA-1">' +
    `${Buffer.from(`n,,${clientFirstBare}`).toString('base64')}</auth>`);
  const serverFirst = Buffer.from((await challenge)[1], 'base64').toString('utf8');
  const attributes = new Map(serverFirst.split(',').map((token) => {
    const index = token.indexOf('=');
    return [token.slice(0, index), token.slice(index + 1)];
  }));
  const saltedPassword = crypto.pbkdf2Sync(
    Buffer.from(password, 'utf8'),
    Buffer.from(attributes.get('s'), 'base64'),
    Number(attributes.get('i')),
    20,
    'sha1',
  );
  const clientKey = hmac(saltedPassword, 'Client Key');
  const storedKey = crypto.createHash('sha1').update(clientKey).digest();
  const clientFinalBare = `c=${Buffer.from('n,,').toString('base64')},r=${attributes.get('r')}`;
  const authMessage = `${clientFirstBare},${serverFirst},${clientFinalBare}`;
  const signature = hmac(storedKey, authMessage);
  const proof = Buffer.from(clientKey.map((byte, index) => byte ^ signature[index]));
  const success = waitFor(/<success[\s\S]*?(\/>|<\/success>)/);
  socket.write('<response xmlns="urn:ietf:params:xml:ns:xmpp-sasl">' +
    `${Buffer.from(`${clientFinalBare},p=${proof.toString('base64')}`).toString('base64')}</response>`);
  await success;

  await openStream();
  const bound = waitFor(/<iq[^>]*id=["']bind-1["'][\s\S]*?<\/iq>/);
  socket.write('<iq type="set" id="bind-1"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind">' +
    '<resource>raw-plaintext</resource></bind></iq>');
  await bound;

  return {
    socket,
    get received() {
      return received;
    },
    async send(stanza) {
      socket.write(stanza);
      // One event-loop turn is enough for the server to parse and route it.
      await new Promise((resolve) => setImmediate(resolve));
    },
    close() {
      for (const waiter of waiters) clearTimeout(waiter.timer);
      waiters.clear();
      socket.destroy();
    },
  };
}

/**
 * Signs in over a deliberately unencrypted stream using SASL PLAIN.
 *
 * PLAIN over an unsecure stream is only offered when the TLS policy is
 * deliberately Disabled, and `@xmpp/client` cannot be forced to send it, so
 * this raw client is the only way to exercise that path. The password may be
 * empty, which is the relaxed-testing case under test.
 */
async function signInWithPlain(port, username, password, domain = 'localhost') {
  const socket = net.connect(port, '127.0.0.1');
  const decoder = new StringDecoder('utf8');
  let received = '';
  const waiters = new Set();
  socket.on('error', () => {});
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
  const close = () => {
    for (const waiter of waiters) clearTimeout(waiter.timer);
    waiters.clear();
    socket.destroy();
  };
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  const waitFor = (pattern, timeout = 5000) => {
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
      const match = received.slice(offset).match(pattern);
      if (!match) return;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      resolve(match);
    });
  };

  const openStream = () => {
    const features = waitFor(/<stream:features[\s\S]*?<\/stream:features>/);
    socket.write(`<stream:stream to="${domain}" xmlns="jabber:client" ` +
      'xmlns:stream="http://etherx.jabber.org/streams" version="1.0">');
    return features;
  };

  try {
    const features = (await openStream())[0];
    if (!features.includes('>PLAIN<')) {
      throw new Error('PLAIN was not offered on this unsecure stream');
    }
    const outcome = waitFor(/<(success|failure)[\s\S]*?(\/>|<\/\1>)/);
    const initial = Buffer.from(`\u0000${username}\u0000${password}`, 'utf8').toString('base64');
    socket.write('<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="PLAIN">' +
      `${initial}</auth>`);
    const result = await outcome;
    if (result[1] === 'failure') throw new Error(`PLAIN authentication failed: ${result[0]}`);

    await openStream();
    const bound = waitFor(/<iq[^>]*id=["']bind-plain["'][\s\S]*?<\/iq>/);
    socket.write('<iq type="set" id="bind-plain"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind">' +
      '<resource>raw-plain</resource></bind></iq>');
    await bound;
  } catch (error) {
    close();
    throw error;
  }

  return {
    socket,
    get received() {
      return received;
    },
    async sendChat(to, body) {
      socket.write(`<message to="${to}" type="chat"><body>${body}</body></message>`);
      await new Promise((resolve) => setImmediate(resolve));
    },
    close,
  };
}

async function run() {
  await test('server advertises MUC discovery with correctly addressed replies and errors', async () => {
    const { XmppServerCore, NS } = require('../src/xmpp-server-core');
    const { XmppClientCore } = require('../src/xmpp-client-core');
    const { xml } = require('@xmpp/xml');
    const server = new XmppServerCore({
      host: '127.0.0.1', port: 0, domain: 'localhost', tlsPolicy: 'disabled',
      externalAccount: { username: 'velocity', password: 'disco-secret' },
    });
    const started = await server.listen();
    const client = new XmppClientCore({
      service: `xmpp://127.0.0.1:${started.address.port}`, domain: 'localhost',
      username: 'velocity', password: 'disco-secret', resource: 'receiver',
      tlsPolicy: 'disabled',
    });
    try {
      await client.connect();
      const response = await client.entity.iqCaller.request(xml('iq', {
        type: 'get', to: 'conference.localhost',
      }, xml('query', { xmlns: NS.DISCO_INFO })), 1000);
      const query = response.getChild('query', NS.DISCO_INFO);
      assert(response.attrs.from === 'conference.localhost', 'Discovery response must come from the conference service');
      assert(response.attrs.to === client.entity.jid.toString(), 'Discovery response must address the bound client');
      assert(query.getChild('identity').attrs.category === 'conference', 'Discovery identity must be a conference');
      assert(query.getChild('identity').attrs.type === 'text', 'Discovery identity must be text');
      assert(query.getChild('identity').attrs.name === 'ArcGIS Velocity Simulator', 'Discovery identity must name the Simulator');
      assert(query.getChildren('feature').some(feature => feature.attrs.var === NS.MUC), 'Discovery must advertise MUC');

      for (const to of [undefined, 'unsupported.localhost']) {
        const id = to ? 'addressed-error' : 'default-domain-error';
        let reply;
        const receive = stanza => { if (stanza.attrs.id === id) reply = stanza; };
        client.entity.on('stanza', receive);
        try {
          await client.entity.send(xml('iq', { type: 'get', id, ...(to ? { to } : {}) },
            xml('query', { xmlns: NS.DISCO_INFO })));
          await waitFor(() => reply);
          assert(reply.attrs.type === 'error', 'Other discovery destinations must remain unsupported');
          assert(reply.attrs.from === (to || 'localhost'), 'IQ error must identify the requested service or default domain');
          assert(reply.attrs.to === client.entity.jid.toString(), 'IQ error must address the bound client');
          assert(reply.getChild('error').getChild('service-unavailable', NS.STANZA_ERROR), 'IQ error must use the shared stanza error namespace');
        } finally {
          client.entity.removeListener('stanza', receive);
        }
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
  console.log('\n=== XMPP Transport Tests ===');

  await test('a present-but-empty XMPP password is accepted while identities stay required', async () => {
    const { XmppClientCore } = require('../src/xmpp-client-core.js');
    let missingUsername = false;
    try {
      createXmppClientTransport({ ip: '127.0.0.1', port: 5222, xmppPassword: '' });
    } catch (error) {
      missingUsername = /username is required/i.test(error.message);
    }
    assert(missingUsername, 'a missing username must still be rejected');

    let missingPassword = false;
    try {
      createXmppClientTransport({ ip: '127.0.0.1', port: 5222, xmppUsername: 'simulator' });
    } catch (error) {
      missingPassword = /an empty value is allowed/i.test(error.message);
    }
    assert(missingPassword, 'a missing password must be rejected with an explicit hint');

    const emptyPasswordClient = createXmppClientTransport({
      ip: '127.0.0.1',
      port: 5222,
      xmppUsername: 'simulator',
      xmppPassword: '',
      xmppDestination: 'velocity-logger@localhost',
    });
    assert(typeof emptyPasswordClient.connect === 'function',
      'an empty password must build a usable client transport');

    let missingExternalPassword = false;
    try {
      createXmppServerTransport({ ip: '127.0.0.1', port: 0, xmppExternalUsername: 'velocity-logger' });
    } catch (error) {
      missingExternalPassword = /an empty value is allowed/i.test(error.message);
    }
    assert(missingExternalPassword, 'a missing external password must be rejected');

    // The core keeps the same distinction: empty is a value, missing is not.
    const core = new XmppClientCore({
      service: 'xmpp://127.0.0.1:5222', domain: 'localhost', username: 'simulator', password: '',
    });
    assert(core.options.password === '', 'the core must keep a present-but-empty password');
    let coreRejected = false;
    try {
      new XmppClientCore({ service: 'xmpp://127.0.0.1:5222', domain: 'localhost', username: 'simulator' });
    } catch (error) {
      coreRejected = /password/.test(error.message);
    }
    assert(coreRejected, 'the core must still reject a missing password');
  });

  await test('an explicit certificate bypass is accepted for a remote XMPP host', async () => {
    // The bypass is a warning-styled opt-in, not a loopback-only shortcut.
    const remote = createXmppClientTransport({
      ip: '10.1.2.3',
      port: 5222,
      xmppUsername: 'simulator',
      xmppPassword: '',
      xmppDestination: 'feed@example.com',
      xmppAllowUnverifiedTls: true,
    });
    assert(typeof remote.connect === 'function',
      'an explicit bypass must not be blocked by a non-loopback host');
  });

  await test('an empty password authenticates over SCRAM-SHA-1 on a secure stream', async () => {
    const received = [];
    const server = createXmppServerTransport({
      ip: '127.0.0.1',
      port: 0,
      xmppDomain: 'localhost',
      xmppTlsPolicy: 'required',
      xmppExternalUsername: 'velocity-logger',
      xmppExternalPassword: '',
      onData: (body) => received.push(body),
    });
    let client;
    try {
      const listening = await server.connect();
      client = createXmppClientTransport({
        ip: '127.0.0.1',
        port: listening.address.port,
        xmppDomain: 'localhost',
        xmppTlsPolicy: 'required',
        xmppUsername: 'velocity-logger',
        xmppPassword: '',
        xmppDestination: listening.serviceJid,
        xmppAllowUnverifiedTls: true,
        xmppPingIntervalMs: IDLE_TIMING_MS,
      });
      const connected = await client.connect();
      assert(connected.secure === true || connected.tlsInfo.startsWith('tls=on'),
        'the SCRAM sign-in must happen on an encrypted stream');
      const outbound = await client.send('empty-password-scram');
      assert(outbound.delivered, 'an empty-password account must be able to publish');
      await waitFor(() => received.length === 1);
      assert(received[0] === 'empty-password-scram', 'the server must receive the exact body');
    } finally {
      if (client) await client.disconnect();
      await server.disconnect();
    }
  });

  await test('an empty password authenticates over PLAIN when TLS is deliberately disabled', async () => {
    const received = [];
    const server = createXmppServerTransport({
      ip: '127.0.0.1',
      port: 0,
      xmppDomain: 'localhost',
      xmppTlsPolicy: 'disabled',
      xmppExternalUsername: 'velocity-logger',
      xmppExternalPassword: '',
      onData: (body) => received.push(body),
    });
    let raw;
    try {
      const listening = await server.connect();
      // PLAIN is only reachable on a raw plaintext stream: @xmpp/client always
      // accepts a STARTTLS offer, so a real client cannot produce one here.
      raw = await signInWithPlain(listening.address.port, 'velocity-logger', '');
      await raw.sendChat(listening.serviceJid, 'empty-password-plain');
      await waitFor(() => received.length === 1);
      assert(received[0] === 'empty-password-plain', 'PLAIN with an empty password must deliver the body');
    } finally {
      if (raw) raw.close();
      await server.disconnect();
    }
  });

  await test('PLAIN stays refused on an unsecure stream unless TLS is disabled', async () => {
    const server = createXmppServerTransport({
      ip: '127.0.0.1',
      port: 0,
      xmppDomain: 'localhost',
      xmppTlsPolicy: 'preferred',
      xmppExternalUsername: 'velocity-logger',
      xmppExternalPassword: '',
      onData: () => {},
    });
    let raw;
    try {
      const listening = await server.connect();
      let refused = false;
      try {
        raw = await signInWithPlain(listening.address.port, 'velocity-logger', '');
      } catch (error) {
        refused = /PLAIN|encryption-required|not-authorized|failure/i.test(error.message);
      }
      assert(refused, 'PLAIN must stay refused on an unsecure Preferred stream');
    } finally {
      if (raw) raw.close();
      await server.disconnect();
    }
  });

  await test('client and server transports exchange direct chat with whitespace credentials', async () => {
    const serverInbound = [];
    const clientInbound = [];
    const server = createXmppServerTransport({
      ip: '127.0.0.1',
      port: 0,
      xmppDomain: 'Example.TEST',
      xmppTlsPolicy: 'disabled',
      xmppExternalUsername: 'Receiver',
      xmppExternalPassword: '  whitespace secret  ',
      onData: (body, metadata) => serverInbound.push({ body, metadata }),
    });
    let client;
    try {
      const listening = await server.connect();
      client = createXmppClientTransport({
        ip: '127.0.0.1',
        port: listening.address.port,
        xmppDomain: 'example.test',
        xmppTlsPolicy: 'disabled',
        xmppUsername: 'RECEIVER',
        xmppPassword: '  whitespace secret  ',
        xmppDestination: listening.serviceJid.toUpperCase(),
        xmppPingIntervalMs: IDLE_TIMING_MS,
        onData: (body, metadata) => clientInbound.push({ body, metadata }),
      });
      const connected = await client.connect();
      assert(connected.jid.startsWith('receiver@example.test/'), 'client JID should be canonicalized');

      const outbound = await client.send('client to service');
      assert(outbound.delivered && outbound.recipients === 1, 'client send should report one recipient');
      await waitFor(() => serverInbound.length === 1);
      assert(serverInbound[0].body === 'client to service', 'server should receive the exact direct body');
      assert(serverInbound[0].metadata.secure === false, 'plaintext inbound metadata should report secure=false');

      const published = await server.send('service to client');
      assert(published.delivered && published.recipients === 1, 'server send should reach the bound client');
      await waitFor(() => clientInbound.length === 1);
      assert(clientInbound[0].body === 'service to client', 'client should receive the service body');

      let oversizedRejected = false;
      try {
        await client.send('🌍'.repeat(Math.ceil((XMPP_MAX_BODY_BYTES + 1) / 4)));
      } catch (error) {
        oversizedRejected = /UTF-8 bytes.*exceeds/i.test(error.message);
      }
      assert(oversizedRejected, 'body limit must be measured in UTF-8 bytes');
    } finally {
      if (client) await client.disconnect();
      await server.disconnect();
    }
  });

  await test('required STARTTLS MUC supports join, service broadcast, and self echo', async () => {
    const room = 'traffic@conference.localhost';
    const serverInbound = [];
    const clientInbound = [];
    const server = createXmppServerTransport({
      ip: '127.0.0.1',
      port: 0,
      xmppTlsPolicy: 'required',
      xmppExternalUsername: 'receiver',
      xmppExternalPassword: 'external-secret',
      xmppConversation: 'muc',
      xmppRoom: room,
      xmppNickname: 'simulator',
      xmppRoomPassword: 'room secret',
      onData: (body, metadata) => serverInbound.push({ body, metadata }),
    });
    let client;
    try {
      const listening = await server.connect();
      client = createXmppClientTransport({
        ip: '127.0.0.1',
        port: listening.address.port,
        xmppTlsPolicy: 'required',
        xmppAllowUnverifiedTls: true,
        xmppUsername: 'receiver',
        xmppPassword: 'external-secret',
        xmppConversation: 'muc',
        xmppRoom: room,
        xmppNickname: 'velocity-feed',
        xmppRoomPassword: 'room secret',
        xmppPingIntervalMs: IDLE_TIMING_MS,
        onData: (body, metadata) => clientInbound.push({ body, metadata }),
      });
      const connected = await client.connect();
      assert(connected.secure, 'required policy must produce an encrypted client stream');

      await client.send('room inbound');
      await waitFor(() => serverInbound.length === 1 &&
        clientInbound.some((entry) => entry.body === 'room inbound' && entry.metadata.selfEcho));
      assert(serverInbound[0].metadata.conversation === 'muc', 'server should identify MUC inbound data');
      assert(serverInbound[0].metadata.secure === true, 'STARTTLS inbound metadata should report secure=true');

      const published = await server.send('room outbound');
      assert(published.delivered && published.recipients === 1, 'service broadcast should reach external occupant');
      await waitFor(() => clientInbound.some((entry) => entry.body === 'room outbound'));
    } finally {
      if (client) await client.disconnect();
      await server.disconnect();
    }
  });

  await test('preferred policy reports the actual plaintext connection state', async () => {
    const server = createXmppServerTransport({
      ip: '127.0.0.1',
      port: 0,
      xmppTlsPolicy: 'disabled',
      xmppExternalUsername: 'receiver',
      xmppExternalPassword: 'external-secret',
    });
    let client;
    try {
      const listening = await server.connect();
      client = createXmppClientTransport({
        ip: '127.0.0.1',
        port: listening.address.port,
        xmppTlsPolicy: 'preferred',
        xmppUsername: 'receiver',
        xmppPassword: 'external-secret',
        xmppDestination: listening.serviceJid,
        xmppPingIntervalMs: IDLE_TIMING_MS,
      });
      const connected = await client.connect();
      assert(connected.secure === false, 'preferred policy should expose the actual plaintext state');
      assert(/tls=off.*preferred/i.test(connected.tlsInfo), 'TLS metadata should report preferred fallback');
    } finally {
      if (client) await client.disconnect();
      await server.disconnect();
    }
  });

  await test('connect timeout cleanup closes pending sockets and disables reconnect', async () => {
    const sockets = new Set();
    let accepted = 0;
    const blackhole = net.createServer((socket) => {
      accepted += 1;
      sockets.add(socket);
      socket.resume();
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise((resolve) => blackhole.listen(0, '127.0.0.1', resolve));
    const transport = createXmppClientTransport({
      ip: '127.0.0.1',
      port: blackhole.address().port,
      xmppTlsPolicy: 'required',
      xmppUsername: 'receiver',
      xmppPassword: 'external-secret',
      xmppDestination: 'service@localhost',
      xmppConnectTimeoutMs: 40,
      xmppReplyTimeoutMs: 40,
      xmppPingIntervalMs: IDLE_TIMING_MS,
      // A deliberately short reconnect delay: if cleanup failed to stop the
      // scheduler, the black hole would accept a second socket well inside the
      // observation window below.
      xmppReconnectDelayMs: 200,
    });
    try {
      let rejected = false;
      try {
        await transport.connect();
      } catch (error) {
        rejected = /timed out/i.test(error.message);
      }
      assert(rejected, 'pending connect should reject at the configured deadline');
      await waitFor(() => sockets.size === 0);
      await new Promise((resolve) => setTimeout(resolve, 700));
      assert(accepted === 1, 'cleanup must disable automatic reconnect after timeout');
    } finally {
      await transport.disconnect();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => blackhole.close(resolve));
    }
  });

  await test('destination and body limits are normalized before sending', async () => {
    const destinations = Array.from({ length: 20 }, (_, index) => `USER${index}@Example.TEST`);
    const transport = createXmppClientTransport({
      ip: '127.0.0.1',
      xmppTlsPolicy: 'disabled',
      xmppUsername: 'sender',
      xmppPassword: 'secret',
      xmppDestination: `${destinations.join(',')},user0@example.test`,
      xmppPingIntervalMs: IDLE_TIMING_MS,
    });
    assert(transport.describe().destinations.length === 20, 'destinations should trim, canonicalize, and dedupe');

    for (const [label, paths] of [
      ['certificate only', { xmppTlsCertPath: __filename }],
      ['private key only', { xmppTlsKeyPath: __filename }],
      ['certificate with a blank key path', { xmppTlsCertPath: __filename, xmppTlsKeyPath: '   ' }],
    ]) {
      let pairRejected = false;
      try {
        createXmppServerTransport({
          ip: '127.0.0.1',
          xmppTlsPolicy: 'required',
          xmppExternalUsername: 'receiver',
          xmppExternalPassword: 'external-secret',
          ...paths,
        });
      } catch (error) {
        pairRejected = /both.*certificate.*private key/i.test(error.message);
      }
      assert(pairRejected, `server TLS material must be supplied as a pair (${label})`);
    }

    let missingFileRejected = false;
    try {
      createXmppServerTransport({
        ip: '127.0.0.1',
        xmppTlsPolicy: 'required',
        xmppExternalUsername: 'receiver',
        xmppExternalPassword: 'external-secret',
        xmppTlsCertPath: `${__filename}.missing`,
        xmppTlsKeyPath: `${__filename}.missing`,
      });
    } catch (error) {
      missingFileRejected = /certificate file was not found/i.test(error.message);
    }
    assert(missingFileRejected, 'a paired but missing certificate path must fail before listening');
  });

  await test('every XMPP timing is a positive integer with the canonical default', async () => {
    const base = {
      ip: '127.0.0.1',
      xmppTlsPolicy: 'disabled',
      xmppUsername: 'sender',
      xmppPassword: 'secret',
      xmppDestination: 'feed@example.test',
    };
    const defaults = createXmppClientTransport(base).describe();
    assert(defaults.xmppConnectTimeoutMs === XMPP_DEFAULT_CONNECT_TIMEOUT_MS &&
      XMPP_DEFAULT_CONNECT_TIMEOUT_MS === 30000, 'connect timeout defaults to 30000ms');
    assert(defaults.xmppReplyTimeoutMs === XMPP_DEFAULT_REPLY_TIMEOUT_MS &&
      XMPP_DEFAULT_REPLY_TIMEOUT_MS === 15000, 'reply timeout defaults to 15000ms');
    assert(defaults.xmppPingIntervalMs === XMPP_DEFAULT_PING_INTERVAL_MS &&
      XMPP_DEFAULT_PING_INTERVAL_MS === 60000, 'ping interval defaults to 60000ms');
    assert(defaults.xmppReconnectDelayMs === XMPP_DEFAULT_RECONNECT_DELAY_MS &&
      XMPP_DEFAULT_RECONNECT_DELAY_MS === 60000, 'reconnect delay defaults to 60000ms');

    for (const { key } of XMPP_TIMING_OPTIONS) {
      for (const invalid of [0, -1, 1.5, 'soon']) {
        let rejected = false;
        try {
          createXmppClientTransport({ ...base, [key]: invalid });
        } catch (error) {
          rejected = new RegExp(`'${key}'.*millisecond or more`, 'i').test(error.message);
        }
        assert(rejected, `${key}=${String(invalid)} must be rejected as a non-positive timing`);
      }
    }

    // The server role validates the same way even though it only uses two of
    // the four timings, so a launch configuration cannot carry a bad value.
    let serverRejected = false;
    try {
      createXmppServerTransport({
        ip: '127.0.0.1',
        xmppTlsPolicy: 'disabled',
        xmppExternalUsername: 'receiver',
        xmppExternalPassword: 'external-secret',
        xmppConnectTimeoutMs: 0,
      });
    } catch (error) {
      serverRejected = /xmppConnectTimeoutMs.*millisecond or more/i.test(error.message);
    }
    assert(serverRejected, 'the server role must reject a zero connect timeout too');
  });

  await test('an external account cannot canonically collide with the reserved identity', async () => {
    for (const username of [
      INTERNAL_APP_USERNAME,
      'Velocity-Simulator',
      'VELOCITY-SIMULATOR@Example.TEST',
      '  velocity-simulator  ',
    ]) {
      let rejected = false;
      try {
        createXmppServerTransport({
          ip: '127.0.0.1',
          xmppTlsPolicy: 'disabled',
          xmppExternalUsername: username,
          xmppExternalPassword: 'external-secret',
        });
      } catch (error) {
        rejected = /must differ from the reserved/i.test(error.message);
      }
      assert(rejected, `'${username}' must not be accepted as the external account`);
    }

    const distinct = createXmppServerTransport({
      ip: '127.0.0.1',
      xmppTlsPolicy: 'disabled',
      xmppExternalUsername: 'Receiver@Example.TEST',
      xmppExternalPassword: 'external-secret',
    });
    assert(distinct.describe().externalAccount === 'receiver',
      'a distinct external account is canonicalized to its lowercase local part');
  });

  await test('copied client settings use canonical option names and withhold the password', async () => {
    const server = createXmppServerTransport({
      ip: '127.0.0.1',
      port: 0,
      xmppDomain: 'example.test',
      xmppTlsPolicy: 'disabled',
      xmppExternalUsername: 'receiver',
      xmppExternalPassword: 'external-secret',
    });
    try {
      const listening = await server.connect();
      const settings = server.getClientSettings();
      assert(settings.ip === listening.address.address && settings.port === listening.address.port,
        'the copied host is the shared top-level ip option');
      assert(!Object.hasOwn(settings, 'host') && !Object.hasOwn(settings, 'xmppHost'),
        'there is no host or xmppHost key anywhere in the copied settings');
      assert(settings.xmppDomain === 'example.test',
        'xmppDomain stays the served XMPP domain, separate from ip');
      assert(settings.xmppAllowUnverifiedTls === false && settings.xmppConversation === 'direct',
        'canonical option names are used for the conversation and the TLS bypass');
      assert(!Object.hasOwn(settings, 'xmppPassword') && settings.passwordIncluded === false,
        'the password is absent unless it is explicitly requested');
      for (const { key, defaultValue } of XMPP_TIMING_OPTIONS) {
        assert(settings[key] === defaultValue, `${key} should be copied with its canonical default`);
      }

      const safe = formatClientSettings(settings);
      assert(/^ip=127\.0\.0\.1$/m.test(safe), 'the copied text emits ip=, never host= or xmppHost=');
      assert(!/(^|\n)host=/.test(safe) && !safe.includes('xmppHost'),
        'no host or xmppHost key may appear in the copied text');
      assert(safe.includes('protocol=xmpp') && safe.includes('mode=client'),
        'the copied text is directly usable as command-line parameters');
      assert(safe.includes('xmppConversation=direct') && safe.includes('xmppAllowUnverifiedTls=false'),
        'canonical conversation and TLS-bypass keys are emitted');
      assert(safe.includes(`xmppDestination=${listening.serviceJid}`),
        'the destination is the application identity a receiver publishes to');
      for (const { key, defaultValue } of XMPP_TIMING_OPTIONS) {
        assert(safe.includes(`${key}=${defaultValue}`), `${key} should appear in the copied text`);
      }
      assert(!safe.includes('external-secret'), 'default copied settings must not contain a password');
      assert(/not copied/.test(safe), 'default copy should explain that the password was withheld');

      const withPassword = formatClientSettings(server.getClientSettings({ includePassword: true }));
      assert(withPassword.includes('xmppPassword=external-secret'),
        'an explicit password copy uses the canonical xmppPassword key');
    } finally {
      await server.disconnect();
    }
  });

  await test('copied room settings name the room and nickname with canonical keys', async () => {
    const server = createXmppServerTransport({
      ip: '127.0.0.1',
      port: 0,
      xmppTlsPolicy: 'disabled',
      xmppExternalUsername: 'receiver',
      xmppExternalPassword: 'external-secret',
      xmppConversation: 'muc',
      xmppRoom: 'traffic',
      xmppNickname: 'simulator',
    });
    try {
      await server.connect();
      const text = formatClientSettings(server.getClientSettings());
      assert(text.includes('xmppConversation=muc') &&
        text.includes('xmppRoom=traffic@conference.localhost') &&
        text.includes('xmppNickname=simulator'),
        'room mode copies the canonical room and nickname keys');
      assert(!text.includes('xmppDestination='), 'room mode does not copy a direct destination');
    } finally {
      await server.disconnect();
    }
  });

  await test('a client that requires STARTTLS fails before SASL and sends no credential', async () => {
    const logs = [];
    const server = createXmppServerTransport({
      ip: '127.0.0.1',
      port: 0,
      xmppTlsPolicy: 'disabled',
      xmppExternalUsername: 'receiver',
      xmppExternalPassword: 'external-secret',
      onLog: (level, message) => logs.push(message),
    });
    let client;
    try {
      const listening = await server.connect();
      client = createXmppClientTransport({
        ip: '127.0.0.1',
        port: listening.address.port,
        xmppTlsPolicy: 'required',
        xmppUsername: 'receiver',
        xmppPassword: 'external-secret',
        xmppDestination: listening.serviceJid,
        xmppConnectTimeoutMs: 4000,
        xmppReplyTimeoutMs: 1000,
        xmppPingIntervalMs: IDLE_TIMING_MS,
        xmppReconnectDelayMs: IDLE_TIMING_MS,
      });
      let failure = null;
      try {
        await client.connect();
      } catch (error) {
        failure = error;
      }
      assert(failure !== null, 'Required must not connect to a server that never offers STARTTLS');
      assert(/STARTTLS is required.*SASL was not attempted/i.test(failure.message),
        `the failure must name the pre-SASL abort, got: ${failure && failure.message}`);
      assert(!logs.some((message) => /authenticated using/i.test(message)),
        'the server must never observe an authentication attempt');
      assert(client.isConnected() === false, 'a refused client reports itself as disconnected');
    } finally {
      if (client) await client.disconnect();
      await server.disconnect();
    }
  });

  await test('inbound server metadata reports the connection state, not the server capability', async () => {
    const inbound = [];
    const states = [];
    // Preferred means the server offers TLS, so its listen-time tlsInfo says
    // tls=on. The stream below never upgrades, and every per-connection report
    // has to say so.
    const server = createXmppServerTransport({
      ip: '127.0.0.1',
      port: 0,
      xmppTlsPolicy: 'preferred',
      xmppExternalUsername: 'receiver',
      xmppExternalPassword: 'external-secret',
      onData: (body, metadata) => inbound.push({ body, metadata }),
      onStateChange: (state, detail) => states.push({ state, detail }),
    });
    let raw;
    try {
      const listening = await server.connect();
      assert(/tls=on/.test(listening.tlsInfo),
        'a preferred server advertises TLS, so its own summary reports tls=on');
      assert(/offered; each stream reports its own state/.test(listening.tlsInfo),
        'a preferred server summary must be labelled as an offer, not a connection state');

      raw = await signInWithoutTls(listening.address.port, 'receiver', 'external-secret');
      await raw.send(`<message type='chat' to='${listening.serviceJid}'><body>plaintext line</body></message>`);
      await waitFor(() => inbound.length === 1);
      assert(inbound[0].metadata.secure === false,
        'inbound metadata must report the plaintext connection, not the server capability');

      const bound = states.find((entry) => entry.state === 'authenticated');
      assert(bound && bound.detail.secure === false,
        'the authenticated lifecycle detail must carry the actual per-connection TLS state');
      assert(server.getClientCount() === 1, 'the plaintext stream still counts as a recipient');

      const ready = states.find((entry) => entry.state === 'ready');
      assert(ready && ready.detail.xmppConnectTimeoutMs === XMPP_DEFAULT_CONNECT_TIMEOUT_MS &&
        ready.detail.xmppReplyTimeoutMs === XMPP_DEFAULT_REPLY_TIMEOUT_MS,
        'the ready lifecycle detail reports the resolved timings under their canonical names');
    } finally {
      if (raw) raw.close();
      await server.disconnect();
    }
  });

  await test('a partially completed connect is cleaned up before the error is reported', async () => {
    const { TransportManager } = require('../src/transport-manager');
    const server = createXmppServerTransport({
      ip: '127.0.0.1',
      port: 0,
      xmppTlsPolicy: 'disabled',
      xmppExternalUsername: 'receiver',
      xmppExternalPassword: 'external-secret',
      xmppConversation: 'muc',
      xmppRoom: 'guarded',
      xmppRoomPassword: 'room-secret',
    });
    const manager = new TransportManager();
    try {
      const listening = await server.connect();
      let failure = null;
      try {
        // Authentication and binding succeed; only the room entry fails, so the
        // stream exists at the moment the error is raised.
        await manager.connect({
          protocol: 'xmpp',
          mode: 'client',
          ip: '127.0.0.1',
          port: listening.address.port,
          xmppTlsPolicy: 'disabled',
          xmppUsername: 'receiver',
          xmppPassword: 'external-secret',
          xmppConversation: 'muc',
          xmppRoom: 'guarded',
          xmppNickname: 'late',
          xmppConnectTimeoutMs: 4000,
          xmppReplyTimeoutMs: 2000,
          xmppPingIntervalMs: IDLE_TIMING_MS,
          xmppReconnectDelayMs: IDLE_TIMING_MS,
        });
      } catch (error) {
        failure = error;
      }
      assert(failure !== null, 'entering a password-protected room without the password must fail');
      assert(/not-authorized/i.test(failure.message), `the MUC condition should be reported: ${failure.message}`);
      assert(manager.isConnected() === false, 'the manager must not hold a half-connected transport');
      assert(manager.connection === null, 'the failed transport is unregistered after cleanup');
      // The server sees the stream close, which only happens if the partially
      // connected client was actually torn down.
      await waitFor(() => server.getClientCount() === 0);
    } finally {
      await manager.disconnect().catch(() => {});
      await server.disconnect();
    }
  });

  await test('passwords are compared exactly, including surrounding whitespace', async () => {
    const server = createXmppServerTransport({
      ip: '127.0.0.1',
      port: 0,
      xmppTlsPolicy: 'disabled',
      xmppExternalUsername: 'receiver',
      xmppExternalPassword: '  padded secret  ',
    });
    let trimmedClient;
    let exactClient;
    try {
      const listening = await server.connect();
      trimmedClient = createXmppClientTransport({
        ip: '127.0.0.1',
        port: listening.address.port,
        xmppTlsPolicy: 'disabled',
        xmppUsername: 'receiver',
        xmppPassword: 'padded secret',
        xmppDestination: listening.serviceJid,
        xmppConnectTimeoutMs: 4000,
        xmppReplyTimeoutMs: 1000,
        xmppPingIntervalMs: IDLE_TIMING_MS,
        xmppReconnectDelayMs: IDLE_TIMING_MS,
      });
      let trimmedFailed = false;
      try {
        await trimmedClient.connect();
      } catch (_) {
        trimmedFailed = true;
      }
      assert(trimmedFailed, 'a trimmed password must not authenticate against an untrimmed one');

      exactClient = createXmppClientTransport({
        ip: '127.0.0.1',
        port: listening.address.port,
        xmppTlsPolicy: 'disabled',
        xmppUsername: 'receiver',
        xmppPassword: '  padded secret  ',
        xmppDestination: listening.serviceJid,
        xmppConnectTimeoutMs: 4000,
        xmppReplyTimeoutMs: 1000,
        xmppPingIntervalMs: IDLE_TIMING_MS,
        xmppReconnectDelayMs: IDLE_TIMING_MS,
      });
      const connected = await exactClient.connect();
      assert(connected.success === true, 'the exact untrimmed password must authenticate');
    } finally {
      if (trimmedClient) await trimmedClient.disconnect();
      if (exactClient) await exactClient.disconnect();
      await server.disconnect();
    }
  });

  await test('client lifecycle metadata names the reconnect delay under its canonical key', async () => {
    const states = [];
    const server = createXmppServerTransport({
      ip: '127.0.0.1',
      port: 0,
      xmppTlsPolicy: 'disabled',
      xmppExternalUsername: 'receiver',
      xmppExternalPassword: 'external-secret',
    });
    let client;
    try {
      const listening = await server.connect();
      client = createXmppClientTransport({
        ip: '127.0.0.1',
        port: listening.address.port,
        xmppTlsPolicy: 'disabled',
        xmppUsername: 'receiver',
        xmppPassword: 'external-secret',
        xmppDestination: listening.serviceJid,
        xmppConnectTimeoutMs: 4000,
        xmppReplyTimeoutMs: 1000,
        xmppPingIntervalMs: IDLE_TIMING_MS,
        xmppReconnectDelayMs: 45000,
        onStateChange: (state, detail) => states.push({ state, detail }),
      });
      const connected = await client.connect();
      assert(connected.xmppReconnectDelayMs === 45000,
        'the connect result reports the resolved reconnect delay');
      assert(client.describe().xmppReconnectDelayMs === 45000,
        'the log-safe descriptor reports the resolved reconnect delay');
      const ready = states.find((entry) => entry.state === 'ready');
      assert(ready && ready.detail.xmppReconnectDelayMs === 45000 &&
        ready.detail.xmppPingIntervalMs === IDLE_TIMING_MS,
        'the ready lifecycle detail carries all four client timings');
    } finally {
      if (client) await client.disconnect();
      await server.disconnect();
    }
  });

  await test('unexpected drops clear client state while deliberate closes do not schedule reconnect', async () => {
    const server = createXmppServerTransport({
      ip: '127.0.0.1',
      port: 0,
      xmppDomain: 'localhost',
      xmppTlsPolicy: 'disabled',
      xmppExternalUsername: 'receiver',
      xmppExternalPassword: 'external-secret',
    });
    const listening = await server.connect();
    const deliberateStates = [];
    const deliberate = createXmppClientTransport({
      ip: '127.0.0.1',
      port: listening.address.port,
      xmppDomain: 'localhost',
      xmppTlsPolicy: 'disabled',
      xmppUsername: 'receiver',
      xmppPassword: 'external-secret',
      xmppDestination: listening.serviceJid,
      xmppPingIntervalMs: IDLE_TIMING_MS,
      xmppReconnectDelayMs: IDLE_TIMING_MS,
      onStateChange: (state) => deliberateStates.push(state),
    });
    let dropped;
    try {
      await deliberate.connect();
      await deliberate.disconnect();
      assert(!deliberateStates.includes('offline'),
        'a deliberate close must not report a reconnecting offline state');

      const droppedStates = [];
      dropped = createXmppClientTransport({
        ip: '127.0.0.1',
        port: listening.address.port,
        xmppDomain: 'localhost',
        xmppTlsPolicy: 'disabled',
        xmppUsername: 'receiver',
        xmppPassword: 'external-secret',
        xmppDestination: listening.serviceJid,
        xmppPingIntervalMs: IDLE_TIMING_MS,
        xmppReconnectDelayMs: IDLE_TIMING_MS,
        onStateChange: (state) => droppedStates.push(state),
      });
      await dropped.connect();
      await server.disconnect();
      await waitFor(() => !dropped.isConnected());
      assert(droppedStates.includes('offline'),
        'an unexpected stream drop must report the offline state');
      const result = await dropped.send('not delivered');
      assert(result.delivered === false && result.reason === 'no-clients',
        'send during the reconnect delay must be rejected without throwing');
    } finally {
      await deliberate.disconnect().catch(() => {});
      if (dropped) await dropped.disconnect().catch(() => {});
      await server.disconnect().catch(() => {});
    }
  });

  await test('transport manager wires both XMPP roles, recipient waiting, and inbound data', async () => {
    const { TransportManager } = require('../src/transport-manager');
    const serverManager = new TransportManager();
    const clientManager = new TransportManager();
    const statuses = [];
    const inbound = [];
    serverManager.on('status', (event) => statuses.push(event.message));
    serverManager.on('data-received', (event) => inbound.push(event));

    try {
      const listening = await serverManager.connect({
        protocol: 'xmpp',
        mode: 'server',
        ip: '127.0.0.1',
        port: 0,
        xmppDomain: 'localhost',
        xmppTlsPolicy: 'disabled',
        xmppExternalUsername: 'receiver',
        xmppExternalPassword: 'external-secret',
      });
      assert(listening.success === true, 'the manager should connect the XMPP server role');
      assert(serverManager.isConnected() === true, 'the manager should report the server as connected');
      assert(serverManager.requiresRecipients() === true, 'XMPP server mode requires recipients');
      assert(serverManager.hasRecipients() === false, 'no recipients before a client signs in');
      assert(statuses.some((message) => /XMPP server listening/.test(message)),
        'a connected status message should name the XMPP server');

      const noClients = await serverManager.send('too early');
      assert(!noClients.delivered && noClients.reason === 'no-clients',
        'sending before a client signs in must report no-clients so the replay cursor holds');

      // waitForRecipients must resolve only once a stream has actually bound.
      let waiterResolved = false;
      let waiterFailed = null;
      const waiter = serverManager.waitForRecipients({ timeoutMs: 15000 })
        .then(() => { waiterResolved = true; })
        .catch((error) => { waiterFailed = error; });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert(waiterResolved === false, 'waitForRecipients must not resolve while nobody is signed in');

      const online = await clientManager.connect({
        protocol: 'xmpp',
        mode: 'client',
        ip: '127.0.0.1',
        port: listening.address.port,
        xmppDomain: 'localhost',
        xmppTlsPolicy: 'disabled',
        xmppAllowUnverifiedTls: true,
        xmppUsername: 'receiver',
        xmppPassword: 'external-secret',
        xmppDestination: listening.serviceJid,
        xmppPingIntervalMs: IDLE_TIMING_MS,
      });
      assert(online.success === true, 'the manager should connect the XMPP client role');
      assert(clientManager.hasRecipients() === true,
        'a connected client has an implicit recipient once a destination is configured');

      await waiter;
      assert(waiterFailed === null, `waitForRecipients must not fail (${waiterFailed && waiterFailed.message})`);
      assert(waiterResolved === true, 'waitForRecipients resolves once a stream binds a resource');
      assert(serverManager.hasRecipients() === true, 'the server manager now reports a recipient');

      const delivered = await serverManager.send('m1,m2');
      assert(delivered.delivered && delivered.recipients === 1, 'the manager should deliver to one recipient');

      await clientManager.send('reply,line');
      await waitFor(() => inbound.length > 0);
      assert(inbound[0].protocol === 'xmpp' && inbound[0].data === 'reply,line',
        'the client manager should surface inbound data with the protocol tag');

      await clientManager.disconnect();
      assert(clientManager.isConnected() === false, 'the client manager should disconnect cleanly');
      await waitFor(() => serverManager.hasRecipients() === false);
      assert(serverManager.hasRecipients() === false, 'the server manager drops the recipient');
    } finally {
      await clientManager.disconnect().catch(() => {});
      await serverManager.disconnect().catch(() => {});
    }
  });

  console.log(`\nXMPP transport: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
