/**
 * @fileoverview Browser interactions available as `ctx.browser` in
 * `mode: 'browser'`. Every action waits for the page to settle and refreshes
 * the snapshot used by `ctx.extract()`, so extraction after an interaction
 * always sees the updated DOM without any manual re-reading.
 */

import {LoomError} from '../errors.js';
import type {UrlPattern} from '../utils.js';

/** Options shared by actions that target an element. */
export interface ActionOptions {
  /** Do nothing (instead of failing) when the element does not exist. */
  readonly optional?: boolean;
  /** Maximum wait in milliseconds. */
  readonly timeout?: number;
}

/** Options for {@link BrowserActions.click}. */
export interface ClickOptions extends ActionOptions {
  /** Wait for this selector to appear after clicking. */
  readonly waitFor?: string;
  /** Click repeatedly while the element exists (e.g. "load more"). */
  readonly repeat?: number;
}

/** Options for {@link BrowserActions.infiniteScroll}. */
export interface InfiniteScrollOptions {
  /** Selector of the items being loaded; scrolling stops when it stops growing. */
  readonly items?: string;
  /** Stop once this many items are present. */
  readonly max?: number;
  /** Safety limit on scroll steps. Defaults to 50. */
  readonly maxScrolls?: number;
  /** How long to wait for new content after each scroll. Defaults to 1500ms. */
  readonly idle?: number;
}

/** A network response observed by the page (XHR/fetch). */
export interface CapturedResponse {
  readonly url: string;
  readonly status: number;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

/** A browser cookie. */
export interface Cookie {
  readonly name: string;
  readonly value: string;
  readonly domain?: string;
  readonly path?: string;
}

/** Page interactions for browser-mode spiders. */
export interface BrowserActions {
  /** Navigates the current page. */
  goto(url: string): Promise<void>;
  /** Clicks an element. Returns false when an optional element is absent. */
  click(selector: string, options?: ClickOptions): Promise<boolean>;
  /** Replaces the value of an input. */
  fill(selector: string, value: string, options?: ActionOptions): Promise<void>;
  /** Types text with a human-like delay between keys. */
  type(selector: string, text: string, delayMs?: number): Promise<void>;
  /** Presses a key such as `'Enter'`. */
  press(key: string): Promise<void>;
  /** Chooses option(s) of a `<select>`. */
  select(selector: string, value: string | readonly string[]): Promise<void>;
  /** Checks a checkbox or radio button. */
  check(selector: string): Promise<void>;
  /** Hovers an element (menus, tooltips). */
  hover(selector: string): Promise<void>;
  /** Scrolls by a pixel amount, or to the top/bottom. */
  scroll(target?: number | 'top' | 'bottom'): Promise<void>;
  /** Scrolls until no more content loads. Returns the final item count. */
  infiniteScroll(options?: InfiniteScrollOptions): Promise<number>;
  /** Waits for a selector to appear, or for a number of milliseconds. */
  waitFor(target: string | number, options?: ActionOptions): Promise<void>;
  /** Waits until the network is idle. */
  waitForIdle(timeoutMs?: number): Promise<void>;
  /** Waits for a response whose URL matches `pattern` (e.g. after a click). */
  waitForResponse(pattern: UrlPattern, timeoutMs?: number): Promise<CapturedResponse>;
  /** XHR/fetch responses observed since the page started loading. */
  responses(pattern?: UrlPattern): CapturedResponse[];
  /** Runs a function (or expression string) inside the page. */
  evaluate<R, A = undefined>(
    script: string | ((arg: A) => R | Promise<R>),
    arg?: A
  ): Promise<R>;
  /** Saves a screenshot under `.loom/files/<spider>/` and returns its path. */
  screenshot(options?: {name?: string; fullPage?: boolean}): Promise<string>;
  /** Cookies of the current browser context. */
  cookies(): Promise<Cookie[]>;
  /** Adds cookies to the current browser context. */
  setCookies(cookies: readonly Cookie[]): Promise<void>;
  /** Reloads the page. */
  reload(): Promise<void>;
}

/**
 * The `ctx.browser` object of HTTP-mode spiders: every call explains how to
 * switch modes instead of failing with an undefined-property error.
 */
export const HTTP_MODE_BROWSER: BrowserActions = new Proxy(
  {} as BrowserActions,
  {
    get(_target, property) {
      if (property === 'then') return undefined;
      return () => {
        throw new LoomError(
          `ctx.browser.${String(property)}() needs a real browser`,
          "set mode: 'browser' on the spider (pages are then rendered by Chromium)"
        );
      };
    },
  }
);
