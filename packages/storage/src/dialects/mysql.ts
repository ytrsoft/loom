/**
 * @fileoverview MySQL family: mysql2, MariaDB, TiDB, PlanetScale and any
 * other Drizzle MySQL driver. MySQL cannot index TEXT columns, so string
 * columns that are part of the unique key are stored as VARCHAR(512).
 */

import {sql, type Column, type SQL, type Table} from 'drizzle-orm';
import {
  bigint,
  boolean,
  datetime,
  double,
  json,
  mysqlTable,
  text,
  varchar,
  type MySqlColumnBuilderBase,
} from 'drizzle-orm/mysql-core';

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

const INDEXED_STRING_LENGTH = 512;

function sqlType(def: ColumnDef): string {
  switch (def.kind) {
    case 'id':
      return 'BIGINT AUTO_INCREMENT PRIMARY KEY';
    case 'string':
      return def.unique ? `VARCHAR(${INDEXED_STRING_LENGTH})` : 'TEXT';
    case 'number':
      return 'DOUBLE';
    case 'integer':
      return 'BIGINT';
    case 'boolean':
      return 'BOOLEAN';
    case 'date':
      return 'DATETIME(3)';
    case 'json':
      return 'JSON';
  }
}

function column(def: ColumnDef): MySqlColumnBuilderBase {
  switch (def.kind) {
    case 'id':
      return bigint(def.dbName, {mode: 'number'}).autoincrement().primaryKey();
    case 'string':
      return def.unique
        ? varchar(def.dbName, {length: INDEXED_STRING_LENGTH})
        : text(def.dbName);
    case 'number':
      return double(def.dbName);
    case 'integer':
      return bigint(def.dbName, {mode: 'number'});
    case 'boolean':
      return boolean(def.dbName);
    case 'date':
      return datetime(def.dbName, {mode: 'date', fsp: 3});
    case 'json':
      return json(def.dbName);
  }
}

const quote = (identifier: string): string => `\`${identifier.replace(/`/g, '``')}\``;

async function querySql(
  db: DrizzleDb,
  query: SQL
): Promise<Array<Record<string, unknown>>> {
  const result = await db.execute!(query);
  // mysql2 returns [rows, fields]; serverless drivers return {rows}.
  if (Array.isArray(result)) {
    return (Array.isArray(result[0]) ? result[0] : result) as Array<
      Record<string, unknown>
    >;
  }
  return (result as {rows: Array<Record<string, unknown>>}).rows;
}

async function runSql(db: DrizzleDb, statement: SQL): Promise<void> {
  await db.execute!(statement);
}

/** The MySQL dialect. */
export const mysqlDialect: Dialect = {
  name: 'mysql',
  quote,

  buildTable(def: TableDef): Table {
    const columns: Record<string, MySqlColumnBuilderBase> = {};
    for (const entry of def.columns) columns[entry.key] = column(entry);
    return mysqlTable(def.name, columns);
  },

  createTable(def: TableDef): string {
    const columns = def.columns.map(c => `${quote(c.dbName)} ${sqlType(c)}`);
    const unique = uniqueColumns(def);
    if (unique.length) {
      columns.push(
        `UNIQUE KEY ${quote(uniqueIndexName(def.name))} ` +
          `(${unique.map(c => quote(c.dbName)).join(', ')})`
      );
    }
    return (
      `CREATE TABLE IF NOT EXISTS ${quote(def.name)} (${columns.join(', ')}) ` +
      'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    );
  },

  addColumn(table: string, def: ColumnDef): string {
    return `ALTER TABLE ${quote(table)} ADD COLUMN ${quote(def.dbName)} ${sqlType(def)}`;
  },

  async ensureUniqueIndex(db: DrizzleDb, def: TableDef): Promise<void> {
    const unique = uniqueColumns(def);
    if (!unique.length) return;
    const name = uniqueIndexName(def.name);
    const existing = await querySql(
      db,
      sql`SELECT 1 FROM information_schema.statistics
          WHERE table_schema = database() AND table_name = ${def.name}
          AND index_name = ${name} LIMIT 1`
    );
    if (existing.length) return;
    await runSql(
      db,
      sql.raw(
        `ALTER TABLE ${quote(def.name)} ADD UNIQUE KEY ${quote(name)} ` +
          `(${unique.map(c => quote(c.dbName)).join(', ')})`
      )
    );
  },

  async listColumns(db: DrizzleDb, table: string): Promise<ExistingColumn[]> {
    const rows = await querySql(
      db,
      sql`SELECT column_name AS name, data_type AS type
          FROM information_schema.columns
          WHERE table_schema = database() AND table_name = ${table}`
    );
    return rows.map(row => ({
      name: String(row['name'] ?? row['NAME']),
      type: String(row['type'] ?? row['TYPE']),
    }));
  },

  run: runSql,
  rows: querySql,

  upsert(
    insert: InsertQuery,
    _target: Column[],
    update: readonly ColumnDef[]
  ): PromiseLike<unknown> {
    const set: Record<string, SQL> = {};
    for (const def of update) set[def.key] = sql.raw(`VALUES(${quote(def.dbName)})`);
    return insert.onDuplicateKeyUpdate!({set});
  },
};
