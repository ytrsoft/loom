/**
 * @fileoverview Builds the HTTP server: REST API, WebSocket events and the
 * dashboard, plus extension points for custom routes and middleware.
 */

import {existsSync} from 'node:fs';
import {createServer as createHttpServer, type Server} from 'node:http';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';

import express, {
  Router,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import {DefinitionError, type Loom, type ServerConfig} from 'loom';

import {HttpError, createApiRouter} from './api.js';
import {RealtimeHub} from './realtime.js';

/** Sets up custom routes on a router. */
export type RouteSetup = (router: Router, loom: Loom) => void;

/** Custom routes mounted under a prefix. */
export interface RouteDefinition {
  readonly prefix: string;
  readonly setup: RouteSetup;
}

/**
 * Defines custom routes, e.g. a domain-specific endpoint over crawled data:
 *
 *   defineRoutes((router, loom) => {
 *     router.get('/top-stories', async (_req, res) => {
 *       const stories = await loom.items(hackerNews);
 *       res.json(await stories.find({orderBy: '-points', limit: 10}));
 *     });
 *   });
 */
export function defineRoutes(setup: RouteSetup, prefix = '/api'): RouteDefinition {
  return {prefix, setup};
}

/** Options for {@link createServer}. */
export interface ServerOptions extends ServerConfig {
  /** Extra routes. */
  readonly routes?: readonly RouteDefinition[];
  /** Directory of a built dashboard; defaults to @loom/dashboard. */
  readonly dashboardDir?: string;
  /** Last-chance hook to add middleware to the Express app. */
  readonly configure?: (app: Express, loom: Loom) => void;
}

/** A created server. */
export interface LoomServer {
  readonly app: Express;
  readonly http: Server;
  readonly realtime: RealtimeHub;
  /** Starts listening and resolves with the public URL. */
  listen(): Promise<string>;
  close(): Promise<void>;
}

function findDashboard(explicit?: string): string | undefined {
  if (explicit) return existsSync(explicit) ? explicit : undefined;
  try {
    const require = createRequire(import.meta.url);
    const dist = join(dirname(require.resolve('@loom/dashboard/package.json')), 'dist');
    return existsSync(join(dist, 'index.html')) ? dist : undefined;
  } catch {
    return undefined;
  }
}

function cors(origins: ServerConfig['cors']) {
  const allowed =
    origins === true ? true : new Set(typeof origins === 'string' ? [origins] : origins || []);
  return (request: Request, response: Response, next: NextFunction) => {
    const origin = request.headers.origin;
    if (origin && (allowed === true || allowed.has(origin))) {
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('access-control-allow-headers', 'authorization, content-type');
      response.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
      response.setHeader('vary', 'origin');
    }
    if (request.method === 'OPTIONS') response.status(204).end();
    else next();
  };
}

function auth(token: string | undefined) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!token) return next();
    const header = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    const provided = header ?? (request.query['token'] as string | undefined);
    if (provided !== token) {
      throw new HttpError(401, 'missing or invalid token (Authorization: Bearer <LOOM_TOKEN>)');
    }
    next();
  };
}

/** Creates (but does not start) the server. */
export function createServer(loom: Loom, options: ServerOptions = {}): LoomServer {
  const config = {...loom.config.server, ...options};
  const app = express();
  app.disable('x-powered-by');
  if (config.cors) app.use(cors(config.cors));
  app.use('/api', auth(config.token));
  const routes = [
    ...(loom.config.server.routes as readonly RouteDefinition[]),
    ...(options.routes ?? []),
  ];
  for (const route of routes) {
    const router = Router();
    route.setup(router, loom);
    app.use(route.prefix, router);
  }
  app.use('/api', createApiRouter(loom));
  options.configure?.(app, loom);

  const dashboard = config.dashboard ? findDashboard(options.dashboardDir) : undefined;
  if (dashboard) {
    app.use(express.static(dashboard, {index: false, maxAge: '1h'}));
    app.use((request: Request, response: Response, next: NextFunction) => {
      if (request.method !== 'GET' || request.path.startsWith('/api')) return next();
      response.sendFile(join(dashboard, 'index.html'));
    });
  }

  app.use('/api', (_request: Request, _response: Response, next: NextFunction) => {
    next(new HttpError(404, 'no such API route'));
  });
  app.use(
    (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
      const status =
        error instanceof HttpError ? error.status : error instanceof DefinitionError ? 400 : 500;
      if (status === 500) loom.logger.error(`api error: ${String(error)}`);
      response.status(status).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  );

  const http = createHttpServer(app);
  const realtime = new RealtimeHub(http, loom, {
    ...(config.token ? {token: config.token} : {}),
  });

  return {
    app,
    http,
    realtime,
    listen: () =>
      new Promise((resolve, reject) => {
        http.once('error', reject);
        http.listen(config.port, config.host, () => {
          const url = `http://${config.host}:${config.port}`;
          loom.logger.info(
            dashboard
              ? `dashboard and API on ${url}`
              : `API on ${url}/api (dashboard not built: pnpm --filter @loom/dashboard build)`
          );
          resolve(url);
        });
      }),
    close: async () => {
      realtime.close();
      await new Promise<void>(resolve => http.close(() => resolve()));
    },
  };
}

/** Creates the server and starts listening. */
export async function startServer(
  loom: Loom,
  options: ServerOptions = {}
): Promise<LoomServer> {
  const server = createServer(loom, options);
  await server.listen();
  return server;
}
