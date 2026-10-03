import React, { createContext, useCallback, useContext, useState } from 'react';
import type { SidePanelView } from '@/lib/types/workspaceTab';

export interface SidePanelContextValue {
  activeView: SidePanelView;
  setActiveView: (view: SidePanelView) => void;
  toggleView: (view: Exclude<SidePanelView, null>) => void;
}

const SidePanelContext = createContext<SidePanelContextValue | undefined>(undefined);

export function SidePanelProvider({
  children,
  initialView = 'explorer',
}: {
  children: React.ReactNode;
  initialView?: SidePanelView;
}) {
  // P11-01(D2): 폴더 미선택 상태에서도 전부 선택 가능. 워크스페이스 개념은 P11-04에서 작업 폴더로 대체한다.
  // P12-03: 앱 시작 시 첫 선택은 파일 탐색기다.
  const [internalView, setInternalView] = useState<SidePanelView>(() => initialView);

  const activeView: SidePanelView = internalView;

  const handleSetActiveView = useCallback((view: SidePanelView) => {
    setInternalView(view);
  }, []);

  const toggleView = useCallback((view: Exclude<SidePanelView, null>) => {
    setInternalView((prev) => (prev === view ? null : view));
  }, []);

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
