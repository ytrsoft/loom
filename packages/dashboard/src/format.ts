/**
 * @fileoverview Display formatting. Every timestamp the dashboard shows goes
 * through {@link dateTime}: local time as `YYYY-MM-DD HH:mm:ss`.
 */

const numberFormat = new Intl.NumberFormat('zh-CN');

const pad = (value: number): string => String(value).padStart(2, '0');

/** Matches ISO 8601 timestamps such as `2026-10-25T02:00:00.000Z`. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** True for strings that look like an ISO timestamp. */
export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE.test(value);
}

/** Parses a date-ish value; undefined when it is not a valid date. */
function toDate(value: string | number | Date | null | undefined): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Any date → local `2026-10-25 10:00:00`. */
export function dateTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return value ? String(value) : '—';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** Kept for existing callers: same as {@link dateTime}. */
export const time = dateTime;

/** 12345 → "12,345". */
export function count(value: number | undefined | null): string {
  return numberFormat.format(value ?? 0);
}

/** Milliseconds → "1 分 12 秒". */
export function duration(ms: number | undefined | null): string {
  const seconds = Math.round((ms ?? 0) / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

/** Fraction → "97.5%"; "—" when there is nothing to divide. */
export function percent(part: number, whole: number): string {
  if (!whole) return '—';
  const value = (part / whole) * 100;
  return `${value.toFixed(value === 100 || value === 0 ? 0 : 1)}%`;
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  stopped: '已停止',
};

/** Human label of a run status. */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

const TRIGGER_LABELS: Readonly<Record<string, string>> = {
  manual: '手动',
  api: '控制台',
  cli: '命令行',
  schedule: '定时',
};

/** Human label of a run trigger. */
export function triggerLabel(trigger: string): string {
  return TRIGGER_LABELS[trigger] ?? trigger;
}

const LEVEL_LABELS: Readonly<Record<string, string>> = {
  debug: '调试',
  info: '信息',
  warn: '警告',
  error: '错误',
};

/** Human label of a log level. */
export function levelLabel(level: string): string {
  return LEVEL_LABELS[level] ?? level;
}
