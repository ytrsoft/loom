/**
 * @fileoverview Status badges and dots shared by every page.
 */

import type {ReactElement} from 'react';
import {CircleCheck, CircleDashed, CircleSlash, CircleX, LoaderCircle} from 'lucide-react';

import {Badge} from '@/components/ui/badge';
import {statusLabel} from '@/format';
import {cn} from '@/lib/utils';
import type {RunStatus} from '@/types';

const VARIANT = {
  running: 'warning',
  succeeded: 'success',
  failed: 'destructive',
  stopped: 'secondary',
} as const;

/** Badge with icon for a run status; "从未运行" when there is none. */
export function StatusBadge({status, className}: {status: RunStatus | undefined | null; className?: string}): ReactElement {
  if (!status) {
    return (
      <Badge variant="outline" className={cn('font-normal text-muted-foreground', className)}>
        <CircleDashed />
        从未运行
      </Badge>
    );
  }
  const Icon =
    status === 'running'
      ? LoaderCircle
      : status === 'succeeded'
        ? CircleCheck
        : status === 'failed'
          ? CircleX
          : CircleSlash;
  return (
    <Badge variant={VARIANT[status]} className={className}>
      <Icon className={status === 'running' ? 'animate-spin' : ''} />
      {statusLabel(status)}
    </Badge>
  );
}

/** Small coloured dot for lists. */
export function StatusDot({status, className}: {status: RunStatus | undefined | null; className?: string}): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        status === 'running' && 'animate-pulse-dot bg-warning',
        status === 'succeeded' && 'bg-success',
        status === 'failed' && 'bg-destructive',
        status === 'stopped' && 'bg-muted-foreground/60',
        !status && 'border border-muted-foreground/50',
        className
      )}
    />
  );
}
