import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLatestKeyedRequests, useLatestRequest } from './useLatestRequest';

describe('useLatestRequest', () => {
  it('aborts the previous request and marks only the newest request current', () => {
    const { result } = renderHook(() => useLatestRequest());

    let first!: ReturnType<typeof result.current.begin>;
    let second!: ReturnType<typeof result.current.begin>;

    act(() => {
      first = result.current.begin();
      second = result.current.begin();
    });

    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(second.signal.aborted).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it('aborts an active request when the component unmounts', () => {
    const { result, unmount } = renderHook(() => useLatestRequest());
    let request!: ReturnType<typeof result.current.begin>;

    act(() => {
      request = result.current.begin();
    });

    unmount();

    expect(request.signal.aborted).toBe(true);
    expect(request.isCurrent()).toBe(false);
  });
});

describe('useLatestKeyedRequests', () => {
  it('supersedes only requests with the same key', () => {
    const { result } = renderHook(() => useLatestKeyedRequests());
    let widgetAFirst!: ReturnType<typeof result.current.begin>;
    let widgetB!: ReturnType<typeof result.current.begin>;
    let widgetASecond!: ReturnType<typeof result.current.begin>;

    act(() => {
      widgetAFirst = result.current.begin('widget-a');
      widgetB = result.current.begin('widget-b');
      widgetASecond = result.current.begin('widget-a');
    });

    expect(widgetAFirst.signal.aborted).toBe(true);
    expect(widgetAFirst.isCurrent()).toBe(false);
    expect(widgetASecond.isCurrent()).toBe(true);
    expect(widgetB.isCurrent()).toBe(true);
  });
});
