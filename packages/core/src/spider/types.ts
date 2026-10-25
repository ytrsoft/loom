/**
 * @fileoverview Public types of a spider definition and of the context
 * object its handlers receive. These types are the whole surface a
 * developer works with; nothing from Crawlee leaks through them.
 */

import type {
  Extractable,
  Infer,
  InferShape,
  SchemaLike,
  Shape,
  Simplify,
} from '../extract/types.js';
import type {Logger} from '../logger.js';
import type {Duration, Rate, UrlPattern} from '../utils.js';
import type {BrowserActions, Cookie} from './browser.js';
import type {Hooks, Plugin} from './plugin.js';

/** How pages are fetched: plain HTTP (fast) or a real browser (JS sites). */
export type Mode = 'http' | 'browser';

/** HTTP methods supported for requests. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

/** A request with everything Loom needs to fetch and route it. */
export interface RequestSpec {
  readonly url: string;
  /** Route (handler name) that processes the response. */
  readonly route?: string;
  readonly method?: HttpMethod;
  readonly headers?: Readonly<Record<string, string>>;
  /** Request body. Objects and arrays are sent as JSON. */
  readonly body?: string | Readonly<Record<string, unknown>> | readonly unknown[];
  /** Data handed to the handler as `ctx.data`. */
  readonly data?: Readonly<Record<string, unknown>>;
  /** De-duplication key. Defaults to the normalized URL (+ body). */
  readonly key?: string;
}

/** A URL or a full request. */
export type RequestInput = string | RequestSpec;

/** Start URLs: a value, a list, or a (possibly async) generator. */
export type StartInput =
  | RequestInput
  | readonly RequestInput[]
  | (() =>
      | Iterable<RequestInput>
      | AsyncIterable<RequestInput>
      | Promise<readonly RequestInput[]>);

/** Options for `ctx.follow()`. */
export interface FollowOptions {
  /** Data handed to the next handler as `ctx.data`. */
  readonly data?: Readonly<Record<string, unknown>>;
  /** Follow at most this many links. */
  readonly limit?: number;
  /** Only follow URLs matching one of these patterns. */
  readonly include?: UrlPattern | readonly UrlPattern[];
  /** Never follow URLs matching one of these patterns. */
  readonly exclude?: UrlPattern | readonly UrlPattern[];
  /** Stay on the current host. Defaults to the spider's `sameDomain`. */
  readonly sameDomain?: boolean;
}

/** Options for `ctx.enqueue()`. */
export interface EnqueueOptions {
  /** Data handed to the next handler (merged with per-request data). */
  readonly data?: Readonly<Record<string, unknown>>;
}

/** A side request made with `ctx.fetch()`. */
export interface FetchInit {
  readonly method?: HttpMethod;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Readonly<Record<string, unknown>> | readonly unknown[];
}

/** Response of `ctx.fetch()`, with the same extraction API as the page. */
export interface FetchResult {
  readonly url: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  json<T = unknown>(): T;
  extract<T extends Extractable>(target: T): Infer<T>;
  extractAll<T extends Extractable>(selector: string, target: T): Array<Infer<T>>;
}

/** Options for `ctx.download()`. */
export interface DownloadOptions {
  /** File name; defaults to a hash of the URL plus its extension. */
  readonly name?: string;
  /** Sub-directory below `.loom/files/<spider>/`. */
  readonly dir?: string;
}

/** Key-value state shared by all requests of one run. */
export interface RunState {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  /** Adds `by` (default 1) to a numeric counter and returns the new value. */
  increment(key: string, by?: number): number;
}

/** Everything a handler can do. All methods are bound, so destructure freely. */
export interface CrawlContext<TItem extends object = Record<string, unknown>> {
  /** Final URL of the page (after redirects). */
  readonly url: string;
  /** Route that is handling this request. */
  readonly route: string;
  /** Link distance from the start URL (start = 0). */
  readonly depth: number;
  /** Page number within a `next()` pagination chain (start = 1). */
  readonly page: number;
  /** Data passed with `follow()` / `enqueue()` / start requests. */
  readonly data: Readonly<Record<string, unknown>>;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /** Response body (the rendered DOM in browser mode). */
  readonly body: string;

  /** Parses the response as JSON. */
  json<T = unknown>(): T;
  /**
   * Extracts a field, shorthand, shape or schema from the page. Throws when
   * required data is missing (the request is retried, then reported).
   */
  extract<T extends Extractable>(target: T): Infer<T>;
  /**
   * Extracts `target` from every node matched by `selector`. Rows missing
   * required data are skipped and reported, never thrown.
   */
  extractAll<T extends Extractable>(selector: string, target: T): Array<Infer<T>>;

  /** Stores one or many items (validated, de-duplicated, batched). */
  save(item: TItem | readonly TItem[]): Promise<void>;
  /** Whether an item with this unique key was stored before (incremental crawls). */
  seen(key: unknown): Promise<boolean>;

  /**
   * Follows links found on the page. `selector` matches link elements
   * (`'a.product'`) or uses shorthand for another attribute (`'li @data-url'`).
   * Returns the number of new requests.
   */
  follow(selector: string, route?: string, options?: FollowOptions): Promise<number>;
  /** Adds explicit URLs or requests. Returns the number of new requests. */
  enqueue(
    requests: RequestInput | readonly RequestInput[],
    route?: string,
    options?: EnqueueOptions
  ): Promise<number>;
  /**
   * Follows the "next page" link to the same route, honouring `maxPages`.
   * Defaults to the spider's `next` selector. Returns whether it was queued.
   */
  next(selector?: string): Promise<boolean>;

  /** Makes a side request with the crawler's session, proxy and headers. */
  fetch(url: string, init?: FetchInit): Promise<FetchResult>;
  /** Downloads a file and returns its path relative to the project root. */
  download(url: string, options?: DownloadOptions): Promise<string>;

  /** Page interactions (browser mode). */
  readonly browser: BrowserActions;
  readonly log: Logger;
  readonly state: RunState;

  /** Ends this request without error. */
  skip(reason?: string): never;
  /** Fails this request so it is retried with a fresh session/proxy. */
  retry(reason?: string): never;
  /** Gracefully stops the whole run after in-flight requests finish. */
  stop(reason?: string): void;
}

/** A route handler. */
export type Handler<TItem extends object = Record<string, unknown>> = (
  ctx: CrawlContext<TItem>
) => void | Promise<void>;

/** Browser settings for `mode: 'browser'`. */
export interface BrowserOptions {
  /** Browser engine. Defaults to `'chromium'`. */
  readonly engine?: 'chromium' | 'firefox' | 'webkit';
  /** Defaults to true; `loom run --headful` overrides it. */
  readonly headless?: boolean;
  /** Resource types to block for speed, e.g. `['image', 'font', 'media']`. */
  readonly block?: ReadonlyArray<
    'image' | 'font' | 'media' | 'stylesheet' | 'other'
  >;
  /** Selector to wait for before the handler runs. */
  readonly waitFor?: string;
  /** Navigation readiness. Defaults to `'domcontentloaded'`. */
  readonly waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  readonly viewport?: {readonly width: number; readonly height: number};
  readonly locale?: string;
}

/** Network and behaviour settings; also usable as project-wide defaults. */
export interface CrawlSettings {
  /** Parallel requests. Defaults to 10 (http) or 3 (browser). */
  readonly concurrency?: number;
  /** Maximum request rate, e.g. `'2/s'` or `'30/min'`. */
  readonly rateLimit?: Rate;
  /** Retries per request. Defaults to 3. */
  readonly retries?: number;
  /** Time budget per request. Defaults to `'60s'`. */
  readonly timeout?: Duration;
  /** Stop after this many requests. */
  readonly maxRequests?: number;
  /** Maximum link depth from the start URLs. */
  readonly maxDepth?: number;
  /** Maximum pages followed through `next()`. */
  readonly maxPages?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly userAgent?: string;
  /** Cookies sent with every request. */
  readonly cookies?: readonly Cookie[] | Readonly<Record<string, string>>;
  /** One proxy URL or a pool rotated per session. */
  readonly proxy?: string | readonly string[];
  /** Obey robots.txt. Defaults to false. */
  readonly robots?: boolean;
  /** `follow()` stays on the current host. Defaults to true. */
  readonly sameDomain?: boolean;
  /**
   * `'run'` (default): never fetch a URL twice within a run.
   * `'always'`: also skip URLs fetched successfully in previous runs
   * (start URLs and `next()` pages are always re-fetched).
   */
  readonly dedupe?: 'run' | 'always';
  readonly browser?: BrowserOptions;
}

/** Where and how items are stored. */
export interface StoreOptions<TItem extends object = Record<string, unknown>> {
  /** Table name, or a Drizzle table you manage yourself. Defaults to the spider name. */
  readonly table?: string | object;
  /** Key(s) identifying an item; enables upserts and `ctx.seen()`. */
  readonly unique?: (keyof TItem & string) | ReadonlyArray<keyof TItem & string>;
}

/** Declarative list → detail crawling. */
export interface DetailOptions<D extends Shape> {
  /** Link to the detail page, resolved inside each list item (`'h3 a'`). */
  readonly link: string;
  /** Fields read on the detail page; merged into the list item. */
  readonly schema: SchemaLike<D>;
}

type EmptyShape = Record<never, never>;

/** The item type stored by a spider with list schema `S` and detail schema `D`. */
export type SpiderItem<S extends Shape, D extends Shape> = EmptyShape extends S
  ? EmptyShape extends D
    ? Record<string, unknown>
    : InferShape<D>
  : Simplify<InferShape<S> & (EmptyShape extends D ? unknown : InferShape<D>)>;

/** Options accepted by `defineSpider()`. */
export interface SpiderOptions<
  S extends Shape = EmptyShape,
  D extends Shape = EmptyShape,
> extends CrawlSettings {
  /** Unique kebab-case name, also the default table name. */
  readonly name: string;
  readonly description?: string;
  readonly start: StartInput;
  readonly mode?: Mode;
  /** Item schema: gives `save()` its type and the table its columns. */
  readonly schema?: SchemaLike<S>;
  /** Declarative: selector of repeated items, each extracted with `schema`. */
  readonly items?: string;
  /** Declarative: follow each item to a detail page and merge its fields. */
  readonly detail?: DetailOptions<D>;
  /** Declarative: selector of the "next page" link. */
  readonly next?: string;
  /** Handler for start URLs (shorthand for `routes.start`). */
  readonly parse?: Handler<SpiderItem<S, D>>;
  /** Named handlers for `follow(selector, 'route')`. */
  readonly routes?: Readonly<Record<string, Handler<SpiderItem<S, D>>>>;
  /** Storage options, or `false` to only emit items as events. */
  readonly store?: StoreOptions<SpiderItem<S, D>> | false;
  /** Cron expression for automatic runs, e.g. `'0 * * * *'`. */
  readonly schedule?: string;
  /** Plugins applied to this spider. */
  readonly use?: readonly Plugin[];
  /** Lifecycle hooks for this spider only. */
  readonly hooks?: Hooks<SpiderItem<S, D>>;
}

/** Brand that identifies spiders at runtime (used by auto-discovery). */
export const SPIDER_BRAND: unique symbol = Symbol.for('loom.spider');

/** Type-erased options as seen by the runtime. */
export type SpiderDefinition = SpiderOptions<Shape, Shape>;

/** A defined spider. */
export interface Spider<TItem extends object = Record<string, unknown>> {
  readonly [SPIDER_BRAND]: true;
  readonly name: string;
  readonly options: SpiderDefinition;
  /** Type-level marker carrying the item type. Never set at runtime. */
  readonly item?: TItem;
}
