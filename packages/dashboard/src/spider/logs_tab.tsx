/**
 * @fileoverview Live logs with level filter, search, follow/pause, clear
 * and download.
 */

import type {ReactElement} from 'react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {Download, Eraser, Pause, Play, ScrollText, Search} from 'lucide-react';

import {Empty} from '@/components/empty';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Tabs, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {count, dateTime, levelLabel} from '@/format';
import {cn} from '@/lib/utils';
import type {LogLine} from '@/types';

type Filter = 'all' | LogLine['level'];

const FILTERS: ReadonlyArray<[Filter, string]> = [
  ['all', '全部'],
  ['info', '信息'],
  ['warn', '警告'],
  ['error', '错误'],
];

const LEVEL_STYLE: Readonly<Record<LogLine['level'], string>> = {
  debug: 'text-muted-foreground',
  info: 'text-sky-600 dark:text-sky-400',
  warn: 'text-warning',
  error: 'text-destructive',
};

interface LogsTabProps {
  readonly spider: string;
  readonly lines: readonly LogLine[];
}

/** The logs tab. */
export function LogsTab({spider, lines}: LogsTabProps): ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [clearedAt, setClearedAt] = useState(0);

  const kept = useMemo(() => lines.slice(Math.min(clearedAt, lines.length)), [lines, clearedAt]);
  const tally = useMemo(() => {
    const result: Record<Filter, number> = {all: kept.length, debug: 0, info: 0, warn: 0, error: 0};
    for (const line of kept) result[line.level]++;
    return result;
  }, [kept]);
  const needle = search.trim().toLowerCase();
  const shown = kept.filter(
    line => (filter === 'all' || line.level === filter) && (!needle || line.message.toLowerCase().includes(needle))
  );

  useEffect(() => {
    const element = container.current;
    if (element && follow) element.scrollTop = element.scrollHeight;
  }, [shown.length, follow]);

  const download = () => {
    const text = kept
      .map(line => `${dateTime(line.time)} ${line.level.toUpperCase().padEnd(5)} ${line.message}`)
      .join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([`${text}\n`], {type: 'text/plain;charset=utf-8'}));
    link.download = `${spider}-${dateTime(new Date()).replace(/[: ]/g, '-')}.log`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 p-4">
        <Tabs value={filter} onValueChange={value => setFilter(value as Filter)}>
          <TabsList>
            {FILTERS.map(([id, label]) => (
              <TabsTrigger key={id} value={id}>
                {label}
                <span
                  className={cn(
                    'text-xs tabular-nums text-muted-foreground',
                    id === 'warn' && tally.warn && 'text-warning',
                    id === 'error' && tally.error && 'text-destructive'
                  )}
                >
                  {count(tally[id])}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:w-60">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="筛选日志…"
            value={search}
            onChange={event => setSearch(event.target.value)}
            className="pl-8"
            aria-label="筛选日志"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setFollow(value => !value)} aria-pressed={follow}>
            {follow ? <Pause /> : <Play />}
            {follow ? '暂停滚动' : '跟随最新'}
          </Button>
          <Button variant="outline" size="sm" disabled={!kept.length} onClick={download}>
            <Download />
            下载
          </Button>
          <Button variant="outline" size="sm" disabled={!kept.length} onClick={() => setClearedAt(lines.length)}>
            <Eraser />
            清屏
          </Button>
        </div>
      </div>

      {!kept.length ? (
        <Empty icon={<ScrollText />} title="还没有日志" className="border-t">
          打开这个页面之后产生的日志会实时显示在这里，最多保留最近 400 行。
        </Empty>
      ) : (
        <div
          ref={container}
          role="log"
          aria-live="polite"
          tabIndex={0}
          onWheel={event => {
            if (event.deltaY < 0 && follow) setFollow(false);
          }}
          className="h-[min(560px,calc(100svh-320px))] min-h-64 overflow-y-auto border-t bg-muted/30 py-2 font-mono text-xs leading-6"
        >
          {shown.map((line, index) => (
            <div
              key={`${line.time}-${index}`}
              className={cn(
                'grid grid-cols-[auto_2.5rem_1fr] gap-4 px-4 hover:bg-muted',
                line.level === 'error' && 'bg-destructive/5'
              )}
            >
              <time dateTime={line.time} className="whitespace-nowrap text-muted-foreground">
                {dateTime(line.time)}
              </time>
              <span className={cn('font-sans font-medium', LEVEL_STYLE[line.level])}>{levelLabel(line.level)}</span>
              <span className={cn('whitespace-pre-wrap break-all', line.level === 'error' && 'text-destructive')}>
                {line.message}
              </span>
            </div>
          ))}
          {!shown.length && <p className="px-4 py-6 font-sans text-sm text-muted-foreground">没有符合条件的日志。</p>}
        </div>
      )}
    </div>
  );
}
