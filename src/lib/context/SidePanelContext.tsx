import React, { createContext, useCallback, useContext, useState } from 'react';
import type { SidePanelView } from '@/lib/types/workspaceTab';
import { useSafeWorkspace } from './WorkspaceContext';

export interface SidePanelContextValue {
  activeView: SidePanelView;
  setActiveView: (view: SidePanelView) => void;
  toggleView: (view: Exclude<SidePanelView, null>) => void;
}

const SidePanelContext = createContext<SidePanelContextValue | undefined>(undefined);

export function SidePanelProvider({
  children,
  initialView = 'chat-sessions',
}: {
  children: React.ReactNode;
  initialView?: SidePanelView;
}) {
  const workspace = useSafeWorkspace();
  const hasWorkspaceContext = workspace !== null;
  const workspaceRoot = workspace?.workspaceRoot ?? null;

  const [internalView, setInternalView] = useState<SidePanelView>(() => {
    if (hasWorkspaceContext && !workspaceRoot) {
      return 'explorer';
    }
    return initialView;
  });

  const activeView: SidePanelView =
    hasWorkspaceContext && !workspaceRoot ? 'explorer' : internalView;

  const handleSetActiveView = useCallback(
    (view: SidePanelView) => {
      if (hasWorkspaceContext && !workspaceRoot) {
        return;
      }
      setInternalView(view);
    },
    [hasWorkspaceContext, workspaceRoot],
  );

  const toggleView = useCallback(
    (view: Exclude<SidePanelView, null>) => {
      if (hasWorkspaceContext && !workspaceRoot) {
        return;
      }
      setInternalView((prev) => (prev === view ? null : view));
    },
    [hasWorkspaceContext, workspaceRoot],
  );

  return (
    <SidePanelContext.Provider
      value={{
        activeView,
        setActiveView: handleSetActiveView,
        toggleView,
      }}
    >
      {children}
    </SidePanelContext.Provider>
  );
}

export function useSidePanel(): SidePanelContextValue {
  const ctx = useContext(SidePanelContext);
  if (!ctx) {
    throw new Error('useSidePanel must be used within a SidePanelProvider');
  }
  return ctx;
}
