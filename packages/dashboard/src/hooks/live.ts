/**
 * @fileoverview Live state fed by the WebSocket. Events are folded into an
 * immutable snapshot; React reads it through useSyncExternalStore and
 * re-renders at most once per animation frame, however busy the crawl.
 */

import {useSyncExternalStore} from 'react';

import {apiToken} from '../api.js';
import type {LogLine, Run, RunStats, RunStatus, ServerEvent} from '../types.js';

/** One second of a run: how many requests finished, failed or were retried. */
export interface WeaveColumn {
  readonly ok: number;
  readonly failed: number;
  readonly retried: number;
}

/** A run as seen live. */
export interface LiveRun {
  readonly runId: string;
  readonly status: RunStatus;
  readonly stats: RunStats | null;
  readonly startedAt: number;
  readonly weave: readonly WeaveColumn[];
  readonly error: string | null;
}

/** The whole live snapshot. */
export interface LiveState {
  readonly connected: boolean;
  readonly runs: Readonly<Record<string, LiveRun>>;
  readonly logs: Readonly<Record<string, readonly LogLine[]>>;
  /** Bumped when a spider stores items, to refresh tables. */
  readonly itemsVersion: Readonly<Record<string, number>>;
  /** Bumped when runs start or end, to refresh the spider list. */
  readonly listVersion: number;
}

const MAX_COLUMNS = 160;
const MAX_LOGS = 400;
const EMPTY_COLUMN: WeaveColumn = {ok: 0, failed: 0, retried: 0};

class LiveStore {
  private state: LiveState = {
    connected: false,
    runs: {},
    logs: {},
    itemsVersion: {},
    listVersion: 0,
  };
  private readonly listeners = new Set<() => void>();
  private frame = 0;
  private retryDelay = 500;
  private socket: WebSocket | null = null;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    // One socket for the page; StrictMode's subscribe/unsubscribe/subscribe
    // must not open a second one and double every event.
    if (!this.socket) this.connect();
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = (): LiveState => this.state;

  private connect(): void {
    const token = apiToken();
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      this.retryDelay = 500;
      this.update(state => ({...state, connected: true}));
    };
    socket.onmessage = message => {
      try {
        this.apply(JSON.parse(String(message.data)) as ServerEvent);
      } catch {
        // Ignore malformed frames.
      }
    };
    socket.onclose = () => {
      this.socket = null;
      this.update(state => ({...state, connected: false}));
      setTimeout(() => {
        if (!this.socket) this.connect();
      }, this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 10_000);
    };
  }

  private apply(event: ServerEvent): void {
    switch (event.type) {
      case 'hello':
        this.update(state => ({
          ...state,
          runs: Object.fromEntries(event.runs.map(run => [run.spider, liveFromRun(run)])),
          listVersion: state.listVersion + 1,
        }));
        break;
      case 'run:start':
        this.update(state => ({
          ...state,
          runs: {
            ...state.runs,
            [event.spider]: {
              runId: event.runId,
              status: 'running',
              stats: null,
              startedAt: Date.now(),
              weave: [],
              error: null,
            },
          },
          listVersion: state.listVersion + 1,
        }));
        break;
      case 'run:end':
        this.patchRun(event.spider, event.runId, run => ({
          ...run,
          status: event.status,
          stats: event.stats,
          error: event.error ?? null,
        }));
        this.update(state => ({
          ...state,
          listVersion: state.listVersion + 1,
          itemsVersion: bump(state.itemsVersion, event.spider),
        }));
        break;
      case 'stats':
        this.patchRun(event.spider, event.runId, run => ({...run, stats: event.stats}));
        break;
      case 'request:done':
        this.weave(event.spider, event.runId, 'ok');
        break;
      case 'request:failed':
        this.weave(event.spider, event.runId, event.willRetry ? 'retried' : 'failed');
        break;
      case 'item:saved':
        this.update(state => ({
          ...state,
          itemsVersion: bump(state.itemsVersion, event.spider),
        }));
        break;
      case 'log':
        if (event.spider) {
          const spider = event.spider;
          this.update(state => ({
            ...state,
            logs: {
              ...state.logs,
              [spider]: [...(state.logs[spider] ?? []), event].slice(-MAX_LOGS),
            },
          }));
        }
        break;
      case 'item:dropped':
        break;
    }
  }

  private weave(spider: string, runId: string, kind: keyof WeaveColumn): void {
    this.patchRun(spider, runId, run => {
      const index = Math.floor((Date.now() - run.startedAt) / 1000);
      const weave = [...run.weave];
      while (weave.length <= index) weave.push(EMPTY_COLUMN);
      const column = weave[index] ?? EMPTY_COLUMN;
      weave[index] = {...column, [kind]: column[kind] + 1};
      const overflow = weave.length - MAX_COLUMNS;
      return {
        ...run,
        startedAt: overflow > 0 ? run.startedAt + overflow * 1000 : run.startedAt,
        weave: overflow > 0 ? weave.slice(overflow) : weave,
      };
    });
  }

  private patchRun(spider: string, runId: string, patch: (run: LiveRun) => LiveRun): void {
    this.update(state => {
      const run = state.runs[spider];
      if (!run || run.runId !== runId) return state;
      return {...state, runs: {...state.runs, [spider]: patch(run)}};
    });
  }

  private update(reducer: (state: LiveState) => LiveState): void {
    this.state = reducer(this.state);
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      for (const listener of this.listeners) listener();
    });
  }
}

function liveFromRun(run: Run): LiveRun {
  return {
    runId: run.id,
    status: run.status,
    stats: run.stats,
    startedAt: new Date(run.startedAt).getTime(),
    weave: [],
    error: run.error,
  };
}

function bump(versions: Readonly<Record<string, number>>, key: string): Record<string, number> {
  return {...versions, [key]: (versions[key] ?? 0) + 1};
}

const store = new LiveStore();

/** The live snapshot. */
export function useLive(): LiveState {
  return useSyncExternalStore(store.subscribe, store.snapshot);
}
