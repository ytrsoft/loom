/**
 * @fileoverview Project configuration. Every option has a conventional
 * default, so most projects need no `loom.config.ts` at all:
 *
 *   database   sqlite:.loom/loom.db         (env LOOM_DATABASE_URL)
 *   spiders    every spider exported from src/spiders/**
 *   server     http://localhost:3000        (env LOOM_PORT, LOOM_HOST)
 *   auth       none                         (env LOOM_TOKEN)
 *   logs       info                         (env LOOM_LOG_LEVEL)
 */

import {isAbsolute, join, resolve} from 'node:path';

import type {CrawlSettings, LogLevel, Plugin, Spider} from '@loom/core';
import type {DatabaseConfig} from '@loom/storage';

/** HTTP server and dashboard settings. */
export interface ServerConfig {
  /** Defaults to 3000. */
  readonly port?: number;
  /** Defaults to `'localhost'`; use `'0.0.0.0'` inside containers. */
  readonly host?: string;
  /** Serve the dashboard UI. Defaults to true. */
  readonly dashboard?: boolean;
  /** Require `Authorization: Bearer <token>` for the API and WebSocket. */
  readonly token?: string;
  /** Allowed CORS origins, or true for any. Defaults to none. */
  readonly cors?: boolean | string | readonly string[];
  /** Custom routes created with `defineRoutes()` from @loom/server. */
  readonly routes?: readonly ServerRoutes[];
}

/**
 * Custom routes, as returned by `defineRoutes()`. Typed structurally so that
 * this package does not depend on the server package.
 */
export interface ServerRoutes {
  readonly prefix: string;
  readonly setup: (router: never, loom: never) => void;
}

/** `loom.config.ts` contents. */
export interface LoomConfig {
  /** Project root. Defaults to the current directory. */
  readonly root?: string;
  /** Working directory for crawl state and downloads. Defaults to `.loom`. */
  readonly workDir?: string;
  /** Database URL or config. Defaults to SQLite in the work directory. */
  readonly database?: string | DatabaseConfig;
  /** Spiders to register (in addition to discovered ones). */
  readonly spiders?: ReadonlyArray<Spider<object>>;
  /** Directory scanned for spiders by the CLI. Defaults to `src/spiders`. */
  readonly spidersDir?: string;
  /** Default crawl settings for every spider. */
  readonly defaults?: CrawlSettings;
  /** Plugins applied to every spider. */
  readonly plugins?: readonly Plugin[];
  readonly server?: ServerConfig;
  readonly logLevel?: LogLevel;
  /** Disable console logging (events are still emitted). */
  readonly silent?: boolean;
}

/** Configuration with every default applied. */
export interface ResolvedConfig {
  readonly root: string;
  readonly workDir: string;
  readonly database: string | DatabaseConfig;
  readonly spiders: ReadonlyArray<Spider<object>>;
  readonly spidersDir: string;
  readonly defaults: CrawlSettings;
  readonly plugins: readonly Plugin[];
  readonly server: Required<Omit<ServerConfig, 'token'>> & {
    readonly token: string | undefined;
  };
  readonly logLevel: LogLevel;
  readonly silent: boolean;
}

/** Identity helper that gives `loom.config.ts` full type checking. */
export function defineConfig(config: LoomConfig): LoomConfig {
  return config;
}

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

function envLogLevel(): LogLevel | undefined {
  const value = process.env['LOOM_LOG_LEVEL'];
  return LOG_LEVELS.find(level => level === value);
}

/** Applies conventions and environment overrides. */
export function resolveConfig(config: LoomConfig = {}): ResolvedConfig {
  const env = process.env;
  const root = resolve(config.root ?? process.cwd());
  const inRoot = (path: string) => (isAbsolute(path) ? path : join(root, path));
  const workDir = inRoot(config.workDir ?? '.loom');
  const database =
    env['LOOM_DATABASE_URL'] ??
    config.database ??
    `sqlite:${join(workDir, 'loom.db')}`;
  return {
    root,
    workDir,
    database,
    spiders: config.spiders ?? [],
    spidersDir: inRoot(config.spidersDir ?? 'src/spiders'),
    defaults: config.defaults ?? {},
    plugins: config.plugins ?? [],
    server: {
      port: Number(env['LOOM_PORT'] ?? config.server?.port ?? 3000),
      host: env['LOOM_HOST'] ?? config.server?.host ?? 'localhost',
      dashboard: config.server?.dashboard ?? true,
      token: env['LOOM_TOKEN'] ?? config.server?.token,
      cors: config.server?.cors ?? false,
      routes: config.server?.routes ?? [],
    },
    logLevel: envLogLevel() ?? config.logLevel ?? 'info',
    silent: config.silent ?? false,
  };
}
