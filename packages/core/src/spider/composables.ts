/**
 * @fileoverview The composition API. While a handler runs, its context is
 * available anywhere in the async call chain, so crawling logic can be split
 * into small reusable functions without threading `ctx` through every call:
 *
 *   export async function useAcceptCookies() {
 *     await useBrowser().click('#accept-cookies', {optional: true});
 *   }
 *
 *   routes: {
 *     async product({extract, save}) {
 *       await useAcceptCookies();
 *       await save(extract(product));
 *     },
 *   }
 */

import {AsyncLocalStorage} from 'node:async_hooks';

import {LoomError} from '../errors.js';
import type {Logger} from '../logger.js';
import type {BrowserActions} from './browser.js';
import type {CrawlContext, RunState} from './types.js';

// Stored on globalThis so every copy of Loom in the process shares it.
const STORAGE_KEY = Symbol.for('loom.context');
const globalSlot = globalThis as {
  [STORAGE_KEY]?: AsyncLocalStorage<CrawlContext<object>>;
};
const storage = (globalSlot[STORAGE_KEY] ??=
  new AsyncLocalStorage<CrawlContext<object>>());

/** Runs `callback` with `ctx` as the current context. Used by the engine. */
export function runWithContext<T>(
  ctx: CrawlContext<object>,
  callback: () => T
): T {
  return storage.run(ctx, callback);
}

/** The context of the request currently being handled. */
export function useContext<
  TItem extends object = Record<string, unknown>,
>(): CrawlContext<TItem> {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new LoomError(
      'useContext() was called outside of a request handler',
      'call composables from inside parse/routes handlers or plugin hooks'
    );
  }
  return ctx as unknown as CrawlContext<TItem>;
}

/** Browser actions of the current page (browser mode). */
export function useBrowser(): BrowserActions {
  return useContext().browser;
}

/** The logger of the current run. */
export function useLogger(): Logger {
  return useContext().log;
}

/** Key-value state shared by all requests of the current run. */
export function useRunState(): RunState {
  return useContext().state;
}

/** URL, route and data of the current request. */
export function useRequest(): {
  readonly url: string;
  readonly route: string;
  readonly depth: number;
  readonly data: Readonly<Record<string, unknown>>;
} {
  const {url, route, depth, data} = useContext();
  return {url, route, depth, data};
}
