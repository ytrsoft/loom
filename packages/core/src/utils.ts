/**
 * @fileoverview Small helpers for human-friendly configuration values:
 * durations ('30s'), rates ('10/min') and URL patterns ('/products/**').
 */

import {DefinitionError} from './errors.js';

/** A duration in milliseconds, or a string such as `'500ms'`, `'30s'`, `'2m'`. */
export type Duration = number | string;

/** A rate per second, or a string such as `'2/s'`, `'30/min'`, `'1000/h'`. */
export type Rate = number | string;

/** A URL filter: a glob (`'/blog/**'`, `'*.pdf'`) or a regular expression. */
export type UrlPattern = string | RegExp;

const DURATION_UNITS: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
};

/** Converts a {@link Duration} to milliseconds. */
export function toMilliseconds(value: Duration): number {
  if (typeof value === 'number') return value;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|min|h)\s*$/.exec(value);
  if (!match) {
    throw new DefinitionError(
      `invalid duration "${value}"`,
      "use milliseconds or a string like '500ms', '30s', '2m'"
    );
  }
  return Number(match[1]) * DURATION_UNITS[match[2]!]!;
}

const RATE_UNITS: Readonly<Record<string, number>> = {
  s: 60,
  sec: 60,
  m: 1,
  min: 1,
  h: 1 / 60,
  hour: 1 / 60,
};

/** Converts a {@link Rate} to requests per minute. */
export function toPerMinute(value: Rate): number {
  if (typeof value === 'number') return value * 60;
  const match = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(s|sec|m|min|h|hour)\s*$/.exec(
    value
  );
  if (!match) {
    throw new DefinitionError(
      `invalid rate "${value}"`,
      "use requests per second or a string like '2/s', '30/min', '1000/h'"
    );
  }
  return Math.max(1, Math.round(Number(match[1]) * RATE_UNITS[match[2]!]!));
}

/** Compiles a glob into a regular expression matched against full URLs. */
export function globToRegExp(glob: string): RegExp {
  const source = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // One pass so `**` is matched before `*` without a placeholder character.
    .replace(/\*\*|\*|\?/g, token =>
      token === '**' ? '.*' : token === '*' ? '[^/]*' : '[^/]'
    );
  return glob.includes('://')
    ? new RegExp(`^${source}$`)
    : new RegExp(`${source}(?:[?#].*)?$`);
}

/** Tests a URL against a {@link UrlPattern}. */
export function matchesPattern(url: string, pattern: UrlPattern): boolean {
  const regex = typeof pattern === 'string' ? globToRegExp(pattern) : pattern;
  regex.lastIndex = 0;
  return regex.test(url);
}

/** Normalizes a value or list into a list. */
export function toArray<T>(value: T | readonly T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? [...(value as readonly T[])] : [value as T];
}

/** Resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Converts camelCase or kebab-case to snake_case. */
export function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/**
 * Formats a date as local `YYYY-MM-DD HH:mm:ss`, the form used in every
 * human-facing output (logs, CLI tables, CSV/JSON exports).
 */
export function formatDateTime(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
