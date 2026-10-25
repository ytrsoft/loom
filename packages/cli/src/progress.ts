/**
 * @fileoverview A single status line for `loom run`, redrawn in place on a
 * TTY and printed periodically otherwise.
 */

import type {Loom, RunStats} from 'loom';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const CLEAR_LINE = '\x1b[2K\r';

/** Formats a count with thousands separators. */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** Formats milliseconds as `1m 12s`. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** One-line summary of run stats. */
export function describeStats(stats: RunStats): string {
  return [
    `${formatCount(stats.requests)}/${formatCount(stats.enqueued)} requests`,
    `${formatCount(stats.items)} items`,
    stats.failed ? `${formatCount(stats.failed)} failed` : '',
    stats.dropped ? `${formatCount(stats.dropped)} dropped` : '',
    `${stats.requestsPerMinute}/min`,
    formatDuration(stats.durationMs),
  ]
    .filter(Boolean)
    .join('  ');
}

/** Renders live progress for one run. Returns a stop function. */
export function showProgress(loom: Loom, runId: string): () => void {
  const tty = Boolean(process.stderr.isTTY);
  let lastPrinted = 0;
  let line = '';
  const draw = () => {
    if (tty) process.stderr.write(`${CLEAR_LINE}${DIM}${line}${RESET}`);
  };
  const unsubscribeStats = loom.on('stats', event => {
    if (event.runId !== runId) return;
    line = describeStats(event.stats);
    if (tty) {
      draw();
    } else if (Date.now() - lastPrinted > 10_000) {
      lastPrinted = Date.now();
      process.stderr.write(`${line}\n`);
    }
  });
  // Log lines are printed by the logger; clear and redraw the status around them.
  const unsubscribeLog = loom.on('log', () => {
    if (tty && line) {
      process.stderr.write(CLEAR_LINE);
      setImmediate(draw);
    }
  });
  return () => {
    unsubscribeStats();
    unsubscribeLog();
    if (tty) process.stderr.write(CLEAR_LINE);
  };
}
