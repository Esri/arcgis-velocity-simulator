const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../src/tls-utils.js'), 'utf8');
const bundled = '-----BEGIN CERTIFICATE-----\nYnVuZGxlZA==\n-----END CERTIFICATE-----';
const privateRoot = '-----BEGIN CERTIFICATE-----\ncHJpdmF0ZQ==\n-----END CERTIFICATE-----';

function load(platform, { files = {}, commandOutput = privateRoot, commandFails = false } = {}) {
  const commands = [];
  const reads = [];
  const moduleValue = { exports: {} };
  const fakeFs = {
    readFileSync(file) {
      reads.push(file);
      if (Object.hasOwn(files, file)) return files[file];
      throw Object.assign(new Error('Missing test certificate bundle.'), { code: 'ENOENT' });
    },
  };
  vm.runInNewContext(source, {
    module: moduleValue, Buffer, process: { platform },
    require(name) {
      if (name === 'fs') return fakeFs;
      if (name === 'tls') return { rootCertificates: [bundled] };
      if (name === 'child_process') return {
        execSync(command, options) {
          commands.push({ command, options });
          if (commandFails) throw new Error('Test certificate store unavailable.');
          if (command === 'security list-keychains') return '"/test/login.keychain-db"';
          return commandOutput;
        },
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { ...moduleValue.exports, commands, reads };
}

const windows = load('win32', { commandOutput: `${privateRoot}\n${bundled}` });
const windowsRoots = windows.getSystemRootCertificates();
assert.strictEqual(windowsRoots.osSource, 'Windows certificate store');
assert.strictEqual(windowsRoots.bundledCount, 1);
assert.strictEqual(windowsRoots.totalCount, 2);
assert.ok(windowsRoots.pemBuffer.toString().includes(privateRoot));
const windowsCommand = windows.commands[0];
assert.match(windowsCommand.command, /^powershell -NoProfile -NonInteractive -EncodedCommand /);
const script = Buffer.from(windowsCommand.command.split(' ').at(-1), 'base64').toString('utf16le');
assert.ok(script.includes('Cert:\\LocalMachine\\Root, Cert:\\CurrentUser\\Root'));
assert.ok(script.includes('$_.RawData'));
assert.ok(windowsCommand.options.timeout > 0);
assert.strictEqual(windows.getSystemRootCertificates(), windowsRoots);
assert.strictEqual(windows.commands.length, 1);
windows.resetSystemRootCertsCache();
windows.getSystemRootCertificates();
assert.strictEqual(windows.commands.length, 2);

const linuxPaths = [
  '/etc/ssl/certs/ca-certificates.crt',
  '/etc/pki/tls/certs/ca-bundle.crt',
  '/etc/ssl/ca-bundle.pem',
];
for (const [index, bundlePath] of linuxPaths.entries()) {
  const linux = load('linux', { files: { [bundlePath]: privateRoot } });
  const roots = linux.getSystemRootCertificates();
  assert.strictEqual(roots.osSource, bundlePath);
  assert.strictEqual(roots.totalCount, 2);
  assert.ok(roots.pemBuffer.toString().includes(privateRoot));
  assert.deepStrictEqual(linux.reads, linuxPaths.slice(0, index + 1));
  assert.strictEqual(linux.commands.length, 0);
}

const mac = load('darwin');
assert.strictEqual(mac.getSystemRootCertificates().osSource, 'macOS Keychain (system + login)');
assert.ok(mac.commands[1].command.includes('/System/Library/Keychains/SystemRootCertificates.keychain'));
assert.ok(mac.commands[1].command.includes('/Library/Keychains/System.keychain'));
assert.ok(mac.commands[1].command.includes('/test/login.keychain-db'));

for (const platform of ['win32', 'linux', 'darwin']) {
  const unavailable = load(platform, { commandFails: true });
  const roots = unavailable.getSystemRootCertificates();
  assert.strictEqual(roots.osSource, null);
  assert.strictEqual(roots.osCount, 0);
  assert.strictEqual(roots.pemBuffer.toString(), bundled);
}
console.log('tls-system-roots tests passed');
