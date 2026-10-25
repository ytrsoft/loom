/**
 * @fileoverview The engine runs one spider. It is the only module in Loom
 * that imports Crawlee: request queues, sessions, proxies, retries,
 * autoscaling and browser pools are configured here from the spider's
 * declarative settings, and every Crawlee callback is translated into the
 * engine-agnostic {@link ContextImpl}. Swapping the crawling backend would
 * mean rewriting this file only.
 */

import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {extname, join, relative} from 'node:path';

import {MemoryStorage} from '@crawlee/memory-storage';
import {
  CheerioCrawler,
  Configuration,
  LogLevel as CrawleeLogLevel,
  PlaywrightCrawler,
  ProxyConfiguration,
  RequestQueue,
  log as crawleeLog,
  type Request as CrawleeRequest,
  type RequestOptions,
  type Session,
} from 'crawlee';
import type {Page, Response} from 'playwright';

import {
  LoomError,
  isPermanentError,
  isRetrySignal,
  isSkipSignal,
} from '../errors.js';
import type {EventBus, RunStats, RunStatus} from '../events.js';
import type {Issue} from '../extract/field.js';
import type {Logger} from '../logger.js';
import {HTTP_MODE_BROWSER, type BrowserActions, type Cookie} from '../spider/browser.js';
import {runWithContext} from '../spider/composables.js';
import {
  ContextImpl,
  MemoryRunState,
  type ChildMeta,
  type PageSnapshot,
  type RequestMeta,
} from '../spider/context.js';
import {
  DETAIL_ROUTE,
  createDeclarativeHandlers,
  type DeclarativeHandlers,
} from '../spider/declarative.js';
import {START_ROUTE} from '../spider/define_spider.js';
import {HookRunner, type Plugin, type RequestDraft, type RunInfo} from '../spider/plugin.js';
import type {
  BrowserOptions,
  CrawlContext,
  CrawlSettings,
  DownloadOptions,
  FetchInit,
  Handler,
  RequestInput,
  RequestSpec,
  Spider,
  SpiderDefinition,
  StartInput,
} from '../spider/types.js';
import {toArray, toMilliseconds, toPerMinute} from '../utils.js';
import {PlaywrightActions} from './playwright_actions.js';
import {StatsTracker} from './stats.js';

/** Persists items. Implemented by the storage layer. */
export interface ItemSink {
  write(
    spider: SpiderDefinition,
    items: readonly object[],
    meta: {readonly url: string; readonly runId: string}
  ): Promise<void>;
  /** Whether an item with this unique key exists. */
  has(spider: SpiderDefinition, key: unknown): Promise<boolean>;
}

/** Remembers URLs fetched in earlier runs (`dedupe: 'always'`). */
export interface VisitedStore {
  /** Returns the subset of `urls` that was visited before. */
  filter(spider: string, urls: readonly string[]): Promise<Set<string>>;
  mark(spider: string, urls: readonly string[]): Promise<void>;
}

/** Everything the engine needs from its host. */
export interface EngineServices {
  readonly events: EventBus;
  readonly logger: Logger;
  readonly sink: ItemSink;
  readonly visited?: VisitedStore;
  /** Project root; returned file paths are relative to it. */
  readonly projectRoot: string;
  /** Working directory for state and files (`.loom`). */
  readonly workDir: string;
  /** Plugins applied to every spider. */
  readonly plugins?: readonly Plugin[];
  /** Project-wide defaults, overridden by spider settings. */
  readonly defaults?: CrawlSettings;
}

/** Per-run options. */
export interface RunOptions {
  readonly runId: string;
  /** What started the run: `'manual'`, `'schedule'`, `'api'`, ... */
  readonly trigger?: string;
  readonly signal?: AbortSignal;
  /** Settings that win over spider and project settings (CLI flags). */
  readonly overrides?: CrawlSettings;
  /** Keep the request queue on disk and continue an interrupted run. */
  readonly resume?: boolean;
}

/** Outcome of a run. */
export interface RunResult {
  readonly status: RunStatus;
  readonly stats: RunStats;
  readonly error?: string;
}

interface ResolvedSettings {
  readonly mode: 'http' | 'browser';
  readonly concurrency: number;
  readonly ratePerMinute: number | undefined;
  readonly retries: number;
  readonly timeoutMs: number;
  readonly maxRequests: number | undefined;
  readonly maxDepth: number;
  readonly maxPages: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly cookies: readonly Cookie[];
  readonly proxies: readonly string[];
  readonly robots: boolean;
  readonly sameDomain: boolean;
  readonly dedupe: 'run' | 'always';
  readonly browser: Required<Pick<BrowserOptions, 'engine' | 'headless' | 'waitUntil'>> &
    BrowserOptions;
}

type SendRequest = (options: Record<string, unknown>) => Promise<{
  readonly url: string;
  readonly statusCode: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string | Buffer;
}>;

const META_KEY = '__loom';
const STATS_INTERVAL_MS = 1000;
const START_BATCH = 500;

function resolveSettings(
  spider: SpiderDefinition,
  defaults: CrawlSettings = {},
  overrides: CrawlSettings = {}
): ResolvedSettings {
  const merged: CrawlSettings = {...defaults, ...spider, ...overrides};
  const mode = spider.mode ?? 'http';
  const browser = {...defaults.browser, ...spider.browser, ...overrides.browser};
  const userAgent = merged.userAgent;
  const headers: Record<string, string> = {
    ...defaults.headers,
    ...spider.headers,
    ...overrides.headers,
    ...(userAgent ? {'user-agent': userAgent} : {}),
    ...(browser.locale ? {'accept-language': browser.locale} : {}),
  };
  const cookies = merged.cookies ?? [];
  return {
    mode,
    concurrency: merged.concurrency ?? (mode === 'browser' ? 3 : 10),
    ratePerMinute:
      merged.rateLimit === undefined ? undefined : toPerMinute(merged.rateLimit),
    retries: merged.retries ?? 3,
    timeoutMs: toMilliseconds(merged.timeout ?? '60s'),
    maxRequests: merged.maxRequests,
    maxDepth: merged.maxDepth ?? Number.POSITIVE_INFINITY,
    maxPages: merged.maxPages ?? Number.POSITIVE_INFINITY,
    headers,
    cookies: Array.isArray(cookies)
      ? cookies
      : Object.entries(cookies).map(([name, value]) => ({name, value})),
    proxies: toArray(merged.proxy),
    robots: merged.robots ?? false,
    sameDomain: merged.sameDomain ?? true,
    dedupe: merged.dedupe ?? 'run',
    browser: {
      engine: 'chromium',
      headless: true,
      waitUntil: 'domcontentloaded',
      ...browser,
    },
  };
}

function flattenHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      flat[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  return flat;
}

function encodeBody(
  body: RequestSpec['body'],
  headers: Readonly<Record<string, string>> = {}
): {body: string | undefined; headers: Record<string, string>} {
  if (body === undefined) return {body: undefined, headers: {...headers}};
  if (typeof body === 'string') return {body, headers: {...headers}};
  return {
    body: JSON.stringify(body),
    headers: {'content-type': 'application/json', ...headers},
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cookieHeader(cookies: readonly Cookie[]): string | undefined {
  if (!cookies.length) return undefined;
  return cookies.map(({name, value}) => `${name}=${value}`).join('; ');
}

/** Runs one spider to completion. */
export async function runSpider(
  spider: Spider<object>,
  services: EngineServices,
  options: RunOptions
): Promise<RunResult> {
  return new Engine(spider.options, services, options).run();
}

class Engine {
  private readonly settings: ResolvedSettings;
  private readonly stats = new StatsTracker();
  private readonly hooks: HookRunner;
  private readonly log: Logger;
  private readonly state = new MemoryRunState();
  private readonly runInfo: RunInfo;
  private readonly declarative: DeclarativeHandlers;
  private readonly filesDir: string;
  private queue: RequestQueue | undefined;
  private crawler: CheerioCrawler | PlaywrightCrawler | undefined;
  private stopReason: string | undefined;

  constructor(
    private readonly spider: SpiderDefinition,
    private readonly services: EngineServices,
    private readonly options: RunOptions
  ) {
    this.settings = resolveSettings(
      spider,
      services.defaults,
      options.overrides
    );
    this.log = services.logger.child({spider: spider.name, runId: options.runId});
    this.hooks = new HookRunner([
      ...(services.plugins ?? []),
      ...(spider.use ?? []),
      ...(spider.hooks ? [{name: `${spider.name}:hooks`, ...spider.hooks} as Plugin] : []),
    ]);
    this.runInfo = {
      runId: options.runId,
      spider: spider.name,
      log: this.log,
      state: this.state,
    };
    this.declarative = createDeclarativeHandlers(spider, (ctx, url, carry) =>
      this.enqueue([{url, route: DETAIL_ROUTE, data: ctx.data}], {
        depth: ctx.depth + 1,
        page: 1,
        revisit: false,
        carry,
      })
    );
    this.filesDir = join(services.workDir, 'files', spider.name);
  }

  async run(): Promise<RunResult> {
    const {events} = this.services;
    const {runId} = this.options;
    events.emit('run:start', {
      runId,
      spider: this.spider.name,
      trigger: this.options.trigger ?? 'manual',
    });
    const timer = setInterval(() => this.emitStats(), STATS_INTERVAL_MS);
    let status: RunStatus = 'succeeded';
    let error: string | undefined;
    try {
      crawleeLog.setLevel(CrawleeLogLevel.OFF);
      await this.hooks.runStart(this.runInfo);
      const config = new Configuration({
        storageClient: new MemoryStorage({
          localDataDirectory: join(this.services.workDir, 'state', this.spider.name),
          persistStorage: Boolean(this.options.resume),
          writeMetadata: false,
        }),
        persistStorage: Boolean(this.options.resume),
        purgeOnStart: !this.options.resume,
      });
      this.queue = await RequestQueue.open(
        this.options.resume ? this.spider.name : runId,
        {config}
      );
      this.crawler =
        this.settings.mode === 'browser'
          ? await this.createBrowserCrawler(config)
          : this.createHttpCrawler(config);
      this.options.signal?.addEventListener(
        'abort',
        () => this.requestStop('stopped by user'),
        {once: true}
      );
      this.log.info(`started (${this.settings.mode} mode)`);
      await this.seed();
      if (!this.stopReason) await this.crawler.run();
      if (this.options.signal?.aborted) status = 'stopped';
      else if (this.stats.failed > 0 && this.stats.succeeded === 0) {
        status = 'failed';
        error = 'every request failed';
      }
    } catch (caught) {
      status = 'failed';
      error = errorMessage(caught);
      this.log.error(`run failed: ${error}`);
    } finally {
      clearInterval(timer);
    }
    const stats = this.stats.snapshot();
    await this.hooks.runEnd({...this.runInfo, stats, status});
    if (!this.options.resume) await this.queue?.drop().catch(() => undefined);
    this.log.info(
      `${status}: ${stats.items} items, ${stats.succeeded}/${stats.requests} requests ok, ` +
        `${stats.failed} failed in ${(stats.durationMs / 1000).toFixed(1)}s`
    );
    events.emit('run:end', {
      runId,
      spider: this.spider.name,
      status,
      stats,
      ...(error ? {error} : {}),
    });
    return {status, stats, ...(error ? {error} : {})};
  }

  // -----------------------------------------------------------------------
  // Crawlers
  // -----------------------------------------------------------------------

  private commonOptions() {
    const s = this.settings;
    return {
      requestQueue: this.queue,
      maxConcurrency: s.concurrency,
      ...(s.ratePerMinute ? {maxRequestsPerMinute: s.ratePerMinute} : {}),
      ...(s.maxRequests ? {maxRequestsPerCrawl: s.maxRequests} : {}),
      maxRequestRetries: s.retries,
      requestHandlerTimeoutSecs: Math.ceil(s.timeoutMs / 1000),
      navigationTimeoutSecs: Math.ceil(s.timeoutMs / 1000),
      useSessionPool: true,
      persistCookiesPerSession: true,
      respectRobotsTxtFile: s.robots,
      ...(s.proxies.length
        ? {proxyConfiguration: new ProxyConfiguration({proxyUrls: [...s.proxies]})}
        : {}),
      errorHandler: async (
        {request, session}: {request: CrawleeRequest; session?: Session},
        error: Error
      ) => this.onAttemptFailed(request, error, session, true),
      failedRequestHandler: async (
        {request, session}: {request: CrawleeRequest; session?: Session},
        error: Error
      ) => this.onAttemptFailed(request, error, session, false),
    };
  }

  private createHttpCrawler(config: Configuration): CheerioCrawler {
    const cookie = cookieHeader(this.settings.cookies);
    const baseHeaders = {...this.settings.headers, ...(cookie ? {cookie} : {})};
    return new CheerioCrawler(
      {
        ...this.commonOptions(),
        additionalMimeTypes: [
          'application/json',
          'application/ld+json',
          'application/xml',
          'text/xml',
          'text/plain',
        ],
        preNavigationHooks: [
          ({request}, gotOptions) => {
            gotOptions.headers = {
              ...baseHeaders,
              ...(gotOptions.headers as Record<string, string> | undefined),
              ...request.headers,
            };
          },
        ],
        requestHandler: async ({request, body, response, sendRequest}) => {
          await this.handle(
            request,
            {
              url: request.loadedUrl ?? request.url,
              status: response.statusCode ?? 200,
              headers: flattenHeaders(response.headers),
              body: typeof body === 'string' ? body : body.toString('utf8'),
            },
            HTTP_MODE_BROWSER,
            sendRequest as unknown as SendRequest
          );
        },
      },
      config
    );
  }

  private async createBrowserCrawler(
    config: Configuration
  ): Promise<PlaywrightCrawler> {
    let playwright: typeof import('playwright');
    try {
      playwright = await import('playwright');
    } catch {
      throw new LoomError(
        "mode: 'browser' needs Playwright",
        'run: pnpm add playwright && npx playwright install chromium'
      );
    }
    const s = this.settings;
    const blocked = new Set<string>(s.browser.block ?? []);
    const captured = new WeakMap<Page, Response[]>();
    return new PlaywrightCrawler(
      {
        ...this.commonOptions(),
        headless: s.browser.headless,
        launchContext: {launcher: playwright[s.browser.engine]},
        browserPoolOptions: {useFingerprints: !s.headers['user-agent']},
        preNavigationHooks: [
          async ({page, request}, gotoOptions) => {
            if (gotoOptions) gotoOptions.waitUntil = s.browser.waitUntil;
            const responses: Response[] = [];
            captured.set(page, responses);
            page.on('response', response => {
              const type = response.request().resourceType();
              if ((type === 'xhr' || type === 'fetch') && responses.length < 500) {
                responses.push(response);
              }
            });
            if (blocked.size) {
              await page.route('**/*', route =>
                blocked.has(route.request().resourceType())
                  ? route.abort()
                  : route.continue()
              );
            }
            const headers = {...s.headers, ...request.headers};
            if (Object.keys(headers).length) await page.setExtraHTTPHeaders(headers);
            if (s.browser.viewport) await page.setViewportSize(s.browser.viewport);
            if (s.cookies.length) {
              await page.context().addCookies(
                s.cookies.map(cookie =>
                  cookie.domain
                    ? {...cookie, domain: cookie.domain, path: cookie.path ?? '/'}
                    : {name: cookie.name, value: cookie.value, url: request.url}
                )
              );
            }
          },
        ],
        requestHandler: async ({request, page, response, sendRequest}) => {
          if (s.browser.waitFor) {
            await page.waitForSelector(s.browser.waitFor, {timeout: s.timeoutMs});
          }
          const snapshot = async (): Promise<PageSnapshot> => ({
            url: page.url(),
            status: response?.status() ?? 200,
            headers: response?.headers() ?? {},
            body: await page.content(),
          });
          let current: ContextImpl<object> | undefined;
          const actions = new PlaywrightActions(page, captured.get(page) ?? [], {
            timeoutMs: s.timeoutMs,
            waitUntil: s.browser.waitUntil,
            screenshotDir: join(this.filesDir, 'screenshots'),
            projectRoot: this.services.projectRoot,
            onChange: async () => current?.updateSnapshot(await snapshot()),
          });
          await this.handle(
            request,
            await snapshot(),
            actions,
            sendRequest as unknown as SendRequest,
            ctx => (current = ctx)
          );
        },
      },
      config
    );
  }

  // -----------------------------------------------------------------------
  // Request handling
  // -----------------------------------------------------------------------

  private async handle(
    request: CrawleeRequest,
    snapshot: PageSnapshot,
    browser: BrowserActions,
    send: SendRequest,
    onContext?: (ctx: ContextImpl<object>) => void
  ): Promise<void> {
    const meta = this.readMeta(request);
    const started = Date.now();
    const base = {
      runId: this.options.runId,
      spider: this.spider.name,
      url: request.url,
      route: meta.route,
    };
    this.services.events.emit('request:start', base);
    const ctx: ContextImpl<object> = new ContextImpl<object>(snapshot, meta, {
      spider: this.spider,
      maxPages: this.settings.maxPages,
      sameDomain: this.settings.sameDomain,
      log: this.log,
      state: this.state,
      browser,
      enqueue: (requests, child) => this.enqueue(requests, child),
      save: items => this.saveItems(items, ctx),
      seen: key => this.services.sink.has(this.spider, key),
      fetch: (url, init) => this.sideFetch(send, url, init),
      download: (url, options) => this.download(send, url, options),
      stop: reason => this.requestStop(reason),
      report: (issues, url) => this.reportIssues(issues, url),
    });
    onContext?.(ctx);
    let skipped = false;
    try {
      await runWithContext(ctx, async () => {
        await this.hooks.afterResponse(ctx as CrawlContext);
        await this.resolveHandler(meta)(ctx);
      });
      await ctx.flush();
    } catch (error) {
      await ctx.flush().catch(() => undefined);
      if (isPermanentError(error)) {
        // Definition mistakes do not get better by retrying.
        request.noRetry = true;
      }
      if (!isSkipSignal(error)) throw error;
      skipped = true;
      this.log.debug(`skipped ${request.url}: ${error.message}`);
    }
    if (this.settings.dedupe === 'always' && !meta.revisit) {
      await this.services.visited?.mark(this.spider.name, [request.url]);
    }
    this.stats.requests++;
    this.stats.succeeded++;
    this.services.events.emit('request:done', {
      ...base,
      status: ctx.status,
      durationMs: Date.now() - started,
      skipped,
    });
  }

  private resolveHandler(meta: RequestMeta): Handler<object> {
    if (meta.route === DETAIL_ROUTE) {
      return ctx => this.declarative.detail(ctx, meta.carry ?? {});
    }
    const named = this.spider.routes?.[meta.route];
    if (named) return named as Handler<object>;
    if (meta.route === START_ROUTE) {
      return (this.spider.parse as Handler<object> | undefined) ?? this.declarative.start;
    }
    throw new LoomError(
      `spider "${this.spider.name}" has no route "${meta.route}"`,
      `add routes: {'${meta.route}': async ctx => {...}}`
    );
  }

  private async onAttemptFailed(
    request: CrawleeRequest,
    error: Error,
    session: Session | undefined,
    willRetry: boolean
  ): Promise<void> {
    if (isRetrySignal(error)) session?.retire();
    const route = this.readMeta(request).route;
    const message = errorMessage(error);
    if (willRetry) {
      this.stats.retries++;
      this.log.warn(
        `retry ${request.retryCount + 1}/${this.settings.retries} ` +
          `${request.url}: ${message}`
      );
    } else {
      this.stats.requests++;
      this.stats.failed++;
      this.log.error(`failed ${request.url}: ${message}`);
    }
    this.services.events.emit('request:failed', {
      runId: this.options.runId,
      spider: this.spider.name,
      url: request.url,
      route,
      error: message,
      willRetry,
    });
    await this.hooks.onError(
      error,
      {url: request.url, route, retryCount: request.retryCount, willRetry},
      this.runInfo
    );
  }

  // -----------------------------------------------------------------------
  // Queueing
  // -----------------------------------------------------------------------

  private readMeta(request: CrawleeRequest): RequestMeta {
    const stored = request.userData[META_KEY] as RequestMeta | undefined;
    return (
      stored ?? {
        route: request.label ?? START_ROUTE,
        depth: 0,
        page: 1,
        data: {},
        revisit: true,
      }
    );
  }

  private async seed(): Promise<void> {
    const batch: RequestSpec[] = [];
    const flush = async () => {
      await this.enqueue(batch.splice(0), {depth: 0, page: 1, revisit: true});
    };
    for await (const input of this.startInputs(this.spider.start)) {
      const spec = typeof input === 'string' ? {url: input} : input;
      batch.push({...spec, route: spec.route ?? START_ROUTE});
      if (batch.length >= START_BATCH) await flush();
    }
    await flush();
    if (!this.stats.enqueued && !this.options.resume) {
      this.log.warn('no start requests were queued');
    }
  }

  private async *startInputs(start: StartInput): AsyncIterable<RequestInput> {
    if (typeof start !== 'function') {
      yield* toArray<RequestInput>(start);
      return;
    }
    const produced = await start();
    yield* produced as Iterable<RequestInput> | AsyncIterable<RequestInput>;
  }

  private async enqueue(
    specs: readonly RequestSpec[],
    child: ChildMeta
  ): Promise<number> {
    if (this.stopReason || !this.queue || !specs.length) return 0;
    const accepted: Array<RequestOptions & {url: string}> = [];
    for (const spec of specs) {
      if (child.depth > this.settings.maxDepth) continue;
      const draft: RequestDraft = {
        url: spec.url,
        method: spec.method ?? 'GET',
        headers: {...spec.headers},
        data: {...spec.data},
        route: spec.route ?? START_ROUTE,
        depth: child.depth,
      };
      if (!(await this.hooks.beforeRequest(draft, this.runInfo))) continue;
      const meta: RequestMeta = {
        route: draft.route,
        depth: child.depth,
        page: child.page,
        data: draft.data,
        revisit: child.revisit,
        ...(child.carry ? {carry: child.carry} : {}),
      };
      const {body, headers} = encodeBody(spec.body, draft.headers);
      accepted.push({
        url: draft.url,
        method: draft.method,
        headers,
        ...(body !== undefined ? {payload: body} : {}),
        ...(spec.key ? {uniqueKey: spec.key} : {}),
        useExtendedUniqueKey: draft.method !== 'GET' || body !== undefined,
        label: draft.route,
        userData: {[META_KEY]: meta},
      });
    }
    let pending = accepted;
    if (this.settings.dedupe === 'always' && !child.revisit && this.services.visited) {
      const known = await this.services.visited.filter(
        this.spider.name,
        pending.map(request => request.url)
      );
      pending = pending.filter(request => !known.has(request.url));
    }
    if (!pending.length) return 0;
    const result = await this.queue.addRequests(pending);
    const added = result.processedRequests.filter(r => !r.wasAlreadyPresent).length;
    this.stats.enqueued += added;
    return added;
  }

  private requestStop(reason: string): void {
    if (this.stopReason) return;
    this.stopReason = reason;
    this.log.info(`stopping: ${reason}`);
    this.crawler?.stop(reason);
  }

  // -----------------------------------------------------------------------
  // Items, side requests, files
  // -----------------------------------------------------------------------

  private async saveItems(
    items: readonly object[],
    ctx: ContextImpl<object>
  ): Promise<number> {
    const kept: object[] = [];
    for (const item of items) {
      const result = await this.hooks.onItem(item, ctx as CrawlContext);
      if (result) kept.push(result);
      else this.stats.dropped++;
    }
    if (!kept.length) return 0;
    if (this.spider.store !== false) {
      await this.services.sink.write(this.spider, kept, {
        url: ctx.url,
        runId: this.options.runId,
      });
    }
    this.stats.items += kept.length;
    this.services.events.emit('item:saved', {
      runId: this.options.runId,
      spider: this.spider.name,
      count: kept.length,
      url: ctx.url,
      sample: kept.slice(0, 5),
    });
    return kept.length;
  }

  private reportIssues(issues: readonly Issue[], url: string): void {
    if (!issues.length) return;
    const reasons = issues.map(issue => `${issue.path}: ${issue.message}`);
    const dropped = issues.filter(issue => issue.message.startsWith('dropped')).length;
    this.stats.dropped += dropped;
    const shown = reasons.slice(0, 3).join('; ');
    const more = reasons.length > 3 ? ` (+${reasons.length - 3} more)` : '';
    this.log.warn(`extraction issues on ${url}: ${shown}${more}`);
    this.services.events.emit('item:dropped', {
      runId: this.options.runId,
      spider: this.spider.name,
      url,
      reasons,
    });
  }

  private async sideFetch(
    send: SendRequest,
    url: string,
    init: FetchInit
  ): Promise<PageSnapshot> {
    const {body, headers} = encodeBody(init.body, {
      ...this.settings.headers,
      ...init.headers,
    });
    const response = await send({
      url,
      method: init.method ?? 'GET',
      headers,
      ...(body !== undefined ? {body} : {}),
      throwHttpErrors: false,
      responseType: 'text',
    });
    return {
      url: response.url,
      status: response.statusCode,
      headers: flattenHeaders(response.headers),
      body: String(response.body),
    };
  }

  private async download(
    send: SendRequest,
    url: string,
    options: DownloadOptions
  ): Promise<string> {
    const response = await send({
      url,
      headers: this.settings.headers,
      responseType: 'buffer',
      throwHttpErrors: true,
    });
    const extension = extname(new URL(url).pathname).slice(0, 8);
    const hash = createHash('sha1').update(url).digest('hex').slice(0, 16);
    const directory = join(this.filesDir, options.dir ?? '');
    await mkdir(directory, {recursive: true});
    const file = join(directory, options.name ?? `${hash}${extension}`);
    await writeFile(file, response.body);
    return relative(this.services.projectRoot, file);
  }

  private emitStats(): void {
    this.services.events.emit('stats', {
      runId: this.options.runId,
      spider: this.spider.name,
      stats: this.stats.snapshot(),
    });
  }
}
