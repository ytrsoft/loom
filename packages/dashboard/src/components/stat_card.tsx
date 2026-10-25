/**
 * @fileoverview KPI card: label, big number, a note and an optional trend.
 */

import type {ReactElement, ReactNode} from 'react';

import {Sparkline} from '@/components/charts';
import {Card} from '@/components/ui/card';
import {cn} from '@/lib/utils';

interface StatCardProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly unit?: string;
  readonly note?: ReactNode;
  readonly icon?: ReactElement;
  readonly trend?: readonly number[];
  readonly tone?: 'default' | 'bad' | 'warn' | 'live';
}

/** One statistic. */
export function StatCard({label, value, unit, note, icon, trend, tone = 'default'}: StatCardProps): ReactElement {
  return (
    <Card className="flex flex-col justify-between gap-3 p-5">
      <div className="flex items-center justify-between text-sm text-muted-foreground [&_svg]:size-4">
        <span>{label}</span>
        {icon}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div
            className={cn(
              'whitespace-nowrap text-2xl font-semibold tabular-nums tracking-tight',
              tone === 'bad' && 'text-destructive',
              tone === 'warn' && 'text-warning',
              tone === 'live' && 'text-primary'
            )}
          >
            {value}
            {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
          </div>
          {note && <div className="mt-1 truncate text-xs text-muted-foreground">{note}</div>}
        </div>
        {trend && <Sparkline values={trend} className="h-8 w-20 shrink-0" />}
      </div>
    </Card>
  );
}
