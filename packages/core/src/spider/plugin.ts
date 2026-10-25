/**
 * @fileoverview Plugins package reusable crawling behaviour (logins, block
 * detection, item cleaning) as lifecycle hooks. Hooks run in order: global
 * plugins from the config, then the spider's `use` list, then the spider's
 * own `hooks`.
 */

import {DefinitionError} from '../errors.js';
import type {RunStats, RunStatus} from '../events.js';
import type {Logger} from '../logger.js';
import type {CrawlContext, HttpMethod, RunState} from './types.js';

/** A request about to be queued. Hooks may edit it in place. */
export interface RequestDraft {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  data: Record<string, unknown>;
  route: string;
  readonly depth: number;
}

/** Information about the current run, passed to run-level hooks. */
export interface RunInfo {
  readonly runId: string;
  readonly spider: string;
  readonly log: Logger;
  readonly state: RunState;
}

/** Information about a request that failed. */
export interface FailedRequestInfo {
  readonly url: string;
  readonly route: string;
  readonly retryCount: number;
  readonly willRetry: boolean;
}

type Awaitable<T> = T | Promise<T>;

/** Lifecycle hooks. Every hook is optional. */
export interface Hooks<TItem extends object = Record<string, unknown>> {
  /** Before the first request. Throwing aborts the run. */
  onRunStart?(run: RunInfo): Awaitable<void>;
  /** After the last request, whatever the outcome. */
  onRunEnd?(
    run: RunInfo & {readonly stats: RunStats; readonly status: RunStatus}
  ): Awaitable<void>;
  /** Before a request is queued. Edit it in place, or return false to drop it. */
  beforeRequest?(request: RequestDraft, run: RunInfo): Awaitable<void | boolean>;
  /** After a page loaded, before its handler. Call `ctx.retry()` to reject it. */
  afterResponse?(ctx: CrawlContext<TItem>): Awaitable<void>;
  /**
   * For every item before storage. Return a (modified) item to keep it, null
   * to drop it, or nothing to keep the item as is.
   */
  onItem?(
    item: TItem,
    ctx: CrawlContext<TItem>
  ): Awaitable<TItem | null | undefined | void>;
  /** When a request fails (including attempts that will be retried). */
  onError?(error: Error, request: FailedRequestInfo, run: RunInfo): Awaitable<void>;
}

/** A named bundle of hooks. */
export interface Plugin extends Hooks {
  readonly name: string;
}

/**
 * Defines a plugin. Plugins with options are plain factories:
 *
 *   export const tagSource = (source: string) =>
 *     definePlugin({name: 'tag-source', onItem: item => ({...item, source})});
 */
export function definePlugin(plugin: Plugin): Plugin {
  if (!plugin.name) {
    throw new DefinitionError('a plugin needs a name', "add name: 'my-plugin'");
  }
  return Object.freeze({...plugin});
}

/** Runs hooks of several plugins in order. */
export class HookRunner {
  constructor(private readonly plugins: readonly Plugin[]) {}

  async runStart(run: RunInfo): Promise<void> {
    for (const plugin of this.plugins) await plugin.onRunStart?.(run);
  }

  async runEnd(
    run: RunInfo & {readonly stats: RunStats; readonly status: RunStatus}
  ): Promise<void> {
    for (const plugin of this.plugins) {
      try {
        await plugin.onRunEnd?.(run);
      } catch (error) {
        run.log.error(`plugin "${plugin.name}" failed in onRunEnd`, {
          error: String(error),
        });
      }
    }
  }

  async beforeRequest(request: RequestDraft, run: RunInfo): Promise<boolean> {
    for (const plugin of this.plugins) {
      if ((await plugin.beforeRequest?.(request, run)) === false) return false;
    }
    return true;
  }

  async afterResponse(ctx: CrawlContext): Promise<void> {
    for (const plugin of this.plugins) await plugin.afterResponse?.(ctx);
  }

  async onItem(item: object, ctx: CrawlContext): Promise<object | null> {
    let current = item as Record<string, unknown>;
    for (const plugin of this.plugins) {
      if (!plugin.onItem) continue;
      const result = await plugin.onItem(current, ctx);
      if (result === null) return null;
      if (result !== undefined) current = result;
    }
    return current;
  }

  async onError(
    error: Error,
    request: FailedRequestInfo,
    run: RunInfo
  ): Promise<void> {
    for (const plugin of this.plugins) {
      try {
        await plugin.onError?.(error, request, run);
      } catch (hookError) {
        run.log.error(`plugin "${plugin.name}" failed in onError`, {
          error: String(hookError),
        });
      }
    }
  }
}
