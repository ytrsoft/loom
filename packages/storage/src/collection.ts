/**
 * @fileoverview A collection is one table of items. Managed collections are
 * created and migrated automatically: new item keys become new columns,
 * unique keys become a unique index and writes become upserts. Collections
 * backed by your own Drizzle table skip all DDL.
 */

import {
  and,
  asc,
  between,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  not,
  notInArray,
  notLike,
  or,
  sql,
  type Column,
  type SQL,
  type Table,
} from 'drizzle-orm';

import {
  kindFromSqlType,
  type ColumnDef,
  type Dialect,
  type DrizzleDb,
  type TableDef,
} from './dialects/dialect.js';
import {
  StorageError,
  chunk,
  csvLine,
  readableValue,
  toCamelCase,
  toSnakeCase,
} from './serialize.js';
import type {
  CollectionSpec,
  ColumnKind,
  ColumnSpec,
  ExportFormat,
  FindQuery,
  Operators,
  OrderBy,
  Page,
  SaveMeta,
  Stored,
  Where,
} from './types.js';

/** Operators handed to functional `where` clauses. */
export const operators: Operators = {
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  like,
  notLike,
  inArray,
  notInArray,
  isNull,
  isNotNull,
  between,
  and,
  or,
  not,
  sql,
};

const WRITE_BATCH = 100;
const READ_BATCH = 500;
const MAX_LIMIT = 2 ** 31 - 1;

const META_COLUMNS: readonly ColumnDef[] = [
  {key: '_url', dbName: '_url', kind: 'string', unique: false, meta: true},
  {key: '_runId', dbName: '_run_id', kind: 'string', unique: false, meta: true},
  {key: '_createdAt', dbName: '_created_at', kind: 'date', unique: false, meta: true},
  {key: '_updatedAt', dbName: '_updated_at', kind: 'date', unique: false, meta: true},
];
const ID_COLUMN: ColumnDef = {
  key: '_id',
  dbName: '_id',
  kind: 'id',
  unique: false,
  meta: true,
};
const RESERVED_KEYS = new Set([ID_COLUMN, ...META_COLUMNS].map(c => c.key));

/** Infers the storage kind of a runtime value. */
export function kindOfValue(value: unknown): ColumnKind {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value instanceof Date) return 'date';
  if (typeof value === 'object') return 'json';
  return 'string';
}

function normalize(value: unknown, kind: ColumnDef['kind']): unknown {
  if (value === undefined || value === null) return null;
  switch (kind) {
    case 'string':
      return typeof value === 'string'
        ? value
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
    case 'number': {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    }
    case 'integer': {
      const number = Math.trunc(Number(value));
      return Number.isFinite(number) ? number : null;
    }
    case 'boolean':
      return typeof value === 'boolean'
        ? value
        : ['true', '1', 'yes'].includes(String(value).toLowerCase());
    case 'date': {
      const date = value instanceof Date ? value : new Date(value as string);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    case 'json':
      return value;
    case 'id':
      return value;
  }
}

function kindFromDrizzle(column: Column): ColumnDef['kind'] {
  switch (column.dataType) {
    case 'number':
      return 'number';
    case 'bigint':
      return 'integer';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'json':
    case 'array':
      return 'json';
    default:
      return 'string';
  }
}

/** One table of items. */
export class Collection<T extends object = Record<string, unknown>> {
  private table: Table;

  private constructor(
    private readonly dialect: Dialect,
    private readonly db: DrizzleDb,
    private def: TableDef,
    private readonly managed: boolean,
    table?: Table
  ) {
    this.table = table ?? dialect.buildTable(def);
  }

  /** Opens a collection, creating or migrating its table when managed. */
  static async open<T extends object>(
    dialect: Dialect,
    db: DrizzleDb,
    spec: CollectionSpec
  ): Promise<Collection<T>> {
    const unique = new Set(spec.unique ?? []);
    if (spec.table) {
      const columns = getTableColumns(spec.table as Table);
      const def: TableDef = {
        name: spec.name,
        columns: Object.entries(columns).map(([key, column]) => ({
          key,
          dbName: column.name,
          kind: column.primary && key === '_id' ? 'id' : kindFromDrizzle(column),
          unique: unique.has(key),
          meta: RESERVED_KEYS.has(key),
        })),
      };
      return new Collection<T>(dialect, db, def, false, spec.table as Table);
    }
    for (const key of unique) {
      if (!spec.columns?.some(column => column.name === key)) {
        throw new StorageError(
          `unique key "${key}" of "${spec.name}" is not a declared column`,
          'declare it in columns (Loom does this for you from a spider schema)'
        );
      }
    }
    const userColumns: ColumnDef[] = (spec.columns ?? [])
      .filter(column => !RESERVED_KEYS.has(column.name))
      .map(column => ({
        key: column.name,
        dbName: toSnakeCase(column.name),
        kind: column.kind,
        unique: unique.has(column.name),
        meta: false,
      }));
    const withMeta = spec.meta !== false;
    const def: TableDef = {
      name: spec.name,
      columns: withMeta
        ? [ID_COLUMN, ...userColumns, ...META_COLUMNS]
        : userColumns,
    };
    const collection = new Collection<T>(dialect, db, def, true);
    await collection.sync();
    return collection;
  }

  /** Table name. */
  get name(): string {
    return this.def.name;
  }

  /** The Drizzle table, for hand-written queries with `database.orm()`. */
  get drizzleTable(): Table {
    return this.table;
  }

  /** Item keys and kinds of every column, meta columns included. */
  get columns(): ColumnSpec[] {
    return this.def.columns.map(column => ({
      name: column.key,
      kind: column.kind === 'id' ? 'integer' : column.kind,
    }));
  }

  /** Item keys of the unique index. */
  get uniqueKeys(): string[] {
    return this.def.columns.filter(c => c.unique).map(c => c.key);
  }

  /** Adds columns that do not exist yet. No-op for unmanaged tables. */
  async ensureColumns(specs: readonly ColumnSpec[]): Promise<void> {
    if (!this.managed) return;
    const known = new Set(this.def.columns.map(column => column.key));
    const added = specs
      .filter(spec => !known.has(spec.name) && !RESERVED_KEYS.has(spec.name))
      .map(
        (spec): ColumnDef => ({
          key: spec.name,
          dbName: toSnakeCase(spec.name),
          kind: spec.kind,
          unique: false,
          meta: false,
        })
      );
    if (!added.length) return;
    const meta = this.def.columns.filter(column => column.meta);
    const user = this.def.columns.filter(column => !column.meta);
    this.def = {
      name: this.def.name,
      columns: [...meta.filter(c => c.kind === 'id'), ...user, ...added,
        ...meta.filter(c => c.kind !== 'id')],
    };
    await this.sync();
  }

  /** Inserts items, or upserts them when the collection has unique keys. */
  async save(items: readonly T[], meta: SaveMeta = {}): Promise<number> {
    if (!items.length) return 0;
    if (this.managed) await this.ensureColumns(this.inferColumns(items));
    const now = new Date();
    const unique = this.def.columns.filter(column => column.unique);
    const rows = this.dedupe(
      items.map(item => this.toRow(item as Record<string, unknown>, meta, now)),
      unique
    );
    const update = this.def.columns.filter(
      column => !column.unique && column.kind !== 'id' && column.key !== '_createdAt'
    );
    const target = unique.map(column => this.column(column.key));
    for (const batch of chunk(rows, WRITE_BATCH)) {
      const insert = this.db.insert(this.table).values(batch);
      if (unique.length) await this.dialect.upsert(insert, target, update);
      else await insert;
    }
    return rows.length;
  }

  /** Finds items. Newest first unless `orderBy` says otherwise. */
  async find(query: FindQuery<T> = {}): Promise<Array<Stored<T>>> {
    let select = this.db.select().from(this.table);
    const condition = this.condition(query.where);
    if (condition) select = select.where(condition);
    const order = this.order(query.orderBy);
    if (order.length) select = select.orderBy(...order);
    if (query.limit !== undefined || query.offset) {
      select = select.limit(query.limit ?? MAX_LIMIT);
    }
    if (query.offset) select = select.offset(query.offset);
    return (await select) as Array<Stored<T>>;
  }

  /** Finds the first matching item. */
  async findOne(query: FindQuery<T> = {}): Promise<Stored<T> | undefined> {
    const [item] = await this.find({...query, limit: 1});
    return item;
  }

  /** A page of items plus the total count, for UIs and APIs. */
  async page(query: FindQuery<T> = {}): Promise<Page<T>> {
    const limit = Math.min(query.limit ?? 50, 1000);
    const offset = query.offset ?? 0;
    const [items, total] = await Promise.all([
      this.find({...query, limit, offset}),
      this.count(query.where),
    ]);
    return {items, total, limit, offset};
  }

  /** Counts matching items. */
  async count(where?: Where<T>): Promise<number> {
    let select = this.db
      .select({value: sql<number>`count(*)`})
      .from(this.table);
    const condition = this.condition(where);
    if (condition) select = select.where(condition);
    const [row] = await select;
    return Number(row?.['value'] ?? 0);
  }

  /** Whether any item matches. */
  async exists(where: Where<T>): Promise<boolean> {
    return (await this.findOne({where, orderBy: []})) !== undefined;
  }

  /** Deletes matching items (all items when `where` is omitted). */
  async delete(where?: Where<T>): Promise<void> {
    await this.db.delete(this.table).where(this.condition(where));
  }

  /** Iterates over all matching items in batches, without loading them at once. */
  async *iterate(
    options: {where?: Where<T>; batchSize?: number} = {}
  ): AsyncGenerator<Stored<T>> {
    const batchSize = options.batchSize ?? READ_BATCH;
    const hasId = this.def.columns.some(column => column.kind === 'id');
    let lastId = 0;
    let offset = 0;
    for (;;) {
      const base = this.condition(options.where);
      const batch = hasId
        ? await this.find({
            where: () => and(base, gt(this.column('_id'), lastId)),
            orderBy: '_id',
            limit: batchSize,
          })
        : await this.find({where: options.where, orderBy: [], limit: batchSize, offset});
      yield* batch;
      if (batch.length < batchSize) return;
      lastId = Number(batch.at(-1)?._id ?? 0);
      offset += batch.length;
    }
  }

  /** Streams an export as text chunks (CSV, JSON array or NDJSON). */
  async *export(
    format: ExportFormat,
    options: {where?: Where<T>} = {}
  ): AsyncGenerator<string> {
    const keys = this.def.columns
      .filter(column => column.kind !== 'id' && column.key !== '_runId')
      .map(column => column.key);
    if (format === 'csv') yield csvLine(keys);
    if (format === 'json') yield '[\n';
    let first = true;
    for await (const item of this.iterate(options)) {
      const row = item as Record<string, unknown>;
      if (format === 'csv') {
        yield csvLine(keys.map(key => row[key]));
      } else {
        const picked = Object.fromEntries(
          keys.map(key => [key, readableValue(row[key])])
        );
        const json = JSON.stringify(picked);
        yield format === 'ndjson' ? `${json}\n` : `${first ? '' : ',\n'}${json}`;
      }
      first = false;
    }
    if (format === 'json') yield '\n]\n';
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private async sync(): Promise<void> {
    await this.dialect.run(this.db, sql.raw(this.dialect.createTable(this.def)));
    const existing = await this.dialect.listColumns(this.db, this.def.name);
    const existingNames = new Set(existing.map(column => column.name));
    for (const column of this.def.columns) {
      if (!existingNames.has(column.dbName)) {
        await this.dialect.run(
          this.db,
          sql.raw(this.dialect.addColumn(this.def.name, column))
        );
      }
    }
    // Columns written by earlier runs but unknown to this process.
    const known = new Set(this.def.columns.map(column => column.dbName));
    const recovered = existing
      .filter(column => !known.has(column.name))
      .map(
        (column): ColumnDef => ({
          key: toCamelCase(column.name),
          dbName: column.name,
          kind: kindFromSqlType(column.type),
          unique: false,
          meta: false,
        })
      );
    if (recovered.length) {
      const meta = this.def.columns.filter(column => column.meta);
      this.def = {
        name: this.def.name,
        columns: [
          ...meta.filter(c => c.kind === 'id'),
          ...this.def.columns.filter(c => !c.meta),
          ...recovered,
          ...meta.filter(c => c.kind !== 'id'),
        ],
      };
    }
    await this.dialect.ensureUniqueIndex(this.db, this.def);
    this.table = this.dialect.buildTable(this.def);
  }

  private inferColumns(items: readonly T[]): ColumnSpec[] {
    const known = new Set(this.def.columns.map(column => column.key));
    const found = new Map<string, ColumnKind>();
    for (const item of items) {
      for (const [key, value] of Object.entries(item)) {
        if (known.has(key) || found.has(key) || value == null) continue;
        found.set(key, kindOfValue(value));
      }
    }
    return [...found].map(([name, kind]) => ({name, kind}));
  }

  private toRow(
    item: Record<string, unknown>,
    meta: SaveMeta,
    now: Date
  ): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const column of this.def.columns) {
      if (column.kind === 'id') continue;
      switch (column.key) {
        case '_url':
          row[column.key] = meta.url ?? null;
          break;
        case '_runId':
          row[column.key] = meta.runId ?? null;
          break;
        case '_createdAt':
        case '_updatedAt':
          row[column.key] = now;
          break;
        default:
          row[column.key] = normalize(item[column.key], column.kind);
      }
    }
    return row;
  }

  /** Keeps the last row per unique key (databases reject duplicate upserts). */
  private dedupe(
    rows: Array<Record<string, unknown>>,
    unique: readonly ColumnDef[]
  ): Array<Record<string, unknown>> {
    if (!unique.length) return rows;
    const byKey = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      byKey.set(JSON.stringify(unique.map(column => row[column.key])), row);
    }
    return [...byKey.values()];
  }

  private column(key: string): Column {
    const column = getTableColumns(this.table)[key];
    if (!column) {
      throw new StorageError(
        `"${this.def.name}" has no column "${key}"`,
        `known columns: ${this.def.columns.map(c => c.key).join(', ')}`
      );
    }
    return column;
  }

  private condition(where: Where<T> | undefined): SQL | undefined {
    if (!where) return undefined;
    if (typeof where === 'function') {
      return where(getTableColumns(this.table) as never, operators);
    }
    const parts = Object.entries(where).map(([key, value]) =>
      value === null ? isNull(this.column(key)) : eq(this.column(key), value)
    );
    return and(...parts);
  }

  private order(orderBy: OrderBy | undefined): SQL[] {
    const hasId = this.def.columns.some(column => column.kind === 'id');
    const entries =
      orderBy === undefined ? (hasId ? ['-_id'] : []) : [orderBy].flat();
    return entries.map(entry =>
      entry.startsWith('-')
        ? desc(this.column(entry.slice(1)))
        : asc(this.column(entry))
    );
  }
}
