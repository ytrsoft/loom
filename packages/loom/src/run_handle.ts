/**
 * @fileoverview A handle to a run in progress: live stats, a stop switch and
 * a promise for the final summary.
 */

import type {EventBus, RunResult, RunStats, RunStatus} from '@loom/core';

/** Serializable state of a run. */
export interface RunSummary {
  readonly id: string;
  readonly spider: string;
  readonly trigger: string;
  readonly status: RunStatus;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly stats: RunStats | null;
  readonly error: string | null;
}

/** Static information about a run. */
export interface RunInfoInput {
  readonly id: string;
  readonly spider: string;
  readonly trigger: string;
}

/** A run in progress (or just finished). */
export class RunHandle {
  readonly id: string;
  readonly spider: string;
  readonly trigger: string;
  readonly startedAt = new Date();
  /** Resolves with the final summary. Never rejects. */
  readonly done: Promise<RunSummary>;
  private currentStatus: RunStatus = 'running';
  private currentStats: RunStats | null = null;
  private endedAt: Date | null = null;
  private error: string | null = null;
  private readonly controller = new AbortController();

  constructor(
    info: RunInfoInput,
    events: EventBus,
    execute: (signal: AbortSignal) => Promise<RunResult>
  ) {
    this.id = info.id;
    this.spider = info.spider;
    this.trigger = info.trigger;
    const unsubscribe = events.on('stats', event => {
      if (event.runId === this.id) this.currentStats = event.stats;
    });
    this.done = execute(this.controller.signal)
      .then(
        result => {
          this.currentStatus = result.status;
          this.currentStats = result.stats;
          this.error = result.error ?? null;
        },
        (error: unknown) => {
          this.currentStatus = 'failed';
          this.error = error instanceof Error ? error.message : String(error);
        }
      )
      .then(() => {
        this.endedAt = new Date();
        unsubscribe();
        return this.toJSON();
      });
  }

  get status(): RunStatus {
    return this.currentStatus;
  }

  get stats(): RunStats | null {
    return this.currentStats;
  }

  /** Requests a graceful stop; in-flight requests finish first. */
  stop(): void {
    this.controller.abort();
  }

  toJSON(): RunSummary {
    return {
      id: this.id,
      spider: this.spider,
      trigger: this.trigger,
      status: this.currentStatus,
      startedAt: this.startedAt.toISOString(),
      endedAt: this.endedAt?.toISOString() ?? null,
      stats: this.currentStats,
      error: this.error,
    };
  }
}
