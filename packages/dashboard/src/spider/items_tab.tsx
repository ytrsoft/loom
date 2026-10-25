/**
 * @fileoverview Stored items: search, sort, column visibility, export,
 * clearing, paging and a detail sheet per row.
 */

import type {ReactElement} from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Database,
  Download,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react';
import {toast} from 'sonner';

import {api, type ExportFormat} from '@/api';
import {Empty} from '@/components/empty';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {Button, buttonVariants} from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
import {Kbd} from '@/components/ui/kbd';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Skeleton} from '@/components/ui/skeleton';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {count} from '@/format';
import {useResource} from '@/hooks/use_resource';
import {cn} from '@/lib/utils';
import {ItemSheet} from './item_sheet';
import {CellValue, columnLabel, isNumeric} from './value';

const PAGE_SIZES = ['20', '50', '100', '200'];
const ALWAYS_HIDDEN = new Set(['_runId']);
const HIDDEN_BY_DEFAULT = ['_id', '_updatedAt'];

const EXPORTS: ReadonlyArray<[ExportFormat, string, string]> = [
  ['csv', 'CSV', '用 Excel 或 Numbers 打开'],
  ['json', 'JSON', '一个数组，适合脚本读取'],
  ['ndjson', 'NDJSON', '每行一条，适合大数据量'],
];

interface ItemsTabProps {
  readonly spider: string;
  readonly version: number;
  readonly running: boolean;
}

function storedHidden(spider: string): Set<string> {
  try {
    const raw = localStorage.getItem(`loom.hidden.${spider}`);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // Use the defaults.
  }
  return new Set(HIDDEN_BY_DEFAULT);
}

/** The data tab. */
export function ItemsTab({spider, version, running}: ItemsTabProps): ReactElement {
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [order, setOrder] = useState('-_id');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState(() => storedHidden(spider));
  const [open, setOpen] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const searchBox = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(0);
      setQuery(search.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    try {
      localStorage.setItem(`loom.hidden.${spider}`, JSON.stringify([...hidden]));
    } catch {
      // Lasts for this page only.
    }
  }, [hidden, spider]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || target?.closest('input, textarea, [contenteditable]')) return;
      event.preventDefault();
      searchBox.current?.focus();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const page = useResource(
    () => api.items(spider, {limit: pageSize, offset, order, ...(query ? {q: query} : {})}),
    `${spider}:${offset}:${pageSize}:${order}:${query}:${version}`
  );
  const allColumns = (page.data?.columns ?? []).filter(column => !ALWAYS_HIDDEN.has(column.name));
  const columns = allColumns.filter(column => !hidden.has(column.name));
  const items = page.data?.items ?? [];
  const total = page.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.floor(offset / pageSize) + 1;

  const sortBy = (name: string) => setOrder(value => (value === `-${name}` ? name : `-${name}`));

  const clear = async () => {
    try {
      await api.clearItems(spider);
      toast.success(`已删除 ${spider} 的全部数据`);
      setOffset(0);
      page.reload();
    } catch (reason) {
      toast.error('删除失败', {description: reason instanceof Error ? reason.message : String(reason)});
    }
  };

  const closeSheet = useCallback(() => setOpen(null), []);
  const previous = useCallback(() => setOpen(index => (index === null ? index : Math.max(0, index - 1))), []);
  const next = useCallback(
    () => setOpen(index => (index === null ? index : Math.min(items.length - 1, index + 1))),
    [items.length]
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 p-4">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchBox}
            type="search"
            placeholder="搜索文本字段…"
            value={search}
            onChange={event => setSearch(event.target.value)}
            className="pl-8 pr-10"
            aria-label="搜索数据"
          />
          {!search && <Kbd className="absolute right-2 top-1/2 -translate-y-1/2">/</Kbd>}
        </div>
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {query ? `找到 ${count(total)} 条` : `共 ${count(total)} 条`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={!allColumns.length}>
                <Settings2 />
                显示列
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>显示的列</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {allColumns.map(column => (
                <DropdownMenuCheckboxItem
                  key={column.name}
                  checked={!hidden.has(column.name)}
                  onSelect={event => event.preventDefault()}
                  onCheckedChange={checked =>
                    setHidden(value => {
                      const nextHidden = new Set(value);
                      if (checked) nextHidden.delete(column.name);
                      else nextHidden.add(column.name);
                      return nextHidden;
                    })
                  }
                >
                  {columnLabel(column.name)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={!total}>
                <Download />
                导出
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>导出全部 {count(total)} 条</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {EXPORTS.map(([format, label, hint]) => (
                <DropdownMenuItem key={format} asChild>
                  <a href={api.exportUrl(spider, format)} download className="flex-col items-start gap-0">
                    <span className="font-medium">{label}</span>
                    <span className="text-xs text-muted-foreground">{hint}</span>
                  </a>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            disabled={!total || running}
            title={running ? '运行中不能清空' : undefined}
            onClick={() => setConfirmClear(true)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 />
            清空
          </Button>
        </div>
      </div>

      {page.error ? (
        <p className="mx-4 mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          无法读取数据：{page.error}
        </p>
      ) : !page.data ? (
        <div className="space-y-2 px-4 pb-4">
          {Array.from({length: 6}, (_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : !items.length ? (
        <Empty
          icon={query ? <Search /> : <Database />}
          title={query ? `没有包含“${query}”的数据` : '还没有数据'}
          className="border-t"
        >
          {query ? '换个关键词试试，搜索只匹配文本字段。' : '点“开始运行”抓取第一批，新数据会实时出现在这里。'}
        </Empty>
      ) : (
        <div className={cn('border-t transition-opacity', page.loading && 'opacity-60')}>
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                {columns.map(column => {
                  const active = order.replace(/^-/, '') === column.name;
                  const SortIcon = !active ? ArrowUpDown : order.startsWith('-') ? ArrowDown : ArrowUp;
                  return (
                    <TableHead
                      key={column.name}
                      aria-sort={active ? (order.startsWith('-') ? 'descending' : 'ascending') : 'none'}
                      className={cn('whitespace-nowrap', isNumeric(column) && 'text-right')}
                    >
                      <button
                        type="button"
                        onClick={() => sortBy(column.name)}
                        className={cn(
                          '-mx-1.5 inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-accent hover:text-foreground',
                          active && 'text-foreground'
                        )}
                      >
                        {columnLabel(column.name)}
                        <SortIcon className={cn('size-3.5', !active && 'opacity-40')} />
                      </button>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow
                  key={String(item['_id'] ?? index)}
                  data-state={open === index ? 'selected' : undefined}
                  className="cursor-pointer"
                  tabIndex={0}
                  onClick={() => setOpen(index)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') setOpen(index);
                  }}
                >
                  {columns.map(column => (
                    <TableCell key={column.name} className={cn(isNumeric(column) && 'text-right')}>
                      <CellValue value={item[column.name]} column={column} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {total > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            第 {count(offset + 1)}–{count(Math.min(offset + pageSize, total))} 条，共 {count(total)} 条
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground">每页</span>
            <Select
              value={String(pageSize)}
              onValueChange={value => {
                setPageSize(Number(value));
                setOffset(0);
              }}
            >
              <SelectTrigger className="h-8 w-[72px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top">
                {PAGE_SIZES.map(size => (
                  <SelectItem key={size} value={size}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="tabular-nums">
            第 {count(current)} / {count(pages)} 页
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" disabled={current === 1} onClick={() => setOffset(0)} aria-label="首页">
              <ChevronsLeft />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={current === 1}
              onClick={() => setOffset(Math.max(0, offset - pageSize))}
              aria-label="上一页"
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={current >= pages}
              onClick={() => setOffset(offset + pageSize)}
              aria-label="下一页"
            >
              <ChevronRight />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={current >= pages}
              onClick={() => setOffset((pages - 1) * pageSize)}
              aria-label="末页"
            >
              <ChevronsRight />
            </Button>
          </div>
        </div>
      )}

      <ItemSheet
        item={open === null ? undefined : items[open]}
        columns={allColumns}
        position={open === null ? '' : `第 ${count(offset + open + 1)} 条，共 ${count(total)} 条`}
        hasPrevious={open !== null && open > 0}
        hasNext={open !== null && open < items.length - 1}
        onPrevious={previous}
        onNext={next}
        onClose={closeSheet}
      />

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 {spider} 的全部数据？</AlertDialogTitle>
            <AlertDialogDescription>
              表中的 {count(total)} 条数据会被永久删除，运行记录保留。这个操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className={buttonVariants({variant: 'destructive'})} onClick={() => void clear()}>
              删除 {count(total)} 条
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
