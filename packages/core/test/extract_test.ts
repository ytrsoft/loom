/**
 * @fileoverview Tests for the extraction DSL.
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  $,
  ExtractionError,
  extractAllFrom,
  extractFrom,
  jsonLd,
  meta,
  parseDate,
  parseNumber,
  schema,
} from '../src/index.js';

const URL = 'https://shop.example/catalog/';

const HTML = `
  <html><head>
    <meta property="og:title" content="Catalog">
    <script type="application/ld+json">
      {"@context": "https://schema.org", "@graph": [
        {"@type": "Organization", "name": "Shop"},
        {"@type": "Product", "name": "Lamp", "offers": {"price": "19.90"}}
      ]}
    </script>
    <script id="state">window.__STATE__ = {"user": {"id": 7, "tags": ["a", "b"]}};</script>
  </head><body>
    <table>
      <tr class="item" id="i1"><td class="title"><a href="/p/1">  Lamp  </a></td></tr>
      <tr><td class="score">120 points</td><td class="age" title="1700000000"></td></tr>
      <tr class="item" id="i2"><td class="title"><a href="/p/2">Desk</a></td></tr>
      <tr><td class="score">discuss</td></tr>
    </table>
    <ul><li class="tag">red</li><li class="tag">blue</li><li class="tag">red</li></ul>
    <span class="price">¥1,299.50</span>
    <span class="views">3.2万</span>
    <img class="cover" data-src="/img/cover.jpg" src="data:image/gif;base64,AAA">
  </body></html>`;

describe('shorthand strings', () => {
  it('reads text, attributes and absolute links', () => {
    const result = extractFrom(
      HTML,
      {title: 'tr#i1 .title a', link: 'tr#i1 .title a @href', id: 'tr.item @id'},
      {url: URL}
    );
    assert.deepEqual(result, {
      title: 'Lamp',
      link: 'https://shop.example/p/1',
      id: 'i1',
    });
  });
});

describe('typed fields', () => {
  it('parses numbers with currency, separators and Chinese units', () => {
    assert.equal(extractFrom(HTML, $('.price').number()), 1299.5);
    assert.equal(extractFrom(HTML, $('.views').number()), 32000);
    assert.equal(parseNumber('1.2k'), 1200);
    assert.equal(parseNumber('1.234,5', {decimal: ','}), 1234.5);
  });

  it('resolves lazy-loaded images', () => {
    assert.equal(
      extractFrom(HTML, $('img.cover').src(), {url: URL}),
      'https://shop.example/img/cover.jpg'
    );
  });

  it('parses relative and Chinese dates', () => {
    const now = Date.UTC(2026, 0, 10);
    assert.equal(parseDate('3 hours ago', now).getTime(), now - 3 * 3600e3);
    assert.equal(parseDate('2天前', now).getTime(), now - 2 * 86400e3);
    assert.equal(parseDate('2024年1月2日').getFullYear(), 2024);
  });

  it('lists with .all() and list operations', () => {
    assert.deepEqual(extractFrom(HTML, $('.tag').all().text().unique()), [
      'red',
      'blue',
    ]);
    assert.equal(extractFrom(HTML, $('.tag').all().text().join('/')), 'red/blue/red');
  });
});

describe('lists of records', () => {
  const story = schema({
    id: '@id',
    title: '.title a',
    points: $('+ tr .score').int(),
    postedAt: $('+ tr .age').attr('title').date().optional(),
  });

  it('reads sibling rows and drops invalid records', () => {
    const items = extractAllFrom(HTML, 'tr.item', story, {url: URL});
    assert.equal(items.length, 1);
    assert.equal(items[0]?.points, 120);
    assert.equal(items[0]?.postedAt?.getTime(), 1700000000 * 1000);
  });

  it('keeps records when a field has a default', () => {
    const lenient = story.extend({points: $('+ tr .score').int().default(0)});
    const items = extractAllFrom(HTML, 'tr.item', lenient);
    assert.deepEqual(
      items.map(item => item.points),
      [120, 0]
    );
  });

  it('throws a readable error for missing single values', () => {
    assert.throws(
      () => extractFrom(HTML, {missing: $('.does-not-exist').text()}),
      (error: unknown) =>
        error instanceof ExtractionError &&
        /missing required missing/.test(error.message)
    );
  });
});

describe('embedded and structured data', () => {
  it('reads JSON embedded in scripts', () => {
    const state = extractFrom(
      HTML,
      $('#state').json('user').object({id: $('id').int(), tags: $('tags').all().text()})
    );
    assert.deepEqual(state, {id: 7, tags: ['a', 'b']});
  });

  it('reads JSON-LD and meta tags', () => {
    const product = extractFrom(
      HTML,
      jsonLd('Product').object({name: 'name', price: $('offers.price').number()})
    );
    assert.deepEqual(product, {name: 'Lamp', price: 19.9});
    assert.equal(extractFrom(HTML, meta('og:title')), 'Catalog');
  });

  it('uses the same DSL for JSON documents', () => {
    const api = {data: {items: [{id: 1, name: 'A'}, {id: 2, name: 'B'}]}};
    const rows = extractFrom(
      api,
      $('data.items').list({id: $('id').int(), name: 'name'})
    );
    assert.deepEqual(rows, [
      {id: 1, name: 'A'},
      {id: 2, name: 'B'},
    ]);
    assert.deepEqual(extractFrom(api, $('data.items[*].name').all().text()), [
      'A',
      'B',
    ]);
  });
});
