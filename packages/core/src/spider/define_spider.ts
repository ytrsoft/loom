/**
 * @fileoverview `defineSpider()` validates a spider definition up front so
 * mistakes surface when the file is loaded, not halfway through a crawl.
 */

import {DefinitionError} from '../errors.js';
import type {Shape} from '../extract/types.js';
import {toMilliseconds, toPerMinute} from '../utils.js';
import {
  SPIDER_BRAND,
  type Spider,
  type SpiderDefinition,
  type SpiderItem,
  type SpiderOptions,
} from './types.js';

const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Route name that receives start URLs. */
export const START_ROUTE = 'start';

function validate(options: SpiderDefinition): void {
  const fail = (message: string, hint?: string): never => {
    throw new DefinitionError(
      `spider "${options.name ?? '?'}": ${message}`,
      hint
    );
  };
  if (!options.name || !NAME_PATTERN.test(options.name)) {
    fail(
      'name must be kebab-case',
      "use lowercase letters, digits and dashes, e.g. name: 'hacker-news'"
    );
  }
  if (options.start === undefined) {
    fail('start is required', "e.g. start: 'https://example.com'");
  }
  const routes = options.routes ?? {};
  if (options.parse && routes[START_ROUTE]) {
    fail('both parse and routes.start are defined', 'keep only one of them');
  }
  const declarative = Boolean(
    options.schema || options.detail || options.next
  );
  if (!options.parse && !routes[START_ROUTE] && !declarative) {
    fail(
      'nothing handles the start URLs',
      'add a parse() handler, routes.start, or a schema for declarative crawling'
    );
  }
  if (options.items && !options.schema) {
    fail('items needs a schema', 'add schema: schema({...})');
  }
  if (options.store && options.store.unique && options.schema) {
    const keys = Object.keys(options.schema.shape).concat(
      Object.keys(options.detail?.schema.shape ?? {})
    );
    const unique =
      typeof options.store.unique === 'string'
        ? [options.store.unique]
        : options.store.unique;
    for (const key of unique) {
      if (!keys.includes(key)) {
        fail(
          `store.unique refers to "${key}", which is not in the schema`,
          `available keys: ${keys.join(', ')}`
        );
      }
    }
  }
  if (options.timeout !== undefined) toMilliseconds(options.timeout);
  if (options.rateLimit !== undefined) toPerMinute(options.rateLimit);
  if (options.concurrency !== undefined && options.concurrency < 1) {
    fail('concurrency must be at least 1');
  }
}

/**
 * Defines a spider. The item type is inferred from `schema` (and
 * `detail.schema`), so `ctx.save()` and stored rows are fully typed.
 *
 * Declarative (no handler code):
 *
 *   export const hackerNews = defineSpider({
 *     name: 'hacker-news',
 *     start: 'https://news.ycombinator.com',
 *     schema: story,
 *     items: 'tr.athing',
 *     next: '.morelink',
 *     maxPages: 3,
 *   });
 *
 * Imperative (full control):
 *
 *   export const books = defineSpider({
 *     name: 'books',
 *     start: 'https://books.toscrape.com',
 *     schema: book,
 *     routes: {
 *       async start({follow, next}) {
 *         await follow('h3 a', 'book');
 *         await next('li.next a');
 *       },
 *       async book({extract, save}) {
 *         await save(extract(book));
 *       },
 *     },
 *   });
 */
export function defineSpider<
  S extends Shape = Record<never, never>,
  D extends Shape = Record<never, never>,
>(options: SpiderOptions<S, D>): Spider<SpiderItem<S, D>> {
  const definition = options as unknown as SpiderDefinition;
  validate(definition);
  return Object.freeze({
    [SPIDER_BRAND]: true as const,
    name: definition.name,
    options: definition,
  });
}

/** Whether `value` is a spider (used by file-system discovery). */
export function isSpider(value: unknown): value is Spider<object> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<Spider>)[SPIDER_BRAND] === true
  );
}
