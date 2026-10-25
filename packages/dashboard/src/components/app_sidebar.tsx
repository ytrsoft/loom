/**
 * @fileoverview The sidebar: brand, search, pages and every spider with
 * its state.
 */

import type {ReactElement} from 'react';
import {Activity, History, LayoutDashboard, Search} from 'lucide-react';

import {StatusDot} from '@/components/status';
import {Kbd} from '@/components/ui/kbd';
import {count} from '@/format';
import type {LiveState} from '@/hooks/live';
import {href, spiderHref, type Route} from '@/lib/routes';
import {cn} from '@/lib/utils';
import type {SpiderInfo} from '@/types';

interface AppSidebarProps {
  readonly spiders: readonly SpiderInfo[];
  readonly route: Route;
  readonly live: LiveState;
  onSearch(): void;
}

function NavLink({
  to,
  active,
  icon: Icon,
  children,
  trailing,
}: {
  to: string;
  active: boolean;
  icon: typeof Activity;
  children: string;
  trailing?: ReactElement | string | null;
}): ReactElement {
  return (
    <a
      href={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        active && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
      )}
    >
      <Icon className="size-4 shrink-0 opacity-70" />
      <span className="flex-1 truncate">{children}</span>
      {trailing}
    </a>
  );
}

/** Left navigation. */
export function AppSidebar({spiders, route, live, onSearch}: AppSidebarProps): ReactElement {
  const runningCount = spiders.filter(spider => live.runs[spider.name]?.status === 'running').length;
  return (
    <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <svg viewBox="0 0 16 16" className="size-4" fill="none" strokeWidth="1.5" strokeLinecap="round">
            <path d="M5 2.5v11M8 2.5v11M11 2.5v11" stroke="currentColor" strokeOpacity="0.55" />
            <path d="M2.5 6h11M2.5 10h11" stroke="currentColor" />
          </svg>
        </div>
        <div className="grid leading-tight">
          <span className="text-sm font-semibold text-foreground">Loom</span>
          <span className="text-xs text-muted-foreground">爬虫控制台</span>
        </div>
      </div>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={onSearch}
          className="flex h-8 w-full items-center gap-2 rounded-md border bg-background px-2.5 text-sm text-muted-foreground shadow-sm transition-colors hover:bg-accent"
        >
          <Search className="size-4" />
          <span className="flex-1 text-left">搜索…</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>

      <nav className="grid gap-0.5 px-3 py-2">
        <NavLink to={href({page: 'overview'})} active={route.page === 'overview'} icon={LayoutDashboard}>
          总览
        </NavLink>
        <NavLink to={href({page: 'runs'})} active={route.page === 'runs'} icon={History}>
          运行记录
        </NavLink>
      </nav>

      <div className="flex items-center justify-between px-5 pb-1 pt-4 text-xs font-medium text-muted-foreground">
        <span>爬虫</span>
        <span>{spiders.length}</span>
      </div>
      <nav className="grid flex-1 content-start gap-0.5 overflow-y-auto px-3 pb-3" aria-label="爬虫">
        {spiders.map(spider => {
          const liveRun = live.runs[spider.name];
          const status = liveRun?.status === 'running' ? 'running' : spider.lastRun?.status;
          const active = route.page === 'spider' && route.name === spider.name;
          return (
            <a
              key={spider.name}
              href={spiderHref(spider.name)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                active && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
              )}
            >
              <StatusDot status={status} />
              <span className="flex-1 truncate">{spider.name}</span>
              {spider.table && (
                <span className="text-xs tabular-nums text-muted-foreground">{count(spider.items)}</span>
              )}
            </a>
          );
        })}
        {!spiders.length && (
          <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">
            在 <code className="font-mono">src/spiders/</code> 中导出一个 spider，它会自动出现在这里。
          </p>
        )}
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <span
            className={cn(
              'size-2 rounded-full',
              live.connected ? 'bg-success shadow-[0_0_0_3px_hsl(var(--success)/0.2)]' : 'bg-destructive'
            )}
          />
          <span className="flex-1">
            {live.connected ? '实时连接正常' : '正在重新连接…'}
          </span>
          {runningCount > 0 && (
            <span className="flex items-center gap-1 text-warning">
              <Activity className="size-3.5" />
              {runningCount} 运行中
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
