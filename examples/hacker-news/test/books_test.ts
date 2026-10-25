/**
 * @fileoverview Offline tests of the books spider's two routes.
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {testRoute} from 'loom/testing';

import {books} from '../src/spiders/books.js';

const LIST_URL = 'https://books.toscrape.com/catalogue/category/books_1/index.html';
const BOOK_URL = 'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html';

const LIST = `
<article class="product_pod">
  <h3><a href="../../a-light-in-the-attic_1000/index.html">A Light in the ...</a></h3>
</article>
<ul class="pager"><li class="next"><a href="page-2.html">next</a></li></ul>`;

const DETAIL = `
<ul class="breadcrumb">
  <li><a href="../../index.html">Home</a></li>
  <li><a href="../category/books_1/index.html">Books</a></li>
  <li><a href="../category/books/poetry_23/index.html">Poetry</a></li>
  <li class="active">A Light in the Attic</li>
</ul>
<div id="product_gallery"><img src="../../media/cache/fe/72/cover.jpg" alt=""></div>
<div class="col-sm-6 product_main">
  <h1>A Light in the Attic</h1>
  <p class="price_color">£51.77</p>
  <p class="instock availability"><i class="icon-ok"></i> In stock (22 available)</p>
  <p class="star-rating Three"></p>
</div>
<div id="product_description" class="sub-header"><h2>Product Description</h2></div>
<p>It's hard to imagine a world without A Light in the Attic.</p>
<table class="table table-striped"><tr><th>UPC</th><td>a897fe39b1053632</td></tr></table>`;

describe('books', () => {
  it('queues detail pages and the next list page', async () => {
    const result = await testRoute(books, 'start', {url: LIST_URL, html: LIST});
    assert.deepEqual(
      result.requests.map(request => [request.route, request.url]),
      [
        ['book', BOOK_URL],
        ['start', 'https://books.toscrape.com/catalogue/category/books_1/page-2.html'],
      ]
    );
    assert.deepEqual(result.requests[0]?.data, {listPage: 1});
  });

  it('extracts a typed book', async () => {
    const result = await testRoute(books, 'book', {
      url: BOOK_URL,
      html: DETAIL,
      data: {listPage: 1},
    });
    const [book] = result.items;
    assert.equal(book?.price, 51.77);
    assert.equal(book?.stock, 22);
    assert.equal(book?.rating, 3);
    assert.equal(book?.category, 'Poetry');
    assert.equal(book?.listPage, 1);
    assert.equal(book?.image, 'https://books.toscrape.com/media/cache/fe/72/cover.jpg');
    assert.match(book?.coverFile ?? '', /cover\.jpg/);
  });
});
