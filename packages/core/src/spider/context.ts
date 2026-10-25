/**
 * @fileoverview The object behind `ctx`. It is engine-agnostic: the runtime
 * hands it a page snapshot plus a set of services, which is also what makes
 * spiders testable offline (see `testing.ts`).
 *
 * Asynchronous side effects (`save`, `follow`, `enqueue`, `download`) are
 * tracked and awaited after the handler returns, so forgetting an `await`
 * never loses data or hides an error.
 */

import {LoomError, RetrySignal, SkipSignal} from '../errors.js';
import {extractEach, extractValue} from '../extract/extract.js';
import type {Issue} from '../extract/field.js';
import {resolveUrl} from '../extract/parsers.js';
import {scopeFor, HtmlScope, type Scope} from '../extract/scope.js';
import type {Extractable, Infer} from '../extract/types.js';
import type {Logger} from '../logger.js';
import {matchesPattern, toArray} from '../utils.js';
import type {BrowserActions} from './browser.js';
import type {
  CrawlContext,
  DownloadOptions,
  EnqueueOptions,
  FetchInit,
  FetchResult,
  FollowOptions,
  RequestInput,
  RequestSpec,
  RunState,
  SpiderDefinition,
} from './types.js';

/** Routing metadata stored with every queued request. */
export interface RequestMeta {
  readonly route: string;
  readonly depth: number;
  readonly page: number;
  readonly data: Readonly<Record<string, unknown>>;
  /** Partial item carried from a list page to its detail page. */
  readonly carry?: Readonly<Record<string, unknown>>;
  /** Exempt from cross-run de-duplication (start URLs, pagination). */
  readonly revisit: boolean;
}

/** What a request's children inherit. */
export type ChildMeta = Pick<RequestMeta, 'depth' | 'page' | 'revisit'> & {
  readonly carry?: Readonly<Record<string, unknown>>;
};

/** A fetched page (or side response). */
export interface PageSnapshot {
  readonly url: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** Services the runtime provides to a context. */
export interface ContextServices {
  readonly spider: SpiderDefinition;
  readonly maxPages: number;
  readonly sameDomain: boolean;
  readonly log: Logger;
  readonly state: RunState;
  readonly browser: BrowserActions;
  enqueue(requests: readonly RequestSpec[], meta: ChildMeta): Promise<number>;
  save(items: readonly object[], ctx: CrawlContext<object>): Promise<number>;
  seen(key: unknown): Promise<boolean>;
  fetch(url: string, init: FetchInit): Promise<PageSnapshot>;
  download(url: string, options: DownloadOptions): Promise<string>;
  stop(reason: string): void;
  report(issues: readonly Issue[], url: string): void;
}

/** Whether a response should be parsed as JSON. */
export function isJsonResponse(snapshot: PageSnapshot): boolean {
  const type = snapshot.headers['content-type'] ?? '';
  if (/[/+]json\b/i.test(type)) return true;
  if (/html|xml/i.test(type)) return false;
  return /^\s*[[{]/.test(snapshot.body);
}

function createScope(snapshot: PageSnapshot): Scope {
  if (isJsonResponse(snapshot)) {
    try {
      return scopeFor(snapshot.body, snapshot.url, true);
    } catch {
      // Malformed JSON with a JSON content type: fall back to HTML parsing.
    }
  }
  return HtmlScope.parse(snapshot.body, snapshot.url);
}

function parseJson<T>(snapshot: PageSnapshot): T {
  try {
    return JSON.parse(snapshot.body) as T;
  } catch {
    throw new LoomError(
      `response of ${snapshot.url} is not valid JSON`,
      'use ctx.extract() with CSS selectors for HTML responses'
    );
  }
}

/** Wraps a side response with the page extraction API. */
export function createFetchResult(
  snapshot: PageSnapshot,
  report: (issues: readonly Issue[], url: string) => void
): FetchResult {
  let scope: Scope | undefined;
  const document = () => (scope ??= createScope(snapshot));
  return {
    url: snapshot.url,
    status: snapshot.status,
    headers: snapshot.headers,
    body: snapshot.body,
    json: <T>() => parseJson<T>(snapshot),
    extract: <T extends Extractable>(target: T): Infer<T> => {
      const {value, issues} = extractValue(target, document());
      report(issues, snapshot.url);
      return value;
    },
    extractAll: <T extends Extractable>(selector: string, target: T) => {
      const {items, issues} = extractEach(selector, target, document());
      report(issues, snapshot.url);
      return items;
    },
  };
}

const ATTRIBUTE_SUFFIX = /(?:^|\s)@([\w:.-]+)$/;

/** In-memory {@link RunState}. */
export class MemoryRunState implements RunState {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.values.set(key, value);
  }

  increment(key: string, by = 1): number {
    const next = (Number(this.values.get(key)) || 0) + by;
    this.values.set(key, next);
    return next;
  }
}

/** The concrete `ctx` passed to handlers. */
export class ContextImpl<TItem extends object = Record<string, unknown>>
  implements CrawlContext<TItem>
{
  private document: Scope | undefined;
  private readonly pending = new Set<Promise<void>>();
  private readonly failures: unknown[] = [];

  constructor(
    private snapshot: PageSnapshot,
    readonly meta: RequestMeta,
    private readonly services: ContextServices
  ) {}

  get url(): string {
    return this.snapshot.url;
  }

  get route(): string {
    return this.meta.route;
  }

  get depth(): number {
    return this.meta.depth;
  }

  get page(): number {
    return this.meta.page;
  }

  get data(): Readonly<Record<string, unknown>> {
    return this.meta.data;
  }

  get status(): number {
    return this.snapshot.status;
  }

  get headers(): Readonly<Record<string, string>> {
    return this.snapshot.headers;
  }

  get body(): string {
    return this.snapshot.body;
  }

  get browser(): BrowserActions {
    return this.services.browser;
  }

  get log(): Logger {
    return this.services.log;
  }

  get state(): RunState {
    return this.services.state;
  }

  /** Replaces the page snapshot, e.g. after browser interactions. */
  updateSnapshot(snapshot: PageSnapshot): void {
    this.snapshot = snapshot;
    this.document = undefined;
  }

  readonly json = <T = unknown>(): T => parseJson<T>(this.snapshot);

  readonly extract = <T extends Extractable>(target: T): Infer<T> => {
    const {value, issues} = extractValue(target, this.scope());
    this.services.report(issues, this.url);
    return value;
  };

  readonly extractAll = <T extends Extractable>(
    selector: string,
    target: T
  ): Array<Infer<T>> => {
    const {items, issues} = extractEach(selector, target, this.scope());
    this.services.report(issues, this.url);
    return items;
  };

  readonly save = (item: TItem | readonly TItem[]): Promise<void> =>
    this.track(
      this.services
        .save(toArray<TItem>(item), this as CrawlContext<object>)
        .then(() => undefined)
    );

  readonly seen = (key: unknown): Promise<boolean> => this.services.seen(key);

  readonly follow = (
    selector: string,
    route: string = this.route,
    options: FollowOptions = {}
  ): Promise<number> => {
    const urls = this.links(selector, options);
    const requests = urls.map(url => ({url, route, data: options.data ?? {}}));
    return this.track(
      this.services.enqueue(requests, {
        depth: this.depth + 1,
        page: 1,
        revisit: false,
      })
    );
  };

  readonly enqueue = (
    requests: RequestInput | readonly RequestInput[],
    route: string = this.route,
    options: EnqueueOptions = {}
  ): Promise<number> => {
    const specs = toArray<RequestInput>(requests).map(input => {
      const spec = typeof input === 'string' ? {url: input} : input;
      return {
        ...spec,
        url: resolveUrl(spec.url, this.url),
        route: spec.route ?? route,
        data: {...options.data, ...spec.data},
      };
    });
    return this.track(
      this.services.enqueue(specs, {
        depth: this.depth + 1,
        page: 1,
        revisit: false,
      })
    );
  };

  readonly next = async (selector?: string): Promise<boolean> => {
    const target = selector ?? this.services.spider.next;
    if (!target) {
      throw new LoomError(
        'next() needs a selector',
        "pass one (next('a.next')) or set next: 'a.next' on the spider"
      );
    }
    if (this.page >= this.services.maxPages) return false;
    const [url] = this.links(target, {sameDomain: false, limit: 1});
    if (!url) return false;
    const added = await this.track(
      this.services.enqueue([{url, route: this.route, data: this.data}], {
        depth: this.depth,
        page: this.page + 1,
        revisit: true,
      })
    );
    return added > 0;
  };

  readonly fetch = async (
    url: string,
    init: FetchInit = {}
  ): Promise<FetchResult> => {
    const snapshot = await this.services.fetch(resolveUrl(url, this.url), init);
    return createFetchResult(snapshot, (issues, source) =>
      this.services.report(issues, source)
    );
  };

  readonly download = (
    url: string,
    options: DownloadOptions = {}
  ): Promise<string> =>
    this.track(this.services.download(resolveUrl(url, this.url), options));

  readonly skip = (reason = 'skipped'): never => {
    throw new SkipSignal(reason);
  };

  readonly retry = (reason = 'retry requested'): never => {
    throw new RetrySignal(reason);
  };

  readonly stop = (reason = 'stopped by handler'): void => {
    this.services.stop(reason);
  };

  /** Waits for all tracked side effects; rethrows the first failure. */
  async flush(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
    const [failure] = this.failures.splice(0);
    if (failure !== undefined) throw failure;
  }

  private scope(): Scope {
    return (this.document ??= createScope(this.snapshot));
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    const tracked = promise.then(
      () => undefined,
      (error: unknown) => {
        this.failures.push(error);
      }
    );
    this.pending.add(tracked);
    void tracked.finally(() => this.pending.delete(tracked));
    return promise;
  }

  /** Resolves link targets for `follow()` / `next()`. */
  private links(selector: string, options: FollowOptions): string[] {
    const suffix = ATTRIBUTE_SUFFIX.exec(selector);
    const attribute = suffix?.[1];
    const query = suffix ? selector.slice(0, suffix.index).trim() : selector;
    const sameDomain = options.sameDomain ?? this.services.sameDomain;
    const host = new URL(this.url).host;
    const include = toArray(options.include);
    const exclude = toArray(options.exclude);
    const found = new Set<string>();
    for (const node of this.scope().selectAll(query)) {
      const raw = attribute
        ? node.attr(attribute)
        : (node.attr('href') ?? node.selectAll('a[href]')[0]?.attr('href'));
      if (!raw) continue;
      let url: string;
      try {
        url = resolveUrl(raw, node.baseUrl);
      } catch {
        continue;
      }
      if (!/^https?:/.test(url)) continue;
      if (sameDomain && new URL(url).host !== host) continue;
      if (include.length && !include.some(p => matchesPattern(url, p))) continue;
      if (exclude.some(p => matchesPattern(url, p))) continue;
      found.add(url.replace(/#.*$/, ''));
      if (options.limit && found.size >= options.limit) break;
    }
    return [...found];
  }
}
