/**
 * @fileoverview Typed client for the Loom REST API.
 */

import type {ItemPage, Run, SpiderInfo} from './types.js';

const TOKEN_KEY = 'loom.token';

/** The API token, taken from `?token=` once and remembered. */
export function apiToken(): string | null {
  const fromUrl = new URLSearchParams(location.search).get('token');
  if (fromUrl) localStorage.setItem(TOKEN_KEY, fromUrl);
  return fromUrl ?? localStorage.getItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = apiToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? {authorization: `Bearer ${token}`} : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {error?: string};
    throw new Error(body.error ?? `请求失败（HTTP ${response.status}）`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** Query options for items. */
export interface ItemQuery {
  readonly limit: number;
  readonly offset: number;
  readonly order?: string;
  readonly q?: string;
}

/** Options when starting a run from the dashboard. */
export interface StartOptions {
  readonly maxRequests?: number;
  readonly resume?: boolean;
}

/** Export formats offered by the server. */
export type ExportFormat = 'csv' | 'json' | 'ndjson';

/** The API. */
export const api = {
  spiders: (): Promise<SpiderInfo[]> => request<SpiderInfo[]>('/api/spiders'),
  startRun: (spider: string, options: StartOptions = {}): Promise<Run> =>
    request<Run>(`/api/spiders/${encodeURIComponent(spider)}/runs`, {
      method: 'POST',
      body: JSON.stringify(options),
    }),
  stopRun: (runId: string): Promise<{stopping: boolean}> =>
    request<{stopping: boolean}>(`/api/runs/${encodeURIComponent(runId)}/stop`, {
      method: 'POST',
    }),
  runs: (spider: string, limit = 30): Promise<Run[]> =>
    request<Run[]>(`/api/runs?spider=${encodeURIComponent(spider)}&limit=${limit}`),
  recentRuns: (limit = 300): Promise<Run[]> => request<Run[]>(`/api/runs?limit=${limit}`),
  items: (spider: string, query: ItemQuery): Promise<ItemPage> => {
    const params = new URLSearchParams({
      limit: String(query.limit),
      offset: String(query.offset),
      ...(query.order ? {order: query.order} : {}),
      ...(query.q ? {q: query.q} : {}),
    });
    return request<ItemPage>(`/api/spiders/${encodeURIComponent(spider)}/items?${params}`);
  },
  clearItems: (spider: string): Promise<void> =>
    request<void>(`/api/spiders/${encodeURIComponent(spider)}/items?confirm=true`, {
      method: 'DELETE',
    }),
  exportUrl: (spider: string, format: ExportFormat): string => {
    const token = apiToken();
    return `/api/spiders/${encodeURIComponent(spider)}/export?format=${format}${
      token ? `&token=${encodeURIComponent(token)}` : ''
    }`;
  },
};
