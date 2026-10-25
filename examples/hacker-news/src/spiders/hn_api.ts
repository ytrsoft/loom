/**
 * @fileoverview JSON API spider with incremental crawling: only stories not
 * stored yet are fetched. Selectors are dot paths because responses are JSON.
 */

import {$, defineSpider, schema} from 'loom';

import {onlyRecent} from '../plugins/only_recent.js';

const API = 'https://hacker-news.firebaseio.com/v0';

export const apiStory = schema({
  id: $('id').int(),
  title: 'title',
  url: $('url').text().optional(),
  score: $('score').int().default(0),
  author: 'by',
  comments: $('descendants').int().default(0),
  postedAt: $('time').date(),
});

export const hackerNewsApi = defineSpider({
  name: 'hn-api',
  description: 'Hacker News 官方 API：增量抓取最新文章，已入库的不再请求',
  start: `${API}/newstories.json`,
  schema: apiStory,
  store: {unique: 'id'},
  concurrency: 8,
  rateLimit: '10/s',
  use: [onlyRecent({field: 'postedAt', days: 7})],
  routes: {
    async start({json, seen, enqueue, log}) {
      const ids = json<number[]>().slice(0, 100);
      const fresh: number[] = [];
      for (const id of ids) {
        if (!(await seen(id))) fresh.push(id);
      }
      log.info(`${fresh.length} new of ${ids.length} latest stories`);
      await enqueue(
        fresh.map(id => `${API}/item/${id}.json`),
        'story'
      );
    },

    async story({json, extract, save, skip}) {
      const raw = json<{type?: string; dead?: boolean} | null>();
      if (!raw || raw.type !== 'story' || raw.dead) skip('not a live story');
      await save(extract(apiStory));
    },
  },
});
