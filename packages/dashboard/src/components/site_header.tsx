/**
 * @fileoverview Top bar: breadcrumb, mobile navigation, search and theme.
 */

import type {ReactElement} from 'react';
import {ChevronRight, Menu, Search} from 'lucide-react';

import {ThemeToggle} from '@/components/theme';
import {Button} from '@/components/ui/button';
import {href, type Route} from '@/lib/routes';

interface SiteHeaderProps {
  readonly route: Route;
  onSearch(): void;
}

const PAGE_TITLES = {overview: '总览', runs: '运行记录', spider: '爬虫'} as const;

/** Sticky header of the main column. */
export function SiteHeader({route, onSearch}: SiteHeaderProps): ReactElement {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:px-6">
      <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onSearch} aria-label="打开导航">
        <Menu />
      </Button>
      <nav aria-label="位置" className="flex min-w-0 items-center gap-1.5 text-sm">
        {route.page === 'spider' ? (
          <>
            <a href={href({page: 'overview'})} className="text-muted-foreground transition-colors hover:text-foreground">
              爬虫
            </a>
            <ChevronRight className="size-3.5 text-muted-foreground" />
            <span className="truncate font-medium">{route.name}</span>
          </>
        ) : (
          <span className="font-medium">{PAGE_TITLES[route.page]}</span>
        )}
      </nav>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" onClick={onSearch} aria-label="搜索" className="md:hidden">
          <Search />
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );
}
