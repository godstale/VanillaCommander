import { useContext } from 'react';
import { MacrosContext, type MacrosContextValue } from './macrosContext';

export type { MacrosContextValue };

export function useMacros(): MacrosContextValue {
  const ctx = useContext(MacrosContext);
  if (!ctx) throw new Error('useMacros must be used within a MacrosProvider');
  return ctx;
}
