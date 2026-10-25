/**
 * @fileoverview `loom new <name>` and `loom init`.
 */

import {existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {parseArgs} from 'node:util';

import {resolveConfig} from 'loom';

const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function camelCase(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function httpTemplate(name: string): string {
  return `import {$, defineSpider, schema} from 'loom';

/** One record. Each key becomes a typed column in the database. */
const item = schema({
  title: 'h2 a',
  url: 'h2 a @href',
  price: $('.price').number().optional(),
});

export const ${camelCase(name)} = defineSpider({
  name: '${name}',
  start: 'https://example.com',
  schema: item,
  // Declarative crawling: every element matching \`items\` is extracted with
  // \`schema\` and stored; \`next\` follows pagination up to \`maxPages\`.
  items: 'article',
  next: 'a[rel=next]',
  maxPages: 5,
  store: {unique: 'url'},
});
`;
}

function browserTemplate(name: string): string {
  return `import {defineSpider, schema} from 'loom';

const item = schema({
  title: '.title',
  url: '.title a @href',
});

export const ${camelCase(name)} = defineSpider({
  name: '${name}',
  mode: 'browser',
  start: 'https://example.com',
  schema: item,
  browser: {block: ['image', 'font', 'media']},
  store: {unique: 'url'},
  async parse({browser, extractAll, save}) {
    await browser.infiniteScroll({items: '.card', max: 200});
    await save(extractAll('.card', item));
  },
});
`;
}

function apiTemplate(name: string): string {
  return `import {$, defineSpider, schema} from 'loom';

/** Selectors are dot paths when the response is JSON. */
const item = schema({
  id: $('id').int(),
  title: 'title',
  createdAt: $('created_at').date(),
});

export const ${camelCase(name)} = defineSpider({
  name: '${name}',
  start: 'https://api.example.com/items?page=1',
  schema: item,
  store: {unique: 'id'},
  rateLimit: '2/s',
  async parse({extractAll, save, enqueue, json, page}) {
    await save(extractAll('data', item));
    if (json<{hasMore: boolean}>().hasMore) {
      await enqueue(\`https://api.example.com/items?page=\${page + 1}\`);
    }
  },
});
`;
}

/** `loom new <name> [--browser | --api]`. */
export async function newCommand(args: string[]): Promise<number> {
  const {values, positionals} = parseArgs({
    args,
    allowPositionals: true,
    options: {browser: {type: 'boolean'}, api: {type: 'boolean'}},
  });
  const name = positionals[0];
  if (!name || !NAME_PATTERN.test(name)) {
    console.error('usage: loom new <kebab-case-name> [--browser | --api]');
    return 2;
  }
  const {spidersDir, root} = resolveConfig();
  const file = join(spidersDir, `${name.replace(/-/g, '_')}.ts`);
  if (existsSync(file)) {
    console.error(`${relative(root, file)} already exists`);
    return 1;
  }
  const template = values.browser
    ? browserTemplate(name)
    : values.api
      ? apiTemplate(name)
      : httpTemplate(name);
  await mkdir(spidersDir, {recursive: true});
  await writeFile(file, template);
  console.log(`created ${relative(root, file)}\nrun it with: loom run ${name}`);
  return 0;
}

const CONFIG_TEMPLATE = `import {defineConfig} from 'loom';

/**
 * Every option is optional. Spiders exported from src/spiders/ are found
 * automatically; the database defaults to SQLite in .loom/.
 */
export const config = defineConfig({
  database: process.env['LOOM_DATABASE_URL'] ?? 'sqlite:./data/loom.db',
  defaults: {
    concurrency: 5,
    retries: 3,
  },
  server: {port: 3000},
});
`;

/** `loom init`: config file and a first spider. */
export async function initCommand(): Promise<number> {
  const root = process.cwd();
  const configFile = join(root, 'loom.config.ts');
  if (!existsSync(configFile)) {
    await writeFile(configFile, CONFIG_TEMPLATE);
    console.log('created loom.config.ts');
  }
  return newCommand(['example']);
}
