/**
 * @fileoverview A composable: reusable crawling logic that reads the current
 * page through the composition API instead of receiving `ctx` as an argument.
 */

import {$, useContext} from 'loom';

/** The breadcrumb trail of the current page, e.g. `['Home', 'Books', 'Poetry']`. */
export function useBreadcrumbs(selector = '.breadcrumb li'): string[] {
  return useContext().extract($(selector).all().text());
}
