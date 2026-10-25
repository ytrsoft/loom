/**
 * @fileoverview Public API of @loom/storage.
 */

export {Collection, kindOfValue, operators} from './collection.js';
export {
  DEFAULT_DATABASE_URL,
  connect,
  dialectFor,
  registerDriver,
  type DatabaseConfig,
  type DriverConnection,
  type DriverFactory,
} from './connect.js';
export {Database, type DatabaseOptions} from './database.js';
export {
  kindFromSqlType,
  type ColumnDef,
  type Dialect,
  type DrizzleDb,
  type TableDef,
} from './dialects/dialect.js';
export {mysqlDialect} from './dialects/mysql.js';
export {postgresDialect} from './dialects/postgres.js';
export {sqliteDialect} from './dialects/sqlite.js';
export {
  StorageError,
  formatDateTime,
  readableValue,
  toCamelCase,
  toSnakeCase,
} from './serialize.js';
export type {
  CollectionSpec,
  ColumnKind,
  ColumnSpec,
  DialectName,
  ExportFormat,
  FindQuery,
  MetaFields,
  Operators,
  OrderBy,
  Page,
  SaveMeta,
  Stored,
  Where,
} from './types.js';
