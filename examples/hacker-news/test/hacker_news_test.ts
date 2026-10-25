/**
 * @fileoverview Offline test of the declarative Hacker News spider.
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {testRoute} from 'loom/testing';

import {hackerNews} from '../src/spiders/hacker_news.js';

const FRONT_PAGE = `<table>
<tr class="athing submission" id="42000001">
  <td class="title"><span class="rank">1.</span></td>
  <td class="title"><span class="titleline">
    <a href="https://example.com/post">Show HN: Loom</a>
    <span class="sitebit comhead"> (<a href="from?site=example.com"><span class="sitestr">example.com</span></a>)</span>
  </span></td>
</tr>
<tr><td colspan="2"></td><td class="subtext"><span class="subline">
  <span class="score">128 points</span> by <a href="user?id=ada" class="hnuser">ada</a>
  <span class="age" title="2026-10-24T08:00:00 1792828800"><a href="item?id=42000001">2 hours ago</a></span>
  | <a href="hide?id=42000001">hide</a> | <a href="item?id=42000001">37&nbsp;comments</a></span></td></tr>
<tr class="athing submission" id="42000002">
  <td class="title"><span class="rank">2.</span></td>
  <td class="title"><span class="titleline"><a href="item?id=42000002">Ask HN: Crawlers?</a></span></td>
</tr>
<tr><td colspan="2"></td><td class="subtext"><span class="subline">
  <span class="score">5 points</span> by <a class="hnuser" href="user?id=bob">bob</a>
  <span class="age" title="2026-10-24T09:00:00 1792832400"><a>1 hour ago</a></span>
  | <a href="item?id=42000002">discuss</a></span></td></tr>
</table>
<a href="?p=2" class="morelink" rel="next">More</a>`;

describe('hacker-news', () => {
  it('extracts stories across sibling rows and follows "More"', async () => {
    const result = await testRoute(hackerNews, 'start', {
      url: 'https://news.ycombinator.com/news',
      html: FRONT_PAGE,
    });
    assert.deepEqual(result.issues, []);
    assert.equal(result.items.length, 2);
    const [first, second] = result.items;
    assert.equal(first?.id, '42000001');
    assert.equal(first?.points, 128);
    assert.equal(first?.comments, 37);
    assert.equal(first?.site, 'example.com');
    assert.ok(first?.postedAt instanceof Date);
    assert.equal(second?.url, 'https://news.ycombinator.com/item?id=42000002');
    assert.equal(second?.comments, 0);
    assert.equal(second?.site, null);
    assert.deepEqual(
      result.requests.map(request => request.url),
      ['https://news.ycombinator.com/news?p=2']
    );
  });
});
