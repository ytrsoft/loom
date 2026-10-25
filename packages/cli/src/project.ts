/**
 * @fileoverview Loads a Loom project by convention:
 *
 *   loom.config.ts   optional; `export const config = defineConfig({...})`
 *   src/spiders/**   every exported spider is registered automatically
 *
 * TypeScript files are loaded through tsx's ESM loader, so the CLI and the
 * project share one module graph (and therefore one copy of Loom).
 */

import {existsSync} from 'node:fs';
import {readdir} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {pathToFileURL} from 'node:url';

import {
  DefinitionError,
  createLoom,
  isSpider,
  resolveConfig,
  type Loom,
  type LoomConfig,
  type ResolvedConfig,
  type Spider,
} from 'loom';

/** A loaded project. */
export interface Project {
  readonly root: string;
  readonly configFile: string | undefined;
  readonly config: LoomConfig;
  readonly resolved: ResolvedConfig;
  readonly spiders: Array<Spider<object>>;
  /** Spider name → file that defined it. */
  readonly sources: ReadonlyMap<string, string>;
}

const CONFIG_FILES = ['loom.config.ts', 'loom.config.mts', 'loom.config.js', 'loom.config.mjs'];
const SOURCE_PATTERN = /\.(m?ts|m?js)$/;
const IGNORED_PATTERN = /(_test|\.test|\.spec|\.d)\.(m?ts|m?js)$/;

let loaderRegistered = false;

async function ensureTypeScriptLoader(): Promise<void> {
  if (loaderRegistered) return;
  const {register} = await import('tsx/esm/api');
  register();
  loaderRegistered = true;
}

async function importFile(file: string): Promise<Record<string, unknown>> {
  await ensureTypeScriptLoader();
  return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
}

async function listSources(directory: string): Promise<string[]> {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, {recursive: true, withFileTypes: true});
  return entries
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name))
    .filter(file => SOURCE_PATTERN.test(file) && !IGNORED_PATTERN.test(file))
    .sort();
}

/** Loads config and discovers spiders. */
export async function loadProject(root: string = process.cwd()): Promise<Project> {
  const configFile = CONFIG_FILES.map(name => join(root, name)).find(existsSync);
  let config: LoomConfig = {};
  if (configFile) {
    const module = await importFile(configFile);
    config = (module['config'] ?? module['default'] ?? {}) as LoomConfig;
  }
  const resolved = resolveConfig({root, ...config});
  const spiders: Array<Spider<object>> = [...resolved.spiders];
  const sources = new Map<string, string>();
  for (const spider of spiders) sources.set(spider.name, configFile ?? 'config');
  for (const file of await listSources(resolved.spidersDir)) {
    const module = await importFile(file);
    for (const value of Object.values(module)) {
      if (!isSpider(value) || spiders.includes(value)) continue;
      const previous = sources.get(value.name);
      if (previous) {
        throw new DefinitionError(
          `spider "${value.name}" is defined twice`,
          `in ${relative(root, previous)} and ${relative(root, file)}`
        );
      }
      spiders.push(value);
      sources.set(value.name, file);
    }
  }
  return {root, configFile, config, resolved, spiders, sources};
}

/** Creates the runtime for a loaded project. */
export function createProjectLoom(
  project: Project,
  overrides: Partial<LoomConfig> = {}
): Promise<Loom> {
  return createLoom({
    ...project.config,
    ...overrides,
    root: project.root,
    spiders: project.spiders,
  });
}
