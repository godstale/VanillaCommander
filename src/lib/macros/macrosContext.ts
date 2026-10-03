import { createContext } from 'react';
import type { Macro, MacroDraft } from './types';

export interface MacrosContextValue {
  macros: Macro[];
  loading: boolean;
  refresh: () => Promise<void>;
  create: (draft: MacroDraft) => Promise<Macro>;
  update: (id: string, patch: Partial<MacroDraft>) => Promise<Macro | null>;
  remove: (id: string) => Promise<void>;
}

export const MacrosContext = createContext<MacrosContextValue | undefined>(undefined);
