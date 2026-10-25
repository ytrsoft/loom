/**
 * @fileoverview Shapes of the server API, mirrored for the browser bundle.
 */

/** Counters of a run. */
export interface RunStats {
  readonly requests: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly retries: number;
  readonly enqueued: number;
  readonly items: number;
  readonly dropped: number;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly requestsPerMinute: number;
}

/** Status of a run. */
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'stopped';

/** A run (live or historical). */
export interface Run {
  readonly id: string;
  readonly spider: string;
  readonly trigger: string;
  readonly status: RunStatus;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly stats: RunStats | null;
  readonly error: string | null;
}

/** A column of a spider's table. */
export interface ColumnInfo {
  readonly name: string;
  readonly kind: string;
}

/** A spider as listed by the API. */
export interface SpiderInfo {
  readonly name: string;
  readonly description: string | null;
  readonly mode: 'http' | 'browser';
  readonly schedule: string | null;
  readonly table: string | null;
  readonly unique: readonly string[];
  readonly columns: readonly ColumnInfo[];
  readonly running: Run | null;
  readonly items: number;
  readonly lastRun: Run | null;
}

/** A page of stored items. */
export interface ItemPage {
  readonly items: ReadonlyArray<Record<string, unknown>>;
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly columns: readonly ColumnInfo[];
}

/** A log line. */
export interface LogLine {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly time: string;
  readonly spider?: string;
  readonly runId?: string;
}

/** Events pushed over the WebSocket. */
export type ServerEvent =
  | {readonly type: 'hello'; readonly runs: readonly Run[]}
  | ({readonly type: 'run:start'} & {runId: string; spider: string; trigger: string})
  | ({readonly type: 'run:end'} & {
      runId: string;
      spider: string;
      status: RunStatus;
      stats: RunStats;
      error?: string;
    })
  | ({readonly type: 'request:done'} & {runId: string; spider: string; url: string; skipped: boolean})
  | ({readonly type: 'request:failed'} & {
      runId: string;
      spider: string;
      url: string;
      error: string;
      willRetry: boolean;
    })
  | ({readonly type: 'item:saved'} & {runId: string; spider: string; count: number})
  | ({readonly type: 'item:dropped'} & {runId: string; spider: string; reasons: string[]})
  | ({readonly type: 'stats'} & {runId: string; spider: string; stats: RunStats})
  | ({readonly type: 'log'} & LogLine);
