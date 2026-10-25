/**
 * @fileoverview Forgiving parsers that turn the messy strings found on real
 * pages ("$1,299.00", "1.2万", "3 hours ago", "2024年1月2日") into typed
 * values. Each parser throws a ParseError with a readable reason; fields turn
 * that reason into an extraction issue instead of crashing the crawl.
 */

/** Raised when a raw value cannot be converted to the requested type. */
export class ParseError extends Error {
  override readonly name = 'ParseError';
}

/** Options for {@link parseNumber}. */
export interface NumberOptions {
  /** Decimal separator used by the page. Defaults to `'.'`. */
  readonly decimal?: '.' | ',';
}

const MULTIPLIERS: Readonly<Record<string, number>> = {
  k: 1e3,
  m: 1e6,
  b: 1e9,
  w: 1e4,
  千: 1e3,
  万: 1e4,
  亿: 1e8,
};

const NUMBER_PATTERN =
  /([-−])?\s*(\d[\d\s.,'’]*)\s*(?:([kmbw](?![a-z]))|([千万亿]))?/i;

/** Shortens a value for use inside error messages. */
export function preview(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

/** Parses the first number found in `input`. */
export function parseNumber(input: string, options: NumberOptions = {}): number {
  const match = NUMBER_PATTERN.exec(input);
  if (!match || match[2] === undefined) {
    throw new ParseError(`cannot read a number from "${preview(input)}"`);
  }
  let digits = match[2].replace(/[\s'’]/g, '').replace(/[.,]+$/, '');
  digits =
    options.decimal === ','
      ? digits.replace(/\./g, '').replace(',', '.')
      : digits.replace(/,/g, '');
  let value = Number.parseFloat(digits);
  if (!Number.isFinite(value)) {
    throw new ParseError(`cannot read a number from "${preview(input)}"`);
  }
  const suffix = (match[3] ?? match[4] ?? '').toLowerCase();
  value *= MULTIPLIERS[suffix] ?? 1;
  return match[1] ? -value : value;
}

const SECOND = 1000;
const UNIT_MS: Readonly<Record<string, number>> = {
  second: SECOND,
  minute: 60 * SECOND,
  hour: 3600 * SECOND,
  day: 86400 * SECOND,
  week: 7 * 86400 * SECOND,
  month: 30 * 86400 * SECOND,
  year: 365 * 86400 * SECOND,
  秒: SECOND,
  分钟: 60 * SECOND,
  分: 60 * SECOND,
  小时: 3600 * SECOND,
  天: 86400 * SECOND,
  周: 7 * 86400 * SECOND,
  个月: 30 * 86400 * SECOND,
  月: 30 * 86400 * SECOND,
  年: 365 * 86400 * SECOND,
};

function parseRelativeDate(text: string, now: number): Date | null {
  const lower = text.toLowerCase();
  if (/^(just now|now|刚刚|刚才)$/.test(lower)) return new Date(now);
  if (/^(today|今天)$/.test(lower)) return new Date(now);
  if (/^(yesterday|昨天)$/.test(lower)) return new Date(now - UNIT_MS.day!);
  const english =
    /^(\d+|an?|one)\s*(second|minute|hour|day|week|month|year)s?\s+ago$/.exec(
      lower
    );
  if (english) {
    const amount = /^\d+$/.test(english[1]!) ? Number(english[1]) : 1;
    return new Date(now - amount * UNIT_MS[english[2]!]!);
  }
  const chinese = /^(\d+)\s*(秒|分钟|分|小时|天|周|个月|月|年)前$/.exec(text);
  if (chinese) {
    return new Date(now - Number(chinese[1]) * UNIT_MS[chinese[2]!]!);
  }
  return null;
}

/**
 * Parses absolute dates, unix timestamps (seconds or milliseconds), relative
 * phrases ("3 hours ago", "3小时前") and Chinese dates ("2024年1月2日").
 */
export function parseDate(
  input: string | number | Date,
  now: number = Date.now()
): Date {
  if (input instanceof Date) return input;
  if (typeof input === 'number') {
    return new Date(Math.abs(input) < 1e11 ? input * SECOND : input);
  }
  const text = input.trim();
  if (/^\d{9,13}$/.test(text)) return parseDate(Number(text), now);
  const relative = parseRelativeDate(text, now);
  if (relative) return relative;
  const normalized = text
    .replace(/(\d{4})年(\d{1,2})月(\d{1,2})日?/, '$1-$2-$3')
    .replace(/(\d{4})\/(\d{1,2})\/(\d{1,2})/, '$1-$2-$3')
    .replace(/(\d{4})-(\d)(?=\D|$)/, '$1-0$2')
    .replace(/(\d{4}-\d{2})-(\d)(?=\D|$)/, '$1-0$2');
  const time = Date.parse(normalized);
  if (Number.isNaN(time)) {
    throw new ParseError(`cannot read a date from "${preview(input)}"`);
  }
  return new Date(time);
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'on', '是', '有']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', 'off', '否', '无']);

/** Parses common spellings of booleans. */
export function parseBoolean(input: string | number | boolean): boolean {
  if (typeof input === 'boolean') return input;
  const text = String(input).trim().toLowerCase();
  if (TRUE_WORDS.has(text)) return true;
  if (FALSE_WORDS.has(text)) return false;
  throw new ParseError(`cannot read a boolean from "${preview(input)}"`);
}

/**
 * Resolves `href` against `base`. Returns an absolute URL, or throws for
 * values that are not navigable links (`javascript:`, empty strings).
 */
export function resolveUrl(href: string, base: string): string {
  const value = href.trim();
  if (value === '' || /^javascript:/i.test(value)) {
    throw new ParseError(`"${preview(href)}" is not a link`);
  }
  try {
    return new URL(value, base).href;
  } catch {
    throw new ParseError(`"${preview(href)}" is not a valid URL`);
  }
}

/** Collapses runs of whitespace and trims the result. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Extracts the first balanced JSON object or array from free text, e.g. the
 * state blob in `window.__STATE__ = {...};`.
 */
export function parseEmbeddedJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to scanning for an embedded literal.
  }
  const start = trimmed.search(/[[{]/);
  if (start < 0) throw new ParseError('no JSON value found');
  const open = trimmed[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  for (let i = start; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth++;
    else if (char === close && --depth === 0) {
      try {
        return JSON.parse(trimmed.slice(start, i + 1));
      } catch {
        throw new ParseError('embedded JSON is malformed');
      }
    }
  }
  throw new ParseError('embedded JSON is not terminated');
}
