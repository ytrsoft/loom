/**
 * @fileoverview ⌘K: jump to any page or spider, or start a spider.
 */

import type {ReactElement} from 'react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {Bug, CornerDownLeft, History, LayoutDashboard, Play, Search} from 'lucide-react';

import {StatusDot} from '@/components/status';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog';
import {Kbd} from '@/components/ui/kbd';
import {api} from '@/api';
import type {LiveState} from '@/hooks/live';
import {navigate, type Route} from '@/lib/routes';
import {cn} from '@/lib/utils';
import type {SpiderInfo} from '@/types';
import {toast} from 'sonner';

interface CommandMenuProps {
  readonly open: boolean;
  readonly spiders: readonly SpiderInfo[];
  readonly live: LiveState;
  onOpenChange(open: boolean): void;
}

interface Command {
  readonly id: string;
  readonly group: string;
  readonly label: string;
  readonly hint?: string;
  readonly icon: ReactElement;
  run(): void;
}

/** The command palette. */
export function CommandMenu({open, spiders, live, onOpenChange}: CommandMenuProps): ReactElement {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (route: Route) => () => navigate(route);
    const all: Command[] = [
      {id: 'overview', group: '页面', label: '总览', icon: <LayoutDashboard />, run: go({page: 'overview'})},
      {id: 'runs', group: '页面', label: '运行记录', icon: <History />, run: go({page: 'runs'})},
    ];
    for (const spider of spiders) {
      const running = live.runs[spider.name]?.status === 'running';
      all.push({
        id: `open:${spider.name}`,
        group: '爬虫',
        label: spider.name,
        hint: spider.description ?? undefined,
        icon: <StatusDot status={running ? 'running' : spider.lastRun?.status} className="mx-1" />,
        run: go({page: 'spider', name: spider.name}),
      });
    }
    for (const spider of spiders) {
      if (live.runs[spider.name]?.status === 'running') continue;
      all.push({
        id: `start:${spider.name}`,
        group: '操作',
        label: `运行 ${spider.name}`,
        icon: <Play />,
        run: () => {
          api.startRun(spider.name).then(
            () => toast.success(`已开始运行 ${spider.name}`),
            (error: unknown) => toast.error(`无法运行 ${spider.name}`, {description: String(error)})
          );
        },
      });
    }
    const needle = query.trim().toLowerCase();
    return needle
      ? all.filter(command => `${command.label} ${command.hint ?? ''}`.toLowerCase().includes(needle))
      : all;
  }, [spiders, live.runs, query]);

  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({block: 'nearest'});
  }, [active]);

  const choose = (command: Command | undefined) => {
    if (!command) return;
    onOpenChange(false);
    command.run();
  };

  let lastGroup = '';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="top-[20%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">搜索</DialogTitle>
        <DialogDescription className="sr-only">输入页面或爬虫名称，回车打开</DialogDescription>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={event => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') setActive(index => Math.min(commands.length - 1, index + 1));
              else if (event.key === 'ArrowUp') setActive(index => Math.max(0, index - 1));
              else if (event.key === 'Enter') choose(commands[active]);
              else return;
              event.preventDefault();
            }}
            placeholder="搜索页面、爬虫或操作…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div ref={list} className="max-h-80 overflow-y-auto p-1.5" role="listbox">
          {!commands.length && <p className="py-8 text-center text-sm text-muted-foreground">没有找到结果。</p>}
          {commands.map((command, index) => {
            const header = command.group !== lastGroup ? command.group : null;
            lastGroup = command.group;
            return (
              <div key={command.id}>
                {header && <div className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">{header}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  data-active={index === active}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(command)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground',
                    index === active && 'bg-accent text-accent-foreground'
                  )}
                >
                  {command.icon}
                  <span className="shrink-0">{command.label}</span>
                  {command.hint && <span className="truncate text-xs text-muted-foreground">{command.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            选择
          </span>
          <span className="flex items-center gap-1">
            <Kbd>
              <CornerDownLeft className="size-3" />
            </Kbd>
            打开
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Bug className="size-3.5" />
            {spiders.length} 个爬虫
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
