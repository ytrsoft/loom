/**
 * @fileoverview Mutable counters behind the immutable {@link RunStats}
 * snapshots published to listeners.
 */

import type {RunStats} from '../events.js';

/** Collects counters for one run. */
export class StatsTracker {
  requests = 0;
  succeeded = 0;
  failed = 0;
  retries = 0;
  enqueued = 0;
  items = 0;
  dropped = 0;
  private readonly started = Date.now();

  /** An immutable copy of the current counters. */
  snapshot(): RunStats {
    const durationMs = Date.now() - this.started;
    const minutes = durationMs / 60_000;
    return {
      requests: this.requests,
      succeeded: this.succeeded,
      failed: this.failed,
      retries: this.retries,
      enqueued: this.enqueued,
      items: this.items,
      dropped: this.dropped,
      startedAt: new Date(this.started).toISOString(),
      durationMs,
      requestsPerMinute:
        minutes > 0 ? Math.round((this.requests / minutes) * 10) / 10 : 0,
    };
  }
}
