/**
 * @fileoverview Hash routes: `#/`, `#/runs` and `#/spiders/<name>`.
 */

import {useEffect, useState} from 'react';

/** A parsed location. */
export type Route =
  | {readonly page: 'overview'}
  | {readonly page: 'runs'}
  | {readonly page: 'spider'; readonly name: string};

/** Parses `location.hash`. Old `#/<name>` links still open the spider. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (!path) return {page: 'overview'};
  if (path === 'runs') return {page: 'runs'};
  const name = path.startsWith('spiders/') ? path.slice('spiders/'.length) : path;
  return {page: 'spider', name: decodeURIComponent(name)};
}

/** Link target of a route. */
export function href(route: Route): string {
  switch (route.page) {
    case 'overview':
      return '#/';
    case 'runs':
      return '#/runs';
    case 'spider':
      return `#/spiders/${encodeURIComponent(route.name)}`;
  }
}

/** Link to a spider. */
export const spiderHref = (name: string): string => href({page: 'spider', name});

/** Navigates to a route. */
export function navigate(route: Route): void {
  location.hash = href(route).slice(1);
}

/** The current route, following hash changes. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(location.hash));
      scrollTo({top: 0});
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
