/**
 * @fileoverview PostgreSQL family: node-postgres, postgres.js, Neon,
 * Supabase, Vercel Postgres, PGlite, CockroachDB and any other Drizzle
 * PostgreSQL driver.
 */

import {sql, type Column, type SQL, type Table} from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
  type PgColumnBuilderBase,
} from 'drizzle-orm/pg-core';

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
  id: 'BIGSERIAL PRIMARY KEY',
  string: 'TEXT',
  number: 'DOUBLE PRECISION',
  integer: 'BIGINT',
  boolean: 'BOOLEAN',
  date: 'TIMESTAMPTZ',
  json: 'JSONB',
};

function column(def: ColumnDef): PgColumnBuilderBase {
  switch (def.kind) {
    case 'id':
      return bigserial(def.dbName, {mode: 'number'}).primaryKey();
    case 'string':
      return text(def.dbName);
    case 'number':
      return doublePrecision(def.dbName);
    case 'integer':
      return bigint(def.dbName, {mode: 'number'});
    case 'boolean':
      return boolean(def.dbName);
    case 'date':
      return timestamp(def.dbName, {withTimezone: true, mode: 'date'});
    case 'json':
      return jsonb(def.dbName);
  }
}

const quote = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

async function querySql(
  db: DrizzleDb,
  query: SQL
): Promise<Array<Record<string, unknown>>> {
  const result = await db.execute!(query);
  // node-postgres returns {rows}; postgres.js returns the rows directly.
  return (Array.isArray(result)
    ? result
    : (result as {rows: unknown[]}).rows) as Array<Record<string, unknown>>;
}

async function runSql(db: DrizzleDb, statement: SQL): Promise<void> {
  await db.execute!(statement);
}

/** The PostgreSQL dialect. */
export const postgresDialect: Dialect = {
  name: 'postgres',
  quote,

  buildTable(def: TableDef): Table {
    const columns: Record<string, PgColumnBuilderBase> = {};
    for (const entry of def.columns) columns[entry.key] = column(entry);
    return pgTable(def.name, columns);
  },

  createTable(def: TableDef): string {
    const columns = def.columns.map(
      c => `${quote(c.dbName)} ${SQL_TYPES[c.kind]}`
    );
    return `CREATE TABLE IF NOT EXISTS ${quote(def.name)} (${columns.join(', ')})`;
  },

  addColumn(table: string, def: ColumnDef): string {
    return (
      `ALTER TABLE ${quote(table)} ADD COLUMN IF NOT EXISTS ` +
      `${quote(def.dbName)} ${SQL_TYPES[def.kind]}`
    );
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
      sql`SELECT column_name AS name, data_type AS type
          FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = ${table}`
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
    for (const def of update) {
      set[def.key] = sql.raw(`excluded.${quote(def.dbName)}`);
    }
    return insert.onConflictDoUpdate!({target, set});
  },
};
