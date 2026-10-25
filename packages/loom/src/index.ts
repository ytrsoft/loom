/**
 * @fileoverview The `loom` package: everything a Loom project imports.
 *
 *   import {$, defineSpider, schema} from 'loom';
 */

export * from '@loom/core';
export {
  Collection,
  Database,
  StorageError,
  connect,
  formatDateTime,
  readableValue,
  operators,
  registerDriver,
  type CollectionSpec,
  type ColumnKind,
  type ColumnSpec,
  type DatabaseConfig,
  type DialectName,
  type DriverFactory,
  type ExportFormat,
  type FindQuery,
  type MetaFields,
  type Page,
  type Stored,
  type Where,
} from '@loom/storage';
export {
  defineConfig,
  resolveConfig,
  type LoomConfig,
  type ResolvedConfig,
  type ServerConfig,
  type ServerRoutes,
} from './config.js';
export {
  Loom,
  createLoom,
  type SpiderInfo,
  type StartOptions,
} from './loom.js';
export {RunHandle, type RunSummary} from './run_handle.js';
export {collectionSpecFor, type RunRecord} from './storage_bridge.js';
