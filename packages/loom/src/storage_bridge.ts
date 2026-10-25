/**
 * @fileoverview Connects the engine to @loom/storage: spider schemas become
 * table definitions, saved items become upserts, and Loom keeps its own
 * bookkeeping (run history, visited URLs) in the same database.
 */

import {createHash} from 'node:crypto';

import {
  LoomError,
  columnsOf,
  toSnakeCase,
  type ItemSink,
  type RunStats,
  type RunStatus,
  type SpiderDefinition,
  type VisitedStore,
} from '@loom/core';
import type {
  Collection,
  CollectionSpec,
  ColumnSpec,
  Database,
} from '@loom/storage';

/** Table definition for a spider's items. */
export function collectionSpecFor(spider: SpiderDefinition): CollectionSpec {
  const store = spider.store === false ? {} : (spider.store ?? {});
  const columns = new Map<string, ColumnSpec>();
  for (const source of [spider.schema, spider.detail?.schema]) {
    if (!source) continue;
    for (const column of columnsOf(source)) {
      columns.set(column.name, {name: column.name, kind: column.kind});
    }
  }
  const unique =
    store.unique === undefined
      ? []
      : typeof store.unique === 'string'
        ? [store.unique]
        : [...store.unique];
  return {
    name: typeof store.table === 'string' ? store.table : toSnakeCase(spider.name),
    columns: [...columns.values()],
    ...(unique.length ? {unique} : {}),
    ...(typeof store.table === 'object' ? {table: store.table} : {}),
  };
}

/** Writes items to their spider's collection. */
export class StorageSink implements ItemSink {
  constructor(private readonly database: Database) {}

  /** The collection holding a spider's items. */
  collection(spider: SpiderDefinition): Promise<Collection<object>> {
    return this.database.collection<object>(collectionSpecFor(spider));
  }

  async write(
    spider: SpiderDefinition,
    items: readonly object[],
    meta: {readonly url: string; readonly runId: string}
  ): Promise<void> {
    const collection = await this.collection(spider);
    await collection.save(items, meta);
  }

  async has(spider: SpiderDefinition, key: unknown): Promise<boolean> {
    const collection = await this.collection(spider);
    const [unique, ...rest] = collection.uniqueKeys;
    if (!unique || rest.length) {
      throw new LoomError(
        `ctx.seen() needs exactly one unique key on spider "${spider.name}"`,
        "set store: {unique: 'id'}"
      );
    }
    return collection.exists({[unique]: key} as never);
  }
}

interface VisitedRow {
  key: string;
  spider: string;
  url: string;
}

/** Remembers successfully fetched URLs across runs. */
export class DatabaseVisitedStore implements VisitedStore {
  private readonly collection: Promise<Collection<VisitedRow>>;

  constructor(database: Database) {
    this.collection = database.collection<VisitedRow>({
      name: 'loom_visited',
      columns: [
        {name: 'key', kind: 'string'},
        {name: 'spider', kind: 'string'},
        {name: 'url', kind: 'string'},
      ],
      unique: ['key'],
      meta: false,
    });
  }

  async filter(spider: string, urls: readonly string[]): Promise<Set<string>> {
    const visited = new Set<string>();
    if (!urls.length) return visited;
    const collection = await this.collection;
    const keys = urls.map(url => visitKey(spider, url));
    for (let i = 0; i < keys.length; i += 200) {
      const batch = keys.slice(i, i + 200);
      const rows = await collection.find({
        where: (t, {inArray}) => inArray(t.key, batch),
        orderBy: [],
      });
      for (const row of rows) visited.add(row.url);
    }
    return visited;
  }

  async mark(spider: string, urls: readonly string[]): Promise<void> {
    const collection = await this.collection;
    await collection.save(
      urls.map(url => ({key: visitKey(spider, url), spider, url}))
    );
  }
}

function visitKey(spider: string, url: string): string {
  return createHash('sha1').update(`${spider}\n${url}`).digest('hex');
}

/** A row of the run history. */
export interface RunRecord {
  id: string;
  spider: string;
  status: RunStatus;
  trigger: string;
  startedAt: Date;
  endedAt: Date | null;
  stats: RunStats | null;
  error: string | null;
}

/** Opens the run history table. */
export function openRunHistory(database: Database): Promise<Collection<RunRecord>> {
  return database.collection<RunRecord>({
    name: 'loom_runs',
    columns: [
      {name: 'id', kind: 'string'},
      {name: 'spider', kind: 'string'},
      {name: 'status', kind: 'string'},
      {name: 'trigger', kind: 'string'},
      {name: 'startedAt', kind: 'date'},
      {name: 'endedAt', kind: 'date'},
      {name: 'stats', kind: 'json'},
      {name: 'error', kind: 'string'},
    ],
    unique: ['id'],
    meta: false,
  });
}
