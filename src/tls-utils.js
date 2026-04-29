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
 * @file tls-utils.js
 * @description
 * Shared TLS utilities for the ArcGIS Velocity Simulator.
 *
 * Provides OS certificate store loading (macOS Keychain, Linux bundle paths,
 * Windows certificate store) and helper functions used by both gRPC and HTTP
 * transports to establish secure connections.
 */
const fs = require('fs');

/**
 * Loads root certificates from both the Node.js bundled store and the OS
 * certificate store, returning the PEM buffer and human-readable metadata.
 *
 * This is necessary because Electron bundles its own Node.js which may not
 * automatically consult the OS certificate store, causing TLS failures when
 * connecting to servers that use internal/enterprise CA certificates
 * (e.g. Esri Root CA).
 *
 * The result is cached after the first call.
 */
let _systemRootCertsResult = null;
function getSystemRootCertificates() {
  if (_systemRootCertsResult) return _systemRootCertsResult;

  const tls = require('tls');
  const bundledCerts = tls.rootCertificates || [];
  const certs = [...bundledCerts];
  const bundledCount = bundledCerts.length;
  let osSource = null;
  let osCount = 0;

  if (process.platform === 'darwin') {
    try {
      const { execSync } = require('child_process');
      let keychainArgs = '/System/Library/Keychains/SystemRootCertificates.keychain /Library/Keychains/System.keychain';
      try {
        const listed = execSync(
          'security list-keychains',
          { timeout: 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
        ).replace(/"/g, '').trim().split('\n').map((s) => s.trim()).filter(Boolean).join(' ');
        if (listed) keychainArgs = `${keychainArgs} ${listed}`;
      } catch (_) { /* use default keychains only */ }
      const pemOutput = execSync(
        `security find-certificate -a -p ${keychainArgs}`,
        { timeout: 10000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
      );
      const matches = pemOutput.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
      if (matches) {
        certs.push(...matches);
        osCount = matches.length;
        osSource = 'macOS Keychain (system + login)';
      }
    } catch (_) { /* keychain read failed — fall back to bundled certs only */ }
  } else if (process.platform === 'linux') {
    const bundlePaths = [
      '/etc/ssl/certs/ca-certificates.crt',
      '/etc/pki/tls/certs/ca-bundle.crt',
      '/etc/ssl/ca-bundle.pem',
    ];
    for (const bundlePath of bundlePaths) {
      try {
        const pemOutput = fs.readFileSync(bundlePath, 'utf-8');
        const matches = pemOutput.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
        if (matches) {
          certs.push(...matches);
          osCount = matches.length;
          osSource = bundlePath;
          break;
        }
      } catch (_) { /* try next path */ }
    }
  } else if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      const psScript = [
        'Get-ChildItem -Path Cert:\\LocalMachine\\Root, Cert:\\CurrentUser\\Root |',
        '  Sort-Object -Property Thumbprint -Unique |',
        '  ForEach-Object {',
        "    '-----BEGIN CERTIFICATE-----'",
        "    [Convert]::ToBase64String($_.RawData, 'InsertLineBreaks')",
        "    '-----END CERTIFICATE-----'",
        '  }',
      ].join('\n');
      const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64');
      const pemOutput = execSync(
        `powershell -NoProfile -NonInteractive -EncodedCommand ${encodedCommand}`,
        { timeout: 15000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
      );
      const matches = pemOutput.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
      if (matches) {
        certs.push(...matches);
        osCount = matches.length;
        osSource = 'Windows certificate store';
      }
    } catch (_) { /* Windows cert store read failed — fall back to bundled certs only */ }
  }

  const uniqueCerts = [...new Set(certs)];
  const pemBuffer = Buffer.from(uniqueCerts.join('\n'));

  _systemRootCertsResult = {
    pemBuffer,
    bundledCount,
    osCount,
    osSource,
    totalCount: uniqueCerts.length,
  };
  return _systemRootCertsResult;
}

/**
 * Builds a human-readable TLS certificate summary string for logging.
 */
function formatTlsCertSummary(certInfo) {
  if (!certInfo) return 'bundled CAs';
  const parts = [`${certInfo.totalCount} trusted CAs loaded`];
  parts.push(`node-bundled=${certInfo.bundledCount}`);
  if (certInfo.osSource) {
    parts.push(`os=${certInfo.osSource} (${certInfo.osCount})`);
  }
  return parts.join(', ');
}

/**
 * Builds HTTPS agent options for Node's https module (client mode).
 *
 * When useTls is true with no custom certs, loads both Node.js bundled
 * root certificates AND the OS certificate store.
 *
 * @param {object} opts
 * @param {boolean} [opts.useTls=true]
 * @param {string} [opts.tlsCaPath] - Path to CA certificate file (PEM)
 * @param {string} [opts.tlsCertPath] - Path to client certificate file (PEM)
 * @param {string} [opts.tlsKeyPath] - Path to private key file (PEM)
 * @returns {{ agentOptions: object, tlsInfo: string }}
 */
function buildHttpsAgentOptions({ useTls = true, tlsCaPath, tlsCertPath, tlsKeyPath } = {}) {
  if (!useTls) {
    return { agentOptions: null, tlsInfo: 'tls=off (unsecure)' };
  }
  const hasCustomCerts = tlsCaPath || tlsCertPath || tlsKeyPath;
  if (!hasCustomCerts) {
    const certResult = getSystemRootCertificates();
    // No CA cert provided — allow self-signed server certs by disabling certificate
    // authority verification. The connection is still TLS-encrypted; only CA chain
    // validation is skipped. Users requiring full verification should supply tlsCaPath.
    return {
      agentOptions: { ca: certResult.pemBuffer, rejectUnauthorized: false },
      tlsInfo: `tls=on (cert verification skipped — no CA provided), ${formatTlsCertSummary(certResult)}`,
    };
  }
  const agentOptions = {};
  const customParts = [];
  if (tlsCaPath) { agentOptions.ca = fs.readFileSync(tlsCaPath); customParts.push(`ca=${tlsCaPath}`); }
  if (tlsCertPath) { agentOptions.cert = fs.readFileSync(tlsCertPath); customParts.push(`cert=${tlsCertPath}`); }
  if (tlsKeyPath) { agentOptions.key = fs.readFileSync(tlsKeyPath); customParts.push(`key=${tlsKeyPath}`); }
  return {
    agentOptions,
    tlsInfo: `tls=on, custom certs: ${customParts.join(', ')}`,
  };
}

/**
 * Returns the list of local IPv4 addresses for all active network interfaces.
 * Always includes 127.0.0.1.
 *
 * @returns {string[]}
 */
function getLocalIpAddresses() {
  const os = require('os');
  const ips = new Set(['127.0.0.1']);
  const ifaces = os.networkInterfaces();
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        ips.add(addr.address);
      }
    }
  }
  return [...ips];
}

/**
 * Generates an in-memory self-signed certificate and private key using the
 * `selfsigned` package. The certificate covers localhost, 127.0.0.1, all
 * local IPv4 addresses, and the machine's hostname so that it works for
 * connections from any network interface — not just loopback.
 *
 * An optional extra `hostname` / `ip` can be provided to ensure a specific
 * address is also covered (e.g. when the server is bound to a particular IP).
 *
 * The result is cached after the first call. Pass `{ force: true }` to
 * regenerate (used after opts change or for testing).
 *
 * @param {object} [opts]
 * @param {string} [opts.hostname] - Extra DNS name to include in the SAN
 * @param {string} [opts.ip]       - Extra IP address to include in the SAN
 * @param {boolean} [opts.force]   - Force regeneration even if cached
 * @returns {{ cert: string, private: string }}
 */
let _selfSignedCert = null;
function generateSelfSignedCert({ hostname: extraHostname, ip: extraIp, force = false } = {}) {
  if (_selfSignedCert && !force) return _selfSignedCert;
  const os = require('os');
  const selfsigned = require('selfsigned');

  const machineHostname = os.hostname();
  const localIps = getLocalIpAddresses();
  if (extraIp) localIps.push(extraIp);

  // Build DNS SANs — always include localhost and machine hostname
  const dnsNames = new Set(['localhost', machineHostname]);
  if (extraHostname) dnsNames.add(extraHostname);

  const altNames = [
    ...[...dnsNames].map((v) => ({ type: 2, value: v })),
    ...[...new Set(localIps)].map((v) => ({ type: 7, ip: v })),
  ];

  const attrs = [{ name: 'commonName', value: machineHostname || 'localhost' }];
  const pems = selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'subjectAltName', altNames },
    ],
  });
  _selfSignedCert = { cert: pems.cert, private: pems.private };
  return _selfSignedCert;
}

/**
 * Resets the cached self-signed certificate (for testing).
 */
function resetSelfSignedCertCache() {
  _selfSignedCert = null;
}

/**
 * Builds TLS options for Node's https.createServer (server mode).
 *
 * When no tlsCertPath/tlsKeyPath are provided, an in-memory self-signed
 * certificate is generated automatically so the server can start in TLS mode
 * without any pre-configured certificate files. The generated certificate
 * covers localhost, 127.0.0.1, the machine hostname, all local IPv4 addresses,
 * and any extra `ip` / `hostname` passed in opts — so it works for connections
 * from any network interface, not only loopback.
 *
 * Clients connecting to a self-signed server must either disable certificate
 * verification or supply the generated CA cert; the tlsInfo string indicates
 * "self-signed".
 *
 * @param {object} opts
 * @param {boolean} [opts.useTls=true]
 * @param {string} [opts.tlsCaPath]
 * @param {string} [opts.tlsCertPath]
 * @param {string} [opts.tlsKeyPath]
 * @param {string} [opts.ip]       - Extra IP to include in self-signed SAN
 * @param {string} [opts.hostname] - Extra hostname to include in self-signed SAN
 * @returns {{ serverOptions: object|null, tlsInfo: string }}
 */
function buildHttpsServerOptions({ useTls = true, tlsCaPath, tlsCertPath, tlsKeyPath, ip, hostname } = {}) {
  if (!useTls) {
    return { serverOptions: null, tlsInfo: 'tls=off (unsecure)' };
  }
  const serverOptions = {};
  const parts = [];
  if (tlsCaPath) { serverOptions.ca = fs.readFileSync(tlsCaPath); parts.push(`ca=${tlsCaPath}`); }
  if (tlsCertPath) { serverOptions.cert = fs.readFileSync(tlsCertPath); parts.push(`cert=${tlsCertPath}`); }
  if (tlsKeyPath) { serverOptions.key = fs.readFileSync(tlsKeyPath); parts.push(`key=${tlsKeyPath}`); }
  if (!serverOptions.cert || !serverOptions.key) {
    const selfSigned = generateSelfSignedCert({ ip, hostname });
    serverOptions.cert = selfSigned.cert;
    serverOptions.key = selfSigned.private;
    parts.push('cert=self-signed (auto-generated)', 'key=self-signed (auto-generated)');
  }
  return {
    serverOptions,
    tlsInfo: `tls=on, ${parts.join(', ')}`,
    selfSigned: !tlsCertPath && !tlsKeyPath ? generateSelfSignedCert({ ip, hostname }).cert : null,
  };
}

/**
 * Resets the cached system root certificates (for testing).
 */
function resetSystemRootCertsCache() {
  _systemRootCertsResult = null;
}

module.exports = {
  getSystemRootCertificates,
  getLocalIpAddresses,
  formatTlsCertSummary,
  buildHttpsAgentOptions,
  buildHttpsServerOptions,
  generateSelfSignedCert,
  resetSystemRootCertsCache,
  resetSelfSignedCertCache,
};

