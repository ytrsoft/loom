/**
 * @fileoverview Every field of one item in a side sheet.
 */

import type {ReactElement} from 'react';
import {useEffect} from 'react';
import {ChevronDown, ChevronUp, Copy, ExternalLink} from 'lucide-react';
import {toast} from 'sonner';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from '@/components/ui/sheet';
import {dateTime, isIsoDate} from '@/format';
import type {ColumnInfo} from '@/types';
import {FullValue, columnLabel} from './value';

interface ItemSheetProps {
  readonly item: Readonly<Record<string, unknown>> | undefined;
  readonly columns: readonly ColumnInfo[];
  readonly position: string;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  onPrevious(): void;
  onNext(): void;
  onClose(): void;
}

/** JSON of an item with dates in local `YYYY-MM-DD HH:mm:ss`. */
function itemJson(item: Readonly<Record<string, unknown>>, columns: readonly ColumnInfo[]): string {
  const dates = new Set(columns.filter(column => column.kind === 'date').map(column => column.name));
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(item).map(([key, value]) => [
        key,
        value !== null && (dates.has(key) || isIsoDate(value)) ? dateTime(String(value)) : value,
      ])
    ),
    null,
    2
  );
}

/** Detail sheet; ↑/↓ or j/k move between rows. */
export function ItemSheet(props: ItemSheetProps): ReactElement {
  const {item, columns, position, hasPrevious, hasNext, onPrevious, onNext, onClose} = props;
  const url = typeof item?.['_url'] === 'string' ? item['_url'] : undefined;
  // The first non-empty plain-text field makes a good title (e.g. a book title).
  const titleColumn = columns.find(column => {
    const value = item?.[column.name];
    return (
      column.kind === 'string' &&
      !column.name.startsWith('_') &&
      typeof value === 'string' &&
      value !== '' &&
      !/^https?:\/\//.test(value)
    );
  });
  const title = titleColumn && item ? String(item[titleColumn.name]) : '';

  useEffect(() => {
    if (!item) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === 'ArrowDown' || event.key === 'j') && hasNext) onNext();
      else if ((event.key === 'ArrowUp' || event.key === 'k') && hasPrevious) onPrevious();
      else return;
      event.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [item, hasNext, hasPrevious, onNext, onPrevious]);

  return (
    <Sheet open={!!item} onOpenChange={open => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="space-y-1 border-b px-6 py-4 pr-12">
          <SheetDescription>{position}</SheetDescription>
          <SheetTitle className="line-clamp-2 text-base">{title || '数据详情'}</SheetTitle>
        </SheetHeader>
        {item && (
          <dl className="flex-1 divide-y overflow-y-auto px-6">
            {columns.map(column => (
              <div key={column.name} className="grid gap-1.5 py-3.5 sm:grid-cols-[9rem_1fr] sm:gap-4">
                <dt className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="truncate">{columnLabel(column.name)}</span>
                  <Badge variant="outline" className="px-1 py-0 font-mono text-[10px] font-normal">
                    {column.kind}
                  </Badge>
                </dt>
                <dd className="min-w-0 text-sm">
                  <FullValue value={item[column.name]} column={column} />
                </dd>
              </div>
            ))}
          </dl>
        )}
        <div className="flex items-center gap-2 border-t px-6 py-3">
          <Button variant="outline" size="icon-sm" disabled={!hasPrevious} onClick={onPrevious} aria-label="上一条">
            <ChevronUp />
          </Button>
          <Button variant="outline" size="icon-sm" disabled={!hasNext} onClick={onNext} aria-label="下一条">
            <ChevronDown />
          </Button>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!item) return;
                void navigator.clipboard.writeText(itemJson(item, columns)).then(() => toast.success('已复制 JSON'));
              }}
            >
              <Copy />
              复制 JSON
            </Button>
            {url && (
              <Button size="sm" asChild>
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  打开来源
                </a>
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
