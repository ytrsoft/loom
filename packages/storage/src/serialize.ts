/**
 * @fileoverview Naming conventions and export serialization.
 */

/** Raised for storage misconfiguration, with a hint on how to fix it. */
export class StorageError extends Error {
  override readonly name = 'StorageError';

  constructor(
    message: string,
    readonly hint?: string
  ) {
    super(hint ? `${message}\n  hint: ${hint}` : message);
  }
}

/** `publishedAt` → `published_at`. */
export function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

/** `published_at` → `publishedAt` (a leading underscore is kept). */
export function toCamelCase(value: string): string {
  const leading = value.startsWith('_') ? '_' : '';
  return (
    leading +
    value.replace(/^_/, '').replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
  );
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

/** Timestamps as `Date#toJSON` writes them, e.g. `2026-10-25T02:00:00.000Z`. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Turns dates, and strings holding an ISO timestamp, into local
 * `YYYY-MM-DD HH:mm:ss`; every other value is returned unchanged.
 */
export function readableValue(value: unknown): unknown {
  if (value instanceof Date) return formatDateTime(value);
  if (typeof value === 'string' && ISO_TIMESTAMP.test(value)) {
    return formatDateTime(new Date(value)) || value;
  }
  return value;
}

/** Formats one CSV cell (RFC 4180). */
export function csvCell(value: unknown): string {
  if (value == null) return '';
  const readable = readableValue(value);
  const text =
    typeof readable === 'object' ? JSON.stringify(readable) : String(readable);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Formats one CSV line. */
export function csvLine(values: readonly unknown[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}

/** Splits a list into chunks. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
