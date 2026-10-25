/**
 * @fileoverview The weave: every finished request of a live run becomes one
 * cell, one column per second, stacked green / amber / red for success,
 * retry and failure. Stalls and error bursts show at a glance.
 */

import type {ReactElement} from 'react';

import type {LiveRun} from '@/hooks/live';

const COLUMNS = 120;
const ROWS = 8;
const CELL = 8;
const GAP = 2;

/** Live request heatmap. */
export function Weave({run}: {run: LiveRun}): ReactElement {
  const width = COLUMNS * CELL;
  const height = ROWS * CELL;
  const columns = run.weave.slice(-COLUMNS);
  const offset = COLUMNS - columns.length;
  const peak = Math.max(ROWS, ...columns.map(c => c.ok + c.failed + c.retried));
  const scale = peak > ROWS ? ROWS / peak : 1;

  const cells: ReactElement[] = [];
  columns.forEach((column, index) => {
    let row = 0;
    const stack: Array<[string, number]> = [
      ['fill-success', column.ok],
      ['fill-warning', column.retried],
      ['fill-destructive', column.failed],
    ];
    for (const [fill, amount] of stack) {
      const units = amount ? Math.max(1, Math.round(amount * scale)) : 0;
      for (let i = 0; i < units && row < ROWS; i++, row++) {
        cells.push(
          <rect
            key={`${index}-${row}`}
            className={fill}
            x={(offset + index) * CELL + GAP / 2}
            y={height - (row + 1) * CELL + GAP / 2}
            width={CELL - GAP}
            height={CELL - GAP}
            rx={1.5}
          />
        );
      }
    }
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-16 w-full" preserveAspectRatio="none" role="img">
      <title>每格代表一个完成的请求，每列一秒</title>
      {Array.from({length: COLUMNS}, (_, column) =>
        Array.from({length: ROWS}, (_, row) => (
          <rect
            key={`bg-${column}-${row}`}
            className="fill-muted"
            x={column * CELL + GAP / 2}
            y={row * CELL + GAP / 2}
            width={CELL - GAP}
            height={CELL - GAP}
            rx={1.5}
          />
        ))
      )}
      {cells}
    </svg>
  );
}
