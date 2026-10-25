/**
 * @fileoverview Starting and stopping a spider, with toasts for the outcome.
 */

import {useCallback, useState} from 'react';
import {toast} from 'sonner';

import {api, type StartOptions} from '../api.js';
import type {LiveState} from './live.js';

/** State and actions for one spider's run controls. */
export interface RunAction {
  readonly running: boolean;
  readonly pending: boolean;
  start(options?: StartOptions): Promise<void>;
  stop(): Promise<void>;
}

const message = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason));

/** Run controls for `spider`, kept in sync with the live state. */
export function useRunAction(spider: string, live: LiveState): RunAction {
  const [pending, setPending] = useState(false);
  const run = live.runs[spider];
  const running = run?.status === 'running';
  const runId = running ? run?.runId : undefined;

  const start = useCallback(
    async (options: StartOptions = {}) => {
      setPending(true);
      try {
        await api.startRun(spider, options);
        toast.success(`${spider} 已开始运行`, {
          description: options.maxRequests ? `试运行，最多 ${options.maxRequests} 个请求` : undefined,
        });
      } catch (reason) {
        toast.error(`${spider} 无法运行`, {description: message(reason)});
      } finally {
        setPending(false);
      }
    },
    [spider]
  );

  const stop = useCallback(async () => {
    if (!runId) return;
    setPending(true);
    try {
      await api.stopRun(runId);
      toast(`${spider} 正在停止`, {description: '等进行中的请求完成后结束'});
    } catch (reason) {
      toast.error(`${spider} 无法停止`, {description: message(reason)});
    } finally {
      setPending(false);
    }
  }, [runId, spider]);

  return {running, pending, start, stop};
}
