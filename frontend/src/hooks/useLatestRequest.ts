import { useCallback, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';

interface ActiveRequest {
  id: number;
  controller: AbortController;
}

export interface LatestRequestToken {
  signal: AbortSignal;
  isCurrent: () => boolean;
  finish: () => void;
}

export function isCanceledRequest(error: unknown): boolean {
  if (axios.isCancel(error)) {
    return true;
  }

  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ERR_CANCELED',
  );
}

export function useLatestRequest() {
  const activeRef = useRef<ActiveRequest | null>(null);
  const sequenceRef = useRef(0);

  const cancel = useCallback(() => {
    sequenceRef.current += 1;
    activeRef.current?.controller.abort();
    activeRef.current = null;
  }, []);

  const begin = useCallback((): LatestRequestToken => {
    activeRef.current?.controller.abort();

    const controller = new AbortController();
    const id = ++sequenceRef.current;
    activeRef.current = { id, controller };

    return {
      signal: controller.signal,
      isCurrent: () =>
        activeRef.current?.id === id && !controller.signal.aborted,
      finish: () => {
        if (activeRef.current?.id === id) {
          activeRef.current = null;
        }
      },
    };
  }, []);

  useEffect(() => cancel, [cancel]);

  return useMemo(() => ({ begin, cancel }), [begin, cancel]);
}

export function useLatestKeyedRequests() {
  const activeRef = useRef<Map<string, ActiveRequest>>(new Map());
  const sequenceRef = useRef(0);

  const cancelAll = useCallback(() => {
    sequenceRef.current += 1;
    for (const request of activeRef.current.values()) {
      request.controller.abort();
    }
    activeRef.current.clear();
  }, []);

  const cancel = useCallback((key: string) => {
    activeRef.current.get(key)?.controller.abort();
    activeRef.current.delete(key);
  }, []);

  const begin = useCallback((key: string): LatestRequestToken => {
    activeRef.current.get(key)?.controller.abort();

    const controller = new AbortController();
    const id = ++sequenceRef.current;
    activeRef.current.set(key, { id, controller });

    return {
      signal: controller.signal,
      isCurrent: () =>
        activeRef.current.get(key)?.id === id && !controller.signal.aborted,
      finish: () => {
        if (activeRef.current.get(key)?.id === id) {
          activeRef.current.delete(key);
        }
      },
    };
  }, []);

  useEffect(() => cancelAll, [cancelAll]);

  return useMemo(() => ({ begin, cancel, cancelAll }), [begin, cancel, cancelAll]);
}
