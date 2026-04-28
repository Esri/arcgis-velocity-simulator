# gRPC Transport

The ArcGIS Velocity Simulator supports gRPC as a transport protocol alongside TCP and UDP. It supports three **gRPC Feature Serialization Formats** for compatibility with different ArcGIS Velocity ingestion paths.

## Feature Serialization Formats

The `grpcSerialization` parameter controls how feature data is encoded on the wire. The default is `protobuf`.

| Format | Service | Proto File | Description |
|--------|---------|-----------|-------------|
| **Protobuf** (default) | `GrpcFeed` | `velocity-grpc.proto` | Velocity external protocol. Features encoded as typed `google.protobuf.Any`-wrapped attributes. |
| **Kryo** | `GrpcFeatureService` | `feature-service.proto` | Velocity internal protocol. Feature bytes sent as raw binary payload. |
| **Text** | `GrpcFeatureService` | `feature-service.proto` | Velocity internal protocol. CSV line sent as plain UTF-8 text in the bytes field. |

### Protobuf Format (Default)

Uses the Velocity external gRPC Feed service:

```protobuf
syntax = "proto3";
package esri.realtime.core.grpc;
import "google/protobuf/any.proto";

message Request {
  repeated Feature features = 1;
}

message Feature {
  repeated google.protobuf.Any attributes = 1;
}

message Response {
  string message = 1;
  int32 code = 2;
}

service GrpcFeed {
  rpc Stream(stream Request) returns (Response);  // client-streaming
  rpc Send(Request) returns (Response);           // unary
  rpc Watch(WatchRequest) returns (stream Request); // server-streaming (push to observers)
}

message WatchRequest {
  string client_id = 1;
}
```

Each attribute is a `google.protobuf.Any` wrapping a standard protobuf wrapper type:

| Protobuf Wrapper | Data Type |
|---|---|
| `google.protobuf.StringValue` | String |
| `google.protobuf.Int32Value` | Integer (32-bit) |
| `google.protobuf.Int64Value` | Long integer (64-bit) |
| `google.protobuf.FloatValue` | Float (32-bit) |
| `google.protobuf.DoubleValue` | Double (64-bit) |
| `google.protobuf.BoolValue` | Boolean |

**Null values** are represented by an empty `type_url` in the `Any` message.

### Kryo Format

Uses the Velocity internal `GrpcFeatureService`:

```protobuf
service GrpcFeatureService {
  rpc execute(GrpcFeatureRequest) returns (GrpcFeatureResponse);
  rpc executeMulti(stream GrpcFeatureRequest) returns (stream GrpcFeatureResponse);
  rpc watch(GrpcWatchRequest) returns (stream GrpcFeatureRequest); // server-streaming (push to observers)
}

message GrpcWatchRequest {
  string client_id = 1;
}

message GrpcFeatureRequest {
  string itemId = 1;
  bytes bytes = 2;
}
```

In true Velocity production deployments, the `bytes` field contains Kryo-serialized `com.esri.arcgis.st.Feature` objects. Since Kryo is a Java-specific binary format, the simulator sends raw UTF-8 bytes in this mode — useful for testing connectivity with the internal gRPC service endpoint.

### Text Format

Uses the same `GrpcFeatureService` as Kryo, but the `bytes` field contains a plain UTF-8 CSV line. This is the simplest format for testing — no encoding/decoding overhead.

## Send Methods (RPC Types)

The `grpcSendMethod` parameter controls the gRPC call pattern used when the simulator is in **client mode**. gRPC defines four RPC types; the simulator supports the two that apply to client-initiated data sending. The default is `stream`.

| RPC Type | CLI Value | Proto RPC (Protobuf) | Proto RPC (Internal) | Description |
|----------|-----------|---------------------|----------------------|-------------|
| **Client Streaming** (default) | `stream` | `GrpcFeed.Stream(stream Request) returns (Response)` | `GrpcFeatureService.executeMulti(stream GrpcFeatureRequest) returns (stream GrpcFeatureResponse)` | Opens a single long-lived HTTP/2 stream. The client writes multiple request messages; the server responds once when the stream closes. Amortises connection setup and header overhead across all messages, making it ideal for high-throughput, continuous data ingestion. |
| **Unary** | `unary` | `GrpcFeed.Send(Request) returns (Response)` | `GrpcFeatureService.execute(GrpcFeatureRequest) returns (GrpcFeatureResponse)` | Each message is a discrete request/response round-trip — one request in, one response out. This is the simplest gRPC pattern, analogous to a traditional REST call. Easier to trace in network tooling (e.g. `grpcurl`, Wireshark) and reason about, but each call incurs its own HTTP/2 framing and header-compression overhead. |

### When to use each

- **Client Streaming** — Use for production-style workloads, throughput benchmarks, or any scenario where you are sending a continuous flow of features. This is the mode ArcGIS Velocity expects for real-time feed ingestion.
- **Unary** — Use for debugging, connectivity testing, or when you need per-message acknowledgements. Also useful when the receiving server does not support streaming RPCs.

> **Note:** The `grpcSendMethod` parameter has no effect in **server mode** — in server mode the simulator hosts a gRPC service and the RPC types are determined by the connecting client.

## Modes

### gRPC Client (Simulator sending to a server)

The simulator connects to a remote gRPC endpoint and sends features. The `grpcSendMethod` parameter determines which RPC type is used:

- **Client Streaming** (default): Opens a persistent stream — `Stream` (GrpcFeed/Protobuf) or `executeMulti` (GrpcFeatureService/Kryo/Text).
- **Unary**: Sends each message individually — `Send` (GrpcFeed/Protobuf) or `execute` (GrpcFeatureService/Kryo/Text).

The optional `grpcHeaderPathKey` / `grpcHeaderPath` parameters inject a metadata header on every outgoing call. This is required when connecting to a real ArcGIS Velocity endpoint so the platform can route the call to the correct feed item.

### gRPC Server (Simulator pushing data to observer clients)

The simulator hosts a gRPC server that **pushes data to connected observer clients** via a server-streaming RPC. This is the primary mode for use with the **ArcGIS Velocity Logger** in gRPC Client mode.

When a client connects and subscribes via the `Watch` (protobuf) or `watch` (internal) RPC, it is registered as a watcher. Each time the simulator sends a line of data, it is pushed to all active watchers simultaneously.

- **Protobuf**: Hosts a `GrpcFeed` server. The simulator also receives features from legacy `Send` / `Stream` callers via `onData`.
- **Kryo / Text**: Hosts a `GrpcFeatureService` server. The simulator also receives features from legacy `execute` / `executeMulti` callers via `onData`.

The server fires an `onClientConnected` callback when the first watcher subscribes, which releases any `waitForClient` hold in headless mode.

> **Note:** The `grpcHeaderPathKey` / `grpcHeaderPath` parameters do not apply in server mode — the server never sends outgoing metadata headers.

## Feature Examples

Below are examples of features sent by the simulator using the **Protobuf** serialization format.

### Example 1: Vehicle Tracking (Fleet GPS)

**CSV input:**
```
vehicle-001,-117.1956,34.0572,65.3,true,1609459200000
```

**Encoded as protobuf Feature:**
```
attributes[0] = Any { type_url: "type.googleapis.com/google.protobuf.StringValue", value: "vehicle-001" }
attributes[1] = Any { type_url: "type.googleapis.com/google.protobuf.DoubleValue", value: -117.1956 }
attributes[2] = Any { type_url: "type.googleapis.com/google.protobuf.DoubleValue", value: 34.0572 }
attributes[3] = Any { type_url: "type.googleapis.com/google.protobuf.DoubleValue", value: 65.3 }
attributes[4] = Any { type_url: "type.googleapis.com/google.protobuf.BoolValue",   value: true }
attributes[5] = Any { type_url: "type.googleapis.com/google.protobuf.Int64Value",  value: 1609459200000 }
```

### Example 2: Weather Station Observations

**CSV input:**
```
WX-SFO-042,37.6213,-122.379,18.5,72,1013.25,false,1714500000000
```

**Auto-detected types:** String, Double, Double, Double, Int32, Double, Boolean, Int64

### Example 3: IoT Sensor Alert

**CSV input:**
```
sensor-9A3F,CRITICAL,Tank overflow detected,98.7,250,true,1714503600000
```

**Auto-detected types:** String, String, String, Double, Int32, Boolean, Int64

### Example 4: AIS Maritime Vessel Position

**CSV input:**
```
367596000,EVER GIVEN,-122.4194,37.7749,12.4,245,15,false,1714507200000
```

**Auto-detected types:** Int32, String, Double, Double, Double, Int32, Int32, Boolean, Int64

### Example 5: Geofence Entry Event

**CSV input:**
```
truck-42,"POLYGON((-118.3 34.0,-118.3 34.1,-118.2 34.1,-118.2 34.0,-118.3 34.0))",ENTER,warehouse-7,1714510800000
```

**Auto-detected types:** String, String, String, String, Int64

## CLI / Headless Usage

```bash
# gRPC client mode with Protobuf serialization (default) — sends to a Logger or Velocity endpoint
electron . runMode=headless filename=./data.csv protocol=grpc mode=client ip=127.0.0.1 port=50051

# gRPC client mode with Text serialization
electron . runMode=headless filename=./data.csv protocol=grpc mode=client ip=127.0.0.1 port=50051 grpcSerialization=text

# gRPC client mode with unary send method (one RPC call per message)
electron . runMode=headless filename=./data.csv protocol=grpc mode=client ip=127.0.0.1 port=50051 grpcSendMethod=unary

# gRPC client mode with Kryo serialization
electron . runMode=headless filename=./data.csv protocol=grpc mode=client ip=127.0.0.1 port=50051 grpcSerialization=kryo

# gRPC client mode with a custom header path (required for real Velocity endpoints)
electron . runMode=headless filename=./data.csv protocol=grpc mode=client ip=127.0.0.1 port=50051 grpcHeaderPathKey=grpc-path grpcHeaderPath=my.feed.dedicated.uid

# gRPC client mode with TLS (for connecting to Velocity endpoints with SSL)
electron . runMode=headless filename=./data.csv protocol=grpc mode=client ip=mcstest492.esri.com port=7145 useTls=true grpcHeaderPathKey=grpc-path grpcHeaderPath=dedicated.c7bf318b252a4b55bf63bb13da8721fd

# gRPC client mode with TLS and custom CA certificate
electron . runMode=headless filename=./data.csv protocol=grpc mode=client ip=myserver.example.com port=7145 useTls=true tlsCaPath=./certs/ca.pem

# gRPC server mode (pushes data to Watch subscribers such as the Logger in gRPC Client mode)
electron . runMode=headless filename=./data.csv protocol=grpc mode=server ip=0.0.0.0 port=50051 grpcSerialization=protobuf

# gRPC server mode — wait for the first Logger client to subscribe before replaying
electron . runMode=headless filename=./data.csv protocol=grpc mode=server ip=0.0.0.0 port=50051 grpcSerialization=protobuf waitForClient=true

# gRPC server mode with TLS (requires cert and key)
electron . runMode=headless filename=./data.csv protocol=grpc mode=server ip=0.0.0.0 port=50051 useTls=true tlsCertPath=./certs/server.pem tlsKeyPath=./certs/server-key.pem
```

### Parameters

| Parameter | Description |
|-----------|-------------|
| `grpcHeaderPath` | Value sent as the gRPC endpoint header path (default: `replace.with.dedicated.uid`). Client mode only. |
| `grpcHeaderPathKey` | Key name for the gRPC endpoint header path metadata entry (default: `grpc-path`). Client mode only. |
| `mode=client` | Connect as a gRPC client to send features |
| `mode=server` | Host a gRPC server and receive features |
| `port` | Bind port (server mode) or target port (client mode) |
| `protocol=grpc` | Select gRPC transport |
| `grpcSerialization=protobuf` | Use Velocity external GrpcFeed protocol with typed Any-wrapped attributes (default) |
| `grpcSerialization=kryo` | Use Velocity internal GrpcFeatureService protocol with raw bytes |
| `grpcSerialization=text` | Use Velocity internal GrpcFeatureService protocol with plain UTF-8 text |
| `grpcSendMethod=stream` | Client Streaming RPC — multiplexes all messages over a single persistent HTTP/2 stream (default). Higher throughput, lower per-message overhead. Client mode only. |
| `grpcSendMethod=unary` | Unary RPC — sends each message as a discrete request/response round-trip. Simpler to trace and debug. Client mode only. |
| `ip` | Bind address (server mode) or target address (client mode) |
| `useTls` | Use TLS (SSL) for the gRPC connection (default: `false`). When `true`, uses SSL credentials instead of plaintext. |
| `tlsCaPath` | Path to a custom CA certificate file (PEM). When omitted with `useTls=true`, OS root certificates are loaded automatically (see [TLS & Certificate Stores](#tls--certificate-stores)). |
| `tlsCertPath` | Path to a client/server certificate file (PEM) for mutual TLS. Required for TLS server mode. |
| `tlsKeyPath` | Path to a private key file (PEM) for mutual TLS. Required for TLS server mode. |

## UI Usage

When gRPC is selected as the connection type in the UI, the following controls appear:

- **Serialization** — `Protobuf` (default), `Kryo`, or `Text`
- **RPC type** — `Client Streaming` (default) or `Unary`. Selects the gRPC call pattern for sending data. Client Streaming opens a persistent stream for high-throughput ingestion. Unary sends each message as an independent request/response round-trip. See [Send Methods (RPC Types)](#send-methods-rpc-types) for details. Only applies in gRPC Client mode. **Locked while connected** (the streaming vs. unary choice is baked into the transport at connect time).
- **Use TLS** — Checkbox to enable TLS (SSL) connections. When checked, additional certificate path fields appear.
- **CA cert** — Path to a custom CA certificate file (PEM). Leave empty to use OS root certificates automatically.
- **TLS cert** — Path to a client/server certificate file (PEM) for mutual TLS.
- **TLS key** — Path to a private key file (PEM) for mutual TLS.
- **Header path key** — gRPC endpoint header path key (default: `grpc-path`). Sent as gRPC metadata on every outgoing call. **Visible only in gRPC Client mode.**
- **Header path** — gRPC endpoint header path value (default: `replace.with.dedicated.uid`). Sent as gRPC metadata on every outgoing call. **Visible only in gRPC Client mode.**

The serialization and TLS controls are shown for both client and server modes. The header controls are shown only when **gRPC Client** is selected, since they have no effect in server mode (the server only receives incoming connections and never initiates outgoing calls).

### Tooltip Reference

The following tooltips appear when hovering over gRPC-related controls in the UI. These are set dynamically via `GRPC_SERIALIZATION_TOOLTIPS` and `GRPC_SEND_METHOD_TOOLTIPS` in `renderer.js`.

#### Serialization Tooltips

| Value | Tooltip |
|-------|---------|
| Protobuf | gRPC Feature Serialization Format: Protobuf. Uses the ArcGIS Velocity external GrpcFeed protocol (velocity-grpc.proto) with typed Feature messages and google.protobuf.Any-wrapped attributes. Recommended for standard external Velocity gRPC interoperability. |
| Kryo | gRPC Feature Serialization Format: Kryo. Uses the internal GrpcFeatureService protocol (feature-service.proto) where the bytes field carries raw binary feature payloads. Intended for internal-path compatibility and advanced testing. |
| Text | gRPC Feature Serialization Format: Text. Uses the internal GrpcFeatureService protocol (feature-service.proto) where the bytes field carries plain UTF-8 text, typically a CSV line. Best for simple human-readable testing. |

#### RPC Type Tooltips

| Value | Tooltip |
|-------|---------|
| Client Streaming | gRPC RPC Type: Client Streaming. Opens a persistent client-streaming RPC and multiplexes all messages over a single long-lived HTTP/2 stream. Ideal for high-throughput ingestion with minimal per-message overhead. |
| Unary | gRPC RPC Type: Unary. Each message is sent as a discrete request/response round-trip. Easier to trace and debug, but incurs per-call overhead. |

### CLI Prepopulation of UI Fields

Connection parameters can be passed on the command line even in UI mode to prepopulate the UI controls. For example:

```bash
# Launch UI with gRPC client preset and TLS enabled
electron . protocol=grpc mode=client ip=mcstest492.esri.com port=7145 useTls=true grpcHeaderPath=dedicated.c7bf318b252a4b55bf63bb13da8721fd
```

Supported UI-prepopulable parameters: `protocol`, `mode`, `ip`, `port`, `grpcSerialization`, `grpcSendMethod`, `grpcHeaderPath`, `grpcHeaderPathKey`, `useTls`, `tlsCaPath`, `tlsCertPath`, `tlsKeyPath`, `intervalMs`, `linesPerInterval`, `loop`.

## Compatibility

- Works with the **ArcGIS Velocity Logger** in both gRPC client and server modes (both apps must use the same serialization format)
- **Protobuf** format is compatible with ArcGIS Velocity external gRPC feed endpoints
- **Kryo/Text** formats are compatible with ArcGIS Velocity internal gRPC feature service endpoints
- Uses `@grpc/grpc-js` + `protobufjs` (pure JavaScript, no native compilation required)
- Supports both plaintext (unsecure) and TLS (SSL) connections

## TLS & Certificate Stores

When `useTls=true` is set without a custom `tlsCaPath`, the app merges the Node.js bundled root CAs with certificates from the OS certificate store. This ensures enterprise/internal CAs (e.g. Esri Root CA) are trusted without requiring a manual PEM file.

| Platform | Source | Method |
|----------|--------|--------|
| **macOS** | System and SystemRoot keychains | `security find-certificate -a -p` |
| **Linux** | System PEM bundle | Reads from `/etc/ssl/certs/ca-certificates.crt`, `/etc/pki/tls/certs/ca-bundle.crt`, or `/etc/ssl/ca-bundle.pem` |
| **Windows** | `LocalMachine\Root` and `CurrentUser\Root` stores | PowerShell `Get-ChildItem Cert:\` via `-EncodedCommand` |

The merged set is deduplicated and passed to `grpc.credentials.createSsl()`. The connection log shows the cert breakdown on connect. Examples:

**Client mode — OS root CAs (no custom cert):**
```
gRPC client connected to mcstest492.esri.com:7145 [protobuf] grpc-path=dedicated.abc123
  tls=on, 429 trusted CAs loaded, node-bundled=144, os=Windows certificate store (285)
```

**Client mode — custom CA cert:**
```
gRPC client connected to myserver.example.com:7145 [protobuf] grpc-path=dedicated.abc123
  tls=on, custom certs: ca=./certs/ca.pem
```

**Server mode — TLS with cert and key:**
```
gRPC server listening on 0.0.0.0:50051 [protobuf]
  tls=on, server certs: cert=./certs/server.pem, key=./certs/server-key.pem
```

**Any mode — TLS off:**
```
  tls=off (unsecure)
```

To override the automatic OS CA lookup on the client side, set `tlsCaPath` to a PEM file path.

### Server-mode TLS requirements

Server-mode TLS has a hard requirement that **both `tlsCertPath` and `tlsKeyPath` must be provided**. There is no fallback to OS or system certificates, because the two roles are fundamentally different:

- **Client TLS** — the client needs *trust anchors* (CA root certs) to verify the server's identity. The OS certificate store is exactly that, which is why client mode can fall back to it automatically.
- **Server TLS** — the server must *present its own identity certificate* to connecting clients. OS root CAs are trust anchors for verifying others; they are not server identity certificates. Without an explicit cert+key pair there is nothing to present, so the connection fails immediately.

If you see the error `TLS server mode requires both tlsCertPath and tlsKeyPath`, your options are:

1. **Disable TLS** — uncheck **Use TLS** (or omit `useTls`) to use plaintext (unsecure) mode. Suitable for local/dev testing between the Simulator and Logger.
2. **Provide a self-signed cert+key** — generate a pair with OpenSSL and supply both paths:
   ```bash
   openssl req -x509 -newkey rsa:4096 -keyout server-key.pem -out server.pem -days 365 -nodes -subj "/CN=localhost"
   ```
   Then set `tlsCertPath=./server.pem` and `tlsKeyPath=./server-key.pem`. The connecting client will need `useTls=true` and either `tlsCaPath=./server.pem` (self-signed) or have the cert trusted in its OS store.

## Examples

### Example A: Simulator (Client) → Logger (Server)

The classic push scenario: simulator sends features, Logger receives them.

1. Start the Logger in **gRPC Server** mode on port 50051 with **Protobuf** serialization
2. Start the Simulator in **gRPC Client** mode pointing to `127.0.0.1:50051` with **Protobuf** serialization
3. Load a CSV file in the Simulator and press Play — decoded features appear in the Logger

### Example B: Simulator (Server) → Logger (Client)

The reverse scenario: Logger subscribes and receives features pushed by the Simulator.

1. Start the Simulator in **gRPC Server** mode on port 50051 with **Protobuf** serialization
2. Load a CSV file in the Simulator but do **not** press Play yet
3. Start the Logger in **gRPC Client** mode pointing to `127.0.0.1:50051` with **Protobuf** serialization
4. Press Play in the Simulator — decoded features are pushed to the Logger in real time

Both scenarios work with all three serialization formats (protobuf, text, kryo). Use `waitForClient=true` in headless server mode to hold replay until the Logger client connects.

