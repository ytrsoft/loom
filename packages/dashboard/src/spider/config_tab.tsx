/**
 * @fileoverview How a spider is set up: fetching, storage, schedule and the
 * columns of its table.
 */

import type {ReactElement} from 'react';

import {Badge} from '@/components/ui/badge';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import type {SpiderInfo} from '@/types';
import {columnLabel} from './value';

const KIND_LABELS: Readonly<Record<string, string>> = {
  id: '自增编号',
  string: '文本',
  number: '数字',
  integer: '整数',
  boolean: '是/否',
  date: '日期时间',
  json: 'JSON',
};

function Row({label, children}: {label: string; children: ReactElement | string}): ReactElement {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** The configuration tab. */
export function ConfigTab({spider}: {spider: SpiderInfo}): ReactElement {
  return (
    <div className="grid gap-8 p-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section>
        <h3 className="mb-1 text-sm font-medium">设置</h3>
        <p className="mb-3 text-sm text-muted-foreground">在爬虫文件的 defineSpider 中修改，保存后自动生效。</p>
        <dl className="divide-y border-y">
          <Row label="抓取方式">{spider.mode === 'browser' ? '浏览器渲染（Playwright）' : 'HTTP 请求'}</Row>
          <Row label="存储表">
            {spider.table ? <code className="font-mono">{spider.table}</code> : '不存储（store: false）'}
          </Row>
          <Row label="去重字段">
            {spider.unique.length ? (
              <span className="flex flex-wrap gap-1">
                {spider.unique.map(name => (
                  <Badge key={name} variant="secondary" className="font-mono">
                    {name}
                  </Badge>
                ))}
              </span>
            ) : (
              '不去重，每次都追加'
            )}
          </Row>
          <Row label="定时">
            {spider.schedule ? <code className="font-mono">{spider.schedule}</code> : '只手动运行'}
          </Row>
        </dl>
      </section>
      <section>
        <h3 className="mb-1 text-sm font-medium">字段</h3>
        <p className="mb-3 text-sm text-muted-foreground">表中的 {spider.columns.length} 列，含 Loom 自动添加的系统字段。</p>
        {spider.columns.length ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>字段</TableHead>
                  <TableHead>类型</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spider.columns.map(column => (
                  <TableRow key={column.name}>
                    <TableCell>
                      <code className="font-mono text-xs">{column.name}</code>
                      {column.name.startsWith('_') && (
                        <span className="ml-2 text-xs text-muted-foreground">{columnLabel(column.name)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{KIND_LABELS[column.kind] ?? column.kind}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">第一次运行后会根据抓到的数据建表。</p>
        )}
      </section>
    </div>
  );
}
