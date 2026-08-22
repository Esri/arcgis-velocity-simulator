/**
 * XMPP transport secret-disclosure regression suite.
 *
 * Complements `xmpp-core.test.js` by proving the last bound required by the
 * production transport scope: the implementation never leaks a credential. It drives a complete
 * authenticated session (STARTTLS + SCRAM-SHA-1, then a second session using
 * PLAIN, a password-protected MUC join, direct chat and groupchat) while
 * capturing every byte written to stdout/stderr and every diagnostic object the
 * modules expose, then asserts that no configured secret appears anywhere.
 *
 * Run with: npm run test:xmpp-secrets
 */

const { TLS_POLICIES, XmppServerCore } = require('../src/xmpp-server-core');
const { XmppClientCore } = require('../src/xmpp-client-core');
const { createAccountStore } = require('../src/xmpp-accounts');
const { createMucService } = require('../src/xmpp-muc');
const { redactSecret } = require('../src/xmpp-utils');

const EXTERNAL_PASSWORD = 'external-secret-Ma9tQ2';
const INTERNAL_PASSWORD = 'internal-secret-Zk4vR7';
const ROOM_PASSWORD = 'room-secret-Wc6bN1';
const ROOM = 'velocity@conference.localhost';

const SECRETS = [EXTERNAL_PASSWORD, INTERNAL_PASSWORD, ROOM_PASSWORD];

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`✅ ${message}`); }
  else { failed++; console.error(`❌ ${message}`); }
}

/** Collects everything written to stdout/stderr and via console while `fn` runs. */
async function captureOutput(fn) {
  const chunks = [];
  const originalStdout = process.stdout.write;
  const originalStderr = process.stderr.write;
  const originalConsole = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    originalConsole[level] = console[level];
    console[level] = (...args) => { chunks.push(args.map((a) => safeStringify(a)).join(' ')); };
  }
  process.stdout.write = (chunk, ...rest) => {
    chunks.push(typeof chunk === 'string' ? chunk : String(chunk));
    return typeof rest[rest.length - 1] === 'function' ? rest[rest.length - 1]() : true;
  };
  process.stderr.write = process.stdout.write;

  try {
    await fn(chunks);
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
    for (const [level, original] of Object.entries(originalConsole)) console[level] = original;
  }
  return chunks.join('\n');
}

function safeStringify(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, (key, inner) => (inner instanceof Error ? inner.message : inner));
  } catch (_) {
    return String(value);
  }
}

/** Records every event an XMPP emitter produces, serialised for inspection. */
function recordEvents(emitter, names, sink) {
  for (const name of names) {
    emitter.on(name, (payload) => sink.push(`${name}:${safeStringify(payload)}`));
  }
}

function findLeak(haystack) {
  return SECRETS.find((secret) => haystack.includes(secret)) || null;
}

async function closeClient(client) {
  if (!client) return;
  client.entity.reconnect.stop();
  try {
    await client.close();
  } catch (_) { /* the stream may already be gone */ }
}

async function run() {
  console.log('\n=== XMPP Secret-Disclosure Tests ===');

  // ---------------------------------------------------------------------------
  // 1. Pure diagnostic surfaces
  // ---------------------------------------------------------------------------
  const store = createAccountStore({
    domain: 'localhost',
    internalAppPassword: INTERNAL_PASSWORD,
    externalAccount: { username: 'external', password: EXTERNAL_PASSWORD },
  });
  const storeDescription = safeStringify(store.describe());
  assert(!findLeak(storeDescription), 'accountStore.describe() discloses no password');
  assert(storeDescription.includes('<redacted:'), 'accountStore.describe() reports redacted markers instead');
  assert(redactSecret(EXTERNAL_PASSWORD) === `<redacted:${EXTERNAL_PASSWORD.length}B>`, 'redactSecret exposes only a byte length');
  assert(!findLeak(redactSecret(EXTERNAL_PASSWORD)), 'redactSecret output contains no fragment of the secret');

  const muc = createMucService({
    mucDomain: 'conference.localhost',
    rooms: [{ jid: ROOM, password: ROOM_PASSWORD }],
  });
  const mucDescription = safeStringify(muc.describe());
  assert(!findLeak(mucDescription), 'mucService.describe() discloses no room password');
  assert(mucDescription.includes('"passwordProtected":true'), 'mucService.describe() reports protection as a boolean only');

  // A failed join must not echo the attempted password back to the caller.
  const rejected = muc.join({
    roomJid: ROOM, nick: 'nick', password: 'wrong', sessionId: 's', fullJid: 'a@localhost/1',
  });
  assert(!rejected.ok, 'a wrong room password is rejected');
  assert(!safeStringify(rejected).includes('wrong'), 'the rejection payload does not echo the attempted password');

  // ---------------------------------------------------------------------------
  // 2. A full live session over STARTTLS + SCRAM-SHA-1, then PLAIN
  // ---------------------------------------------------------------------------
  const serverEvents = [];
  const clientEvents = [];
  let scramSecure = false;
  let plainSecure = false;
  let selfEchoSeen = false;
  let chatSeen = false;
  let sessionError = null;

  const output = await captureOutput(async () => {
    const server = new XmppServerCore({
      tlsPolicy: TLS_POLICIES.REQUIRED,
      externalAccount: { username: 'external', password: EXTERNAL_PASSWORD },
      internalAccount: { username: 'app', password: INTERNAL_PASSWORD },
      roomPasswords: { [ROOM]: ROOM_PASSWORD },
    });
    recordEvents(server, [
      'listening', 'connection', 'secure', 'authenticated', 'bound', 'message',
      'mucJoin', 'mucMessage', 'mucLeave', 'disconnect', 'clientError',
    ], serverEvents);

    const result = await server.listen();
    const service = `xmpp://127.0.0.1:${result.address.port}`;
    let scram;
    let plain;

    try {
      scram = new XmppClientCore({
        service,
        domain: 'localhost',
        username: 'external',
        password: EXTERNAL_PASSWORD,
        resource: 'scram',
        ca: result.selfSignedCertificate,
      });
      recordEvents(scram, ['status', 'online', 'offline', 'stanza', 'chat', 'mucMessage', 'error'], clientEvents);
      await scram.connect();
      scramSecure = scram.isSecure();

      plain = new XmppClientCore({
        service,
        domain: 'localhost',
        username: 'app',
        password: INTERNAL_PASSWORD,
        resource: 'plain',
        mechanism: 'PLAIN',
        ca: result.selfSignedCertificate,
      });
      recordEvents(plain, ['status', 'online', 'offline', 'stanza', 'chat', 'mucMessage', 'error'], clientEvents);
      await plain.connect();
      plainSecure = plain.isSecure();

      // Direct chat.
      const chat = new Promise((resolve) => plain.once('chat', resolve));
      await scram.sendChat(plain.jid, 'hello over a secured stream');
      chatSeen = (await chat).body === 'hello over a secured stream';

      // Password-protected MUC join, groupchat and self echo.
      await scram.joinMuc(ROOM, 'alpha', ROOM_PASSWORD);
      await plain.joinMuc(ROOM, 'beta', ROOM_PASSWORD);
      const echo = new Promise((resolve) => scram.once('mucMessage', resolve));
      await scram.sendMuc(ROOM, 'groupchat body');
      const echoed = await echo;
      selfEchoSeen = echoed.self === true && echoed.nickname === 'alpha';

      await scram.ping();
      await scram.leaveMuc(ROOM);
    } catch (error) {
      sessionError = error;
    } finally {
      await closeClient(scram);
      await closeClient(plain);
      await server.close();
    }
  });

  assert(sessionError === null, `the live session completed without error${sessionError ? `: ${sessionError.message}` : ''}`);
  assert(scramSecure === true, 'the SCRAM-SHA-1 session negotiated STARTTLS');
  assert(plainSecure === true, 'the PLAIN session negotiated STARTTLS before authenticating');
  assert(chatSeen === true, 'the direct chat body was delivered');
  assert(selfEchoSeen === true, 'the MUC self echo was identified by nickname');

  const outputLeak = findLeak(output);
  assert(outputLeak === null, `no secret is written to stdout/stderr or console${outputLeak ? ` (leaked: ${outputLeak.slice(0, 4)}…)` : ''}`);

  const serverEventText = serverEvents.join('\n');
  const serverLeak = findLeak(serverEventText);
  assert(serverLeak === null, 'no secret appears in any server diagnostic event payload');
  assert(serverEvents.some((entry) => entry.startsWith('authenticated:')), 'the server emitted an authenticated event to inspect');
  assert(serverEvents.some((entry) => entry.startsWith('mucJoin:')), 'the server emitted a mucJoin event to inspect');

  const clientEventText = clientEvents.join('\n');
  const clientLeak = findLeak(clientEventText);
  assert(clientLeak === null, 'no secret appears in any client event payload or received stanza');
  assert(clientEvents.some((entry) => entry.startsWith('stanza:')), 'client stanzas were captured for inspection');

  console.log('\n=== Test Results ===');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);
  if (failed > 0) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
