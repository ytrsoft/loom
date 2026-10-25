/**
 * @fileoverview Imperative spider: list pages → detail pages, with data
 * carried between routes, a composable and file downloads.
 */

import {$, computed, defineSpider, schema} from 'loom';

import {useBreadcrumbs} from '../composables/use_breadcrumbs.js';

const RATINGS = {One: 1, Two: 2, Three: 3, Four: 4, Five: 5} as const;

/** A book's detail page. */
export const book = schema({
  title: '.product_main h1',
  price: $('.product_main .price_color').number(),
  stock: $('.product_main .availability')
    .text()
    .match(/(\d+) available/)
    .int()
    .default(0),
  rating: $('.product_main .star-rating')
    .attr('class')
    .match(/star-rating (\w+)/)
    .lookup(RATINGS),
  upc: 'table.table-striped tr:nth-child(1) td',
  description: $('#product_description + p').text().optional(),
  image: '#product_gallery img @src',
  // Filled in by the handler below.
  category: computed<string>(),
  coverFile: computed<string>(),
  listPage: computed<number>('integer'),
});

export const books = defineSpider({
  name: 'books',
  description: 'books.toscrape.com：列表页到详情页，带上列表页码，并下载封面',
  start: 'https://books.toscrape.com/catalogue/category/books_1/index.html',
  schema: book,
  concurrency: 5,
  maxPages: 3,
  store: {unique: 'upc'},
  routes: {
    async start({follow, next, page}) {
      await follow('article.product_pod h3 a', 'book', {data: {listPage: page}});
      await next('li.next a');
    },

    async book({extract, download, save, data}) {
      const item = extract(book);
      await save({
        ...item,
        category: useBreadcrumbs().at(-2) ?? null,
        coverFile: await download(item.image, {dir: 'covers'}),
        listPage: Number(data['listPage']),
      });
    },
  },
});
