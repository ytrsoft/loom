/**
 * @fileoverview A scope is "the thing a field reads from": an HTML element,
 * the whole document, or a value inside a JSON response. Fields only talk to
 * this interface, which is why one extraction DSL works for static pages,
 * browser-rendered pages, JSON APIs and JSON embedded inside HTML.
 */

import {load, type Cheerio, type CheerioAPI} from 'cheerio';
import type {AnyNode} from 'domhandler';

import {normalizeWhitespace} from './parsers.js';

/** The document, element or JSON value a field is resolved against. */
export interface Scope {
  /** Absolute URL used to resolve relative links. */
  readonly baseUrl: string;
  /**
   * Returns the child scopes matched by `selector`. For HTML this is a CSS
   * selector (with `+ sel` / `~ sel` sibling support); for JSON a dot path.
   * An empty selector returns the scope itself.
   */
  selectAll(selector: string): Scope[];
  /** Whitespace-normalized text content. */
  text(): string;
  /** Attribute (HTML) or property (JSON) value, or null when absent. */
  attr(name: string): string | null;
  /** Inner HTML (HTML) or serialized JSON (JSON). */
  html(): string | null;
  /** Outer HTML (HTML) or serialized JSON (JSON). */
  outerHtml(): string | null;
  /** The raw value: text for HTML, the untouched value for JSON. */
  value(): unknown;
}

const SIBLING_SELECTOR = /^([+~])\s*(\S+)\s*(.*)$/;

/** A scope backed by cheerio. */
export class HtmlScope implements Scope {
  /** Parses an HTML string, honouring `<base href>` for link resolution. */
  static parse(html: string, url: string): HtmlScope {
    const $ = load(html);
    const base = $('base[href]').attr('href');
    let baseUrl = url;
    if (base) {
      try {
        baseUrl = new URL(base, url).href;
      } catch {
        // Ignore malformed <base> tags and keep the page URL.
      }
    }
    return new HtmlScope($, $.root(), baseUrl);
  }

  private constructor(
    private readonly $: CheerioAPI,
    private readonly node: Cheerio<AnyNode>,
    readonly baseUrl: string
  ) {}

  selectAll(selector: string): Scope[] {
    const query = selector.trim();
    if (query === '') return [this];
    let matched: Cheerio<AnyNode>;
    const sibling = SIBLING_SELECTOR.exec(query);
    if (sibling) {
      const [, combinator, target, rest] = sibling;
      const siblings =
        combinator === '+' ? this.node.next(target) : this.node.nextAll(target);
      matched = rest ? siblings.find(rest) : siblings;
    } else {
      matched = this.node.find(query);
    }
    return matched
      .toArray()
      .map(el => new HtmlScope(this.$, this.$(el), this.baseUrl));
  }

  text(): string {
    return normalizeWhitespace(this.node.text());
  }

  attr(name: string): string | null {
    return this.node.attr(name) ?? null;
  }

  html(): string | null {
    return this.node.html();
  }

  outerHtml(): string | null {
    return this.$.html(this.node);
  }

  value(): unknown {
    return this.text();
  }
}

type PathToken = string | number | '*';

function tokenizePath(path: string): PathToken[] {
  const tokens: PathToken[] = [];
  for (const part of path.split('.')) {
    const pattern = /([^[\]]+)|\[(\d*|\*)\]/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(part))) {
      if (match[1] !== undefined) {
        tokens.push(/^\d+$/.test(match[1]) ? Number(match[1]) : match[1]);
      } else {
        tokens.push(match[2] === '' || match[2] === '*' ? '*' : Number(match[2]));
      }
    }
  }
  return tokens;
}

/**
 * Reads a dot path such as `data.items[0].title` or `items[*].id`. Wildcards
 * fan out over arrays and return an array of results.
 */
export function readPath(data: unknown, path: string): unknown {
  let current: unknown[] = [data];
  let fannedOut = false;
  for (const token of tokenizePath(path)) {
    const next: unknown[] = [];
    for (const value of current) {
      if (value == null) continue;
      if (token === '*') {
        if (Array.isArray(value)) next.push(...value);
        fannedOut = true;
      } else if (typeof value === 'object') {
        next.push((value as Record<string | number, unknown>)[token]);
      }
    }
    current = next;
  }
  return fannedOut ? current : current[0];
}

/** A scope over a JSON value. */
export class JsonScope implements Scope {
  constructor(
    readonly data: unknown,
    readonly baseUrl: string
  ) {}

  selectAll(path: string): Scope[] {
    const target = path.trim() === '' ? this.data : readPath(this.data, path);
    if (target == null) return [];
    const values = Array.isArray(target) ? target : [target];
    return values
      .filter(value => value != null)
      .map(value => new JsonScope(value, this.baseUrl));
  }

  text(): string {
    if (this.data == null) return '';
    if (typeof this.data === 'object') return JSON.stringify(this.data);
    return normalizeWhitespace(String(this.data));
  }

  attr(name: string): string | null {
    if (this.data == null || typeof this.data !== 'object') return null;
    const value = (this.data as Record<string, unknown>)[name];
    if (value == null) return null;
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  html(): string | null {
    return JSON.stringify(this.data);
  }

  outerHtml(): string | null {
    return this.html();
  }

  value(): unknown {
    return this.data;
  }
}

/** Builds the right scope for a response body. */
export function scopeFor(body: string, url: string, isJson: boolean): Scope {
  if (isJson) return new JsonScope(JSON.parse(body), url);
  return HtmlScope.parse(body, url);
}
