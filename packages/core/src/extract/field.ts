/**
 * @fileoverview A Field is an immutable, typed extraction rule such as
 * `$('.price').number()`. Fields are values: they can be stored in constants,
 * shared between spiders and refined with further transforms without
 * mutating the original. Each transform also updates the field's storage
 * kind, which is how Loom derives database columns from extraction code.
 */

import {
  ParseError,
  parseBoolean,
  parseDate,
  parseNumber,
  preview,
  resolveUrl,
  type NumberOptions,
} from './parsers.js';
import type {Scope} from './scope.js';

/** How a field's value is stored in a database column. */
export type ValueKind =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'json';

/** A non-fatal problem found while extracting, reported to the developer. */
export interface Issue {
  /** Where the problem occurred, e.g. `items[3].price`. */
  readonly path: string;
  readonly message: string;
}

/** Mutable bookkeeping shared by one extraction pass. */
export interface ResolveContext {
  readonly path: string;
  readonly issues: Issue[];
}

/** Thrown when a required field has no value. */
export class RequiredFieldError extends Error {
  override readonly name = 'RequiredFieldError';

  constructor(
    readonly path: string,
    readonly reason: string
  ) {
    super(path ? `${path}: ${reason}` : reason);
  }
}

/**
 * Whether `error` is a {@link RequiredFieldError}. Checked by name so that it
 * also works when two copies of Loom are loaded (e.g. by a TS loader).
 */
export function isRequiredFieldError(
  error: unknown
): error is RequiredFieldError {
  return error instanceof Error && error.name === 'RequiredFieldError';
}

/** Brand identifying fields across module instances. */
export const FIELD_BRAND: unique symbol = Symbol.for('loom.field');

/** Appends a key or index to a resolve path. */
export function childPath(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

type Reader = (scope: Scope, context: ResolveContext) => unknown;
type Transform = (value: unknown, scope: Scope) => unknown;

/** Internal state of a field. Exposed only to Loom's own modules. */
export interface FieldState {
  readonly read: Reader;
  readonly many: boolean;
  readonly kind: ValueKind;
  readonly label: string;
  readonly transforms?: readonly Transform[];
  readonly optional?: boolean;
  readonly fallback?: {readonly value: unknown};
}

type Outcome = {ok: true; value: unknown} | {ok: false; reason: string};

/**
 * An extraction rule producing `T` (or `T[]` when `M` is true).
 *
 * Required by default: a single-valued field that matches nothing makes the
 * surrounding item invalid. Use {@link Field.optional} or
 * {@link Field.default} for data that may legitimately be absent.
 */
export class Field<T, M extends boolean = false> {
  readonly [FIELD_BRAND] = true as const;
  /** Type-level marker carrying the output type. Never set at runtime. */
  declare readonly output: M extends true ? T[] : T;

  /**
   * Fields are created through `$()`, `meta()`, `jsonLd()` and the transform
   * methods; this constructor is not part of the public API.
   */
  constructor(private readonly state: FieldState) {}

  /** The database column kind this field maps to. */
  get kind(): ValueKind {
    return this.state.many ? 'json' : this.state.kind;
  }

  /** The kind of each element (equal to {@link kind} for single fields). */
  get elementKind(): ValueKind {
    return this.state.kind;
  }

  /** Whether this field yields a list. */
  get many(): boolean {
    return this.state.many;
  }

  /** Whether this field may resolve to null. */
  get nullable(): boolean {
    return !this.state.many && !!this.state.optional && !this.state.fallback;
  }

  /** A readable description such as `$('.price').number()`. */
  toString(): string {
    return this.state.label;
  }

  /**
   * Resolves the field against a scope. Throws {@link RequiredFieldError}
   * when a required single value is missing.
   */
  resolve(scope: Scope, context: ResolveContext): unknown {
    let raw: unknown;
    let readFailure = '';
    try {
      raw = this.state.read(scope, context);
    } catch (error) {
      if (!isRequiredFieldError(error)) throw error;
      readFailure = error.reason;
    }
    if (this.state.many) {
      const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
      const output: unknown[] = [];
      values.forEach((value, index) => {
        const outcome = this.transform(value, scope);
        if (outcome.ok) {
          if (!isEmpty(outcome.value)) output.push(outcome.value);
        } else {
          context.issues.push({
            path: childPath(context.path, index),
            message: outcome.reason,
          });
        }
      });
      return output;
    }
    let reason = readFailure || `${this.state.label} matched nothing`;
    if (!readFailure && raw != null) {
      const outcome = this.transform(raw, scope);
      if (outcome.ok && !isEmpty(outcome.value)) return outcome.value;
      reason = outcome.ok
        ? `${this.state.label} produced an empty value`
        : `${this.state.label}: ${outcome.reason}`;
    }
    if (this.state.fallback) return this.state.fallback.value;
    if (this.state.optional) return null;
    throw new RequiredFieldError(context.path, reason);
  }

  /** Overrides the description used in error messages and logs. */
  describe(label: string): Field<T, M> {
    return new Field<T, M>({...this.state, label});
  }

  // ---------------------------------------------------------------------
  // Type conversions
  // ---------------------------------------------------------------------

  /** Parses a number: `"$1,299.00"` → 1299, `"1.2k"` → 1200, `"3万"` → 30000. */
  number(
    this: Field<string | number, M>,
    options: NumberOptions = {}
  ): Field<number, M> {
    return this.pipeAs('number()', 'number', value =>
      typeof value === 'number' ? value : parseNumber(String(value), options)
    );
  }

  /** Parses an integer (fractions are truncated). */
  int(this: Field<string | number, M>): Field<number, M> {
    return this.pipeAs('int()', 'integer', value =>
      Math.trunc(
        typeof value === 'number' ? value : parseNumber(String(value))
      )
    );
  }

  /** Parses a date, unix timestamp or relative phrase ("3 hours ago"). */
  date(this: Field<string | number, M>): Field<Date, M> {
    return this.pipeAs('date()', 'date', value =>
      parseDate(value as string | number)
    );
  }

  /** Parses "true/yes/1/是" style booleans. */
  bool(this: Field<string | number | boolean, M>): Field<boolean, M> {
    return this.pipeAs('bool()', 'boolean', value =>
      parseBoolean(value as string | number | boolean)
    );
  }

  /** Resolves a relative link to an absolute URL. */
  url(this: Field<string, M>): Field<string, M> {
    return this.pipeAs('url()', 'string', (value, scope) =>
      resolveUrl(String(value), scope.baseUrl)
    );
  }

  // ---------------------------------------------------------------------
  // String transforms
  // ---------------------------------------------------------------------

  /**
   * Keeps the regex match. Uses capture group 1 when the pattern has groups,
   * otherwise the whole match; pass a number or group name to choose.
   */
  match(
    this: Field<string, M>,
    pattern: RegExp,
    group?: number | string
  ): Field<string, M> {
    return this.pipeAs(`match(${pattern})`, 'string', value => {
      pattern.lastIndex = 0;
      const found = pattern.exec(String(value));
      if (!found) {
        throw new ParseError(`"${preview(value)}" does not match ${pattern}`);
      }
      const selected = group ?? (found.length > 1 ? 1 : 0);
      return typeof selected === 'number'
        ? found[selected]
        : found.groups?.[selected];
    });
  }

  /** Replaces occurrences of `pattern`. Strings replace every occurrence. */
  replace(
    this: Field<string, M>,
    pattern: string | RegExp,
    replacement: string
  ): Field<string, M> {
    return this.pipeAs(`replace(${String(pattern)})`, 'string', value =>
      typeof pattern === 'string'
        ? String(value).split(pattern).join(replacement)
        : String(value).replace(pattern, replacement)
    );
  }

  /** Removes a leading/trailing pattern or literal, e.g. `.strip('¥')`. */
  strip(this: Field<string, M>, ...parts: string[]): Field<string, M> {
    return this.pipeAs(`strip(${parts.join(', ')})`, 'string', value => {
      let text = String(value);
      for (const part of parts) text = text.split(part).join('');
      return text.trim();
    });
  }

  /** Lower-cases the value. */
  lower(this: Field<string, M>): Field<string, M> {
    return this.pipeAs('lower()', 'string', value =>
      String(value).toLowerCase()
    );
  }

  /** Upper-cases the value. */
  upper(this: Field<string, M>): Field<string, M> {
    return this.pipeAs('upper()', 'string', value =>
      String(value).toUpperCase()
    );
  }

  /** Splits a value into a trimmed, non-empty list of strings. */
  split(this: Field<string, M>, separator: string | RegExp = ','): Field<
    string[],
    M
  > {
    return this.pipeAs(`split(${String(separator)})`, 'json', value =>
      String(value)
        .split(separator)
        .map(part => part.trim())
        .filter(part => part !== '')
    );
  }

  /** Whether the value matches `pattern`. Combine with `.default(false)`. */
  test(this: Field<string, M>, pattern: RegExp): Field<boolean, M> {
    return this.pipeAs(`test(${pattern})`, 'boolean', value => {
      pattern.lastIndex = 0;
      return pattern.test(String(value));
    });
  }

  /** Maps raw values through a lookup table, e.g. `{One: 1, Two: 2}`. */
  lookup<U extends string | number | boolean>(
    this: Field<string, M>,
    table: Readonly<Record<string, U>>
  ): Field<U, M> {
    const first = Object.values(table)[0];
    const kind: ValueKind =
      typeof first === 'number'
        ? Number.isInteger(first)
          ? 'integer'
          : 'number'
        : typeof first === 'boolean'
          ? 'boolean'
          : 'string';
    return this.pipeAs('lookup()', kind, value => {
      const key = String(value);
      if (!(key in table)) {
        throw new ParseError(`"${preview(key)}" is not in the lookup table`);
      }
      return table[key];
    });
  }

  /**
   * Applies a custom transform. Return null/undefined to mark the value as
   * missing; throw to report a problem. Pass `kind` when the output type
   * changes so the right database column is created.
   */
  pipe<U>(
    transform: (value: T, baseUrl: string) => U | null | undefined,
    kind: ValueKind = this.state.kind
  ): Field<U, M> {
    return this.pipeAs('pipe()', kind, (value, scope) =>
      transform(value as T, scope.baseUrl)
    );
  }

  // ---------------------------------------------------------------------
  // Presence
  // ---------------------------------------------------------------------

  /** Allows the value to be missing; missing values become null. */
  optional(this: Field<T, false>): Field<T | null, false> {
    return new Field<T | null, false>({
      ...this.state,
      optional: true,
      label: `${this.state.label}.optional()`,
    });
  }

  /** Uses `value` when nothing could be extracted. */
  default(this: Field<T, false>, value: T): Field<T, false> {
    return new Field<T, false>({
      ...this.state,
      fallback: {value},
      label: `${this.state.label}.default(${preview(value)})`,
    });
  }

  // ---------------------------------------------------------------------
  // List operations (only on fields created with `.all()`)
  // ---------------------------------------------------------------------

  /** The first element of a list. */
  first(this: Field<T, true>): Field<T, false> {
    return this.reduceList('first()', false, this.state.kind, list => list[0]);
  }

  /** The last element of a list. */
  last(this: Field<T, true>): Field<T, false> {
    return this.reduceList('last()', false, this.state.kind, list => list.at(-1));
  }

  /** Joins a list of strings. */
  join(this: Field<string, true>, separator = ', '): Field<string, false> {
    return this.reduceList('join()', false, 'string', list =>
      list.length ? list.join(separator) : null
    );
  }

  /** Keeps elements matching `predicate`. */
  filter(this: Field<T, true>, predicate: (value: T) => boolean): Field<
    T,
    true
  > {
    return this.reduceList('filter()', true, this.state.kind, list =>
      (list as T[]).filter(predicate)
    );
  }

  /** Removes duplicate elements. */
  unique(this: Field<T, true>): Field<T, true> {
    return this.reduceList('unique()', true, this.state.kind, list => [
      ...new Set(list),
    ]);
  }

  /** Keeps at most `count` elements. */
  limit(this: Field<T, true>, count: number): Field<T, true> {
    return this.reduceList(`limit(${count})`, true, this.state.kind, list =>
      list.slice(0, count)
    );
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private pipeAs<U>(
    name: string,
    kind: ValueKind,
    transform: Transform
  ): Field<U, M> {
    return new Field<U, M>({
      ...this.state,
      kind,
      label: `${this.state.label}.${name}`,
      transforms: [...(this.state.transforms ?? []), transform],
    });
  }

  private reduceList<U, N extends boolean>(
    name: string,
    many: N,
    kind: ValueKind,
    reduce: (list: unknown[]) => unknown
  ): Field<U, N> {
    const source = this as Field<unknown, boolean>;
    return new Field<U, N>({
      read: (scope, context) =>
        reduce(source.resolve(scope, context) as unknown[]),
      many,
      kind,
      label: `${this.state.label}.${name}`,
    });
  }

  private transform(value: unknown, scope: Scope): Outcome {
    let current = value;
    for (const transform of this.state.transforms ?? []) {
      if (isEmpty(current)) break;
      try {
        current = transform(current, scope);
      } catch (error) {
        if (error instanceof Error && error.name === 'ParseError') {
          return {ok: false, reason: error.message};
        }
        throw error;
      }
    }
    return {ok: true, value: current};
  }
}

function isEmpty(value: unknown): boolean {
  return value == null || value === '';
}

/** Any field, regardless of its output type. */
export type AnyField = Field<unknown, boolean>;

/** Narrowing helper used by shape compilation. */
export function isField(value: unknown): value is AnyField {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as {[FIELD_BRAND]?: boolean})[FIELD_BRAND] === true
  );
}
