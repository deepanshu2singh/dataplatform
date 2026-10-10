import { createContext } from 'react';

export interface UnsavedChangesContextValue {
  registerGuard: (owner: symbol, message: string) => void;
  unregisterGuard: (owner: symbol) => void;
  allowNextNavigation: () => void;
  cancelNavigationBypass: () => void;
  confirmDiscardChanges: () => boolean;
}

export const UnsavedChangesContext =
  createContext<UnsavedChangesContextValue | null>(null);
