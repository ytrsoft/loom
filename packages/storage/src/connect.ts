/**
 * @fileoverview Connecting by URL. Drivers are loaded lazily, so a project
 * only installs the one it uses. Any other database Drizzle supports works
 * by passing a ready Drizzle instance together with its SQL family:
 *
 *   connect('sqlite:./data/loom.db')
 *   connect('postgres://user:pass@localhost/loom')
 *   connect('mysql://user:pass@localhost/loom')
 *   connect('libsql://my-db.turso.io?authToken=...')
 *   connect({dialect: 'postgres', db: drizzle(neon(process.env.DATABASE_URL))})
 */

import {mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';

import {Database} from './database.js';
import type {Dialect, DrizzleDb} from './dialects/dialect.js';
import {mysqlDialect} from './dialects/mysql.js';
import {postgresDialect} from './dialects/postgres.js';
import {sqliteDialect} from './dialects/sqlite.js';
import {StorageError} from './serialize.js';
import type {DialectName} from './types.js';

/** Connection settings. */
export interface DatabaseConfig {
  /** Connection URL. Defaults to `sqlite:.loom/loom.db`. */
  readonly url?: string;
  /** A ready Drizzle instance (any driver). Requires `dialect`. */
  readonly db?: unknown;
  /** SQL family of `db`. */
  readonly dialect?: DialectName;
  /** Called by `close()` for a `db` you passed in. */
  readonly close?: () => Promise<void>;
  /** Auth token for libSQL/Turso. */
  readonly authToken?: string;
  /** Prefix added to every table name. */
  readonly tablePrefix?: string;
}

/** What a driver factory returns. */
export interface DriverConnection {
  readonly db: unknown;
  readonly dialect: DialectName;
  close(): Promise<void>;
}

/** Opens a connection for URLs it recognizes. */
export type DriverFactory = (
  url: string,
  config: DatabaseConfig
) => Promise<DriverConnection>;

interface DriverEntry {
  readonly test: (url: string) => boolean;
  readonly factory: DriverFactory;
}

const DIALECTS: Readonly<Record<DialectName, Dialect>> = {
  sqlite: sqliteDialect,
  postgres: postgresDialect,
  mysql: mysqlDialect,
};

/** The dialect of an SQL family. */
export function dialectFor(name: DialectName): Dialect {
  return DIALECTS[name];
}

const NATIVE_FAILURE = /bindings file|NODE_MODULE_VERSION|\.node\b|dlopen/i;

async function loadDriver<T>(load: () => Promise<T>, name: string): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if ((error as {code?: string}).code === 'ERR_MODULE_NOT_FOUND') {
      throw new StorageError(
        `database driver "${name}" is not installed`,
        `run: pnpm add ${name}`
      );
    }
    if (error instanceof Error && NATIVE_FAILURE.test(error.message)) {
      throw new StorageError(
        `the native part of "${name}" was not built for Node ${process.version}`,
        `run: pnpm rebuild ${name} (or use a Node LTS release); ` +
          'libsql:file:./data/loom.db works without native compilation'
      );
    }
    throw error;
  }
}

function sqlitePath(url: string): string {
  return url.replace(/^sqlite:(\/\/)?/, '').replace(/^file:(\/\/)?/, '');
}

async function openLibsql(
  url: string,
  config: DatabaseConfig
): Promise<DriverConnection> {
  const {createClient} = await loadDriver(
    () => import('@libsql/client'),
    '@libsql/client'
  );
  const {drizzle} = await import('drizzle-orm/libsql');
  const client = createClient({
    url,
    ...(config.authToken ? {authToken: config.authToken} : {}),
  });
  return {
    db: drizzle(client),
    dialect: 'sqlite',
    close: async () => client.close(),
  };
}

async function openBetterSqlite(file: string): Promise<DriverConnection> {
  const BetterSqlite3 = (
    await loadDriver(() => import('better-sqlite3'), 'better-sqlite3')
  ).default;
  const {drizzle} = await import('drizzle-orm/better-sqlite3');
  let client: InstanceType<typeof BetterSqlite3>;
  try {
    client = new BetterSqlite3(file);
  } catch (error) {
    if (error instanceof Error && NATIVE_FAILURE.test(error.message)) {
      throw new StorageError(`better-sqlite3 cannot load: ${error.message}`);
    }
    throw error;
  }
  client.pragma('journal_mode = WAL');
  client.pragma('busy_timeout = 5000');
  return {
    db: drizzle(client),
    dialect: 'sqlite',
    close: async () => {
      client.close();
    },
  };
}

/**
 * Local SQLite files use better-sqlite3 when it is installed and loads,
 * otherwise @libsql/client (prebuilt binaries, nothing to compile).
 */
async function openSqliteFile(
  url: string,
  config: DatabaseConfig
): Promise<DriverConnection> {
  const file = sqlitePath(url);
  if (file !== ':memory:') {
    await mkdir(dirname(resolve(file)), {recursive: true});
  }
  try {
    return await openBetterSqlite(file);
  } catch (error) {
    if (!(error instanceof StorageError)) throw error;
  }
  try {
    return await openLibsql(
      file === ':memory:' ? ':memory:' : `file:${resolve(file)}`,
      config
    );
  } catch (error) {
    if (!(error instanceof StorageError)) throw error;
    throw new StorageError(
      'no SQLite driver is installed',
      'run: pnpm add @libsql/client (prebuilt, no compilation needed)'
    );
  }
}

const DRIVERS: DriverEntry[] = [
  {
    test: url => /^(postgres|postgresql):\/\//.test(url),
    factory: async url => {
      const pg = (await loadDriver(() => import('pg'), 'pg')).default;
      const {drizzle} = await import('drizzle-orm/node-postgres');
      const pool = new pg.Pool({connectionString: url});
      return {db: drizzle(pool), dialect: 'postgres', close: () => pool.end()};
    },
  },
  {
    test: url => /^(mysql|mariadb):\/\//.test(url),
    factory: async url => {
      const mysql = await loadDriver(() => import('mysql2/promise'), 'mysql2');
      const {drizzle} = await import('drizzle-orm/mysql2');
      const pool = mysql.createPool({uri: url.replace(/^mariadb:/, 'mysql:')});
      return {db: drizzle(pool), dialect: 'mysql', close: () => pool.end()};
    },
  },
  {
    test: url => /^libsql:/.test(url) || /\.turso\.io/.test(url),
    factory: (url, config) =>
      openLibsql(url.startsWith('libsql:file:') ? url.slice(7) : url, config),
  },
  {
    test: url =>
      /^(sqlite:|file:|:memory:)/.test(url) || /\.(db|sqlite3?)$/.test(url),
    factory: openSqliteFile,
  },
];

/**
 * Registers a driver for URLs matching `test`. Registered drivers take
 * precedence over the built-in ones.
 */
export function registerDriver(
  test: RegExp | ((url: string) => boolean),
  factory: DriverFactory
): void {
  DRIVERS.unshift({
    test: typeof test === 'function' ? test : url => test.test(url),
    factory,
  });
}

/** Default database used when nothing is configured. */
export const DEFAULT_DATABASE_URL = 'sqlite:.loom/loom.db';

function redact(url: string): string {
  return url.replace(/\/\/([^:@/]+):[^@/]+@/, '//$1:***@');
}

/** Connects to a database. */
export async function connect(
  input: string | DatabaseConfig = DEFAULT_DATABASE_URL
): Promise<Database> {
  const config: DatabaseConfig = typeof input === 'string' ? {url: input} : input;
  const options = {
    ...(config.tablePrefix ? {tablePrefix: config.tablePrefix} : {}),
  };
  if (config.db) {
    if (!config.dialect) {
      throw new StorageError(
        'a custom Drizzle instance needs its dialect',
        "pass dialect: 'sqlite' | 'postgres' | 'mysql'"
      );
    }
    return new Database(
      dialectFor(config.dialect),
      config.db as DrizzleDb,
      config.close ?? (async () => undefined),
      {...options, label: `custom ${config.dialect}`}
    );
  }
  const url = config.url ?? DEFAULT_DATABASE_URL;
  const driver = DRIVERS.find(entry => entry.test(url));
  if (!driver) {
    throw new StorageError(
      `no database driver recognizes "${redact(url)}"`,
      'use sqlite:path, postgres://..., mysql://..., libsql://..., ' +
        'or pass {dialect, db} with any Drizzle instance'
    );
  }
  const connection = await driver.factory(url, config);
  return new Database(
    dialectFor(connection.dialect),
    connection.db as DrizzleDb,
    () => connection.close(),
    {...options, label: redact(url)}
  );
}
