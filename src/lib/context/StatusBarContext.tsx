import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

// P11-05(§2.1): 슬롯 기반 상태바. 각 기능이 자기 슬롯만 갱신한다.
export type StatusBarSlot = 'agent' | 'jobs' | 'wiki' | 'tab' | 'clipboard' | 'message';

export interface StatusBarItem {
  id: string;
  content: React.ReactNode;
  title?: string;
  onClick?: () => void;
}

export interface StatusBarContextValue {
  publish: (slot: StatusBarSlot, item: StatusBarItem) => void;
  clear: (slot: StatusBarSlot, id?: string) => void;
  /** 일시 메시지(토스트 대체). 기본 5초 후 자동 제거된다. */
  notify: (content: React.ReactNode, timeoutMs?: number) => () => void;
  items: Record<StatusBarSlot, StatusBarItem[]>;
}

const StatusBarContext = createContext<StatusBarContextValue | undefined>(undefined);

const EMPTY_SLOTS: Record<StatusBarSlot, StatusBarItem[]> = {
  agent: [],
  jobs: [],
  wiki: [],
  tab: [],
  clipboard: [],
  message: [],
};

export function StatusBarProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Record<StatusBarSlot, StatusBarItem[]>>(EMPTY_SLOTS);
  const notifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const publish = useCallback((slot: StatusBarSlot, item: StatusBarItem) => {
    setItems((prev) => {
      const rest = prev[slot].filter((i) => i.id !== item.id);
      return { ...prev, [slot]: [...rest, item] };
    });
  }, []);

  const clear = useCallback((slot: StatusBarSlot, id?: string) => {
    setItems((prev) => ({
      ...prev,
      [slot]: id === undefined ? [] : prev[slot].filter((i) => i.id !== id),
    }));
  }, []);

  const notify = useCallback((content: React.ReactNode, timeoutMs = 5000) => {
    if (notifyTimerRef.current) {
      clearTimeout(notifyTimerRef.current);
      notifyTimerRef.current = null;
    }
    const id = `transient-${Date.now()}`;
    setItems((prev) => ({ ...prev, message: [{ id, content }] }));
    let cleared = false;
    const clearFn = () => {
      if (cleared) return;
      cleared = true;
      if (notifyTimerRef.current) {
        clearTimeout(notifyTimerRef.current);
        notifyTimerRef.current = null;
      }
      setItems((prev) => ({ ...prev, message: prev.message.filter((i) => i.id !== id) }));
    };
    notifyTimerRef.current = setTimeout(clearFn, Math.max(0, timeoutMs));
    return clearFn;
  }, []);

  const value = useMemo(
    () => ({ publish, clear, notify, items }),
    [publish, clear, notify, items],
  );

  return (
    <StatusBarContext.Provider value={value}>
      {children}
    </StatusBarContext.Provider>
  );
}

export function useStatusBar(): StatusBarContextValue {
  const ctx = useContext(StatusBarContext);
  if (!ctx) {
    throw new Error('useStatusBar must be used within a StatusBarProvider');
  }
  return ctx;
}
