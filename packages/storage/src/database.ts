/**
 * @fileoverview A connected database. It hands out collections and exposes
 * the underlying Drizzle instance for anything Loom does not wrap.
 */

import type {SQL} from 'drizzle-orm';

import {Collection} from './collection.js';
import type {Dialect, DrizzleDb} from './dialects/dialect.js';
import type {CollectionSpec} from './types.js';

/** Options stored with a database. */
export interface DatabaseOptions {
  /** Prefix added to every table name. */
  readonly tablePrefix?: string;
  /** Connection URL with credentials removed, for display. */
  readonly label?: string;
}

/** A connected database. */
export class Database {
  private readonly collections = new Map<string, Promise<Collection<object>>>();

  constructor(
    readonly dialect: Dialect,
    private readonly db: DrizzleDb,
    private readonly closer: () => Promise<void>,
    readonly options: DatabaseOptions = {}
  ) {}

  /**
   * Opens a collection, creating its table or adding missing columns.
   * Repeated calls return the same collection.
   */
  async collection<T extends object = Record<string, unknown>>(
    spec: CollectionSpec
  ): Promise<Collection<T>> {
    const name = `${this.options.tablePrefix ?? ''}${spec.name}`;
    let pending = this.collections.get(name);
    if (!pending) {
      pending = Collection.open<object>(this.dialect, this.db, {...spec, name});
      this.collections.set(name, pending);
      pending.catch(() => this.collections.delete(name));
    }
    const collection = await pending;
    if (spec.columns?.length) await collection.ensureColumns(spec.columns);
    return collection as unknown as Collection<T>;
  }

  /**
   * The Drizzle instance, for hand-written queries:
   *
   *   const db = database.orm<BetterSQLite3Database>();
   */
  orm<TDb = unknown>(): TDb {
    return this.db as unknown as TDb;
  }

  /** Runs raw SQL and returns its rows. */
  async query(statement: SQL): Promise<Array<Record<string, unknown>>> {
    return this.dialect.rows(this.db, statement);
  }

  /** Closes the connection. */
  async close(): Promise<void> {
    await this.closer();
  }
}
