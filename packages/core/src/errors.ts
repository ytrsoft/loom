/**
 * @fileoverview Error types used across Loom. Every error a developer can
 * hit carries a `hint` that says how to fix it, so failures read like advice
 * instead of stack traces.
 */

/** Base class for all errors thrown by Loom. */
export class LoomError extends Error {
  override readonly name: string = 'LoomError';

  constructor(
    message: string,
    readonly hint?: string
  ) {
    super(hint ? `${message}\n  hint: ${hint}` : message);
  }
}

/** Thrown when a spider or config definition is invalid. */
export class DefinitionError extends LoomError {
  override readonly name = 'DefinitionError';
}

/** Thrown when a required field could not be extracted from a page. */
export class ExtractionError extends LoomError {
  override readonly name = 'ExtractionError';

  constructor(
    readonly url: string,
    readonly problems: readonly string[]
  ) {
    super(
      `could not extract data from ${url}:\n  - ${problems.join('\n  - ')}`,
      'mark fields that may be absent with .optional() or .default(value)'
    );
  }
}

/**
 * Control-flow signals. They are thrown from `ctx.skip()` / `ctx.retry()` so
 * handler code can bail out with a single expression.
 */
export class SkipSignal extends Error {
  override readonly name = 'SkipSignal';
}

/** Signals that the current request should be retried on a fresh session. */
export class RetrySignal extends Error {
  override readonly name = 'RetrySignal';
}

/**
 * Name-based checks. They keep working when a TypeScript loader evaluates a
 * second copy of Loom, where `instanceof` would silently fail.
 */
export function isSkipSignal(error: unknown): error is SkipSignal {
  return error instanceof Error && error.name === 'SkipSignal';
}

/** See {@link isSkipSignal}. */
export function isRetrySignal(error: unknown): error is RetrySignal {
  return error instanceof Error && error.name === 'RetrySignal';
}

/** Definition mistakes that retrying cannot fix. */
export function isPermanentError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'LoomError' || error.name === 'DefinitionError')
  );
}
