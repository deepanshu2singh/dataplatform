import { useSyncExternalStore } from 'react';
const query = '(prefers-reduced-motion: reduce)';
function subscribe(notify: () => void) {
  const media = window.matchMedia?.(query);
  media?.addEventListener('change', notify);
  return () => media?.removeEventListener('change', notify);
}
const read = () => window.matchMedia?.(query).matches ?? false;
export const useReducedMotion = () => useSyncExternalStore(subscribe, read, () => false);
