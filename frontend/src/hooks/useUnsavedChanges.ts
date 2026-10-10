import { useContext, useLayoutEffect, useRef } from 'react';

import { UnsavedChangesContext } from '../contexts/unsavedChanges';

export function useUnsavedChangesGuard(active: boolean, message: string) {
  const context = useContext(UnsavedChangesContext);
  const ownerRef = useRef(Symbol('unsaved-changes-guard'));

  if (!context) {
    throw new Error(
      'useUnsavedChangesGuard must be used within an UnsavedChangesProvider',
    );
  }

  const {
    registerGuard,
    unregisterGuard,
    allowNextNavigation,
  } = context;

  useLayoutEffect(() => {
    const owner = ownerRef.current;

    if (!active) {
      unregisterGuard(owner);
      return;
    }

    registerGuard(owner, message);

    return () => {
      unregisterGuard(owner);
    };
  }, [active, message, registerGuard, unregisterGuard]);

  return {
    allowNextNavigation,
  };
}

export function useUnsavedChangesController() {
  const context = useContext(UnsavedChangesContext);

  if (!context) {
    throw new Error(
      'useUnsavedChangesController must be used within an UnsavedChangesProvider',
    );
  }

  return {
    allowNextNavigation: context.allowNextNavigation,
    cancelNavigationBypass: context.cancelNavigationBypass,
    confirmDiscardChanges: context.confirmDiscardChanges,
  };
}
