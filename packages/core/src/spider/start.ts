/**
 * @fileoverview Helpers that produce start URLs for common situations:
 * numbered pagination and sitemaps.
 */

import {matchesPattern, toArray, type UrlPattern} from '../utils.js';
import type {RequestInput} from './types.js';

/**
 * Expands a URL template over a page range:
 *
 *   start: pages('https://example.com/list?page={page}', 1, 20)
 */
export function pages(
  template: string,
  from: number,
  to: number,
  step = 1
): string[] {
  if (!template.includes('{page}')) {
    throw new Error(`pages(): template "${template}" has no {page} placeholder`);
  }
  const urls: string[] = [];
  for (let page = from; step > 0 ? page <= to : page >= to; page += step) {
    urls.push(template.replaceAll('{page}', String(page)));
  }
  return urls;
}

/** Options for {@link sitemap}. */
export interface SitemapOptions {
  readonly include?: UrlPattern | readonly UrlPattern[];
  readonly exclude?: UrlPattern | readonly UrlPattern[];
  /** Maximum number of URLs to yield. */
  readonly limit?: number;
  /** Route for the yielded URLs. Defaults to `'start'`. */
  readonly route?: string;
}

const LOC_PATTERN = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/g;

/**
 * Reads URLs from a sitemap (following sitemap indexes) as start requests:
 *
 *   start: sitemap('https://shop.example/sitemap.xml', {include: '/products/**'})
 */
export function sitemap(
  url: string,
  options: SitemapOptions = {}
): () => AsyncIterable<RequestInput> {
  const include = toArray(options.include);
  const exclude = toArray(options.exclude);
  const accept = (candidate: string) =>
    (!include.length || include.some(p => matchesPattern(candidate, p))) &&
    !exclude.some(p => matchesPattern(candidate, p));

  return async function* () {
    const pending = [url];
    const visited = new Set<string>();
    let yielded = 0;
    while (pending.length) {
      const next = pending.shift()!;
      if (visited.has(next)) continue;
      visited.add(next);
      const response = await fetch(next);
      if (!response.ok) {
        throw new Error(`sitemap ${next} returned HTTP ${response.status}`);
      }
      const xml = await response.text();
      const isIndex = /<sitemapindex[\s>]/i.test(xml);
      for (const match of xml.matchAll(LOC_PATTERN)) {
        const loc = match[1]!.replace(/&amp;/g, '&');
        if (isIndex) {
          pending.push(loc);
        } else if (accept(loc)) {
          yield options.route ? {url: loc, route: options.route} : loc;
          if (options.limit && ++yielded >= options.limit) return;
        }
      }
    }
  };
}
