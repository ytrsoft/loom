/**
 * @fileoverview The Loom runtime ties spiders, the engine and storage
 * together. It is what the CLI and the server use, and what scripts use for
 * programmatic crawling:
 *
 *   const loom = await createLoom({spiders: [hackerNews]});
 *   const summary = await loom.run('hacker-news');
 *   const top = await (await loom.items(hackerNews)).find({orderBy: '-points'});
 */

import {randomBytes} from 'node:crypto';

import {Cron} from 'croner';
import {
  DefinitionError,
  EventBus,
  createLogger,
  runSpider,
  type CrawlSettings,
  type LoomEventMap,
  type LoomEventName,
  type Logger,
  type Spider,
} from '@loom/core';
import {connect, formatDateTime, type Collection, type Database} from '@loom/storage';

import {resolveConfig, type LoomConfig, type ResolvedConfig} from './config.js';
import {RunHandle, type RunSummary} from './run_handle.js';
import {
  DatabaseVisitedStore,
  StorageSink,
  collectionSpecFor,
  openRunHistory,
  type RunRecord,
} from './storage_bridge.js';

/** Options for starting a run. */
export interface StartOptions {
  /** Recorded in the run history. Defaults to `'manual'`. */
  readonly trigger?: string;
  /** Settings overriding spider and project settings. */
  readonly overrides?: CrawlSettings;
  /** Continue an interrupted run instead of starting fresh. */
  readonly resume?: boolean;
  /** Allow a second concurrent run of the same spider. */
  readonly parallel?: boolean;
}

/** A spider as listed by {@link Loom.describe}. */
export interface SpiderInfo {
  readonly name: string;
  readonly description: string | null;
  readonly mode: 'http' | 'browser';
  readonly schedule: string | null;
  readonly table: string | null;
  readonly unique: readonly string[];
  readonly columns: ReadonlyArray<{readonly name: string; readonly kind: string}>;
  readonly running: RunSummary | null;
}

function closest(name: string, candidates: readonly string[]): string | undefined {
  const distance = (a: string, b: string): number => {
    const row = Array.from({length: b.length + 1}, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let previous = row[0]!;
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const current = row[j]!;
        row[j] = Math.min(
          row[j]! + 1,
          row[j - 1]! + 1,
          previous + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
        previous = current;
      }
    }
    return row[b.length]!;
  };
  return candidates
    .map(candidate => ({candidate, score: distance(name, candidate)}))
    .filter(entry => entry.score <= Math.max(2, name.length / 3))
    .sort((a, b) => a.score - b.score)[0]?.candidate;
}

/** The Loom runtime. Create it with {@link createLoom}. */
export class Loom {
  readonly events: EventBus;
  readonly logger: Logger;
  private readonly registry = new Map<string, Spider<object>>();
  private readonly active = new Map<string, RunHandle>();
  private readonly crons: Cron[] = [];
  private readonly sink: StorageSink;
  private readonly visited: DatabaseVisitedStore;

  private constructor(
    readonly config: ResolvedConfig,
    readonly database: Database,
    private readonly runs: Collection<RunRecord>,
    events: EventBus,
    logger: Logger
  ) {
    this.events = events;
    this.logger = logger;
    this.sink = new StorageSink(database);
    this.visited = new DatabaseVisitedStore(database);
    for (const spider of config.spiders) this.register(spider);
  }

  /** Connects storage and registers configured spiders. */
  static async create(config: LoomConfig = {}): Promise<Loom> {
    const resolved = resolveConfig(config);
    const events = new EventBus();
    const logger = createLogger({
      level: resolved.logLevel,
      events,
      silent: resolved.silent,
    });
    const database = await connect(resolved.database);
    const runs = await openRunHistory(database);
    // Runs that were "running" when the process died are marked as failed.
    const stale = await runs.find({where: {status: 'running'}, orderBy: []});
    if (stale.length) {
      await runs.save(
        stale.map(run => ({
          ...run,
          status: 'failed' as const,
          endedAt: new Date(),
          error: 'process exited during the run',
        }))
      );
    }
    logger.debug(`database: ${database.options.label ?? database.dialect.name}`);
    return new Loom(resolved, database, runs, events, logger);
  }

  // -----------------------------------------------------------------------
  // Spiders
  // -----------------------------------------------------------------------

  /** Registers spiders. Names must be unique. */
  register(...spiders: ReadonlyArray<Spider<object>>): this {
    for (const spider of spiders) {
      if (this.registry.has(spider.name)) {
        throw new DefinitionError(
          `two spiders are named "${spider.name}"`,
          'rename one of them; the name is also the table name'
        );
      }
      this.registry.set(spider.name, spider);
    }
    return this;
  }

  /** Replaces all spiders (hot reload in `loom dev`). Active runs continue. */
  replaceSpiders(spiders: ReadonlyArray<Spider<object>>): void {
    const previous = new Map(this.registry);
    this.registry.clear();
    try {
      this.register(...spiders);
    } catch (error) {
      for (const [name, spider] of previous) this.registry.set(name, spider);
      throw error;
    }
  }

  /** All registered spiders. */
  list(): Array<Spider<object>> {
    return [...this.registry.values()];
  }

  /** A spider by name. Throws with a suggestion for typos. */
  spider(name: string): Spider<object> {
    const spider = this.registry.get(name);
    if (spider) return spider;
    const suggestion = closest(name, [...this.registry.keys()]);
    throw new DefinitionError(
      `no spider named "${name}"`,
      suggestion
        ? `did you mean "${suggestion}"?`
        : `registered spiders: ${[...this.registry.keys()].join(', ') || 'none'}`
    );
  }

  /** Serializable descriptions of all spiders (used by the API). */
  describe(): SpiderInfo[] {
    return this.list().map(spider => {
      const options = spider.options;
      const spec = collectionSpecFor(options);
      return {
        name: spider.name,
        description: options.description ?? null,
        mode: options.mode ?? 'http',
        schedule: options.schedule ?? null,
        table: options.store === false ? null : spec.name,
        unique: spec.unique ?? [],
        columns: spec.columns ?? [],
        running: this.runningFor(spider.name)?.toJSON() ?? null,
      };
    });
  }

  // -----------------------------------------------------------------------
  // Runs
  // -----------------------------------------------------------------------

  /**
   * Starts a run in the background and returns its handle. By convention a
   * spider runs once at a time: starting it again returns the active run.
   */
  start(name: string, options: StartOptions = {}): RunHandle {
    const spider = this.spider(name);
    const existing = this.runningFor(name);
    if (existing && !options.parallel) return existing;
    const id = `${name}-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
    const trigger = options.trigger ?? 'manual';
    const handle = new RunHandle({id, spider: name, trigger}, this.events, async signal => {
      const startedAt = new Date();
      const record = (patch: Partial<RunRecord>): RunRecord => ({
        id,
        spider: name,
        status: 'running',
        trigger,
        startedAt,
        endedAt: null,
        stats: null,
        error: null,
        ...patch,
      });
      await this.runs.save([record({})]);
      const result = await runSpider(
        spider,
        {
          events: this.events,
          logger: this.logger,
          sink: this.sink,
          visited: this.visited,
          projectRoot: this.config.root,
          workDir: this.config.workDir,
          plugins: this.config.plugins,
          defaults: this.config.defaults,
        },
        {
          runId: id,
          trigger,
          signal,
          ...(options.overrides ? {overrides: options.overrides} : {}),
          ...(options.resume ? {resume: true} : {}),
        }
      );
      await this.runs.save([
        record({
          status: result.status,
          endedAt: new Date(),
          stats: result.stats,
          error: result.error ?? null,
        }),
      ]);
      return result;
    });
    this.active.set(id, handle);
    void handle.done.then(() => this.active.delete(id));
    return handle;
  }

  /** Runs a spider and waits for it to finish. */
  async run(name: string, options: StartOptions = {}): Promise<RunSummary> {
    return this.start(name, options).done;
  }

  /** The active run of a spider, if any. */
  runningFor(name: string): RunHandle | undefined {
    return [...this.active.values()].find(run => run.spider === name);
  }

  /** All active runs. */
  activeRuns(): RunHandle[] {
    return [...this.active.values()];
  }

  /** Stops a run by id. Returns false when it is not running. */
  stop(runId: string): boolean {
    const run = this.active.get(runId);
    run?.stop();
    return Boolean(run);
  }

  /** Run history, newest first. */
  async history(
    options: {spider?: string; limit?: number; offset?: number} = {}
  ): Promise<RunRecord[]> {
    return this.runs.find({
      ...(options.spider ? {where: {spider: options.spider}} : {}),
      orderBy: '-startedAt',
      limit: options.limit ?? 50,
      offset: options.offset ?? 0,
    });
  }

  /** One run by id: live when active, otherwise from history. */
  async getRun(id: string): Promise<RunSummary | RunRecord | undefined> {
    return this.active.get(id)?.toJSON() ?? this.runs.findOne({where: {id}, orderBy: []});
  }

  // -----------------------------------------------------------------------
  // Data
  // -----------------------------------------------------------------------

  /**
   * The collection holding a spider's items. Pass the spider itself to get
   * fully typed rows.
   */
  async items<T extends object = Record<string, unknown>>(
    spider: string | Spider<T>
  ): Promise<Collection<T>> {
    const definition =
      typeof spider === 'string' ? this.spider(spider) : spider;
    return this.database.collection<T>(collectionSpecFor(definition.options));
  }

  // -----------------------------------------------------------------------
  // Scheduling and lifecycle
  // -----------------------------------------------------------------------

  /** Starts cron schedules of spiders with a `schedule`. Returns a stop function. */
  schedule(): () => void {
    for (const spider of this.list()) {
      const pattern = spider.options.schedule;
      if (!pattern) continue;
      const cron = new Cron(pattern, {protect: true}, () => {
        this.start(spider.name, {trigger: 'schedule'});
      });
      this.crons.push(cron);
      this.logger.info(
        `${spider.name} scheduled (${pattern}), next run ${nextRunLabel(cron.nextRun())}`
      );
    }
    return () => this.unschedule();
  }

  /** Subscribes to an event. Returns an unsubscribe function. */
  on<K extends LoomEventName>(
    type: K,
    listener: (payload: LoomEventMap[K]) => void
  ): () => void {
    return this.events.on(type, listener);
  }

  /** Stops schedules and runs, then closes the database. */
  async close(): Promise<void> {
    this.unschedule();
    const runs = this.activeRuns();
    for (const run of runs) run.stop();
    await Promise.all(runs.map(run => run.done));
    await this.database.close();
  }

  private unschedule(): void {
    for (const cron of this.crons.splice(0)) cron.stop();
  }
}

/** Creates the Loom runtime. */
export function createLoom(config: LoomConfig = {}): Promise<Loom> {
  return Loom.create(config);
}

function nextRunLabel(date: Date | null): string {
  return date ? formatDateTime(date) : 'never';
}
