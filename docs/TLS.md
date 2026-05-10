# TLS / SSL Security

This document covers all aspects of TLS (Transport Layer Security) support in the ArcGIS Velocity Simulator: certificate type taxonomy, platform-specific behaviour (macOS / Linux / Windows), certificate file formats, OS trust store integration, working with a custom CA, mutual TLS (mTLS), the TLS Trust Badge, and per-protocol notes.

> **Terminology:** This documentation uses **"unsecure"** (not "insecure") for connections that lack TLS/encryption. Third-party API identifiers such as `createInsecure()` are left unchanged.

---

## Supported Protocols

TLS is supported on three transports:

| Protocol | Client mode | Server mode | Notes |
|----------|-------------|-------------|-------|
| **HTTP** | ✅ HTTPS | ✅ HTTPS | Default port 8443 when `useTls=true` |
| **WebSocket** | ✅ WSS | ✅ WSS | Default port 8443 when `useTls=true` |
| **gRPC** | ✅ SSL credentials | ✅ SSL credentials | Mandatory HTTP/2; TLS controlled via `useTls` flag |

**TCP and UDP** do not support TLS. TCP uses a plain line-delimited protocol matching ArcGIS Velocity's native TCP feed format. UDP is connectionless and DTLS is not supported by Node.js's built-in `dgram` module.

---

## CLI Parameters

These parameters apply to all TLS-capable protocols (HTTP, WebSocket, gRPC):

| Parameter | Description |
|-----------|-------------|
| `useTls` | Enable TLS/SSL for the connection (default: `false`). |
| `tlsCaPath` | Path to a custom CA certificate PEM file. When omitted in client mode, OS root CAs are loaded automatically. |
| `tlsCertPath` | Path to a client/server certificate PEM file. Required for server-mode TLS; required in client mode only for mTLS. |
| `tlsKeyPath` | Path to a private key PEM file. Required for server-mode TLS and client-side mTLS. |

---

## Certificate Types

Understanding the different certificate types is key to knowing which parameter to use and what level of trust each provides.

### 1. Self-Signed Certificate

A certificate that is signed by its own private key rather than by a CA. It contains both the subject and the issuer fields pointing to the same entity.

**Characteristics:**
- Zero-cost — no CA needed
- Expires on a date you control
- **Not trusted by any client by default** — browsers and TLS clients will refuse it unless you explicitly tell them to trust it (`rejectUnauthorized: false`) or add it to your trust store
- No revocation mechanism
- SANs (Subject Alternative Names) must be set manually; many modern clients reject certs without them

**When to use:** Local development and testing only. Never in production.

**How it maps to the app:**
- When `useTls=true` on a server with no `tlsCertPath`/`tlsKeyPath`, the app auto-generates an ephemeral self-signed cert (see [Server-Mode TLS — Automatic Self-Signed Certificate](#server-mode-tls--automatic-self-signed-certificate))
- The TLS Trust Badge shows 🔒⚠ (amber)

**OpenSSL — single-step self-signed cert:**
```bash
openssl req -x509 -newkey rsa:4096 \
  -keyout server-key.pem -out server.pem \
  -days 365 -nodes \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```
`-nodes` omits the passphrase so the app can load the key without a prompt.

---

### 2. CA Certificate (Root CA)

A CA (Certificate Authority) certificate is a self-signed certificate whose purpose is to **sign other certificates**. The `CA:TRUE` Basic Constraints extension marks it as a trust anchor.

**Characteristics:**
- Trusted by adding it to a client's trust store (via `tlsCaPath`, or the OS certificate store)
- All certificates it signs are automatically trusted by clients that trust the CA
- The CA private key (`ca-key.pem`) must be kept secure — anyone with it can issue trusted certs
- Typically long-lived (5–10 years)

**When to use:** When you want several servers/clients to trust each other without touching the OS store on every machine. Create one CA, distribute `ca.pem` via `tlsCaPath`, and issue as many server/client certs as you need.

**How it maps to the app:**
- Set `tlsCaPath=./certs/ca.pem` on any client to trust servers whose certs were signed by this CA
- The TLS Trust Badge shows 🔒✓ (green) when the chain verifies successfully

---

### 3. CA-Signed Server Certificate

A certificate issued and signed by a CA (your own private CA, or a public one like Let's Encrypt / DigiCert). The client verifies the chain: `server cert → intermediate CA (if any) → root CA`.

**Characteristics:**
- Trusted by any client that trusts the CA
- Contains SANs for the server's hostname/IP
- Short-lived (90 days for Let's Encrypt; 1 year recommended for private CAs)
- Can be revoked via CRL or OCSP

**How it maps to the app:**
- Set on the server: `tlsCertPath=./certs/server.pem` + `tlsKeyPath=./certs/server-key.pem`
- Clients using the same CA set `tlsCaPath=./certs/ca.pem`; clients using a public CA need no `tlsCaPath` at all (the OS store covers it)
- The TLS Trust Badge shows 🔒✓ (green)

---

### 4. Client Certificate (for mTLS)

A certificate presented by the **client** to the server during the TLS handshake. It proves the client's identity, not just the server's.

**Characteristics:**
- Signed by the same CA the server trusts
- The server must be configured to _request_ and _verify_ client certificates
- The CN or SAN typically identifies the client application or user

**How it maps to the app:**
- Set on the client: `tlsCertPath=./certs/client.pem` + `tlsKeyPath=./certs/client-key.pem`
- The TLS Trust Badge shows 🔐 (blue/cyan) when the app detects mutual auth
- See [Mutual TLS (mTLS)](#mutual-tls-mtls) for the full workflow

---

### 5. Intermediate CA Certificate

An optional layer between the root CA and end-entity certs. The root CA signs the intermediate; the intermediate signs server/client certs. This keeps the root CA key offline.

**Characteristics:**
- Has `CA:TRUE` + `pathLenConstraint` in Basic Constraints
- Can be chained: server cert → intermediate → root
- Common in enterprise PKI

**How it maps to the app:**
- Bundle the intermediate and root into a single PEM chain file (root last) and supply it as `tlsCaPath`
- Or bundle intermediate + server cert into the `tlsCertPath` file if the client needs to build the chain

**Concatenating a chain:**
```bash
# On macOS / Linux
cat intermediate.pem ca.pem > ca-chain.pem
```
```powershell
# On Windows PowerShell
Get-Content intermediate.pem, ca.pem | Set-Content ca-chain.pem
```

---

### 6. OS / System Certificate Store (Public Root CAs)

Public root CAs (DigiCert, Let's Encrypt ISRG Root, etc.) are pre-installed in the operating system certificate store. No `tlsCaPath` is needed when connecting to servers with publicly issued certificates — the app reads the OS store automatically.

**How it maps to the app:**
- Omit `tlsCaPath` entirely; the app merges Node.js bundled CAs with the OS store
- The TLS Trust Badge shows 🔒 (amber) — TLS on, but the exact trust level is not determinable from the cert info string alone

---

## Platform-Specific Notes

### macOS

#### OpenSSL availability

macOS ships with **LibreSSL** on the `openssl` command, not the OpenSSL project's binary. The `-addext` flag (used for SANs) requires OpenSSL ≥ 1.1.1 and is **not supported** by LibreSSL. Options:

```bash
# Install OpenSSL via Homebrew (recommended)
brew install openssl

# Then call it explicitly
/opt/homebrew/opt/openssl@3/bin/openssl req -x509 ...
# or add it to PATH:
export PATH="/opt/homebrew/opt/openssl@3/bin:$PATH"
```

Alternatively use an `openssl.cnf` extension file (see [Subject Alternative Names without -addext](#subject-alternative-names-san-without--addext) below).

#### OS certificate store

The app reads the **System** and **SystemRoot** keychains using `security find-certificate -a -p`. This includes:
- All certs in `/System/Library/Keychains/SystemRootCertificates.keychain`
- All certs in `/Library/Keychains/System.keychain`
- **Not** the user's login keychain by default

**Adding a private CA to the macOS trust store** (so it is trusted system-wide):
```bash
sudo security add-trusted-cert \
  -d \
  -r trustRoot \
  -k /Library/Keychains/System.keychain \
  ca.pem
```

After this, clients on the same Mac that read the system keychain — including the app — will trust certs signed by your CA **without** needing `tlsCaPath`.

**Removing it:**
```bash
sudo security remove-trusted-cert -d ca.pem
```

---

### Linux

#### OpenSSL availability

OpenSSL is typically pre-installed (`openssl version`). On minimal images you may need:
```bash
# Debian / Ubuntu
sudo apt-get install openssl

# RHEL / CentOS / Fedora
sudo dnf install openssl
```

All bash examples in this document work unchanged on Linux.

#### OS certificate store — distribution differences

| Distro family | System bundle path | Update command |
|---------------|--------------------|----------------|
| Debian / Ubuntu | `/etc/ssl/certs/ca-certificates.crt` | `sudo update-ca-certificates` |
| RHEL / CentOS / Fedora | `/etc/pki/tls/certs/ca-bundle.crt` | `sudo update-ca-trust` |
| Alpine | `/etc/ssl/cert.pem` | `sudo update-ca-certificates` |

The app tries all three bundle paths in order. If none exists, it falls back to the Node.js bundled CAs.

**Adding a private CA to the Linux trust store:**

*Debian / Ubuntu:*
```bash
sudo cp ca.pem /usr/local/share/ca-certificates/my-ca.crt   # must end in .crt
sudo update-ca-certificates
```

*RHEL / Fedora:*
```bash
sudo cp ca.pem /etc/pki/ca-trust/source/anchors/my-ca.pem
sudo update-ca-trust extract
```

After this, the app picks up the new CA from the system bundle automatically — no `tlsCaPath` needed.

---

### Windows

#### OpenSSL availability

Windows does **not** ship with OpenSSL. Options:

- **Git for Windows** — installs OpenSSL; available as `openssl` in Git Bash
- **Chocolatey:** `choco install openssl`
- **Scoop:** `scoop install openssl`
- **WSL (Windows Subsystem for Linux)** — use the Linux OpenSSL inside WSL, files accessible from Windows at `\\wsl$\...`

> All multi-line bash examples in this document use `\` as a line continuation. In **Windows Command Prompt** use `^` instead. In **PowerShell** use a backtick `` ` `` or just write it as one line. **Git Bash** accepts `\` directly.

**Windows Command Prompt equivalents:**
```cmd
openssl req -x509 -newkey rsa:4096 ^
  -keyout server-key.pem -out server.pem ^
  -days 365 -nodes ^
  -subj "/CN=localhost"
```

**PowerShell equivalents:**
```powershell
openssl req -x509 -newkey rsa:4096 `
  -keyout server-key.pem -out server.pem `
  -days 365 -nodes `
  -subj "/CN=localhost"
```

The `<(printf ...)` process substitution used for SANs in the bash `openssl x509 -extfile` step is **not available** in cmd or PowerShell. Use a file instead:

```powershell
# Write SAN extension to a temp file
Set-Content san.cnf "subjectAltName=DNS:localhost,IP:127.0.0.1"

# Sign using the file
openssl x509 -req -days 365 `
  -in server.csr `
  -CA ca.pem -CAkey ca-key.pem -CAcreateserial `
  -out server.pem `
  -extfile san.cnf

Remove-Item san.cnf
```

#### OS certificate store

The app reads the Windows **LocalMachine\Root** and **CurrentUser\Root** certificate stores via PowerShell and exports the raw DER bytes as PEM. This is the same set of trusted CAs that Internet Explorer / Edge / Chrome use on Windows.

**Adding a private CA to the Windows trust store:**

*PowerShell (run as Administrator):*
```powershell
Import-Certificate -FilePath "ca.pem" `
  -CertStoreLocation Cert:\LocalMachine\Root
```

Or via the MMC snap-in: `certmgr.msc` → Trusted Root Certification Authorities → Import.

After this, the app trusts your CA from the OS store — no `tlsCaPath` needed.

**Removing it:**
```powershell
# Find it by thumbprint first
Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Subject -like "*My Test CA*" }

# Then remove
Remove-Item Cert:\LocalMachine\Root\<THUMBPRINT>
```

> `Import-Certificate` requires `.cer`/`.crt` (DER or PEM). PEM files work as-is on modern Windows; if you get an error, rename `ca.pem` to `ca.crt`.

---

### Subject Alternative Names (SAN) without `-addext`

If your OpenSSL does not support `-addext` (LibreSSL on macOS, older OpenSSL builds), write an extensions config file instead:

```bash
# san.cnf
cat > san.cnf <<EOF
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = localhost

[v3_req]
subjectAltName = DNS:localhost,IP:127.0.0.1
EOF

# Self-signed: use -config with the extensions section
openssl req -x509 -newkey rsa:4096 \
  -keyout server-key.pem -out server.pem \
  -days 365 -nodes \
  -config san.cnf \
  -extensions v3_req

# CA-signed: pass extensions at signing time
openssl x509 -req -days 365 \
  -in server.csr \
  -CA ca.pem -CAkey ca-key.pem -CAcreateserial \
  -out server.pem \
  -extfile san.cnf \
  -extensions v3_req
```

---

## Certificate File Formats

All certificate and key files must be in **PEM** format (Base64-encoded DER with `-----BEGIN CERTIFICATE-----` / `-----BEGIN PRIVATE KEY-----` ASCII-armour headers). Both RSA (2048-bit minimum; 4096-bit recommended) and ECDSA (`prime256v1` / `secp384r1`) keys are accepted.

### Certificate parameter roles

| Parameter | Holds | When required |
|-----------|-------|---------------|
| `tlsCertPath` | Server certificate **or** client certificate (mTLS) | Server mode always; client mode only for mTLS |
| `tlsKeyPath` | Private key matching `tlsCertPath` | Server mode always; client mode only for mTLS |
| `tlsCaPath` | CA certificate (or chain) that issued `tlsCertPath` | Client mode when the server cert was signed by a private CA not in the OS store; server mode when verifying client certs |

---

## Working with a Custom Certificate Authority

Using your own CA gives you full control over which certificates are trusted — useful for private infrastructure, enterprise environments, or testing without buying a public certificate.

### Step 1 — Create the CA

```bash
# Generate CA private key (keep this secret)
openssl genrsa -out ca-key.pem 4096

# Self-sign the CA certificate (valid 10 years)
openssl req -new -x509 -days 3650 \
  -key ca-key.pem \
  -out ca.pem \
  -subj "/CN=My Test CA/O=My Org"
```

`ca.pem` is the trust anchor you will distribute to clients via `tlsCaPath`.

### Step 2 — Issue a server certificate signed by the CA

```bash
# Generate server private key
openssl genrsa -out server-key.pem 4096

# Create a certificate signing request (CSR)
openssl req -new \
  -key server-key.pem \
  -out server.csr \
  -subj "/CN=localhost"

# Sign the CSR with your CA; include SANs so modern TLS clients accept it
openssl x509 -req -days 365 \
  -in server.csr \
  -CA ca.pem -CAkey ca-key.pem -CAcreateserial \
  -out server.pem \
  -extfile <(printf "subjectAltName=DNS:localhost,IP:127.0.0.1\n")
```

You now have:
- `ca.pem` — CA certificate (distribute to clients as `tlsCaPath`)
- `server.pem` — Server certificate (set as `tlsCertPath` on the server)
- `server-key.pem` — Server private key (set as `tlsKeyPath` on the server)

### Step 3 — Issue a client certificate for mTLS (optional)

```bash
openssl genrsa -out client-key.pem 4096

openssl req -new \
  -key client-key.pem \
  -out client.csr \
  -subj "/CN=my-client"

openssl x509 -req -days 365 \
  -in client.csr \
  -CA ca.pem -CAkey ca-key.pem -CAcreateserial \
  -out client.pem
```

### Step 4 — Configure each protocol

#### gRPC (server → client)

**Server (Simulator or Logger in server mode):**
```bash
electron . protocol=grpc mode=server port=50051 useTls=true \
  tlsCertPath=./certs/server.pem \
  tlsKeyPath=./certs/server-key.pem
```

**Client (Simulator or Logger in client mode) — custom CA:**
```bash
electron . protocol=grpc mode=client ip=myserver.example.com port=50051 useTls=true \
  tlsCaPath=./certs/ca.pem
```

**Client — mTLS (client also presents a certificate):**
```bash
electron . protocol=grpc mode=client ip=myserver.example.com port=50051 useTls=true \
  tlsCaPath=./certs/ca.pem \
  tlsCertPath=./certs/client.pem \
  tlsKeyPath=./certs/client-key.pem
```

#### HTTP / HTTPS (server → client)

**Server:**
```bash
electron . protocol=http mode=server port=8443 useTls=true \
  tlsCertPath=./certs/server.pem \
  tlsKeyPath=./certs/server-key.pem
```

**Client — custom CA:**
```bash
electron . protocol=http mode=client ip=myserver.example.com port=8443 useTls=true \
  tlsCaPath=./certs/ca.pem
```

**Client — mTLS:**
```bash
electron . protocol=http mode=client ip=myserver.example.com port=8443 useTls=true \
  tlsCaPath=./certs/ca.pem \
  tlsCertPath=./certs/client.pem \
  tlsKeyPath=./certs/client-key.pem
```

#### WebSocket / WSS (server → client)

**Server:**
```bash
electron . protocol=ws mode=server port=8443 useTls=true \
  tlsCertPath=./certs/server.pem \
  tlsKeyPath=./certs/server-key.pem
```

**Client — custom CA:**
```bash
electron . protocol=ws mode=client ip=myserver.example.com port=8443 useTls=true \
  tlsCaPath=./certs/ca.pem
```

**Client — mTLS:**
```bash
electron . protocol=ws mode=client ip=myserver.example.com port=8443 useTls=true \
  tlsCaPath=./certs/ca.pem \
  tlsCertPath=./certs/client.pem \
  tlsKeyPath=./certs/client-key.pem
```

### Quick reference — parameter mapping

| Scenario | `useTls` | `tlsCaPath` | `tlsCertPath` | `tlsKeyPath` |
|----------|:--------:|:-----------:|:-------------:|:------------:|
| Client, OS CA store (default) | ✅ | — | — | — |
| Client, private CA | ✅ | `ca.pem` | — | — |
| Client, mTLS with private CA | ✅ | `ca.pem` | `client.pem` | `client-key.pem` |
| Server, auto self-signed | ✅ | — | — | — |
| Server, custom cert | ✅ | — | `server.pem` | `server-key.pem` |
| Server, custom cert + verify clients (mTLS) | ✅ | `ca.pem` | `server.pem` | `server-key.pem` |

> **Note on mTLS server-side verification:** Currently the apps pass `tlsCaPath` to trust chain validation on the client side. Server-side client-certificate verification (requiring clients to present certs) is enforced at the TLS handshake level by the server's CA configuration. Both sides must supply `tlsCertPath`/`tlsKeyPath` and trust each other's CA via `tlsCaPath` for full mutual authentication.

---

## OS Certificate Stores (Client Mode)

When `useTls=true` is set **without** a custom `tlsCaPath`, the app automatically merges the Node.js bundled root CAs with certificates from the operating system certificate store. This ensures enterprise and internal CAs (e.g. Esri Root CA) are trusted without requiring a manual PEM file.

| Platform | Source | Method used by the app |
|----------|--------|------------------------|
| **macOS** | System and SystemRoot keychains | `security find-certificate -a -p` |
| **Linux** | System PEM bundle | Reads `/etc/ssl/certs/ca-certificates.crt`, `/etc/pki/tls/certs/ca-bundle.crt`, or `/etc/ssl/ca-bundle.pem` (first found) |
| **Windows** | `LocalMachine\Root` and `CurrentUser\Root` stores | PowerShell `Get-ChildItem Cert:\` exported as PEM |

The merged set is deduplicated before use. The connection log shows the cert breakdown on connect:

```
tls=on, 429 trusted CAs loaded, node-bundled=144, os=Windows certificate store (285)
```

To override the automatic OS CA lookup, set `tlsCaPath` to a PEM file path. Only that CA (and any intermediates in the file) will be trusted — the OS store is **not** consulted when `tlsCaPath` is set.

For platform-specific instructions on **adding a private CA to the OS store** so the app trusts it without a `tlsCaPath` file, see the [Platform-Specific Notes](#platform-specific-notes) section above.

---

## Server-Mode TLS — Automatic Self-Signed Certificate

When `useTls=true` is set on a server transport **without** providing `tlsCertPath` and `tlsKeyPath`, the app automatically generates an **in-memory self-signed certificate** at startup. This lets you run a TLS-secured server immediately with no certificate files required.

- The cert is valid for `localhost` and `127.0.0.1` (Subject Alternative Names).
- It is regenerated each time the app starts (ephemeral; never written to disk).
- The connection log shows:

  ```
  tls=on, cert=self-signed (auto-generated), key=self-signed (auto-generated)
  ```

### Connecting a client to a self-signed server

Because the certificate is not signed by a trusted CA, connecting clients will reject it by default.

- **Logger / Simulator pairing (same machine):** Both apps automatically set `rejectUnauthorized: false` when the server advertises a self-signed certificate — no configuration needed for local testing.
- **Custom cert files:** Provide your own cert/key via `tlsCertPath` and `tlsKeyPath`. If clients have the corresponding CA in their trust store they will connect without warnings.

---

## Mutual TLS (mTLS)

Mutual TLS requires **both** the server and the client to present a certificate. This provides two-way authentication.

To enable mTLS on the **client** side, supply both `tlsCertPath` and `tlsKeyPath` in addition to `useTls=true`. The server must be configured to request (and verify) client certificates.

---

## TLS Trust Badge

When HTTP, WebSocket, or gRPC is selected, a small lock icon appears in the **status bar centre**. The footer badge mirrors the active protocol's `useTls` checkbox: click it while disconnected to enable or disable TLS for the next connection, and the checkbox, certificate fields, default port logic, and connection behavior stay synchronized. While connected, click the badge to pin the detail popover; disconnect before changing TLS for an active connection.

The icon **shape** and **colour** both encode the configured state or connected trust level so it is unambiguous even for colour-blind users. No text label is shown beside the icon — hover the badge for full TLS details, including encryption state, certificate trust, endpoint, and a reminder that token authentication is shown separately by the key badge.

| Icon | Colour | Trust Level | Meaning |
|------|--------|-------------|---------|
| 🔓 | Grey / dimmed | off | No TLS — plaintext, unsecure connection |
| 🔒… | Blue | configured | TLS enabled in the UI; certificate trust will be checked after connection |
| 🔒 | Amber | on | TLS on — OS certificate store, trust level not fully determined |
| 🔒⚠ | Amber | self-signed | TLS on, self-signed or cert-chain not verified |
| 🔒✓ | Green | ca-verified | TLS on, CA-verified certificate chain |
| 🔐 | Blue / cyan | mtls | Mutual TLS — both client and server present certificates |

The badge is hidden for TCP and UDP because those transports do not support TLS.

### Implementation notes

- `updateTlsBadge(tooltip)` in `renderer.js` parses the tooltip string from the transport and sets the `data-trust` attribute on the badge element.
- CSS `filter` rules in `style.css` apply the colour tint to the emoji icon via the `data-trust` attribute.
- `tlsInfoToTooltip(raw)` converts raw transport `tlsInfo` strings (e.g. `"tls=on, custom certs: ca=./certs/ca.pem"`) into human-readable popover content.

---

## Per-Protocol Notes

### gRPC

- Uses `@grpc/grpc-js` `credentials.createSsl()` with `rejectUnauthorized: false` so self-signed certs work automatically between the Simulator and Logger on the same machine.
- Server mode auto-generates a self-signed cert when no cert/key are provided (see above).
- See [GRPC.md – TLS & Certificate Stores](./GRPC.md#tls--certificate-stores) for log output examples.

### HTTP

- Client mode uses Node.js `https.Agent` with the merged OS CA bundle.
- Server mode uses `https.createServer()` with the provided cert/key (or auto-generated self-signed).
- See [HTTP.md](./HTTP.md) for UI controls and CLI examples.

### WebSocket

- Client mode passes TLS agent options to the `ws` library's `WebSocket` constructor.
- Server mode wraps an `https.Server` before upgrading connections to WebSocket.
- See [WEBSOCKET.md](./WEBSOCKET.md) for UI controls and CLI examples.

---

## Quick-Start Examples

For custom CA / mTLS setup, see [Working with a Custom Certificate Authority](#working-with-a-custom-certificate-authority) above.

```bash
# gRPC client — TLS using OS certificate store (no cert files needed)
electron . protocol=grpc mode=client ip=myserver.example.com port=7145 useTls=true

# gRPC client — TLS with private CA cert
electron . protocol=grpc mode=client ip=myserver.example.com port=7145 useTls=true \
  tlsCaPath=./certs/ca.pem

# gRPC server — auto self-signed (no cert files needed)
electron . protocol=grpc mode=server port=50051 useTls=true

# gRPC server — custom cert/key
electron . protocol=grpc mode=server port=50051 useTls=true \
  tlsCertPath=./certs/server.pem tlsKeyPath=./certs/server-key.pem

# HTTP client — HTTPS with OS certificate store
electron . protocol=http mode=client ip=myserver.example.com port=8443 useTls=true

# HTTP server — custom cert/key
electron . protocol=http mode=server port=8443 useTls=true \
  tlsCertPath=./certs/server.pem tlsKeyPath=./certs/server-key.pem

# WebSocket client — WSS with private CA cert
electron . protocol=ws mode=client ip=myserver.example.com port=8443 useTls=true \
  tlsCaPath=./certs/ca.pem

# WebSocket server — custom cert/key
electron . protocol=ws mode=server port=8443 useTls=true \
  tlsCertPath=./certs/server.pem tlsKeyPath=./certs/server-key.pem
```

---

Back to documentation index: [README.md](./README.md)

