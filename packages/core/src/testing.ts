/**
 * @fileoverview Offline testing. `testRoute()` runs one handler of a spider
 * against fixture HTML or JSON — no network, no browser, no database — and
 * returns what it saved, queued and reported:
 *
 *   const result = await testRoute(books, 'book', {url, html});
 *   assert.equal(result.items[0].price, 51.77);
 */

import {LoomError} from './errors.js';
import type {Logger} from './logger.js';
import {HTTP_MODE_BROWSER} from './spider/browser.js';
import {runWithContext} from './spider/composables.js';
import {
  ContextImpl,
  MemoryRunState,
  type PageSnapshot,
  type RequestMeta,
} from './spider/context.js';
import {DETAIL_ROUTE, createDeclarativeHandlers} from './spider/declarative.js';
import {START_ROUTE} from './spider/define_spider.js';
import {HookRunner, type Plugin} from './spider/plugin.js';
import type {
  CrawlContext,
  FetchInit,
  Handler,
  RequestSpec,
  Spider,
} from './spider/types.js';

/** A fixture page. Provide `html`, `json` or a raw `body`. */
export interface TestPage {
  readonly url: string;
  readonly html?: string;
  readonly json?: unknown;
  readonly body?: string;
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** `ctx.data` for the handler. */
  readonly data?: Readonly<Record<string, unknown>>;
  /** Item carried from a list page (declarative detail routes). */
  readonly carry?: Readonly<Record<string, unknown>>;
}

/** What a handler did. */
export interface TestResult<TItem extends object> {
  readonly items: TItem[];
  readonly requests: Array<RequestSpec & {readonly route: string}>;
  readonly issues: string[];
  readonly logs: string[];
  readonly stopReason: string | undefined;
}

/** Options for {@link testRoute}. */
export interface TestOptions {
  /** Answers `ctx.fetch()` calls. */
  readonly fetch?: (url: string, init: FetchInit) => TestPage | Promise<TestPage>;
  /** Run the spider's plugins and hooks (default true). */
  readonly hooks?: boolean;
}

function toSnapshot(page: TestPage): PageSnapshot {
  const isJson = page.json !== undefined;
  return {
    url: page.url,
    status: page.status ?? 200,
    headers: {
      'content-type': isJson ? 'application/json' : 'text/html',
      ...page.headers,
    },
    body: isJson ? JSON.stringify(page.json) : (page.html ?? page.body ?? ''),
  };
}

function captureLogger(lines: string[]): Logger {
  const logger: Logger = {
    debug: message => lines.push(`debug: ${message}`),
    info: message => lines.push(`info: ${message}`),
    warn: message => lines.push(`warn: ${message}`),
    error: message => lines.push(`error: ${message}`),
    child: () => logger,
  };
  return logger;
}

/** Runs one route of `spider` against a fixture page. */
export async function testRoute<TItem extends object>(
  spider: Spider<TItem>,
  route: string,
  page: TestPage,
  options: TestOptions = {}
): Promise<TestResult<TItem>> {
  const definition = spider.options;
  const items: TItem[] = [];
  const requests: Array<RequestSpec & {route: string}> = [];
  const issues: string[] = [];
  const logs: string[] = [];
  let stopReason: string | undefined;
  const log = captureLogger(logs);
  const hooks = new HookRunner(
    options.hooks === false
      ? []
      : [
          ...(definition.use ?? []),
          ...(definition.hooks
            ? [{name: 'spider', ...definition.hooks} as Plugin]
            : []),
        ]
  );
  const declarative = createDeclarativeHandlers(definition, async (_, url, carry) => {
    requests.push({url, route: DETAIL_ROUTE, data: carry});
    return 1;
  });
  const meta: RequestMeta = {
    route,
    depth: 0,
    page: 1,
    data: page.data ?? {},
    revisit: true,
    ...(page.carry ? {carry: page.carry} : {}),
  };
  const ctx: ContextImpl<object> = new ContextImpl<object>(toSnapshot(page), meta, {
    spider: definition,
    maxPages: definition.maxPages ?? Number.POSITIVE_INFINITY,
    sameDomain: definition.sameDomain ?? true,
    log,
    state: new MemoryRunState(),
    browser: HTTP_MODE_BROWSER,
    enqueue: async specs => {
      for (const spec of specs) {
        requests.push({...spec, route: spec.route ?? START_ROUTE});
      }
      return specs.length;
    },
    save: async saved => {
      for (const item of saved) {
        const kept = await hooks.onItem(item, ctx as CrawlContext);
        if (kept) items.push(kept as TItem);
      }
      return saved.length;
    },
    seen: async () => false,
    fetch: async (url, init) => {
      if (!options.fetch) {
        throw new LoomError(
          `ctx.fetch(${url}) was called in a test`,
          'pass a fetch fixture: testRoute(spider, route, page, {fetch: url => ({url, html})})'
        );
      }
      return toSnapshot(await options.fetch(url, init));
    },
    download: async url => `downloads/${encodeURIComponent(url)}`,
    stop: reason => {
      stopReason = reason;
    },
    report: found => {
      for (const issue of found) issues.push(`${issue.path}: ${issue.message}`);
    },
  });

  let handler: Handler<object> | undefined;
  if (route === DETAIL_ROUTE) {
    handler = current => declarative.detail(current, page.carry ?? {});
  } else if (definition.routes?.[route]) {
    handler = definition.routes[route] as Handler<object>;
  } else if (route === START_ROUTE) {
    handler = (definition.parse as Handler<object> | undefined) ?? declarative.start;
  }
  if (!handler) {
    throw new LoomError(`spider "${spider.name}" has no route "${route}"`);
  }
  const run = handler;
  await runWithContext(ctx, async () => {
    await hooks.afterResponse(ctx as CrawlContext);
    await run(ctx);
  });
  await ctx.flush();
  return {items, requests, issues, logs, stopReason};
}

export {extractAllFrom, extractFrom} from './extract/extract.js';
