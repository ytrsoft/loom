/**
 * @fileoverview Integration tests against an in-memory SQLite database.
 */

import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';

import {connect, type Database} from '../src/index.js';

interface Story {
  id: string;
  title: string;
  points: number;
  tags: string[];
  postedAt: Date | null;
}

describe('collections on SQLite', () => {
  let db: Database;

  before(async () => {
    db = await connect('sqlite::memory:');
  });

  after(async () => {
    await db.close();
  });

  it('creates tables, upserts and queries', async () => {
    const stories = await db.collection<Story>({
      name: 'stories',
      columns: [
        {name: 'id', kind: 'string'},
        {name: 'title', kind: 'string'},
        {name: 'points', kind: 'integer'},
        {name: 'tags', kind: 'json'},
        {name: 'postedAt', kind: 'date'},
      ],
      unique: ['id'],
    });
    const postedAt = new Date('2026-01-02T03:04:05Z');
    await stories.save([
      {id: 'a', title: 'First', points: 10, tags: ['x'], postedAt},
      {id: 'b', title: 'Second', points: 5, tags: [], postedAt: null},
    ]);
    await stories.save([{id: 'a', title: 'First!', points: 12, tags: ['x'], postedAt}]);

    assert.equal(await stories.count(), 2);
    const top = await stories.findOne({orderBy: '-points'});
    assert.equal(top?.title, 'First!');
    assert.deepEqual(top?.tags, ['x']);
    assert.equal(top?.postedAt?.getTime(), postedAt.getTime());
    const popular = await stories.find({where: (t, {gt}) => gt(t.points, 6)});
    assert.equal(popular.length, 1);
  });

  it('adds columns for new keys of schemaless items', async () => {
    const loose = await db.collection<Record<string, unknown>>({name: 'loose'});
    await loose.save([{a: 1}]);
    await loose.save([{a: 2, b: 'new', c: {nested: true}}]);
    const [latest] = await loose.find();
    assert.equal(latest?.['b'], 'new');
    assert.deepEqual(latest?.['c'], {nested: true});
  });

  it('exports CSV', async () => {
    const stories = await db.collection<Story>({name: 'stories'});
    let csv = '';
    for await (const chunk of stories.export('csv')) csv += chunk;
    assert.match(csv, /^id,title,points,tags,postedAt,_url,_createdAt,_updatedAt\r\n/);
    assert.equal(csv.trim().split('\r\n').length, 3);
  });
});
