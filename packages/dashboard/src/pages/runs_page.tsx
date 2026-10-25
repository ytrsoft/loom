/**
 * @fileoverview Every run of every spider, filterable by spider and status.
 */

import type {ReactElement} from 'react';
import {useState} from 'react';
import {History} from 'lucide-react';

import {Empty} from '@/components/empty';
import {RunsTable} from '@/components/runs_table';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {count, statusLabel} from '@/format';
import type {Run, SpiderInfo} from '@/types';

const PAGE = 50;

interface RunsPageProps {
  readonly spiders: readonly SpiderInfo[];
  readonly runs: readonly Run[];
}

/** The runs page. */
export function RunsPage({spiders, runs}: RunsPageProps): ReactElement {
  const [spider, setSpider] = useState('all');
  const [status, setStatus] = useState('all');
  const [shown, setShown] = useState(PAGE);
  const filtered = runs.filter(
    run => (spider === 'all' || run.spider === spider) && (status === 'all' || run.status === status)
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">运行记录</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          最近 {count(runs.length)} 次运行，包括控制台、命令行和定时任务触发的。点击一行查看详情。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={spider}
          onValueChange={value => {
            setSpider(value);
            setShown(PAGE);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部爬虫</SelectItem>
            {spiders.map(item => (
              <SelectItem key={item.name} value={item.name}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={value => {
            setStatus(value);
            setShown(PAGE);
          }}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {(['running', 'succeeded', 'failed', 'stopped'] as const).map(value => (
              <SelectItem key={value} value={value}>
                {statusLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-sm text-muted-foreground">{count(filtered.length)} 次</span>
      </div>

      <Card className="overflow-hidden">
        {filtered.length ? (
          <RunsTable runs={filtered.slice(0, shown)} showSpider />
        ) : (
          <Empty icon={<History />} title={runs.length ? '没有符合条件的运行' : '还没有运行记录'}>
            {runs.length ? '换个爬虫或状态试试。' : '运行任意一个爬虫后，记录会出现在这里。'}
          </Empty>
        )}
      </Card>
      {filtered.length > shown && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setShown(value => value + PAGE)}>
            显示更多
          </Button>
        </div>
      )}
    </div>
  );
}
