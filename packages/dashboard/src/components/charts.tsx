/**
 * @fileoverview Small dependency-free SVG charts in the shadcn chart style:
 * a sparkline and a bar chart with hover tooltip.
 */

import type {ReactElement} from 'react';
import {useState} from 'react';

import {cn} from '@/lib/utils';

/** Line + area sparkline for stat cards. */
export function Sparkline({values, className}: {values: readonly number[]; className?: string}): ReactElement {
  const width = 120;
  const height = 36;
  if (values.length < 2) {
    return <svg viewBox={`0 0 ${width} ${height}`} className={cn('h-9 w-28', className)} aria-hidden="true" />;
  }
  const peak = Math.max(1, ...values);
  const step = width / (values.length - 1);
  const points = values.map((value, index) => [index * step, height - 3 - (value / peak) * (height - 6)] as const);
  const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn('h-9 w-28 overflow-visible', className)} aria-hidden="true">
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity="0.25" />
          <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${width},${height} L0,${height} Z`} fill="url(#spark-fill)" />
      <path d={line} fill="none" stroke="hsl(var(--chart-1))" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** One bar of {@link BarChart}. */
export interface Bar {
  readonly key: string;
  readonly label: string;
  /** Short label under the axis; defaults to the label. */
  readonly tick?: string;
  /** Main value (drawn in the primary colour). */
  readonly value: number;
  /** Part of the bar to draw in red, e.g. failures. */
  readonly bad?: number;
  /** Lines shown in the tooltip. */
  readonly details?: readonly string[];
  /** Marks the bar as failed, drawing it in red. */
  readonly failed?: boolean;
  onClick?(): void;
}

interface BarChartProps {
  readonly bars: readonly Bar[];
  readonly height?: number;
  /** Labels to print under the axis: every `labelEvery`-th bar. */
  readonly labelEvery?: number;
  readonly empty?: string;
  readonly className?: string;
}

/** Vertical bar chart with gridlines and a tooltip. */
export function BarChart({bars, height = 180, labelEvery = 1, empty = '暂无数据', className}: BarChartProps): ReactElement {
  const [hover, setHover] = useState<number | null>(null);
  const peak = Math.max(0, ...bars.map(bar => bar.value + (bar.bad ?? 0)));
  const top = niceCeiling(peak);
  const ticks = [0, top / 2, top];
  const hovered = hover === null ? undefined : bars[hover];

  return (
    <div className={cn('relative', className)}>
      <div className="flex gap-2" style={{height}}>
        <div className="flex flex-col justify-between py-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {[...ticks].reverse().map(tick => (
            <span key={tick} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {compact(tick)}
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          {ticks.map(tick => (
            <div
              key={tick}
              className="absolute inset-x-0 border-t border-dashed border-border"
              style={{bottom: `${top ? (tick / top) * 100 : 0}%`}}
            />
          ))}
          {!peak && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{empty}</div>
          )}
          <div className="absolute inset-0 flex items-end gap-[3px]" onMouseLeave={() => setHover(null)}>
            {bars.map((bar, index) => {
              const total = bar.value + (bar.bad ?? 0);
              const ratio = top ? total / top : 0;
              return (
                <button
                  type="button"
                  key={bar.key}
                  className="group flex h-full flex-1 cursor-default flex-col justify-end outline-none"
                  onMouseEnter={() => setHover(index)}
                  onFocus={() => setHover(index)}
                  onClick={bar.onClick}
                  aria-label={`${bar.label}：${bar.details?.join('，') ?? bar.value}`}
                  style={bar.onClick ? {cursor: 'pointer'} : undefined}
                >
                  <div
                    className={cn(
                      'flex w-full flex-col overflow-hidden rounded-t-[3px] transition-opacity',
                      hover !== null && hover !== index && 'opacity-50'
                    )}
                    style={{height: `${Math.max(total ? 2 : 0, ratio * 100)}%`}}
                  >
                    {!!bar.bad && <div className="bg-chart-3" style={{flex: bar.bad}} />}
                    <div className={bar.failed ? 'bg-chart-3' : 'bg-chart-1'} style={{flex: bar.value}} />
                  </div>
                </button>
              );
            })}
          </div>
          {hovered && hover !== null && (
            <div
              className="pointer-events-none absolute bottom-full z-10 mb-2 min-w-36 -translate-x-1/2 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
              style={{left: `${((hover + 0.5) / bars.length) * 100}%`}}
            >
              <div className="mb-1 font-medium">{hovered.label}</div>
              {(hovered.details ?? [String(hovered.value)]).map(line => (
                <div key={line} className="text-muted-foreground">
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="ml-8 mt-2 flex gap-[3px] text-[11px] tabular-nums text-muted-foreground">
        {bars.map((bar, index) => (
          <span key={bar.key} className="flex-1 overflow-visible whitespace-nowrap text-center">
            {index % labelEvery === 0 ? (bar.tick ?? bar.label) : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function niceCeiling(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find(factor => factor * magnitude >= value) ?? 10;
  return step * magnitude;
}

function compact(value: number): string {
  if (value >= 10_000) return `${+(value / 10_000).toFixed(1)}万`;
  return String(+value.toFixed(1));
}
