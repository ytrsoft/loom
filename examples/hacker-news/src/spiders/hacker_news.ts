/**
 * @fileoverview Declarative spider: no handler code at all. Every
 * `tr.athing` row becomes a story, pagination follows "More", and stories
 * are upserted by id so hourly runs refresh points and comment counts.
 */

import {$, defineSpider, schema} from 'loom';

/**
 * A front-page story. Points, author and age live in the *next* table row,
 * which the `+ tr` sibling selector reaches directly.
 */
export const story = schema({
  id: '@id',
  rank: $('.rank').int(),
  title: '.titleline > a',
  url: '.titleline > a @href',
  site: $('.sitestr').text().optional(),
  points: $('+ tr .score').int().default(0),
  author: $('+ tr .hnuser').text().optional(),
  comments: $('+ tr .subline > a:last-child')
    .text()
    .match(/(\d+)\s*comment/)
    .int()
    .default(0),
  postedAt: $('+ tr .age').attr('title').match(/(\d{9,})$/).date().optional(),
});

export const hackerNews = defineSpider({
  name: 'hacker-news',
  description: 'Hacker News 首页热门，每小时刷新分数和评论数',
  start: 'https://news.ycombinator.com/news',
  schema: story,
  items: 'tr.athing',
  next: '.morelink',
  maxPages: 3,
  rateLimit: '1/s',
  store: {unique: 'id'},
  schedule: '0 * * * *',
});
