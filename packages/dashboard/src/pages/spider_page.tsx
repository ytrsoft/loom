/**
 * @fileoverview One spider: header with run controls, KPIs, live activity
 * or run history, and tabs for data, logs, runs and configuration.
 */

import type {ReactElement} from 'react';
import {useState} from 'react';
import {
  AlertTriangle,
  Clock,
  Database,
  Download,
  Gauge,
  Globe,
  History,
  KeyRound,
  MonitorPlay,
  MoreHorizontal,
  Send,
  Table2,
  Timer,
} from 'lucide-react';
import {toast} from 'sonner';

import {api} from '@/api';
import {BarChart, type Bar} from '@/components/charts';
import {RunsTable} from '@/components/runs_table';
import {StatCard} from '@/components/stat_card';
import {StatusBadge} from '@/components/status';
import {Weave} from '@/components/weave';
import {Empty} from '@/components/empty';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {count, dateTime, duration, percent, statusLabel, triggerLabel} from '@/format';
import type {LiveState} from '@/hooks/live';
import {useRunAction} from '@/hooks/run_action';
import {useResource} from '@/hooks/use_resource';
import {href} from '@/lib/routes';
import {ConfigTab} from '@/spider/config_tab';
import {ItemsTab} from '@/spider/items_tab';
import {LogsTab} from '@/spider/logs_tab';
import {RunButton} from '@/spider/run_button';
import type {Run, SpiderInfo} from '@/types';

interface SpiderPageProps {
  readonly spider: SpiderInfo;
  readonly live: LiveState;
  /** Recent runs, newest first. */
  readonly runs: readonly Run[];
}

function MetaItem({icon: Icon, children}: {icon: typeof Clock; children: ReactElement | string}): ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="size-3.5" />
      {children}
    </span>
  );
}

/** The spider page. */
export function SpiderPage({spider, live, runs}: SpiderPageProps): ReactElement {
  const [tab, setTab] = useState('items');
  const {running} = useRunAction(spider.name, live);
  const run = live.runs[spider.name];
  const latest = spider.lastRun;
  const stats = run?.stats ?? latest?.stats ?? null;
  const status = running ? 'running' : (run?.status ?? latest?.status);
  const version = live.itemsVersion[spider.name] ?? 0;
  const logs = live.logs[spider.name] ?? [];
  const history = useResource(() => api.runs(spider.name, 50), `${spider.name}:${live.listVersion}`);
  const failRate = stats ? stats.failed / Math.max(1, stats.requests) : 0;
  const pastRuns = runs.slice(0, 30).reverse();

  const bars: Bar[] = pastRuns.map(item => ({
    key: item.id,
    label: dateTime(item.startedAt),
    tick: dateTime(item.startedAt).slice(5, 16),
    value: item.stats?.items ?? 0,
    failed: item.status === 'failed',
    details: [
      statusLabel(item.status),
      `${count(item.stats?.items)} 条数据`,
      `${count(item.stats?.failed)} 个失败请求`,
      `用时 ${duration(item.stats?.durationMs)}`,
    ],
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{spider.name}</h1>
            <StatusBadge status={status} />
          </div>
          {spider.description && <p className="max-w-3xl text-sm text-muted-foreground">{spider.description}</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <MetaItem icon={spider.mode === 'browser' ? MonitorPlay : Globe}>
              {spider.mode === 'browser' ? '浏览器渲染' : 'HTTP 请求'}
            </MetaItem>
            <MetaItem icon={Table2}>{spider.table ? `表 ${spider.table}` : '不存储'}</MetaItem>
            {spider.unique.length > 0 && <MetaItem icon={KeyRound}>{`按 ${spider.unique.join(' + ')} 去重`}</MetaItem>}
            <MetaItem icon={Clock}>{spider.schedule ? `定时 ${spider.schedule}` : '手动运行'}</MetaItem>
            {latest && (
              <MetaItem icon={History}>
                {`上次 ${dateTime(latest.startedAt)}，${triggerLabel(latest.trigger)}触发`}
              </MetaItem>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="更多操作">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>导出数据</DropdownMenuLabel>
              {(['csv', 'json', 'ndjson'] as const).map(format => (
                <DropdownMenuItem key={format} asChild disabled={!spider.items}>
                  <a href={api.exportUrl(spider.name, format)} download>
                    <Download />
                    {format.toUpperCase()}
                  </a>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  void navigator.clipboard
                    .writeText(`loom run ${spider.name}`)
                    .then(() => toast.success('已复制命令', {description: `loom run ${spider.name}`}));
                }}
              >
                <Send />
                复制命令行运行方式
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={href({page: 'runs'})}>
                  <History />
                  所有运行记录
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <RunButton spider={spider.name} live={live} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="flex flex-col justify-between gap-3 p-5">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{running ? '本次请求' : '上次请求'}</span>
            <Send className="size-4" />
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums tracking-tight">
              {count(stats?.requests)}
              <span className="ml-1 text-sm font-normal text-muted-foreground">/ {count(stats?.enqueued)}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{width: `${stats?.enqueued ? Math.min(100, (stats.requests / stats.enqueued) * 100) : 0}%`}}
              />
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">已完成 / 已入队</div>
          </div>
        </Card>
        <StatCard
          label={running ? '本次数据' : '上次数据'}
          icon={<Database />}
          value={count(stats?.items)}
          unit="条"
          note={`表中共 ${count(spider.items)} 条${stats?.dropped ? `，丢弃 ${count(stats.dropped)} 条` : ''}`}
          trend={pastRuns.map(item => item.stats?.items ?? 0)}
        />
        <StatCard
          label="失败率"
          icon={<AlertTriangle />}
          value={stats ? percent(stats.failed, stats.requests) : '—'}
          tone={failRate > 0.05 ? 'bad' : stats?.retries ? 'warn' : 'default'}
          note={`${count(stats?.failed)} 个失败，${count(stats?.retries)} 次重试`}
        />
        <StatCard
          label={running ? '已用时' : '用时'}
          icon={running ? <Timer /> : <Gauge />}
          value={duration(stats?.durationMs)}
          note={`速度 ${count(stats?.requestsPerMinute)} 次/分`}
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
          <div className="space-y-1.5">
            <CardTitle className="text-base">{running ? '实时活动' : '运行历史'}</CardTitle>
            <CardDescription>
              {running
                ? `开始于 ${run ? dateTime(new Date(run.startedAt)) : ''}，每格代表一个完成的请求，每列一秒`
                : `最近 ${pastRuns.length} 次运行保存的数据条数，红色为失败的运行`}
            </CardDescription>
          </div>
          {running && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-success" />
                成功
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-warning" />
                重试
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-destructive" />
                失败
              </span>
            </div>
          )}
        </CardHeader>
        <CardContent className="pt-4">
          {running && run ? (
            <Weave run={run} />
          ) : pastRuns.length ? (
            <BarChart bars={bars} height={140} labelEvery={Math.max(1, Math.ceil(pastRuns.length / 6))} />
          ) : (
            <Empty icon={<History />} title="还没有运行过" className="py-8">
              点右上角“开始运行”，请求会在这里实时显示。
            </Empty>
          )}
          {run?.error && !running && (
            <pre className="mt-4 whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 p-3 font-mono text-xs text-destructive">
              {run.error}
            </pre>
          )}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="items">
            数据
            {spider.items > 0 && <TabCount value={spider.items} />}
          </TabsTrigger>
          <TabsTrigger value="logs">
            日志
            {logs.length > 0 && <TabCount value={logs.length} />}
          </TabsTrigger>
          <TabsTrigger value="runs">
            运行记录
            {runs.length > 0 && <TabCount value={runs.length} />}
          </TabsTrigger>
          <TabsTrigger value="config">配置</TabsTrigger>
        </TabsList>
        <Card className="mt-3 overflow-hidden">
          <TabsContent value="items" className="mt-0">
            {spider.table ? (
              <ItemsTab spider={spider.name} version={version} running={running} />
            ) : (
              <Empty icon={<Database />} title="这个爬虫不存储数据">
                它设置了 <code className="font-mono">store: false</code>，数据只通过事件推送。
              </Empty>
            )}
          </TabsContent>
          <TabsContent value="logs" className="mt-0">
            <LogsTab spider={spider.name} lines={logs} />
          </TabsContent>
          <TabsContent value="runs" className="mt-0">
            {history.error ? (
              <p className="p-4 text-sm text-destructive">无法读取运行记录：{history.error}</p>
            ) : history.data?.length ? (
              <RunsTable runs={history.data} />
            ) : (
              <Empty icon={<History />} title="还没有运行记录">
                每次运行，无论从控制台、命令行还是定时任务触发，都会记录在这里。
              </Empty>
            )}
          </TabsContent>
          <TabsContent value="config" className="mt-0">
            <ConfigTab spider={spider} />
          </TabsContent>
        </Card>
      </Tabs>
    </div>
  );
}

function TabCount({value}: {value: number}): ReactElement {
  return (
    <Badge variant="secondary" className="h-5 rounded-full px-1.5 text-[11px] font-normal tabular-nums">
      {count(value)}
    </Badge>
  );
}
