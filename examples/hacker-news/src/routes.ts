/**
 * @fileoverview A custom API endpoint over crawled data, mounted at
 * GET /api/top-stories?limit=10.
 */

import {defineRoutes} from '@loom/server';

import {hackerNews} from './spiders/hacker_news.js';

export const topStories = defineRoutes((router, loom) => {
  router.get('/top-stories', async (request, response) => {
    const limit = Math.min(Number(request.query['limit'] ?? 10) || 10, 100);
    const stories = await loom.items(hackerNews);
    response.json(await stories.find({orderBy: '-points', limit}));
  });
});
