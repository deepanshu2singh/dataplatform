import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useBeforeUnload, useBlocker, useLocation } from 'react-router-dom';

import {
  UnsavedChangesContext,
  type UnsavedChangesContextValue,
} from '../contexts/unsavedChanges';

interface ActiveGuard {
  owner: symbol;
  message: string;
}

function isSameLocation(
  currentLocation: { pathname: string; search: string; hash: string },
  nextLocation: { pathname: string; search: string; hash: string },
) {
  return (
    currentLocation.pathname === nextLocation.pathname &&
    currentLocation.search === nextLocation.search &&
    currentLocation.hash === nextLocation.hash
  );
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [guard, setGuard] = useState<ActiveGuard | null>(null);
  const bypassRef = useRef(false);
  const location = useLocation();

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (!guard || bypassRef.current) {
      return false;
    }

    return !isSameLocation(currentLocation, nextLocation);
  });

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      return;
    }

    if (!guard) {
      blocker.proceed();
      return;
    }

    if (window.confirm(guard.message)) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker, guard]);

  useEffect(() => {
    bypassRef.current = false;
  }, [location.key]);

  useBeforeUnload(
    useCallback(
      (event) => {
        if (!guard) {
          return;
        }

        event.preventDefault();
        event.returnValue = '';
      },
      [guard],
    ),
  );

  const registerGuard = useCallback((owner: symbol, message: string) => {
    setGuard({ owner, message });
  }, []);

  const unregisterGuard = useCallback((owner: symbol) => {
    setGuard((current) => (current?.owner === owner ? null : current));
  }, []);

  const allowNextNavigation = useCallback(() => {
    bypassRef.current = true;
  }, []);

  const cancelNavigationBypass = useCallback(() => {
    bypassRef.current = false;
  }, []);

  const confirmDiscardChanges = useCallback(() => {
    if (!guard) {
      return true;
    }

    return window.confirm(guard.message);
  }, [guard]);

  const value = useMemo<UnsavedChangesContextValue>(
    () => ({
      registerGuard,
      unregisterGuard,
      allowNextNavigation,
      cancelNavigationBypass,
      confirmDiscardChanges,
    }),
    [
      allowNextNavigation,
      cancelNavigationBypass,
      confirmDiscardChanges,
      registerGuard,
      unregisterGuard,
    ],
  );

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
    </UnsavedChangesContext.Provider>
  );
}
