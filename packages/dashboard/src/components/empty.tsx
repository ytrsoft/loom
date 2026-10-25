/**
 * @fileoverview Empty state: an icon, one line of explanation and an action.
 */

import type {ReactElement, ReactNode} from 'react';

import {cn} from '@/lib/utils';

interface EmptyProps {
  readonly icon: ReactElement;
  readonly title: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
}

/** Centered empty state. */
export function Empty({icon, title, children, action, className}: EmptyProps): ReactElement {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
        {icon}
      </div>
      <h3 className="text-sm font-medium">{title}</h3>
      {children && <div className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
