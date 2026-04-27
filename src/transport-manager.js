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
 * @file transport-manager.js
 * @description
 * Backend transport abstraction used by the headless simulation engine.
 *
 * Purpose:
 * - provide a single API for TCP/UDP + server/client combinations
 * - hide socket/server implementation details from the simulation engine
 * - track recipient availability for server-side replay scenarios
 * - emit lifecycle/status events that can be consumed by logging, tests, or orchestration
 *
 * Typical usage:
 * 1. Construct a TransportManager with an optional logger.
 * 2. Call `connect({ protocol, mode, ip, port, connectTimeoutMs })`.
 * 3. In server mode, optionally call `waitForRecipients()` before sending.
 * 4. Call `send(data)` for each outgoing payload.
 * 5. Call `disconnect()` during shutdown or error recovery.
 *
 * Event model:
 * - `status`: connection lifecycle state changes
 * - `log`: transport-specific log messages
 * - `client-connected` / `client-disconnected`: recipient tracking for server mode
 * - `data-received`: inbound data observed by the transport
 * - `socket-error`: non-fatal client socket issues in TCP server mode
 */
const { EventEmitter } = require('events');
const net = require('net');
const dgram = require('dgram');

/**
 * Manages TCP/UDP connections for both client and server execution paths.
 *
 * This class is intentionally renderer-independent so it can be used from:
 * - true headless runs
 * - future shared backend session logic
 * - isolated unit tests without Electron windows
 */
class TransportManager extends EventEmitter {
  constructor({ logger = null } = {}) {
    super();
    this.logger = logger;
    this.connection = null;
    this.protocol = null;
    this.mode = null;
    this.ip = null;
    this.port = null;
    this.tcpClientSockets = [];
    this.udpServerClients = new Set();
    this._recipientWaiters = new Set();
  }

  /**
   * Writes to the injected logger, if present, and mirrors the entry as an event.
   * This keeps transport logging decoupled from stdout, files, or UI rendering.
   */
  log(level, message) {
    if (this.logger && typeof this.logger[level] === 'function') {
      this.logger[level](message);
    }
    this.emit('log', { level, message });
  }

  /**
   * Emits normalized connection-state messages to observers.
   * Consumers use this to update run state without needing direct socket access.
   */
  emitStatus(status, message) {
    this.emit('status', { status, message });
  }

  /**
   * Returns whether a usable transport has been established.
   *
   * Notes:
   * - TCP server: true once the server is listening
   * - TCP client: true while the socket remains open
   * - UDP client/server: true while an active socket wrapper exists
   */
  isConnected() {
    if (!this.connection) {
      return false;
    }

    if (this.protocol === 'grpc') {
      return this.connection.isConnected();
    }

    if (this.connection instanceof net.Server) {
      return this.connection.listening;
    }

    if (this.connection instanceof net.Socket) {
      return !this.connection.destroyed;
    }

    return Boolean(this.connection.socket);
  }

  /**
   * Indicates whether the current transport mode depends on external recipients.
   *
   * Server mode may need connected clients before sending is meaningful.
   * Client mode already has an implicit destination once connected.
   */
  requiresRecipients() {
    return this.mode === 'server';
  }

  /**
   * Returns whether the transport currently has a valid recipient.
   *
   * This is especially important for `waitForClient=true` headless runs,
   * where the simulation engine must avoid consuming lines until delivery is possible.
   */
  hasRecipients() {
    if (!this.connection) {
      return false;
    }

    if (this.protocol === 'grpc') {
      return this.mode === 'client' ? this.connection.isConnected() : this.connection.hasRecipients();
    }

    if (this.connection instanceof net.Server) {
      return this.tcpClientSockets.some((socket) => !socket.destroyed);
    }

    if (this.connection instanceof net.Socket) {
      return !this.connection.destroyed;
    }

    if (this.connection.socket) {
      return this.mode === 'server'
        ? this.udpServerClients.size > 0
        : this.mode === 'client';
    }

    return false;
  }

  /**
   * Resolves any pending `waitForRecipients()` promises once a recipient exists.
   */
  resolveRecipientWaiters() {
    if (!this.hasRecipients()) {
      return;
    }

    for (const waiter of this._recipientWaiters) {
      waiter.resolve();
    }
    this._recipientWaiters.clear();
  }

  /**
   * Rejects any pending `waitForRecipients()` promises, usually during shutdown
   * or transport-level failure.
   */
  rejectRecipientWaiters(error) {
    for (const waiter of this._recipientWaiters) {
      waiter.reject(error);
    }
    this._recipientWaiters.clear();
  }

  /**
   * Entry point for transport creation.
   * Dispatches to the correct TCP/UDP + client/server implementation.
   */
  async connect({ protocol, mode, ip, port, grpcSerialization, grpcSendMethod, headerPathKey, headerPath, useTls, tlsCaPath, tlsCertPath, tlsKeyPath, connectTimeoutMs = 0, connectWaitForServer = false, connectRetryIntervalMs = 1000 }) {
    if (this.connection) {
      throw new Error('A connection is already active.');
    }

    this.protocol = protocol;
    this.mode = mode;
    this.ip = ip;
    this.port = port;

    if (protocol === 'grpc') {
      return this.connectGrpc({ mode, ip, port, grpcSerialization, grpcSendMethod, headerPathKey, headerPath, useTls, tlsCaPath, tlsCertPath, tlsKeyPath });
    }

    if (protocol === 'tcp') {
      return mode === 'server'
        ? this.connectTcpServer({ ip, port, connectTimeoutMs })
        : this.connectTcpClient({ ip, port, connectTimeoutMs, connectWaitForServer, connectRetryIntervalMs });
    }

    return mode === 'server'
      ? this.connectUdpServer({ ip, port, connectTimeoutMs })
      : this.connectUdpClient({ ip, port, connectTimeoutMs, connectWaitForServer, connectRetryIntervalMs });
  }

  /**
   * Connects via gRPC using the GrpcClientTransport or GrpcServerTransport.
   */
  async connectGrpc({ mode, ip, port, grpcSerialization, grpcSendMethod, headerPathKey, headerPath, useTls, tlsCaPath, tlsCertPath, tlsKeyPath }) {
    const { createGrpcClientTransport, createGrpcServerTransport } = require('./grpc-transport.js');
    const ser = grpcSerialization || 'protobuf';
    if (mode === 'client') {
      const useStreaming = grpcSendMethod !== 'unary';
      const transport = createGrpcClientTransport({ ip, port, grpcSerialization, useStreaming, headerPathKey, headerPath, useTls, tlsCaPath, tlsCertPath, tlsKeyPath });
      const result = await transport.connect();
      this.connection = transport;
      this.emitStatus('connected', `gRPC client connected to ${ip}:${port} [${ser}] ${headerPathKey}=${headerPath}\n  ${result.tlsInfo || 'tls=off'}`);
      return result;
    }
    const onClientConnected = () => {
      this.emit('client-connected', { protocol: 'grpc', mode: 'server' });
      this.resolveRecipientWaiters();
    };
    const transport = createGrpcServerTransport({ ip, port, grpcSerialization, headerPathKey, headerPath, onClientConnected, useTls, tlsCaPath, tlsCertPath, tlsKeyPath });
    const result = await transport.connect();
    this.connection = transport;
    this.emitStatus('connected', `gRPC server listening on ${result.address.address}:${result.address.port} [${ser}]\n  ${result.tlsInfo || 'tls=off'}`);
    return result;
  }

  /**
   * Starts a TCP server and begins tracking connected client sockets.
   *
   * Usage notes:
   * - In headless server mode, the simulation engine may wait until a first client appears.
   * - Any inbound client messages are surfaced through `data-received` for observability.
   */
  async connectTcpServer({ ip, port, connectTimeoutMs }) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout = null;

      const server = net.createServer((socket) => {
        this.tcpClientSockets.push(socket);
        const clientKey = `${socket.remoteAddress}:${socket.remotePort}`;
        this.log('info', `TCP client connected: ${clientKey}`);
        this.emit('client-connected', { protocol: 'tcp', mode: 'server', clientKey });
        this.resolveRecipientWaiters();

        socket.on('data', (data) => {
          const message = data.toString();
          this.emit('data-received', { protocol: 'tcp', mode: 'server', data: message, clientKey });
          this.log('debug', `Received from TCP client ${clientKey}: ${message}`);
        });

        socket.on('close', () => {
          this.tcpClientSockets = this.tcpClientSockets.filter((entry) => entry !== socket);
          this.log('info', `TCP client disconnected: ${clientKey}`);
          this.emit('client-disconnected', { protocol: 'tcp', mode: 'server', clientKey });
        });

        socket.on('error', (error) => {
          this.log('warn', `TCP client socket error (${clientKey}): ${error.message}`);
          this.emit('socket-error', { protocol: 'tcp', mode: 'server', error, clientKey });
        });
      });

      const finishError = (error) => {
        if (!settled) {
          settled = true;
          if (timeout) clearTimeout(timeout);
          reject(error);
          return;
        }

        this.connection = null;
        this.emitStatus('disconnected', `TCP server error: ${error.message}`);
        this.rejectRecipientWaiters(error);
      };

      server.on('error', finishError);
      server.on('close', () => {
        if (this.connection === server) {
          this.connection = null;
        }
        this.emitStatus('disconnected', 'TCP server has been shut down.');
        this.rejectRecipientWaiters(new Error('TCP server closed before a recipient became available.'));
      });

      server.listen(port, ip, () => {
        const address = server.address();
        this.connection = server;
        settled = true;
        if (timeout) clearTimeout(timeout);
        this.emitStatus('connected', `TCP server listening on ${address.address}:${address.port}`);
        resolve({ protocol: 'tcp', mode: 'server', address });
      });

      if (connectTimeoutMs > 0) {
        timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            server.close();
            reject(new Error(`Timed out waiting for TCP server bind after ${connectTimeoutMs}ms.`));
          }
        }, connectTimeoutMs);
      }
    });
  }

  /**
   * Connects as a TCP client to a remote host/port.
   *
   * When `connectWaitForServer=true` the method will retry on `ECONNREFUSED` (or any pre-connect
   * error) at `connectRetryIntervalMs` intervals until the server accepts the connection.
   * `connectTimeoutMs > 0` sets an overall deadline; `connectTimeoutMs = 0` waits forever.
   */
  async connectTcpClient({ ip, port, connectTimeoutMs, connectWaitForServer = false, connectRetryIntervalMs = 1000 }) {
    const deadline = connectTimeoutMs > 0 ? Date.now() + connectTimeoutMs : null;

    const attemptOnce = () => new Promise((resolve, reject) => {
      const client = net.createConnection({ host: ip, port }, () => {
        this.connection = client;
        this.emitStatus('connected', `TCP client connected to ${ip}:${port} from local port ${client.localPort}`);

        client.on('close', () => {
          this.connection = null;
          this.emitStatus('disconnected', 'TCP client disconnected.');
        });
        client.on('data', (data) => {
          const message = data.toString();
          this.emit('data-received', { protocol: 'tcp', mode: 'client', data: message, clientKey: `${ip}:${port}` });
          this.log('debug', `Received from TCP server ${ip}:${port}: ${message}`);
        });

        resolve({ protocol: 'tcp', mode: 'client' });
      });

      client.once('error', (error) => {
        client.destroy();
        reject(error);
      });
    });

    let attempt = 0;
    for (;;) {
      try {
        // eslint-disable-next-line no-await-in-loop
        return await attemptOnce();
      } catch (error) {
        attempt += 1;
        const isRetryable = connectWaitForServer && (
          error.code === 'ECONNREFUSED' ||
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ENOTFOUND'
        );

        if (!isRetryable) {
          throw error;
        }

        const remaining = deadline ? deadline - Date.now() : Infinity;
        if (remaining <= 0) {
          throw new Error(`Timed out waiting for TCP server at ${ip}:${port} after ${connectTimeoutMs}ms (${attempt} attempt(s)).`);
        }

        const retryDelay = Math.min(connectRetryIntervalMs, remaining === Infinity ? connectRetryIntervalMs : remaining);
        this.log('info', `TCP server not yet available at ${ip}:${port} (${error.code}). Retrying in ${retryDelay}ms... (attempt ${attempt})`);
        this.emitStatus('connecting', `Waiting for server at ${ip}:${port}. Retry in ${retryDelay}ms.`);

        // eslint-disable-next-line no-await-in-loop
        await new Promise((res) => setTimeout(res, retryDelay));

        if (deadline && Date.now() >= deadline) {
          throw new Error(`Timed out waiting for TCP server at ${ip}:${port} after ${connectTimeoutMs}ms (${attempt} attempt(s)).`);
        }
      }
    }
  }

  /**
   * Binds a UDP server socket.
   *
   * UDP has no persistent connection handshake, so server-side recipients are learned
   * lazily from inbound datagrams. Once a sender is observed, that endpoint can be
   * treated as a recipient for future outbound replay traffic.
   */
  async connectUdpServer({ ip, port, connectTimeoutMs }) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout = null;
      const socket = dgram.createSocket('udp4');

      socket.on('error', (error) => {
        if (!settled) {
          settled = true;
          if (timeout) clearTimeout(timeout);
          reject(error);
          return;
        }

        this.connection = null;
        this.emitStatus('disconnected', `UDP server error: ${error.message}`);
        this.rejectRecipientWaiters(error);
      });

      socket.on('listening', () => {
        const address = socket.address();
        this.connection = { socket, protocol: 'udp', mode: 'server' };
        settled = true;
        if (timeout) clearTimeout(timeout);
        this.emitStatus('connected', `UDP server listening on ${address.address}:${address.port}`);
        resolve({ protocol: 'udp', mode: 'server', address });
      });

      socket.on('message', (message, remoteInfo) => {
        const clientKey = `${remoteInfo.address}:${remoteInfo.port}`;
        if (!this.udpServerClients.has(clientKey)) {
          this.udpServerClients.add(clientKey);
          this.log('info', `UDP client detected: ${clientKey}`);
          this.emit('client-connected', { protocol: 'udp', mode: 'server', clientKey });
          this.resolveRecipientWaiters();
        }

        const text = message.toString();
        this.emit('data-received', { protocol: 'udp', mode: 'server', data: text, clientKey });
        this.log('debug', `Received from UDP client ${clientKey}: ${text}`);
      });

      socket.bind(port, ip);

      if (connectTimeoutMs > 0) {
        timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            socket.close();
            reject(new Error(`Timed out waiting for UDP server bind after ${connectTimeoutMs}ms.`));
          }
        }, connectTimeoutMs);
      }
    });
  }

  /**
   * Creates a UDP client socket ready to send outbound datagrams.
   *
   * Note: UDP is connectionless so `connectWaitForServer` has no practical effect here;
   * the option is accepted for API consistency but no retry logic is applied.
   */
  async connectUdpClient({ ip, port, connectTimeoutMs, connectWaitForServer: _connectWaitForServer = false, connectRetryIntervalMs: _connectRetryIntervalMs = 1000 }) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout = null;
      const socket = dgram.createSocket('udp4');

      socket.on('error', (error) => {
        if (!settled) {
          settled = true;
          if (timeout) clearTimeout(timeout);
          reject(error);
          return;
        }

        this.connection = null;
        this.emitStatus('disconnected', `UDP client error: ${error.message}`);
      });

      socket.on('message', (message, remoteInfo) => {
        const clientKey = `${remoteInfo.address}:${remoteInfo.port}`;
        const text = message.toString();
        this.emit('data-received', { protocol: 'udp', mode: 'client', data: text, clientKey });
        this.log('debug', `Received from UDP endpoint ${clientKey}: ${text}`);
      });

      socket.bind(() => {
        const localAddress = socket.address();
        this.connection = { socket, protocol: 'udp', mode: 'client', ip, port };
        settled = true;
        if (timeout) clearTimeout(timeout);
        this.emitStatus('connected', `UDP client ready to send to ${ip}:${port} from local port ${localAddress.port}`);
        resolve({ protocol: 'udp', mode: 'client', address: localAddress });
      });

      if (connectTimeoutMs > 0) {
        timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            socket.close();
            reject(new Error(`Timed out waiting for UDP client readiness after ${connectTimeoutMs}ms.`));
          }
        }, connectTimeoutMs);
      }
    });
  }

  /**
   * Waits until at least one recipient is available.
   *
   * Intended for server-mode replay workflows where sending should not consume input
   * until there is somebody to receive it.
   */
  waitForRecipients({ timeoutMs = 0 } = {}) {
    if (this.hasRecipients()) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: () => {
          if (timeout) clearTimeout(timeout);
          this._recipientWaiters.delete(waiter);
          resolve();
        },
        reject: (error) => {
          if (timeout) clearTimeout(timeout);
          this._recipientWaiters.delete(waiter);
          reject(error);
        },
      };

      let timeout = null;
      this._recipientWaiters.add(waiter);

      if (timeoutMs > 0) {
        timeout = setTimeout(() => {
          waiter.reject(new Error(`Timed out waiting for a client after ${timeoutMs}ms.`));
        }, timeoutMs);
      }
    });
  }

  /**
   * Sends a payload using the active transport.
   *
   * Return shape:
   * - `{ delivered: true, recipients: <n> }` when at least one send completed
   * - `{ delivered: false, recipients: 0, reason: 'no-clients' }` for server modes
   *   that currently have no recipients
   *
   * The simulation engine relies on this distinction to decide whether to advance
   * the replay cursor or keep waiting.
   */
  async send(data) {
    if (!this.connection) {
      throw new Error('No active connection.');
    }

    if (typeof data !== 'string' || data.length === 0) {
      throw new Error('Data must be a non-empty string.');
    }

    if (this.protocol === 'grpc') {
      return this.connection.send(data);
    }

    if (this.connection instanceof net.Server) {
      const sockets = this.tcpClientSockets.filter((socket) => !socket.destroyed);
      if (sockets.length === 0) {
        return { delivered: false, recipients: 0, reason: 'no-clients' };
      }

      const message = `${data}\n`;
      await Promise.all(sockets.map((socket) => new Promise((resolve, reject) => {
        socket.write(message, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })));

      return { delivered: true, recipients: sockets.length };
    }

    if (this.connection instanceof net.Socket) {
      const message = `${data}\n`;
      await new Promise((resolve, reject) => {
        this.connection.write(message, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      return { delivered: true, recipients: 1 };
    }

    if (this.connection.socket && this.mode === 'client') {
      const buffer = Buffer.from(data);
      await new Promise((resolve, reject) => {
        this.connection.socket.send(buffer, this.port, this.ip, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      return { delivered: true, recipients: 1 };
    }

    if (this.connection.socket && this.mode === 'server') {
      if (this.udpServerClients.size === 0) {
        return { delivered: false, recipients: 0, reason: 'no-clients' };
      }

      const buffer = Buffer.from(data);
      const clients = Array.from(this.udpServerClients);
      await Promise.all(clients.map((clientKey) => {
        const [host, port] = clientKey.split(':');
        return new Promise((resolve, reject) => {
          this.connection.socket.send(buffer, Number.parseInt(port, 10), host, (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }));

      return { delivered: true, recipients: clients.length };
    }

    throw new Error('Unsupported connection state.');
  }

  /**
   * Gracefully tears down the active transport and clears server-side recipient state.
   * Safe to call during normal shutdown and after failures.
   */
  async disconnect() {
    if (!this.connection) {
      return;
    }

    const activeConnection = this.connection;
    this.connection = null;

    if (this.protocol === 'grpc') {
      await activeConnection.disconnect();
      return;
    }

    if (activeConnection instanceof net.Server) {
      await new Promise((resolve) => {
        this.tcpClientSockets.forEach((socket) => {
          if (!socket.destroyed) {
            socket.destroy();
          }
        });
        this.tcpClientSockets = [];
        activeConnection.close(() => resolve());
      });
      return;
    }

    if (activeConnection instanceof net.Socket) {
      await new Promise((resolve) => {
        if (activeConnection.destroyed) {
          resolve();
          return;
        }
        activeConnection.once('close', resolve);
        activeConnection.destroy();
      });
      return;
    }

    if (activeConnection.socket) {
      await new Promise((resolve) => {
        activeConnection.socket.close(() => resolve());
      });
      this.udpServerClients.clear();
    }
  }
}

module.exports = {
  TransportManager,
};

