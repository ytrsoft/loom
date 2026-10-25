/**
 * @fileoverview REST API. Every route is a thin translation of a `Loom`
 * method, so anything the dashboard can do, a script can do too.
 *
 *   GET    /api/health
 *   GET    /api/spiders
 *   GET    /api/spiders/:name
 *   POST   /api/spiders/:name/runs          {maxRequests?, headful?, resume?}
 *   GET    /api/spiders/:name/items         ?limit&offset&order&q&where
 *   GET    /api/spiders/:name/export        ?format=csv|json|ndjson
 *   DELETE /api/spiders/:name/items         ?confirm=true
 *   GET    /api/runs                        ?spider&limit&offset
 *   GET    /api/runs/:id
 *   POST   /api/runs/:id/stop
 */

import {Router, json, type Request, type Response} from 'express';
import type {CrawlSettings, Loom, Spider, Where} from 'loom';

/** An error with an HTTP status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function findSpider(loom: Loom, name: string): Spider<object> {
  const spider = loom.list().find(candidate => candidate.name === name);
  if (!spider) throw new HttpError(404, `no spider named "${name}"`);
  return spider;
}

function intParam(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function param(request: Request, name: string): string {
  return String(request.params[name] ?? '');
}

function buildWhere(
  request: Request,
  stringColumns: readonly string[]
): Where<Record<string, unknown>> | undefined {
  const q = typeof request.query['q'] === 'string' ? request.query['q'].trim() : '';
  let equals: Record<string, unknown> | undefined;
  if (typeof request.query['where'] === 'string') {
    try {
      equals = JSON.parse(request.query['where']) as Record<string, unknown>;
    } catch {
      throw new HttpError(400, 'where must be a JSON object of equalities');
    }
  }
  if (!q && !equals) return undefined;
  return (columns, {and, eq, isNull, like, or}) =>
    and(
      ...Object.entries(equals ?? {}).map(([key, value]) => {
        const column = columns[key];
        if (!column) throw new HttpError(400, `unknown column "${key}"`);
        return value === null ? isNull(column) : eq(column, value);
      }),
      q
        ? or(
            ...stringColumns
              .map(key => columns[key])
              .filter(column => column !== undefined)
              .map(column => like(column, `%${q}%`))
          )
        : undefined
    );
}

/** Builds the API router. */
export function createApiRouter(loom: Loom): Router {
  const router = Router();
  router.use(json({limit: '1mb'}));

  router.get('/health', (_request, response) => {
    response.json({
      ok: true,
      database: loom.database.dialect.name,
      spiders: loom.list().length,
      activeRuns: loom.activeRuns().length,
    });
  });

  router.get('/spiders', async (_request, response) => {
    const spiders = await Promise.all(
      loom.describe().map(async info => {
        const [lastRun] = await loom.history({spider: info.name, limit: 1});
        const items = info.table
          ? await (await loom.items(info.name)).count()
          : 0;
        return {...info, items, lastRun: lastRun ?? null};
      })
    );
    response.json(spiders);
  });

  router.get('/spiders/:name', (request, response) => {
    const name = findSpider(loom, param(request, 'name')).name;
    response.json(loom.describe().find(info => info.name === name));
  });

  router.post('/spiders/:name/runs', (request, response) => {
    const spider = findSpider(loom, param(request, 'name'));
    const body = (request.body ?? {}) as {
      maxRequests?: number;
      headful?: boolean;
      resume?: boolean;
    };
    const overrides: CrawlSettings = {
      ...(body.maxRequests ? {maxRequests: body.maxRequests} : {}),
      ...(body.headful ? {browser: {headless: false}} : {}),
    };
    const run = loom.start(spider.name, {
      trigger: 'api',
      overrides,
      ...(body.resume ? {resume: true} : {}),
    });
    response.status(202).json(run.toJSON());
  });

  router.get('/spiders/:name/items', async (request, response) => {
    const spider = findSpider(loom, param(request, 'name'));
    const collection = await loom.items(spider.name);
    const stringColumns = collection.columns
      .filter(column => column.kind === 'string' && !column.name.startsWith('_'))
      .map(column => column.name);
    const order = typeof request.query['order'] === 'string' ? request.query['order'] : undefined;
    const where = buildWhere(request, stringColumns);
    const page = await collection.page({
      limit: intParam(request.query['limit'], 50, 1000),
      offset: intParam(request.query['offset'], 0, Number.MAX_SAFE_INTEGER),
      ...(order ? {orderBy: order} : {}),
      ...(where ? {where} : {}),
    });
    response.json({...page, columns: collection.columns});
  });

  router.get('/spiders/:name/export', async (request, response) => {
    const spider = findSpider(loom, param(request, 'name'));
    const format = String(request.query['format'] ?? 'csv');
    if (format !== 'csv' && format !== 'json' && format !== 'ndjson') {
      throw new HttpError(400, 'format must be csv, json or ndjson');
    }
    const collection = await loom.items(spider.name);
    const types = {
      csv: 'text/csv; charset=utf-8',
      json: 'application/json; charset=utf-8',
      ndjson: 'application/x-ndjson; charset=utf-8',
    };
    response.setHeader('content-type', types[format]);
    response.setHeader(
      'content-disposition',
      `attachment; filename="${spider.name}.${format}"`
    );
    if (format === 'csv') response.write('\ufeff');
    for await (const chunk of collection.export(format)) {
      if (!response.write(chunk)) {
        await new Promise(resolve => response.once('drain', resolve));
      }
    }
    response.end();
  });

  router.delete('/spiders/:name/items', async (request, response) => {
    const spider = findSpider(loom, param(request, 'name'));
    if (request.query['confirm'] !== 'true') {
      throw new HttpError(400, 'add ?confirm=true to delete every item');
    }
    await (await loom.items(spider.name)).delete();
    response.status(204).end();
  });

  router.get('/runs', async (request, response) => {
    const spider = typeof request.query['spider'] === 'string' ? request.query['spider'] : undefined;
    response.json(
      await loom.history({
        ...(spider ? {spider} : {}),
        limit: intParam(request.query['limit'], 50, 500),
        offset: intParam(request.query['offset'], 0, Number.MAX_SAFE_INTEGER),
      })
    );
  });

  router.get('/runs/:id', async (request, response) => {
    const run = await loom.getRun(param(request, 'id'));
    if (!run) throw new HttpError(404, `no run "${param(request, 'id')}"`);
    response.json(run);
  });

  router.post('/runs/:id/stop', (request, response: Response) => {
    if (!loom.stop(param(request, 'id'))) {
      throw new HttpError(409, 'that run is not active');
    }
    response.status(202).json({stopping: true});
  });

  return router;
}
