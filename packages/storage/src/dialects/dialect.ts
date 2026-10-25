/**
 * @fileoverview The contract every SQL family implements. Drizzle's query
 * builder is shared across families; what differs is DDL (types, auto
 * increment, unique indexes), introspection and upsert syntax. Those live
 * behind this interface, so collections are written once for all databases.
 */

import type {Column, SQL, Table} from 'drizzle-orm';

import type {ColumnKind, DialectName} from '../types.js';

/** A column as Loom manages it. */
export interface ColumnDef {
  /** Item key (camelCase). */
  readonly key: string;
  /** Column name in the database (snake_case). */
  readonly dbName: string;
  /** Storage kind; `'id'` is the auto-increment primary key. */
  readonly kind: ColumnKind | 'id';
  /** Part of the unique key. */
  readonly unique: boolean;
  /** One of Loom's `_meta` columns. */
  readonly meta: boolean;
}

/** A table as Loom manages it. */
export interface TableDef {
  readonly name: string;
  readonly columns: readonly ColumnDef[];
}

/**
 * The fluent surface shared by Drizzle's SQLite, PostgreSQL and MySQL
 * database classes. Their concrete types have no common supertype, so Loom
 * talks to them through this structural view.
 */
export interface DrizzleDb {
  select(fields?: Readonly<Record<string, unknown>>): {
    from(table: Table): SelectQuery;
  };
  insert(table: Table): {
    values(rows: ReadonlyArray<Record<string, unknown>>): InsertQuery;
  };
  delete(table: Table): DeleteQuery;
  /** SQLite drivers. */
  run?(query: SQL): unknown;
  /** SQLite drivers. */
  all?(query: SQL): unknown;
  /** PostgreSQL and MySQL drivers. */
  execute?(query: SQL): Promise<unknown>;
}

/** A select query being built. */
export interface SelectQuery
  extends PromiseLike<Array<Record<string, unknown>>> {
  where(condition: SQL | undefined): SelectQuery;
  orderBy(...order: Array<SQL | Column>): SelectQuery;
  limit(count: number): SelectQuery;
  offset(count: number): SelectQuery;
}

/** An insert query being built. */
export interface InsertQuery extends PromiseLike<unknown> {
  onConflictDoUpdate?(config: {
    target: Column[];
    set: Record<string, SQL>;
  }): PromiseLike<unknown>;
  onDuplicateKeyUpdate?(config: {
    set: Record<string, SQL>;
  }): PromiseLike<unknown>;
}

/** A delete query being built. */
export interface DeleteQuery extends PromiseLike<unknown> {
  where(condition: SQL | undefined): PromiseLike<unknown>;
}

/** A column found by introspection. */
export interface ExistingColumn {
  readonly name: string;
  readonly type: string;
}

/** SQL-family specific behaviour. */
export interface Dialect {
  readonly name: DialectName;
  /** Quotes an identifier. */
  quote(identifier: string): string;
  /** Builds the Drizzle table object used for queries. */
  buildTable(def: TableDef): Table;
  /** `CREATE TABLE IF NOT EXISTS` statement. */
  createTable(def: TableDef): string;
  /** `ALTER TABLE ... ADD COLUMN` statement. */
  addColumn(table: string, column: ColumnDef): string;
  /** Creates the unique index over the table's unique columns, if missing. */
  ensureUniqueIndex(db: DrizzleDb, def: TableDef): Promise<void>;
  /** Columns (name and declared SQL type) that exist in the database. */
  listColumns(db: DrizzleDb, table: string): Promise<ExistingColumn[]>;
  /** Executes a statement. */
  run(db: DrizzleDb, statement: SQL): Promise<void>;
  /** Executes a query and returns its rows. */
  rows(db: DrizzleDb, query: SQL): Promise<Array<Record<string, unknown>>>;
  /** Turns an insert into an insert-or-update on the unique columns. */
  upsert(
    insert: InsertQuery,
    target: Column[],
    update: readonly ColumnDef[]
  ): PromiseLike<unknown>;
}

/** Name of the unique index Loom creates for a table. */
export function uniqueIndexName(table: string): string {
  return `ux_${table}`.slice(0, 60);
}

/** The unique columns of a table definition. */
export function uniqueColumns(def: TableDef): ColumnDef[] {
  return def.columns.filter(column => column.unique);
}

/**
 * Maps a declared SQL type back to a column kind, for columns that exist in
 * the database but are unknown to the current process (schemaless items
 * written by an earlier run).
 */
export function kindFromSqlType(type: string): ColumnKind {
  const t = type.toLowerCase();
  if (t.includes('json')) return 'json';
  if (t.includes('bool') || t === 'tinyint' || t === 'tinyint(1)') {
    return 'boolean';
  }
  if (/timestamp|datetime|^date$/.test(t)) return 'date';
  if (t.includes('int')) return 'integer';
  if (/real|double|float|numeric|decimal/.test(t)) return 'number';
  return 'string';
}
