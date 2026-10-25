/**
 * @fileoverview Streams Loom events to WebSocket clients.
 *
 * Protocol (JSON messages):
 *   server → client  {type: 'hello', runs: RunSummary[]}
 *   server → client  any LoomEvent, e.g. {type: 'item:saved', ...}
 *   client → server  {type: 'subscribe', events: ['run:start', 'log', ...]}
 *
 * Clients receive every event except `request:start` until they subscribe.
 * Slow clients skip high-volume events instead of growing server memory.
 */

import type {IncomingMessage, Server} from 'node:http';
import type {Duplex} from 'node:stream';

import {WebSocketServer, type WebSocket} from 'ws';
import type {Loom, LoomEvent, LoomEventName} from 'loom';

const DEFAULT_EVENTS: ReadonlySet<string> = new Set<LoomEventName>([
  'run:start',
  'run:end',
  'request:done',
  'request:failed',
  'item:saved',
  'item:dropped',
  'stats',
  'log',
]);
const ESSENTIAL_EVENTS: ReadonlySet<string> = new Set(['run:start', 'run:end']);
const MAX_BUFFERED_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 30_000;

interface Client {
  readonly socket: WebSocket;
  events: ReadonlySet<string>;
  alive: boolean;
}

/** Options for {@link RealtimeHub}. */
export interface RealtimeOptions {
  readonly path?: string;
  readonly token?: string;
}

/** Attaches a WebSocket endpoint to an HTTP server. */
export class RealtimeHub {
  private readonly server = new WebSocketServer({noServer: true});
  private readonly clients = new Set<Client>();
  private readonly unsubscribe: () => void;
  private readonly heartbeat: NodeJS.Timeout;

  constructor(
    http: Server,
    private readonly loom: Loom,
    private readonly options: RealtimeOptions = {}
  ) {
    http.on('upgrade', (request, socket, head) =>
      this.upgrade(request, socket, head)
    );
    this.server.on('connection', socket => this.connect(socket));
    this.unsubscribe = loom.events.onAny(event => this.broadcast(event));
    this.heartbeat = setInterval(() => this.ping(), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  /** Number of connected clients. */
  get size(): number {
    return this.clients.size;
  }

  /** Disconnects everyone and detaches from the event bus. */
  close(): void {
    clearInterval(this.heartbeat);
    this.unsubscribe();
    for (const client of this.clients) client.socket.terminate();
    this.server.close();
  }

  private upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== (this.options.path ?? '/ws')) return;
    if (this.options.token) {
      const header = request.headers.authorization?.replace(/^Bearer\s+/i, '');
      const token = url.searchParams.get('token') ?? header;
      if (token !== this.options.token) {
        socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
        return;
      }
    }
    this.server.handleUpgrade(request, socket, head, ws => {
      this.server.emit('connection', ws, request);
    });
  }

  private connect(socket: WebSocket): void {
    const client: Client = {socket, events: DEFAULT_EVENTS, alive: true};
    this.clients.add(client);
    socket.on('pong', () => {
      client.alive = true;
    });
    socket.on('message', raw => {
      try {
        const message = JSON.parse(String(raw)) as {type?: string; events?: unknown};
        if (message.type === 'subscribe' && Array.isArray(message.events)) {
          client.events = new Set(message.events.map(String));
        }
      } catch {
        // Ignore malformed client messages.
      }
    });
    socket.on('close', () => this.clients.delete(client));
    socket.send(
      JSON.stringify({
        type: 'hello',
        runs: this.loom.activeRuns().map(run => run.toJSON()),
      })
    );
  }

  private broadcast(event: LoomEvent): void {
    if (!this.clients.size) return;
    let payload: string | undefined;
    for (const client of this.clients) {
      if (client.socket.readyState !== client.socket.OPEN) continue;
      if (!client.events.has(event.type)) continue;
      const congested = client.socket.bufferedAmount > MAX_BUFFERED_BYTES;
      if (congested && !ESSENTIAL_EVENTS.has(event.type)) continue;
      payload ??= JSON.stringify(event);
      client.socket.send(payload);
    }
  }

  private ping(): void {
    for (const client of this.clients) {
      if (!client.alive) {
        client.socket.terminate();
        this.clients.delete(client);
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
  }
}
