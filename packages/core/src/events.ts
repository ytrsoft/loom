/**
 * @fileoverview A small, typed event bus. The engine reports everything it
 * does through these events; the server forwards them over WebSocket and the
 * CLI renders them as progress output.
 */

import type {LogLevel} from './logger.js';

/** Live counters for a run. */
export interface RunStats {
  /** Requests that finished, successfully or not. */
  readonly requests: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly retries: number;
  /** Requests added to the queue (start URLs included). */
  readonly enqueued: number;
  /** Items written to storage. */
  readonly items: number;
  /** Items rejected by validation or `onItem` hooks. */
  readonly dropped: number;
  readonly startedAt: string;
  readonly durationMs: number;
  /** Finished requests per minute over the run so far. */
  readonly requestsPerMinute: number;
}

/** Final state of a run. */
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'stopped';

/** Payloads of every event, keyed by event name. */
export interface LoomEventMap {
  'run:start': {
    readonly runId: string;
    readonly spider: string;
    readonly trigger: string;
  };
  'run:end': {
    readonly runId: string;
    readonly spider: string;
    readonly status: RunStatus;
    readonly stats: RunStats;
    readonly error?: string;
  };
  'request:start': {
    readonly runId: string;
    readonly spider: string;
    readonly url: string;
    readonly route: string;
  };
  'request:done': {
    readonly runId: string;
    readonly spider: string;
    readonly url: string;
    readonly route: string;
    readonly status: number;
    readonly durationMs: number;
    readonly skipped: boolean;
  };
  'request:failed': {
    readonly runId: string;
    readonly spider: string;
    readonly url: string;
    readonly route: string;
    readonly error: string;
    readonly willRetry: boolean;
  };
  'item:saved': {
    readonly runId: string;
    readonly spider: string;
    readonly count: number;
    readonly url: string;
    /** Up to five saved items, for live previews. */
    readonly sample: readonly object[];
  };
  'item:dropped': {
    readonly runId: string;
    readonly spider: string;
    readonly url: string;
    readonly reasons: readonly string[];
  };
  'stats': {
    readonly runId: string;
    readonly spider: string;
    readonly stats: RunStats;
  };
  'log': {
    readonly level: LogLevel;
    readonly message: string;
    readonly time: string;
    readonly spider?: string;
    readonly runId?: string;
    readonly data?: Readonly<Record<string, unknown>>;
  };
}

/** Name of an event. */
export type LoomEventName = keyof LoomEventMap;

/** A discriminated union of all events, as delivered to `onAny`. */
export type LoomEvent = {
  [K in LoomEventName]: {readonly type: K} & LoomEventMap[K];
}[LoomEventName];

type Listener<K extends LoomEventName> = (payload: LoomEventMap[K]) => void;

/** Typed publish/subscribe hub. Listener errors never break the crawl. */
export class EventBus {
  private readonly listeners = new Map<LoomEventName, Set<Listener<never>>>();
  private readonly anyListeners = new Set<(event: LoomEvent) => void>();

  /** Subscribes to one event type. Returns an unsubscribe function. */
  on<K extends LoomEventName>(type: K, listener: Listener<K>): () => void {
    const set = this.listeners.get(type) ?? new Set<Listener<never>>();
    this.listeners.set(type, set);
    set.add(listener as Listener<never>);
    return () => set.delete(listener as Listener<never>);
  }

  /** Subscribes to every event. Returns an unsubscribe function. */
  onAny(listener: (event: LoomEvent) => void): () => void {
    this.anyListeners.add(listener);
    return () => this.anyListeners.delete(listener);
  }

  /** Publishes an event to its listeners. */
  emit<K extends LoomEventName>(type: K, payload: LoomEventMap[K]): void {
    for (const listener of this.listeners.get(type) ?? []) {
      safely(() => (listener as Listener<K>)(payload));
    }
    if (this.anyListeners.size) {
      const event = {type, ...payload} as LoomEvent;
      for (const listener of this.anyListeners) safely(() => listener(event));
    }
  }
}

function safely(callback: () => void): void {
  try {
    callback();
  } catch (error) {
    console.error('[loom] event listener failed:', error);
  }
}
