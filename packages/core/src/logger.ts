/**
 * @fileoverview A leveled logger. Output is human-readable in a terminal and
 * every entry is also published as a `log` event, so the dashboard shows the
 * same lines the developer sees in their console.
 */

import type {EventBus} from './events.js';
import {formatDateTime} from './utils.js';

/** Log severity. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Structured context attached to every line of a child logger. */
export interface LogBindings {
  readonly spider?: string;
  readonly runId?: string;
}

/** Logger available as `ctx.log` and `useLogger()`. */
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  /** Returns a logger that tags each line with `bindings`. */
  child(bindings: LogBindings): Logger;
}

/** Options for {@link createLogger}. */
export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly events?: EventBus;
  /** Disable console output (events are still emitted). */
  readonly silent?: boolean;
}

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const COLORS: Readonly<Record<LogLevel, string>> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

class ConsoleLogger implements Logger {
  private readonly useColor = Boolean(process.stdout.isTTY);

  constructor(
    private readonly options: LoggerOptions,
    private readonly bindings: LogBindings = {}
  ) {}

  debug(message: string, data?: Record<string, unknown>): void {
    this.write('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.write('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.write('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.write('error', message, data);
  }

  child(bindings: LogBindings): Logger {
    return new ConsoleLogger(this.options, {...this.bindings, ...bindings});
  }

  private write(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): void {
    const time = new Date();
    this.options.events?.emit('log', {
      level,
      message,
      time: time.toISOString(),
      ...this.bindings,
      ...(data ? {data} : {}),
    });
    const threshold = LEVEL_ORDER[this.options.level ?? 'info'];
    if (this.options.silent || LEVEL_ORDER[level] < threshold) return;
    const clock = formatDateTime(time);
    const tag = level.toUpperCase().padEnd(5);
    const scope = this.bindings.spider ? `${this.bindings.spider} ` : '';
    const extra = data ? ` ${JSON.stringify(data)}` : '';
    const line = this.useColor
      ? `${DIM}${clock}${RESET} ${COLORS[level]}${tag}${RESET} ${scope}${message}${DIM}${extra}${RESET}`
      : `${clock} ${tag} ${scope}${message}${extra}`;
    (level === 'error' || level === 'warn' ? console.error : console.log)(line);
  }
}

/** Creates the root logger. */
export function createLogger(options: LoggerOptions = {}): Logger {
  return new ConsoleLogger(options);
}
