/**
 * @fileoverview `loom run`, `loom start` and `loom dev`.
 */

import {spawn, type ChildProcess} from 'node:child_process';
import {existsSync, watch} from 'node:fs';
import {join} from 'node:path';
import {parseArgs} from 'node:util';

import {startServer} from '@loom/server';
import {readableValue, type CrawlSettings} from 'loom';

import {describeStats, showProgress} from '../progress.js';
import {createProjectLoom, loadProject} from '../project.js';

/** `loom run <spider>`: runs one spider in the foreground. */
export async function runCommand(args: string[]): Promise<number> {
  const {values, positionals} = parseArgs({
    args,
    allowPositionals: true,
    options: {
      'max-requests': {type: 'string'},
      'concurrency': {type: 'string'},
      'headful': {type: 'boolean'},
      'resume': {type: 'boolean'},
      'quiet': {type: 'boolean', short: 'q'},
    },
  });
  const name = positionals[0];
  if (!name) {
    console.error('usage: loom run <spider> [--max-requests n] [--headful] [--resume]');
    return 2;
  }
  const project = await loadProject();
  const loom = await createProjectLoom(project, {
    ...(values.quiet ? {logLevel: 'warn' as const} : {}),
  });
  const overrides: CrawlSettings = {
    ...(values['max-requests'] ? {maxRequests: Number(values['max-requests'])} : {}),
    ...(values.concurrency ? {concurrency: Number(values.concurrency)} : {}),
    ...(values.headful ? {browser: {headless: false}} : {}),
  };
  const run = loom.start(name, {
    trigger: 'cli',
    overrides,
    ...(values.resume ? {resume: true} : {}),
  });
  const stopProgress = showProgress(loom, run.id);
  let interrupts = 0;
  const onInterrupt = () => {
    if (++interrupts > 1) {
      // A second Ctrl+C means "stop now": in-flight requests are abandoned on purpose.
      // eslint-disable-next-line n/no-process-exit
      process.exit(130);
    }
    console.error('\nstopping after in-flight requests… (Ctrl+C again to force)');
    run.stop();
  };
  process.on('SIGINT', onInterrupt);
  const summary = await run.done;
  process.off('SIGINT', onInterrupt);
  stopProgress();
  if (summary.stats) console.log(`${summary.status}  ${describeStats(summary.stats)}`);
  const sample = await (await loom.items(name)).find({limit: 3});
  if (sample.length && !values.quiet) {
    console.log('latest items:');
    console.table(
      sample.map(row => {
        const {_runId, _updatedAt, ...rest} = row as Record<string, unknown>;
        void _runId;
        void _updatedAt;
        return Object.fromEntries(
          Object.entries(rest).map(([key, value]) => [key, readableValue(value)])
        );
      })
    );
  }
  await loom.close();
  return summary.status === 'failed' ? 1 : 0;
}

/** `loom start`: API, dashboard and schedules (production). */
export async function startCommand(args: string[]): Promise<number> {
  const {values} = parseArgs({
    args,
    options: {
      'port': {type: 'string', short: 'p'},
      'host': {type: 'string'},
      'no-dashboard': {type: 'boolean'},
      'no-schedule': {type: 'boolean'},
    },
  });
  const project = await loadProject();
  const loom = await createProjectLoom(project);
  loom.logger.info(
    `${project.spiders.length} spider(s): ${project.spiders.map(s => s.name).join(', ') || 'none'}`
  );
  const server = await startServer(loom, {
    ...(values.port ? {port: Number(values.port)} : {}),
    ...(values.host ? {host: values.host} : {}),
    ...(values['no-dashboard'] ? {dashboard: false} : {}),
  });
  if (!values['no-schedule']) loom.schedule();
  await new Promise<void>(resolve => {
    const shutdown = () => resolve();
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
  loom.logger.info('shutting down…');
  await server.close();
  await loom.close();
  return 0;
}

/**
 * `loom dev`: runs `loom start` in a child process and restarts it when
 * project files change. A fresh process guarantees fresh modules.
 */
export async function devCommand(args: string[]): Promise<number> {
  const root = process.cwd();
  const watched = ['src', 'loom.config.ts', 'loom.config.mts']
    .map(path => join(root, path))
    .filter(existsSync);
  const entry = process.argv[1]!;
  let child: ChildProcess | undefined;
  let restarting: NodeJS.Timeout | undefined;

  const launch = () => {
    child = spawn(process.execPath, [...process.execArgv, entry, 'start', ...args], {
      stdio: 'inherit',
      env: {...process.env, LOOM_DEV: '1'},
    });
  };
  const restart = (file: string) => {
    clearTimeout(restarting);
    restarting = setTimeout(() => {
      console.log(`\n↻ ${file} changed, restarting…`);
      const previous = child;
      if (!previous || previous.exitCode !== null) return launch();
      previous.once('exit', launch);
      previous.kill('SIGTERM');
    }, 150);
  };

  for (const path of watched) {
    watch(path, {recursive: true}, (_event, file) => {
      if (file && /\.(m?ts|m?js|json)$/.test(String(file))) restart(String(file));
    });
  }
  launch();
  console.log(`watching ${watched.map(path => path.replace(`${root}/`, '')).join(', ')}`);
  await new Promise<void>(resolve => process.once('SIGINT', resolve));
  child?.kill('SIGTERM');
  return 0;
}
