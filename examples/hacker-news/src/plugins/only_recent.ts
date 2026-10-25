/**
 * @fileoverview A plugin with options: drops items older than N days.
 */

import {definePlugin, type Plugin} from 'loom';

/** Options for {@link onlyRecent}. */
export interface OnlyRecentOptions {
  /** Date field of the item. */
  readonly field: string;
  readonly days: number;
}

/** Keeps only items whose `field` is within the last `days` days. */
export function onlyRecent(options: OnlyRecentOptions): Plugin {
  const maxAge = options.days * 86_400_000;
  return definePlugin({
    name: 'only-recent',
    onItem(item, ctx) {
      const value = item[options.field];
      const time =
        value instanceof Date ? value.getTime() : Date.parse(String(value));
      if (Number.isNaN(time) || Date.now() - time <= maxAge) return;
      ctx.log.debug(`dropped an item older than ${options.days} days`);
      return null;
    },
  });
}
