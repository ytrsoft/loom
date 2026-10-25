/**
 * @fileoverview Public types of @loom/storage. The package is independent
 * of the crawler: it stores plain objects in any SQL database Drizzle can
 * talk to, creating and evolving tables automatically.
 */

import type {
  Column,
  SQL,
  and,
  between,
  eq,
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
} from 'drizzle-orm';

/** SQL family. Every Drizzle driver belongs to one of these. */
export type DialectName = 'sqlite' | 'postgres' | 'mysql';

/** How a value is stored. */
export type ColumnKind =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'json';

/** A column of a collection, named by item key (camelCase). */
export interface ColumnSpec {
  readonly name: string;
  readonly kind: ColumnKind;
}

/** Describes a collection (one table). */
export interface CollectionSpec {
  /** Table name. */
  readonly name: string;
  /** Known columns. Unknown item keys are added on first write. */
  readonly columns?: readonly ColumnSpec[];
  /** Item keys identifying a row; writes become upserts. */
  readonly unique?: readonly string[];
  /**
   * A Drizzle table you manage yourself (with drizzle-kit migrations).
   * Loom then skips all DDL and writes only the columns the table has.
   */
  readonly table?: object;
  /** Add `_id`, `_url`, `_runId`, `_createdAt`, `_updatedAt`. Defaults to true. */
  readonly meta?: boolean;
}

/** Metadata recorded with every write. */
export interface SaveMeta {
  readonly url?: string;
  readonly runId?: string;
}

/** Columns Loom adds to every managed table. */
export interface MetaFields {
  readonly _id: number;
  readonly _url: string | null;
  readonly _runId: string | null;
  readonly _createdAt: Date;
  readonly _updatedAt: Date;
}

/** A stored row. */
export type Stored<T> = T & MetaFields;

/** SQL operators handed to functional `where` clauses. */
export interface Operators {
  readonly eq: typeof eq;
  readonly ne: typeof ne;
  readonly gt: typeof gt;
  readonly gte: typeof gte;
  readonly lt: typeof lt;
  readonly lte: typeof lte;
  readonly like: typeof like;
  readonly notLike: typeof notLike;
  readonly inArray: typeof inArray;
  readonly notInArray: typeof notInArray;
  readonly isNull: typeof isNull;
  readonly isNotNull: typeof isNotNull;
  readonly between: typeof between;
  readonly and: typeof and;
  readonly or: typeof or;
  readonly not: typeof not;
  readonly sql: typeof sql;
}

/**
 * A filter: an object of equalities (`{author: 'pg'}`; null means IS NULL),
 * or a function building any Drizzle condition:
 *
 *   where: (t, {gt, and, like}) => and(gt(t.points, 100), like(t.title, '%AI%'))
 */
export type Where<T> =
  | Partial<{[K in keyof (T & MetaFields)]: (T & MetaFields)[K] | null}>
  | ((
      columns: Readonly<Record<keyof (T & MetaFields) & string, Column>>,
      ops: Operators
    ) => SQL | undefined);

/** Sort order: `'points'` ascending, `'-points'` descending. */
export type OrderBy = string | readonly string[];

/** Query options for `find()`. */
export interface FindQuery<T> {
  readonly where?: Where<T>;
  readonly orderBy?: OrderBy;
  readonly limit?: number;
  readonly offset?: number;
}

/** A page of results with the total count. */
export interface Page<T> {
  readonly items: Array<Stored<T>>;
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/** Export formats. */
export type ExportFormat = 'json' | 'ndjson' | 'csv';
