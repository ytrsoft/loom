/**
 * @fileoverview `loom list` and `loom export`.
 */

import {createWriteStream} from 'node:fs';
import {relative} from 'node:path';
import {once} from 'node:events';
import {parseArgs} from 'node:util';

import type {ExportFormat} from 'loom';

import {formatCount} from '../progress.js';
import {createProjectLoom, loadProject} from '../project.js';

/** `loom list`: spiders, their files and stored item counts. */
export async function listCommand(): Promise<number> {
  const project = await loadProject();
  const loom = await createProjectLoom(project, {logLevel: 'warn'});
  const rows = await Promise.all(
    loom.describe().map(async info => ({
      spider: info.name,
      mode: info.mode,
      schedule: info.schedule ?? '',
      table: info.table ?? '(not stored)',
      items: info.table ? formatCount(await (await loom.items(info.name)).count()) : '',
      file: relative(project.root, project.sources.get(info.name) ?? ''),
    }))
  );
  if (rows.length) console.table(rows);
  else console.log(`no spiders found in ${relative(project.root, project.resolved.spidersDir)}/ — create one with: loom new my-spider`);
  await loom.close();
  return 0;
}

/** `loom export <spider>`: streams stored items as CSV, JSON or NDJSON. */
export async function exportCommand(args: string[]): Promise<number> {
  const {values, positionals} = parseArgs({
    args,
    allowPositionals: true,
    options: {
      format: {type: 'string', short: 'f', default: 'csv'},
      out: {type: 'string', short: 'o'},
    },
  });
  const name = positionals[0];
  const format = values.format as ExportFormat;
  if (!name || !['csv', 'json', 'ndjson'].includes(format)) {
    console.error('usage: loom export <spider> [--format csv|json|ndjson] [--out file]');
    return 2;
  }
  const project = await loadProject();
  const loom = await createProjectLoom(project, {logLevel: 'warn'});
  const collection = await loom.items(name);
  const output = values.out ? createWriteStream(values.out) : process.stdout;
  if (format === 'csv' && values.out) output.write('\ufeff');
  for await (const chunk of collection.export(format)) {
    if (!output.write(chunk)) await once(output, 'drain');
  }
  if (values.out) {
    output.end();
    await once(output, 'finish');
    console.error(`exported ${formatCount(await collection.count())} items to ${values.out}`);
  }
  await loom.close();
  return 0;
}
