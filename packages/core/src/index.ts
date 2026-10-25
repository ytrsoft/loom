/**
 * @fileoverview Public API of @loom/core. Most projects import these through
 * the `loom` package, which adds storage and the runtime.
 */

// Extraction DSL.
export {
  $,
  Selection,
  computed,
  jsonLd,
  meta,
  select,
} from './extract/selector.js';
export {Field, type Issue, type ValueKind} from './extract/field.js';
export {
  Schema,
  columnsOf,
  schema,
  type ColumnDescriptor,
} from './extract/schema.js';
export {extractAllFrom, extractFrom} from './extract/extract.js';
export type {
  Extractable,
  Infer,
  InferShape,
  SchemaLike,
  Shape,
  ShapeValue,
} from './extract/types.js';
export {
  ParseError,
  parseBoolean,
  parseDate,
  parseNumber,
  type NumberOptions,
} from './extract/parsers.js';

// Spiders.
export {START_ROUTE, defineSpider, isSpider} from './spider/define_spider.js';
export type {
  BrowserOptions,
  CrawlContext,
  CrawlSettings,
  DetailOptions,
  DownloadOptions,
  EnqueueOptions,
  FetchInit,
  FetchResult,
  FollowOptions,
  Handler,
  HttpMethod,
  Mode,
  RequestInput,
  RequestSpec,
  RunState,
  Spider,
  SpiderDefinition,
  SpiderItem,
  SpiderOptions,
  StartInput,
  StoreOptions,
} from './spider/types.js';
export type {
  ActionOptions,
  BrowserActions,
  CapturedResponse,
  ClickOptions,
  Cookie,
  InfiniteScrollOptions,
} from './spider/browser.js';
export {
  definePlugin,
  type FailedRequestInfo,
  type Hooks,
  type Plugin,
  type RequestDraft,
  type RunInfo,
} from './spider/plugin.js';
export {
  useBrowser,
  useContext,
  useLogger,
  useRequest,
  useRunState,
} from './spider/composables.js';
export {pages, sitemap, type SitemapOptions} from './spider/start.js';

// Built-in plugins.
export {
  detectBlocking,
  filterItems,
  formLogin,
  mapItems,
  type DetectBlockingOptions,
  type FormLoginOptions,
} from './plugins/index.js';

// Runtime.
export {
  runSpider,
  type EngineServices,
  type ItemSink,
  type RunOptions,
  type RunResult,
  type VisitedStore,
} from './runtime/engine.js';
export {
  EventBus,
  type LoomEvent,
  type LoomEventMap,
  type LoomEventName,
  type RunStats,
  type RunStatus,
} from './events.js';
export {
  createLogger,
  type LogBindings,
  type LogLevel,
  type Logger,
} from './logger.js';
export {DefinitionError, ExtractionError, LoomError} from './errors.js';
export {
  toSnakeCase,
  type Duration,
  type Rate,
  type UrlPattern,
} from './utils.js';
