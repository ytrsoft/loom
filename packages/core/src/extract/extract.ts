/**
 * @fileoverview Extraction entry points. Contexts call these with the page
 * scope; developers can call {@link extractFrom} directly to parse any HTML
 * or JSON they already have, e.g. in unit tests or one-off scripts.
 */

import {ExtractionError} from '../errors.js';
import {isRequiredFieldError, type Issue} from './field.js';
import {toField} from './selector.js';
import {HtmlScope, JsonScope, type Scope} from './scope.js';
import type {Extractable, Infer} from './types.js';

/** Result of extracting a list. */
export interface ListOutcome<T> {
  readonly items: T[];
  readonly issues: Issue[];
}

/**
 * Extracts a single value. Missing required fields throw an
 * {@link ExtractionError} listing every problem.
 */
export function extractValue<T extends Extractable>(
  target: T,
  scope: Scope
): {value: Infer<T>; issues: Issue[]} {
  const issues: Issue[] = [];
  try {
    const value = toField(target).resolve(scope, {path: '', issues});
    return {value: value as Infer<T>, issues};
  } catch (error) {
    if (isRequiredFieldError(error)) {
      throw new ExtractionError(scope.baseUrl, [error.message]);
    }
    throw error;
  }
}

/**
 * Extracts `target` from every node matched by `selector`. Nodes missing
 * required fields are skipped and returned as issues.
 */
export function extractEach<T extends Extractable>(
  selector: string,
  target: T,
  scope: Scope
): ListOutcome<Infer<T>> {
  const field = toField(target);
  const issues: Issue[] = [];
  const items: Array<Infer<T>> = [];
  scope.selectAll(selector).forEach((node, index) => {
    const path = `[${index}]`;
    try {
      items.push(field.resolve(node, {path, issues}) as Infer<T>);
    } catch (error) {
      if (!isRequiredFieldError(error)) throw error;
      issues.push({path, message: `dropped: ${error.reason}`});
    }
  });
  return {items, issues};
}

/** Options for {@link extractFrom}. */
export interface ExtractFromOptions {
  /** URL used to resolve relative links. */
  readonly url?: string;
}

const DEFAULT_URL = 'http://localhost/';

/** Builds a scope from raw HTML, a JSON string or an already-parsed value. */
export function documentScope(
  source: string | object,
  url: string = DEFAULT_URL
): Scope {
  if (typeof source !== 'string') return new JsonScope(source, url);
  const trimmed = source.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return new JsonScope(JSON.parse(trimmed), url);
    } catch {
      // Not JSON after all; treat it as HTML.
    }
  }
  return HtmlScope.parse(source, url);
}

/**
 * Extracts `target` from HTML or JSON without crawling.
 *
 *   const book = extractFrom(html, bookSchema, {url});
 */
export function extractFrom<T extends Extractable>(
  source: string | object,
  target: T,
  options: ExtractFromOptions = {}
): Infer<T> {
  return extractValue(target, documentScope(source, options.url)).value;
}

/** Extracts `target` from each node matching `selector` without crawling. */
export function extractAllFrom<T extends Extractable>(
  source: string | object,
  selector: string,
  target: T,
  options: ExtractFromOptions = {}
): Array<Infer<T>> {
  return extractEach(selector, target, documentScope(source, options.url))
    .items;
}
