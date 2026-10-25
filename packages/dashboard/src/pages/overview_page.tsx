/**
 * @fileoverview Overview: KPIs, items per hour, recent runs and every spider.
 */

import type {ReactElement} from 'react';
import {useMemo} from 'react';
import {Activity, AlertTriangle, ArrowRight, Bug, Database, Layers} from 'lucide-react';

import {BarChart, type Bar} from '@/components/charts';
import {Empty} from '@/components/empty';
import {RunButton} from '@/spider/run_button';
import {StatCard} from '@/components/stat_card';
import {StatusBadge, StatusDot} from '@/components/status';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {count, dateTime, duration, percent} from '@/format';
import type {LiveState} from '@/hooks/live';
import {href, spiderHref} from '@/lib/routes';
import type {Run, SpiderInfo} from '@/types';

const HOUR = 3600_000;

interface OverviewPageProps {
  readonly spiders: readonly SpiderInfo[];
  readonly runs: readonly Run[];
  readonly runsBySpider: ReadonlyMap<string, readonly Run[]>;
  readonly live: LiveState;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** The last runs as a row of bars: height by items, colour by outcome. */
function RecentRuns({runs}: {runs: readonly Run[]}): ReactElement {
  const shown = runs.slice(0, 10).reverse();
  const peak = Math.max(1, ...shown.map(run => run.stats?.items ?? 0));
  return (
    <div className="flex h-6 items-end gap-[3px]" aria-label={`最近 ${shown.length} 次运行`}>
      {Array.from({length: 10 - shown.length}, (_, index) => (
        <span key={`empty-${index}`} className="h-1 w-1.5 rounded-sm bg-muted" />
      ))}
      {shown.map(run => (
        <span
          key={run.id}
          title={`${dateTime(run.startedAt)}，${count(run.stats?.items)} 条`}
          className={
            'w-1.5 rounded-sm ' +
            (run.status === 'failed'
              ? 'bg-destructive'
              : run.status === 'running'
                ? 'bg-warning'
                : run.status === 'stopped'
                  ? 'bg-muted-foreground/40'
                  : 'bg-success')
          }
          style={{height: `${25 + ((run.stats?.items ?? 0) / peak) * 75}%`}}
        />
      ))}
    </div>
  );
}

/** The overview page. */
export function OverviewPage({spiders, runs, runsBySpider, live}: OverviewPageProps): ReactElement {
  const now = Date.now();
  const recent = runs.filter(run => new Date(run.startedAt).getTime() >= now - 24 * HOUR);
  const running = spiders.filter(spider => live.runs[spider.name]?.status === 'running');
  const stored = spiders.reduce((sum, spider) => sum + spider.items, 0);
  const itemsToday = recent.reduce((sum, run) => sum + (run.stats?.items ?? 0), 0);
  const requests = recent.reduce((sum, run) => sum + (run.stats?.requests ?? 0), 0);
  const failed = recent.reduce((sum, run) => sum + (run.stats?.failed ?? 0), 0);
  const failedRuns = recent.filter(run => run.status === 'failed').length;

  const hourly = useMemo(() => {
    const start = new Date(now);
    start.setMinutes(0, 0, 0);
    const first = start.getTime() - 23 * HOUR;
    const buckets = Array.from({length: 24}, (_, index) => ({items: 0, failed: 0, runs: 0, start: first + index * HOUR}));
    for (const run of runs) {
      const index = Math.floor((new Date(run.startedAt).getTime() - first) / HOUR);
      const bucket = buckets[index];
      if (!bucket) continue;
      bucket.items += run.stats?.items ?? 0;
      bucket.failed += run.stats?.failed ?? 0;
      bucket.runs += 1;
    }
    return buckets;
  }, [runs, now]);

  const bars: Bar[] = hourly.map(bucket => {
    const date = new Date(bucket.start);
    const label = `${dateTime(date).slice(0, 10)} ${pad(date.getHours())}:00`;
    return {
      key: String(bucket.start),
      label,
      tick: `${pad(date.getHours())}:00`,
      value: bucket.items,
      details: [`${count(bucket.runs)} 次运行`, `${count(bucket.items)} 条数据`, `${count(bucket.failed)} 个失败请求`],
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">总览</h1>
          <p className="mt-1 text-sm text-muted-foreground">所有爬虫的运行情况，统计覆盖最近 24 小时。</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="正在运行"
          icon={<Activity />}
          value={count(running.length)}
          unit={`/ ${count(spiders.length)}`}
          tone={running.length ? 'live' : 'default'}
          note={running.length ? running.map(spider => spider.name).join('、') : '当前没有运行中的爬虫'}
        />
        <StatCard
          label="已存数据"
          icon={<Database />}
          value={count(stored)}
          unit="条"
          note={`分布在 ${count(spiders.filter(spider => spider.table).length)} 张表`}
        />
        <StatCard
          label="24 小时新增"
          icon={<Layers />}
          value={count(itemsToday)}
          unit="条"
          note={`${count(recent.length)} 次运行${failedRuns ? `，${failedRuns} 次失败` : ''}`}
          trend={hourly.map(bucket => bucket.items)}
        />
        <StatCard
          label="请求失败率"
          icon={<AlertTriangle />}
          value={percent(failed, requests)}
          tone={failed / Math.max(1, requests) > 0.05 ? 'bad' : 'default'}
          note={`${count(failed)} / ${count(requests)} 个请求`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">抓取量</CardTitle>
            <CardDescription>每小时保存的数据条数，按运行开始时间统计</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <BarChart bars={bars} labelEvery={4} empty="最近 24 小时没有运行" />
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
            <div className="space-y-1.5">
              <CardTitle className="text-base">最近运行</CardTitle>
              <CardDescription>来自所有爬虫</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <a href={href({page: 'runs'})}>
                全部
                <ArrowRight />
              </a>
            </Button>
          </CardHeader>
          <CardContent className="flex-1 px-3 pb-3">
            {runs.length ? (
              <ul className="grid">
                {runs.slice(0, 7).map(run => (
                  <li key={run.id}>
                    <a
                      href={spiderHref(run.spider)}
                      className="flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-muted/60"
                    >
                      <StatusDot status={run.status} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{run.spider}</div>
                        <div className="text-xs tabular-nums text-muted-foreground">{dateTime(run.startedAt)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm tabular-nums">{count(run.stats?.items)} 条</div>
                        <div className="text-xs tabular-nums text-muted-foreground">{duration(run.stats?.durationMs)}</div>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={<Activity />} title="还没有运行记录" className="py-10" />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">爬虫</CardTitle>
          <CardDescription>点击名称查看数据、日志和运行记录</CardDescription>
        </CardHeader>
        {spiders.length ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">名称</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>上次运行</TableHead>
                <TableHead className="text-right">上次数据</TableHead>
                <TableHead className="text-right">已存</TableHead>
                <TableHead>最近 10 次</TableHead>
                <TableHead>方式</TableHead>
                <TableHead>定时</TableHead>
                <TableHead className="pr-6 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {spiders.map(spider => {
                const liveRun = live.runs[spider.name];
                const isRunning = liveRun?.status === 'running';
                const lastItems = isRunning ? liveRun?.stats?.items : spider.lastRun?.stats?.items;
                return (
                  <TableRow key={spider.name}>
                    <TableCell className="max-w-72 pl-6">
                      <a href={spiderHref(spider.name)} className="font-medium hover:underline">
                        {spider.name}
                      </a>
                      {spider.description && (
                        <div className="truncate text-xs text-muted-foreground">{spider.description}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={isRunning ? 'running' : spider.lastRun?.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {spider.lastRun ? dateTime(spider.lastRun.startedAt) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {lastItems === undefined ? '—' : count(lastItems)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {spider.table ? count(spider.items) : <span className="text-muted-foreground">不存储</span>}
                    </TableCell>
                    <TableCell>
                      <RecentRuns runs={runsBySpider.get(spider.name) ?? []} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {spider.mode === 'browser' ? '浏览器' : 'HTTP'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {spider.schedule ? (
                        <code className="whitespace-nowrap rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{spider.schedule}</code>
                      ) : (
                        <span className="text-xs text-muted-foreground">手动</span>
                      )}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <RunButton spider={spider.name} live={live} compact />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <Empty icon={<Bug />} title="还没有爬虫">
            运行 <code className="font-mono">loom new hacker-news</code> 创建第一个，保存后这里会自动刷新。
          </Empty>
        )}
      </Card>
    </div>
  );
}
