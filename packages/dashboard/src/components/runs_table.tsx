/**
 * @fileoverview Runs as a table; rows expand to show the run id, end time,
 * counters and error. Used by the runs page and a spider's history tab.
 */

import type {ReactElement} from 'react';
import {Fragment, useState} from 'react';
import {ChevronRight, Copy} from 'lucide-react';
import {toast} from 'sonner';

import {StatusBadge} from '@/components/status';
import {Button} from '@/components/ui/button';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {count, dateTime, duration, percent, triggerLabel} from '@/format';
import {spiderHref} from '@/lib/routes';
import {cn} from '@/lib/utils';
import type {Run} from '@/types';

interface RunsTableProps {
  readonly runs: readonly Run[];
  readonly showSpider?: boolean;
}

/** Expandable table of runs. */
export function RunsTable({runs, showSpider = false}: RunsTableProps): ReactElement {
  const [open, setOpen] = useState<string | null>(null);
  const columns = showSpider ? 10 : 9;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-8" />
          {showSpider && <TableHead>爬虫</TableHead>}
          <TableHead>开始时间</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>触发</TableHead>
          <TableHead className="text-right">请求</TableHead>
          <TableHead className="text-right">数据</TableHead>
          <TableHead className="text-right">失败</TableHead>
          <TableHead className="text-right">成功率</TableHead>
          <TableHead className="text-right">用时</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map(run => {
          const expanded = open === run.id;
          const stats = run.stats;
          return (
            <Fragment key={run.id}>
              <TableRow
                className="cursor-pointer"
                data-state={expanded ? 'selected' : undefined}
                tabIndex={0}
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : run.id)}
                onKeyDown={event => {
                  if (event.key === 'Enter') setOpen(expanded ? null : run.id);
                }}
              >
                <TableCell className="pr-0 text-muted-foreground">
                  <ChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} />
                </TableCell>
                {showSpider && (
                  <TableCell>
                    <a
                      href={spiderHref(run.spider)}
                      className="font-medium hover:underline"
                      onClick={event => event.stopPropagation()}
                    >
                      {run.spider}
                    </a>
                  </TableCell>
                )}
                <TableCell className="whitespace-nowrap tabular-nums">{dateTime(run.startedAt)}</TableCell>
                <TableCell>
                  <StatusBadge status={run.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">{triggerLabel(run.trigger)}</TableCell>
                <TableCell className="text-right tabular-nums">{count(stats?.requests)}</TableCell>
                <TableCell className="text-right tabular-nums">{count(stats?.items)}</TableCell>
                <TableCell className={cn('text-right tabular-nums', stats?.failed && 'font-medium text-destructive')}>
                  {count(stats?.failed)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {stats ? percent(stats.succeeded, stats.succeeded + stats.failed) : '—'}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{duration(stats?.durationMs)}</TableCell>
              </TableRow>
              {expanded && (
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={columns} className="px-6 py-4">
                    <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
                      <div>
                        <dt className="text-xs text-muted-foreground">运行 ID</dt>
                        <dd className="mt-0.5 flex items-center gap-1 font-mono text-xs">
                          <span className="truncate">{run.id}</span>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="size-6"
                            aria-label="复制运行 ID"
                            onClick={() => {
                              void navigator.clipboard.writeText(run.id).then(() => toast.success('已复制运行 ID'));
                            }}
                          >
                            <Copy className="size-3" />
                          </Button>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">结束时间</dt>
                        <dd className="mt-0.5 tabular-nums">{run.endedAt ? dateTime(run.endedAt) : '仍在运行'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">入队 / 重试 / 丢弃</dt>
                        <dd className="mt-0.5 tabular-nums">
                          {count(stats?.enqueued)} / {count(stats?.retries)} / {count(stats?.dropped)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">速度</dt>
                        <dd className="mt-0.5 tabular-nums">{count(stats?.requestsPerMinute)} 次/分</dd>
                      </div>
                    </dl>
                    {run.error && (
                      <pre className="mt-4 whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 p-3 font-mono text-xs text-destructive">
                        {run.error}
                      </pre>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
