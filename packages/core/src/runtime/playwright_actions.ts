/**
 * @fileoverview Implements `ctx.browser` on top of a Playwright page. After
 * every interaction the page is allowed to settle and the context snapshot is
 * refreshed, so `ctx.extract()` always reads the current DOM.
 */

import {mkdir} from 'node:fs/promises';
import {join, relative} from 'node:path';

import type {Page, Response} from 'playwright';

import {LoomError} from '../errors.js';
import type {
  ActionOptions,
  BrowserActions,
  CapturedResponse,
  ClickOptions,
  Cookie,
  InfiniteScrollOptions,
} from '../spider/browser.js';
import {matchesPattern, type UrlPattern} from '../utils.js';

/** Settings for {@link PlaywrightActions}. */
export interface PlaywrightActionsOptions {
  readonly timeoutMs: number;
  readonly waitUntil: 'load' | 'domcontentloaded' | 'networkidle';
  readonly screenshotDir: string;
  readonly projectRoot: string;
  /** Refreshes the context snapshot after the DOM changed. */
  readonly onChange: () => Promise<void>;
}

const SETTLE_TIMEOUT_MS = 3000;

function wrap(response: Response): CapturedResponse {
  return {
    url: response.url(),
    status: response.status(),
    text: () => response.text(),
    json: <T>() => response.json() as Promise<T>,
  };
}

/** Browser actions for one page. */
export class PlaywrightActions implements BrowserActions {
  constructor(
    private readonly page: Page,
    private readonly captured: readonly Response[],
    private readonly options: PlaywrightActionsOptions
  ) {}

  async goto(url: string): Promise<void> {
    await this.page.goto(url, {
      waitUntil: this.options.waitUntil,
      timeout: this.options.timeoutMs,
    });
    await this.options.onChange();
  }

  async click(selector: string, options: ClickOptions = {}): Promise<boolean> {
    const timeout = options.timeout ?? this.options.timeoutMs;
    const locator = this.page.locator(selector).first();
    const times = options.repeat ?? 1;
    let clicks = 0;
    while (clicks < times) {
      if (clicks === 0 && options.optional && !(await locator.count())) break;
      if (clicks > 0 && !(await locator.isVisible())) break;
      await locator.click({timeout});
      clicks++;
      if (options.waitFor) {
        await this.page.waitForSelector(options.waitFor, {timeout});
      } else {
        await this.settle();
      }
    }
    await this.options.onChange();
    return clicks > 0;
  }

  async fill(
    selector: string,
    value: string,
    options: ActionOptions = {}
  ): Promise<void> {
    const locator = this.page.locator(selector).first();
    if (options.optional && !(await locator.count())) return;
    await locator.fill(value, {timeout: options.timeout ?? this.options.timeoutMs});
    await this.options.onChange();
  }

  async type(selector: string, text: string, delayMs = 60): Promise<void> {
    await this.page.locator(selector).first().pressSequentially(text, {
      delay: delayMs,
      timeout: this.options.timeoutMs,
    });
    await this.options.onChange();
  }

  async press(key: string): Promise<void> {
    await this.page.keyboard.press(key);
    await this.settle();
    await this.options.onChange();
  }

  async select(selector: string, value: string | readonly string[]): Promise<void> {
    await this.page.selectOption(
      selector,
      typeof value === 'string' ? value : [...value],
      {timeout: this.options.timeoutMs}
    );
    await this.settle();
    await this.options.onChange();
  }

  async check(selector: string): Promise<void> {
    await this.page.locator(selector).first().check({
      timeout: this.options.timeoutMs,
    });
    await this.options.onChange();
  }

  async hover(selector: string): Promise<void> {
    await this.page.locator(selector).first().hover({
      timeout: this.options.timeoutMs,
    });
    await this.settle();
    await this.options.onChange();
  }

  async scroll(target: number | 'top' | 'bottom' = 'bottom'): Promise<void> {
    const script =
      target === 'top'
        ? 'window.scrollTo(0, 0)'
        : target === 'bottom'
          ? 'window.scrollTo(0, document.body.scrollHeight)'
          : `window.scrollBy(0, ${Number(target)})`;
    await this.page.evaluate(script);
    await this.settle();
    await this.options.onChange();
  }

  async infiniteScroll(options: InfiniteScrollOptions = {}): Promise<number> {
    const maxScrolls = options.maxScrolls ?? 50;
    const idle = options.idle ?? 1500;
    const measure = async () =>
      options.items
        ? this.page.locator(options.items).count()
        : this.page.evaluate<number>('document.body.scrollHeight');
    let previous = await measure();
    let stalled = 0;
    for (let step = 0; step < maxScrolls; step++) {
      await this.page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await this.page
        .waitForLoadState('networkidle', {timeout: idle})
        .catch(() => undefined);
      const current = await measure();
      if (options.items && options.max && current >= options.max) break;
      if (current > previous) {
        stalled = 0;
      } else if (++stalled >= 2) {
        break;
      } else {
        await this.page.waitForTimeout(idle);
      }
      previous = current;
    }
    await this.options.onChange();
    return options.items ? this.page.locator(options.items).count() : 0;
  }

  async waitFor(
    target: string | number,
    options: ActionOptions = {}
  ): Promise<void> {
    if (typeof target === 'number') {
      await this.page.waitForTimeout(target);
    } else {
      try {
        await this.page.waitForSelector(target, {
          timeout: options.timeout ?? this.options.timeoutMs,
        });
      } catch (error) {
        if (!options.optional) {
          throw new LoomError(
            `"${target}" did not appear on ${this.page.url()}`,
            'check the selector, raise the timeout, or pass {optional: true}'
          );
        }
      }
    }
    await this.options.onChange();
  }

  async waitForIdle(timeoutMs = 10_000): Promise<void> {
    await this.page
      .waitForLoadState('networkidle', {timeout: timeoutMs})
      .catch(() => undefined);
    await this.options.onChange();
  }

  async waitForResponse(
    pattern: UrlPattern,
    timeoutMs = this.options.timeoutMs
  ): Promise<CapturedResponse> {
    const response = await this.page.waitForResponse(
      candidate => matchesPattern(candidate.url(), pattern),
      {timeout: timeoutMs}
    );
    await this.options.onChange();
    return wrap(response);
  }

  responses(pattern?: UrlPattern): CapturedResponse[] {
    return this.captured
      .filter(response => !pattern || matchesPattern(response.url(), pattern))
      .map(wrap);
  }

  async evaluate<R, A = undefined>(
    script: string | ((arg: A) => R | Promise<R>),
    arg?: A
  ): Promise<R> {
    const result = (await this.page.evaluate(
      script as never,
      arg as never
    )) as R;
    await this.options.onChange();
    return result;
  }

  async screenshot(
    options: {name?: string; fullPage?: boolean} = {}
  ): Promise<string> {
    await mkdir(this.options.screenshotDir, {recursive: true});
    const file = join(
      this.options.screenshotDir,
      `${options.name ?? Date.now()}.png`
    );
    await this.page.screenshot({path: file, fullPage: options.fullPage ?? true});
    return relative(this.options.projectRoot, file);
  }

  async cookies(): Promise<Cookie[]> {
    const cookies = await this.page.context().cookies();
    return cookies.map(({name, value, domain, path}) => ({
      name,
      value,
      domain,
      path,
    }));
  }

  async setCookies(cookies: readonly Cookie[]): Promise<void> {
    const url = this.page.url();
    await this.page.context().addCookies(
      cookies.map(cookie =>
        cookie.domain
          ? {...cookie, path: cookie.path ?? '/', domain: cookie.domain}
          : {name: cookie.name, value: cookie.value, url}
      )
    );
  }

  async reload(): Promise<void> {
    await this.page.reload({waitUntil: this.options.waitUntil});
    await this.options.onChange();
  }

  private async settle(): Promise<void> {
    await this.page
      .waitForLoadState('networkidle', {timeout: SETTLE_TIMEOUT_MS})
      .catch(() => undefined);
  }
}
