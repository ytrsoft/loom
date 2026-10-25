/**
 * @fileoverview Handlers generated from declarative spider options. They use
 * only the public context API, so declarative and hand-written spiders
 * behave identically (same validation, hooks, storage and events).
 */

import {Field} from '../extract/field.js';
import {fromShorthand} from '../extract/selector.js';
import type {Shape} from '../extract/types.js';
import type {CrawlContext, Handler, SpiderDefinition} from './types.js';

/** Internal route that receives declarative detail pages. */
export const DETAIL_ROUTE = '__detail';

const LINK_KEY = '__loomDetailLink';

/** Queues a detail page carrying the partially extracted list item. */
export type DetailEnqueuer = (
  ctx: CrawlContext<object>,
  url: string,
  carry: Readonly<Record<string, unknown>>
) => Promise<number>;

/** Builds a field resolving a link: `'h3 a'`, `'.card'` or `'li @data-url'`. */
function linkField(link: string): Field<string, false> {
  if (/(?:^|\s)@[\w:.-]+$/.test(link)) return fromShorthand(link).url();
  return new Field<string, false>({
    read: scope => {
      const node = scope.selectAll(link)[0];
      if (!node) return null;
      return node.attr('href') ?? node.selectAll('a[href]')[0]?.attr('href');
    },
    many: false,
    kind: 'string',
    label: `link('${link}')`,
  }).url();
}

/** Handlers implementing `items`, `detail` and `next`. */
export interface DeclarativeHandlers {
  readonly start: Handler<object>;
  detail(
    ctx: CrawlContext<object>,
    carry: Readonly<Record<string, unknown>>
  ): Promise<void>;
}

/** Creates the declarative handlers of a spider. */
export function createDeclarativeHandlers(
  spider: SpiderDefinition,
  enqueueDetail: DetailEnqueuer
): DeclarativeHandlers {
  const {schema, items, detail, next} = spider;
  const listShape: Shape | undefined =
    schema && detail
      ? {...schema.shape, [LINK_KEY]: linkField(detail.link)}
      : schema?.shape;

  return {
    async start(ctx) {
      if (items && listShape) {
        const rows = ctx.extractAll(items, listShape) as Array<
          Record<string, unknown>
        >;
        if (detail) {
          await Promise.all(
            rows.map(row => {
              const {[LINK_KEY]: link, ...carry} = row;
              return enqueueDetail(ctx, String(link), carry);
            })
          );
        } else {
          await ctx.save(rows);
        }
      } else if (detail) {
        await ctx.follow(detail.link, DETAIL_ROUTE);
      } else if (schema) {
        await ctx.save(ctx.extract(schema) as object);
      }
      if (next) await ctx.next(next);
    },

    async detail(ctx, carry) {
      if (!detail) return;
      const fields = ctx.extract(detail.schema) as Record<string, unknown>;
      await ctx.save({...carry, ...fields});
    },
  };
}
