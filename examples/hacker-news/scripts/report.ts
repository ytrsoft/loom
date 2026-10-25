/**
 * @fileoverview Programmatic usage: run a spider from a script and query
 * the typed results. Run with `pnpm report`.
 */

import {createLoom} from 'loom';

import {hackerNews} from '../src/spiders/hacker_news.js';

const loom = await createLoom({
  database: 'sqlite:./data/loom.db',
  spiders: [hackerNews],
});

const summary = await loom.run('hacker-news', {overrides: {maxPages: 1}});
console.log(`${summary.status}: ${summary.stats?.items ?? 0} stories`);

const stories = await loom.items(hackerNews);
const popular = await stories.find({
  where: (t, {gt}) => gt(t.points, 100),
  orderBy: '-points',
  limit: 5,
});
for (const story of popular) {
  console.log(`${String(story.points).padStart(5)}  ${story.title}`);
}

await loom.close();
