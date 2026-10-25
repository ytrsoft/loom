/**
 * @fileoverview Built-in plugins for recurring crawling chores. They are
 * written with the same public API available to every developer, so they
 * double as examples for custom plugins.
 */

import {$} from '../extract/selector.js';
import {definePlugin, type Plugin} from '../spider/plugin.js';
import type {CrawlContext} from '../spider/types.js';

/** Options for {@link detectBlocking}. */
export interface DetectBlockingOptions {
  /** Status codes that mean "blocked". Defaults to 403, 429 and 503. */
  readonly statuses?: readonly number[];
  /** Selectors of challenge pages. Defaults cover reCAPTCHA, hCaptcha, Cloudflare. */
  readonly selectors?: readonly string[];
  /** Text patterns that mean "blocked", e.g. `/访问过于频繁/`. Off by default. */
  readonly text?: ReadonlyArray<string | RegExp>;
}

const DEFAULT_BLOCK_SELECTORS = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  '#challenge-form',
  '#cf-challenge-running',
];

/**
 * Retries pages that look like a block or captcha on a fresh session (new
 * proxy, new cookies) instead of storing garbage.
 */
export function detectBlocking(options: DetectBlockingOptions = {}): Plugin {
  const statuses = new Set(options.statuses ?? [403, 429, 503]);
  const selectors = options.selectors ?? DEFAULT_BLOCK_SELECTORS;
  const patterns = options.text ?? [];
  return definePlugin({
    name: 'detect-blocking',
    afterResponse(ctx) {
      if (statuses.has(ctx.status)) ctx.retry(`blocked (HTTP ${ctx.status})`);
      for (const selector of selectors) {
        if (ctx.extract($(selector).exists())) {
          ctx.retry(`blocked (challenge "${selector}")`);
        }
      }
      for (const pattern of patterns) {
        const found =
          typeof pattern === 'string'
            ? ctx.body.includes(pattern)
            : pattern.test(ctx.body);
        if (found) ctx.retry(`blocked (text ${String(pattern)})`);
      }
    },
  });
}

/** Options for {@link formLogin}. */
export interface FormLoginOptions {
  /** URL of the login page. */
  readonly url: string;
  /** Input selector → value, e.g. `{'#username': 'me', '#password': '***'}`. */
  readonly fields: Readonly<Record<string, string>>;
  /** Selector of the submit button. */
  readonly submit: string;
  /** Selector that only exists for logged-in users (e.g. a logout link). */
  readonly loggedIn: string;
}

/**
 * Logs in through a form whenever a page is not authenticated (browser
 * mode). Sessions keep their cookies, so this usually runs once per session.
 */
export function formLogin(options: FormLoginOptions): Plugin {
  const isLoggedIn = (ctx: CrawlContext) =>
    ctx.extract($(options.loggedIn).exists());
  return definePlugin({
    name: 'form-login',
    async afterResponse(ctx) {
      if (isLoggedIn(ctx)) return;
      const target = ctx.url;
      await ctx.browser.goto(options.url);
      for (const [selector, value] of Object.entries(options.fields)) {
        await ctx.browser.fill(selector, value);
      }
      await ctx.browser.click(options.submit, {waitFor: options.loggedIn});
      if (ctx.url !== target) await ctx.browser.goto(target);
      if (!isLoggedIn(ctx)) ctx.retry('login did not succeed');
      ctx.log.info('logged in');
    },
  });
}

/** Transforms every item before storage. */
export function mapItems<T extends object = Record<string, unknown>>(
  transform: (item: T, ctx: CrawlContext<T>) => T | Promise<T>
): Plugin {
  return definePlugin({
    name: 'map-items',
    onItem: async (item, ctx) => {
      const result = await transform(
        item as unknown as T,
        ctx as unknown as CrawlContext<T>
      );
      return result as unknown as Record<string, unknown>;
    },
  });
}

/** Drops items for which `predicate` returns false. */
export function filterItems<T extends object = Record<string, unknown>>(
  predicate: (item: T) => boolean
): Plugin {
  return definePlugin({
    name: 'filter-items',
    onItem: item => (predicate(item as unknown as T) ? item : null),
  });
}
