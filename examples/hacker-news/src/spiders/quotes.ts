/**
 * @fileoverview Browser spider: logs in through a form (built-in plugin),
 * scrolls an infinitely loading page, then extracts everything at once.
 */

import {$, defineSpider, formLogin, schema} from 'loom';

export const quote = schema({
  text: $('.text').text().replace(/[“”]/g, ''),
  author: '.author',
  tags: $('.tag').all().text(),
  goodreads: $('a[href*="goodreads"]').href().optional(),
});

export const quotes = defineSpider({
  name: 'quotes',
  description: 'quotes.toscrape.com：登录后在浏览器里无限滚动，加载全部名言',
  mode: 'browser',
  start: 'https://quotes.toscrape.com/scroll',
  schema: quote,
  store: {unique: 'text'},
  browser: {block: ['image', 'font', 'media'], waitFor: '.quote'},
  use: [
    formLogin({
      url: 'https://quotes.toscrape.com/login',
      fields: {'#username': 'loom', '#password': 'loom'},
      submit: 'input[type="submit"]',
      loggedIn: 'a[href="/logout"]',
    }),
  ],
  async parse({browser, extractAll, save, log}) {
    const loaded = await browser.infiniteScroll({items: '.quote', max: 100});
    log.info(`loaded ${loaded} quotes`);
    await save(extractAll('.quote', quote));
  },
});
