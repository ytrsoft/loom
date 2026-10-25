/**
 * @fileoverview The selection DSL. `$(selector)` locates nodes; its methods
 * turn the located nodes into typed fields:
 *
 *   $('.price').number()                 // one number
 *   $('.tag').all().text()               // string[]
 *   $('tr.row').list({name: 'td.name'})  // array of objects
 *   $('script#__NEXT_DATA__').json('props.pageProps').object({...})
 *
 * The same selection works on HTML (CSS selectors) and JSON (dot paths), so
 * switching a spider from HTML scraping to an API does not change its style.
 */

import {
  Field,
  RequiredFieldError,
  childPath,
  isRequiredFieldError,
  isField,
  type AnyField,
  type ResolveContext,
  type ValueKind,
} from './field.js';
import {parseEmbeddedJson, type NumberOptions} from './parsers.js';
import {JsonScope, type Scope} from './scope.js';
import {
  isSchema,
  type Extractable,
  type InferShape,
  type SchemaLike,
  type Shape,
} from './types.js';

type Locator = (scope: Scope) => Scope[];

/** A compiled shape: every key resolved to a field. */
export type CompiledShape = Readonly<Record<string, AnyField>>;

const LAZY_IMAGE_ATTRIBUTES = [
  'src',
  'data-src',
  'data-original',
  'data-lazy-src',
  'data-url',
];

/**
 * A located set of nodes. `M` tracks whether the selection yields one value
 * (default) or a list (after {@link Selection.all}).
 */
export class Selection<M extends boolean = false> {
  /** Use `$()`, `jsonLd()` or `Selection.json()` to create selections. */
  constructor(
    private readonly locate: Locator,
    private readonly many: M,
    private readonly label: string
  ) {}

  /** Switches to list mode: following fields yield one value per node. */
  all(): Selection<true> {
    return new Selection(this.locate, true, `${this.label}.all()`);
  }

  /** Whitespace-normalized text. */
  text(): Field<string, M> {
    return this.read<string>('text()', 'string', scope => scope.text());
  }

  /** An attribute (HTML) or property (JSON). */
  attr(name: string): Field<string, M> {
    return this.read<string>(`attr('${name}')`, 'string', scope => scope.attr(name));
  }

  /** The `href` attribute as an absolute URL. */
  href(): Field<string, M> {
    return this.attr('href').url();
  }

  /** The image source as an absolute URL, including lazy-load attributes. */
  src(): Field<string, M> {
    return this.read<string>('src()', 'string', scope => {
      for (const name of LAZY_IMAGE_ATTRIBUTES) {
        const value = scope.attr(name);
        if (value && !value.startsWith('data:')) return value;
      }
      const srcset = scope.attr('srcset');
      return srcset ? (srcset.split(',')[0]?.trim().split(/\s+/)[0] ?? null) : null;
    }).url();
  }

  /** Inner HTML. */
  html(): Field<string, M> {
    return this.read<string>('html()', 'string', scope => scope.html());
  }

  /** Outer HTML. */
  outerHtml(): Field<string, M> {
    return this.read<string>('outerHtml()', 'string', scope => scope.outerHtml());
  }

  /** Shortcut for `.text().number()` that also accepts JSON numbers. */
  number(options?: NumberOptions): Field<number, M> {
    return this.raw('number').number(options);
  }

  /** Shortcut for `.text().int()` that also accepts JSON numbers. */
  int(): Field<number, M> {
    return this.raw('int').int();
  }

  /** Shortcut for `.text().date()` that also accepts timestamps. */
  date(): Field<Date, M> {
    return this.raw('date').date();
  }

  /** Shortcut for `.text().bool()` that also accepts JSON booleans. */
  bool(): Field<boolean, M> {
    return this.read<string | number | boolean>('', 'boolean', scope =>
      scope.value()
    ).bool();
  }

  /** The raw value: JSON values are kept as-is, HTML yields text. */
  value<V = unknown>(): Field<V, M> {
    return this.read<V>('value()', 'json', scope => scope.value());
  }

  /**
   * Parses the located node's text as JSON (tolerating wrappers such as
   * `window.__STATE__ = {...};`) and continues selecting inside it.
   */
  json(path = ''): Selection<M> {
    const locate = this.locate;
    return new Selection(
      scope =>
        locate(scope).flatMap(node =>
          new JsonScope(parseEmbeddedJson(node.text()), scope.baseUrl).selectAll(
            path
          )
        ),
      this.many,
      `${this.label}.json(${path ? `'${path}'` : ''})`
    );
  }

  /**
   * One object per located node. Nodes missing required fields are dropped
   * and reported as issues, so one broken row never fails a whole page.
   */
  list<S extends Shape>(shape: S | SchemaLike<S>): Field<InferShape<S>, true> {
    const compiled = compileShape(shape);
    const locate = this.locate;
    return new Field<InferShape<S>, true>({
      read: (scope, context) => {
        const rows: unknown[] = [];
        locate(scope).forEach((node, index) => {
          const path = childPath(context.path, index);
          try {
            rows.push(
              resolveShape(compiled, node, {path, issues: context.issues})
            );
          } catch (error) {
            if (!isRequiredFieldError(error)) throw error;
            context.issues.push({path, message: `dropped: ${error.reason}`});
          }
        });
        return rows;
      },
      many: true,
      kind: 'json',
      label: `${this.label}.list({...})`,
    });
  }

  /** A nested object read from the first located node. */
  object<S extends Shape>(
    shape: S | SchemaLike<S>
  ): Field<InferShape<S>, false> {
    const compiled = compileShape(shape);
    const locate = this.locate;
    return new Field<InferShape<S>, false>({
      read: (scope, context) => {
        const node = locate(scope)[0];
        return node ? resolveShape(compiled, node, context) : null;
      },
      many: false,
      kind: 'json',
      label: `${this.label}.object({...})`,
    });
  }

  /** Whether anything matched. Never missing. */
  exists(): Field<boolean, false> {
    const locate = this.locate;
    return new Field<boolean, false>({
      read: scope => locate(scope).length > 0,
      many: false,
      kind: 'boolean',
      label: `${this.label}.exists()`,
    });
  }

  /** How many nodes matched. Never missing. */
  count(): Field<number, false> {
    const locate = this.locate;
    return new Field<number, false>({
      read: scope => locate(scope).length,
      many: false,
      kind: 'integer',
      label: `${this.label}.count()`,
    });
  }

  private raw(name: string): Field<string | number, M> {
    return this.read<string | number>('', 'string', scope => {
      const value = scope.value();
      return typeof value === 'number' ? value : scope.text();
    }).describe(`${this.label}.${name}`);
  }

  private read<T>(
    name: string,
    kind: ValueKind,
    reader: (scope: Scope) => unknown
  ): Field<T, M> {
    const locate = this.locate;
    const read = this.many
      ? (scope: Scope) => locate(scope).map(reader)
      : (scope: Scope) => {
          const node = locate(scope)[0];
          return node ? reader(node) : null;
        };
    return new Field<T, M>({
      read,
      many: this.many,
      kind,
      label: name ? `${this.label}.${name}` : this.label,
    });
  }
}

/**
 * Selects nodes by CSS selector (HTML) or dot path (JSON). Call with no
 * argument to target the current node, e.g. `$().attr('id')` inside a list.
 *
 * Relative sibling selectors are supported for table layouts where one
 * record spans several rows: `$('+ tr .score')` reads from the next row.
 */
export function $(selector = ''): Selection<false> {
  return new Selection(
    scope => scope.selectAll(selector),
    false,
    selector ? `$('${selector}')` : '$()'
  );
}

/** Alias of {@link $} for codebases that avoid `$` identifiers. */
export const select = $;

/**
 * Declares a key that handler code fills in (download paths, values from
 * `ctx.data`, computed scores). It extracts nothing but gives the item type
 * and the database column:
 *
 *   const book = schema({title: 'h1', coverFile: computed<string>()});
 *   await save({...extract(book), coverFile: await download(url)});
 */
export function computed<T = string>(
  kind: ValueKind = 'string'
): Field<T | null, false> {
  return new Field<T | null, false>({
    read: () => null,
    many: false,
    kind,
    optional: true,
    label: 'computed()',
  });
}

/** Reads `<meta name|property|itemprop="...">` content. */
export function meta(name: string): Field<string, false> {
  const selector = ['name', 'property', 'itemprop']
    .map(attribute => `meta[${attribute}="${name}"]`)
    .join(', ');
  return $(selector).attr('content').describe(`meta('${name}')`);
}

function flattenJsonLd(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (value && typeof value === 'object') {
    const graph = (value as Record<string, unknown>)['@graph'];
    return graph ? [value, ...flattenJsonLd(graph)] : [value];
  }
  return [];
}

/**
 * Selects JSON-LD objects (`<script type="application/ld+json">`), optionally
 * filtered by `@type`. Product, Article and Event pages often carry clean
 * structured data here, which beats scraping the visible markup.
 */
export function jsonLd(type?: string): Selection<false> {
  return new Selection(
    scope =>
      scope
        .selectAll('script[type="application/ld+json"]')
        .flatMap(node => {
          try {
            return flattenJsonLd(parseEmbeddedJson(node.text()));
          } catch {
            return [];
          }
        })
        .filter(item => {
          if (!type) return true;
          const declared = (item as Record<string, unknown>)['@type'];
          return Array.isArray(declared)
            ? declared.includes(type)
            : declared === type;
        })
        .map(item => new JsonScope(item, scope.baseUrl)),
    false,
    type ? `jsonLd('${type}')` : 'jsonLd()'
  );
}

/**
 * Expands a shorthand string into a field:
 * `'h1'` → text, `'a @href'` → absolute URL, `'@id'` → own attribute.
 */
export function fromShorthand(spec: string): Field<string, false> {
  const match = /(?:^|\s)@([\w:.-]+)$/.exec(spec);
  if (!match) return $(spec).text();
  const selection = $(spec.slice(0, match.index).trim());
  const name = match[1]!;
  if (name === 'href') return selection.href();
  if (name === 'src') return selection.src();
  return selection.attr(name);
}

const compiledShapes = new WeakMap<object, CompiledShape>();

/** Compiles a shape (or schema) into fields. Results are cached. */
export function compileShape(input: Shape | SchemaLike): CompiledShape {
  const shape = isSchema(input) ? input.shape : input;
  const cached = compiledShapes.get(shape);
  if (cached) return cached;
  const compiled: Record<string, AnyField> = {};
  for (const [key, value] of Object.entries(shape)) {
    compiled[key] = toField(value);
  }
  compiledShapes.set(shape, compiled);
  return compiled;
}

/** Converts anything extractable into a single field. */
export function toField(target: Extractable): AnyField {
  if (isField(target)) return target;
  if (typeof target === 'string') return fromShorthand(target);
  return $().object(target as Shape) as AnyField;
}

/**
 * Resolves every key of a compiled shape. Collects all missing required
 * fields before failing, so error messages list every problem at once.
 */
export function resolveShape(
  compiled: CompiledShape,
  scope: Scope,
  context: ResolveContext
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const [key, field] of Object.entries(compiled)) {
    try {
      output[key] = field.resolve(scope, {
        path: childPath(context.path, key),
        issues: context.issues,
      });
    } catch (error) {
      if (!isRequiredFieldError(error)) throw error;
      missing.push(`${key} (${error.reason})`);
    }
  }
  if (missing.length) {
    throw new RequiredFieldError(
      context.path,
      `missing required ${missing.join(', ')}`
    );
  }
  return output;
}
