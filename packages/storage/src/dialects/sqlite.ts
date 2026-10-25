/**
 * @fileoverview SQLite family: better-sqlite3, libSQL/Turso, Cloudflare D1,
 * Bun SQLite, expo-sqlite and any other Drizzle SQLite driver.
 */

import {sql, type Column, type SQL, type Table} from 'drizzle-orm';
import {
  integer,
  real,
  sqliteTable,
  text,
  type SQLiteColumnBuilderBase,
} from 'drizzle-orm/sqlite-core';

import {
  uniqueColumns,
  uniqueIndexName,
  type ColumnDef,
  type Dialect,
  type DrizzleDb,
  type ExistingColumn,
  type InsertQuery,
  type TableDef,
} from './dialect.js';

const SQL_TYPES: Readonly<Record<ColumnDef['kind'], string>> = {
  id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
  string: 'TEXT',
  number: 'REAL',
  integer: 'INTEGER',
  boolean: 'INTEGER',
  date: 'INTEGER',
  json: 'TEXT',
};

function column(def: ColumnDef): SQLiteColumnBuilderBase {
  switch (def.kind) {
    case 'id':
      return integer(def.dbName).primaryKey({autoIncrement: true});
    case 'string':
      return text(def.dbName);
    case 'number':
      return real(def.dbName);
    case 'integer':
      return integer(def.dbName, {mode: 'number'});
    case 'boolean':
      return integer(def.dbName, {mode: 'boolean'});
    case 'date':
      return integer(def.dbName, {mode: 'timestamp_ms'});
    case 'json':
      return text(def.dbName, {mode: 'json'});
  }
}

const quote = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

async function runSql(db: DrizzleDb, statement: SQL): Promise<void> {
  await db.run!(statement);
}

async function querySql(
  db: DrizzleDb,
  query: SQL
): Promise<Array<Record<string, unknown>>> {
  return (await db.all!(query)) as Array<Record<string, unknown>>;
}

/** The SQLite dialect. */
export const sqliteDialect: Dialect = {
  name: 'sqlite',
  quote,

  buildTable(def: TableDef): Table {
    const columns: Record<string, SQLiteColumnBuilderBase> = {};
    for (const entry of def.columns) columns[entry.key] = column(entry);
    return sqliteTable(def.name, columns);
  },

  createTable(def: TableDef): string {
    const columns = def.columns.map(
      c => `${quote(c.dbName)} ${SQL_TYPES[c.kind]}`
    );
    return `CREATE TABLE IF NOT EXISTS ${quote(def.name)} (${columns.join(', ')})`;
  },

  addColumn(table: string, def: ColumnDef): string {
    return `ALTER TABLE ${quote(table)} ADD COLUMN ${quote(def.dbName)} ${SQL_TYPES[def.kind]}`;
  },

  async ensureUniqueIndex(db: DrizzleDb, def: TableDef): Promise<void> {
    const unique = uniqueColumns(def);
    if (!unique.length) return;
    const columns = unique.map(c => quote(c.dbName)).join(', ');
    await runSql(
      db,
      sql.raw(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${quote(uniqueIndexName(def.name))} ` +
          `ON ${quote(def.name)} (${columns})`
      )
    );
  },

  async listColumns(db: DrizzleDb, table: string): Promise<ExistingColumn[]> {
    const rows = await querySql(
      db,
      sql.raw(`PRAGMA table_info(${quote(table)})`)
    );
    return rows.map(row => ({
      name: String(row['name']),
      type: String(row['type']),
    }));
  },

  run: runSql,
  rows: querySql,

  upsert(
    insert: InsertQuery,
    target: Column[],
    update: readonly ColumnDef[]
  ): PromiseLike<unknown> {
    const set: Record<string, SQL> = {};
    for (const def of update) set[def.key] = sql.raw(`excluded.${quote(def.dbName)}`);
    return insert.onConflictDoUpdate!({target, set});
  },
};
