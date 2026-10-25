/**
 * @fileoverview Loads data for a component and reloads it on demand.
 */

import {useCallback, useEffect, useRef, useState} from 'react';

/** State of a loaded resource. */
export interface Resource<T> {
  readonly data: T | undefined;
  readonly error: string | null;
  readonly loading: boolean;
  reload(): void;
}

/**
 * Runs `load` whenever `key` changes; stale responses are ignored so fast
 * navigation never shows the previous spider's data.
 */
export function useResource<T>(load: () => Promise<T>, key: string): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    let current = true;
    setLoading(true);
    loader
      .current()
      .then(result => {
        if (!current) return;
        setData(result);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [key, tick]);

  const reload = useCallback(() => setTick(value => value + 1), []);
  return {data, error, loading, reload};
}
