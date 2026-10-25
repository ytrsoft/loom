/**
 * @fileoverview Renders stored values: dates in local `YYYY-MM-DD HH:mm:ss`,
 * links shortened, images as thumbnails, JSON abbreviated.
 */

import type {ReactElement} from 'react';

import {count, dateTime, isIsoDate} from '@/format';
import type {ColumnInfo} from '@/types';

const IMAGE_URL = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif|svg)(\?\S*)?$/i;

/** Readable label of a column; system columns get Chinese names. */
export function columnLabel(name: string): string {
  switch (name) {
    case '_url':
      return '来源';
    case '_createdAt':
      return '首次抓取';
    case '_updatedAt':
      return '最近更新';
    case '_id':
      return '编号';
    default:
      return name;
  }
}

/** True for number-like columns, which are right-aligned. */
export function isNumeric(column: ColumnInfo): boolean {
  return column.kind === 'number' || column.kind === 'integer' || column.kind === 'id';
}

const nil = <span className="text-muted-foreground/60">—</span>;

/** Compact table cell. */
export function CellValue({value, column}: {value: unknown; column: ColumnInfo}): ReactElement {
  if (value === null || value === undefined || value === '') return nil;
  if (column.kind === 'date' || isIsoDate(value)) {
    return <span className="whitespace-nowrap tabular-nums">{dateTime(String(value))}</span>;
  }
  if (column.kind === 'boolean') {
    return value ? <span className="text-success">是</span> : <span className="text-muted-foreground">否</span>;
  }
  if (typeof value === 'number') return <span className="tabular-nums">{count(value)}</span>;
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return (
      <code className="whitespace-nowrap font-mono text-xs text-muted-foreground">
        {json.length > 48 ? `${json.slice(0, 45)}…` : json}
      </code>
    );
  }
  const text = String(value);
  if (IMAGE_URL.test(text)) {
    return <img className="size-9 rounded-md border bg-muted object-cover" src={text} alt="" loading="lazy" />;
  }
  if (/^https?:\/\//.test(text)) {
    return (
      <a
        className="block max-w-64 truncate text-primary hover:underline"
        href={text}
        target="_blank"
        rel="noreferrer"
        title={text}
        onClick={event => event.stopPropagation()}
      >
        {text.replace(/^https?:\/\/(www\.)?/, '')}
      </a>
    );
  }
  return <span className="line-clamp-2 min-w-40 max-w-80">{text}</span>;
}

/** Full value for the detail sheet. */
export function FullValue({value, column}: {value: unknown; column: ColumnInfo}): ReactElement {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground">空</span>;
  }
  if (column.kind === 'date' || isIsoDate(value)) return <span className="tabular-nums">{dateTime(String(value))}</span>;
  if (column.kind === 'boolean') return <>{value ? '是' : '否'}</>;
  if (typeof value === 'number') return <span className="tabular-nums">{count(value)}</span>;
  if (typeof value === 'object') {
    return (
      <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{JSON.stringify(value, null, 2)}</pre>
    );
  }
  const text = String(value);
  if (/^https?:\/\//.test(text)) {
    return (
      <div className="grid gap-2">
        {IMAGE_URL.test(text) && <img className="max-h-56 max-w-44 rounded-md border" src={text} alt="" />}
        <a className="break-all text-primary hover:underline" href={text} target="_blank" rel="noreferrer">
          {text}
        </a>
      </div>
    );
  }
  return <p className="whitespace-pre-wrap break-words">{text}</p>;
}
