/**
 * @fileoverview Application shell: sidebar, header and the routed page.
 */

import type {ReactElement} from 'react';
import {useEffect, useMemo, useState} from 'react';
import {SearchX, WifiOff} from 'lucide-react';

import {api} from './api.js';
import {AppSidebar} from '@/components/app_sidebar';
import {CommandMenu} from '@/components/command_menu';
import {Empty} from '@/components/empty';
import {SiteHeader} from '@/components/site_header';
import {Button} from '@/components/ui/button';
import {Skeleton} from '@/components/ui/skeleton';
import {useLive} from '@/hooks/live';
import {useResource} from '@/hooks/use_resource';
import {href, useRoute} from '@/lib/routes';
import {OverviewPage} from '@/pages/overview_page';
import {RunsPage} from '@/pages/runs_page';
import {SpiderPage} from '@/pages/spider_page';
import type {Run} from '@/types';

function Loading(): ReactElement {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({length: 4}, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

/** The dashboard. */
export function App(): ReactElement {
  const live = useLive();
  const route = useRoute();
  const [searchOpen, setSearchOpen] = useState(false);
  const spiders = useResource(api.spiders, String(live.listVersion));
  const runs = useResource(() => api.recentRuns(500), String(live.listVersion));

  const runsBySpider = useMemo(() => {
    const map = new Map<string, Run[]>();
    for (const run of runs.data ?? []) {
      const list = map.get(run.spider) ?? [];
      list.push(run);
      map.set(run.spider, list);
    }
    return map;
  }, [runs.data]);

  const list = spiders.data ?? [];
  const current = route.page === 'spider' ? list.find(spider => spider.name === route.name) : undefined;

  useEffect(() => {
    document.title = route.page === 'spider' ? `${route.name} · Loom` : 'Loom';
  }, [route]);

  let page: ReactElement;
  if (spiders.error) {
    page = (
      <Empty
        icon={<WifiOff />}
        title="连不上 Loom 服务器"
        action={<Button onClick={() => location.reload()}>重新连接</Button>}
        className="py-24"
      >
        {spiders.error}。确认 <code className="font-mono">loom dev</code> 或{' '}
        <code className="font-mono">loom start</code> 正在运行。
      </Empty>
    );
  } else if (!spiders.data) {
    page = <Loading />;
  } else if (route.page === 'runs') {
    page = <RunsPage spiders={list} runs={runs.data ?? []} />;
  } else if (route.page === 'spider') {
    page = current ? (
      <SpiderPage key={current.name} spider={current} live={live} runs={runsBySpider.get(current.name) ?? []} />
    ) : (
      <Empty
        icon={<SearchX />}
        title={`找不到爬虫 ${route.name}`}
        action={
          <Button variant="outline" asChild>
            <a href={href({page: 'overview'})}>回到总览</a>
          </Button>
        }
        className="py-24"
      >
        它可能已被删除或改名。
      </Empty>
    );
  } else {
    page = <OverviewPage spiders={list} runs={runs.data ?? []} runsBySpider={runsBySpider} live={live} />;
  }

  return (
    <div className="flex min-h-svh bg-muted/30">
      <AppSidebar spiders={list} route={route} live={live} onSearch={() => setSearchOpen(true)} />
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <SiteHeader route={route} onSearch={() => setSearchOpen(true)} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8 md:py-8">{page}</main>
      </div>
      <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} spiders={list} live={live} />
    </div>
  );
}
