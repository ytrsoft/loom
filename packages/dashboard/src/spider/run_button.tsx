/**
 * @fileoverview Run controls: start/stop, plus a menu with a limited trial
 * run and resuming an interrupted crawl.
 */

import type {ReactElement} from 'react';
import {useState} from 'react';
import {ChevronDown, FlaskConical, Play, RotateCcw, Square} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Switch} from '@/components/ui/switch';
import type {LiveState} from '@/hooks/live';
import {useRunAction} from '@/hooks/run_action';

interface RunButtonProps {
  readonly spider: string;
  readonly live: LiveState;
  /** Small single button for tables. */
  readonly compact?: boolean;
}

/** Start/stop control for one spider. */
export function RunButton({spider, live, compact = false}: RunButtonProps): ReactElement {
  const action = useRunAction(spider, live);
  const [trialOpen, setTrialOpen] = useState(false);
  const [limit, setLimit] = useState('20');
  const [resume, setResume] = useState(false);
  const maxRequests = Number.parseInt(limit, 10);

  if (action.running) {
    return (
      <Button
        variant="outline"
        size={compact ? 'sm' : 'default'}
        disabled={action.pending}
        onClick={() => void action.stop()}
        className="text-destructive hover:text-destructive"
      >
        <Square className="fill-current" />
        停止
      </Button>
    );
  }

  if (compact) {
    return (
      <Button variant="outline" size="sm" disabled={action.pending} onClick={() => void action.start()}>
        <Play />
        运行
      </Button>
    );
  }

  return (
    <>
      <div className="inline-flex rounded-md shadow-sm">
        <Button className="rounded-r-none" disabled={action.pending} onClick={() => void action.start()}>
          <Play className="fill-current" />
          开始运行
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="rounded-l-none border-l border-primary-foreground/20 px-2"
              disabled={action.pending}
              aria-label="更多运行方式"
            >
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => setTrialOpen(true)}>
              <FlaskConical />
              <div>
                <div>试运行</div>
                <div className="text-xs text-muted-foreground">只抓指定数量的请求</div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void action.start({resume: true})}>
              <RotateCcw />
              <div>
                <div>继续上次运行</div>
                <div className="text-xs text-muted-foreground">从中断处的请求队列接着抓</div>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={trialOpen} onOpenChange={setTrialOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>试运行 {spider}</DialogTitle>
            <DialogDescription>先抓几页检查选择器和字段是否正确。抓到的数据照常保存。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 py-2">
            <div className="grid gap-2">
              <Label htmlFor="trial-limit">最多请求数</Label>
              <Input
                id="trial-limit"
                type="number"
                min={1}
                inputMode="numeric"
                value={limit}
                onChange={event => setLimit(event.target.value)}
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <Label htmlFor="trial-resume">从上次中断处继续</Label>
                <p className="mt-1 text-xs text-muted-foreground">关闭时从起始页重新开始</p>
              </div>
              <Switch id="trial-resume" checked={resume} onCheckedChange={setResume} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTrialOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!(maxRequests > 0) || action.pending}
              onClick={() => {
                setTrialOpen(false);
                void action.start({maxRequests, ...(resume ? {resume: true} : {})});
              }}
            >
              <Play className="fill-current" />
              运行 {maxRequests > 0 ? maxRequests : ''} 个请求
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
