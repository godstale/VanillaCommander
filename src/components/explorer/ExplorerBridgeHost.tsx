import { useEffect } from 'react';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { setExplorerOpener, type ExplorerRequest } from '@/lib/tools/commander/explorerBridge';

function baseNameOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function stripVerbatimPrefix(path: string): string {
  if (path.startsWith('\\\\?\\UNC\\')) return `\\${path.slice(7)}`;
  if (path.startsWith('\\\\?\\')) return path.slice(4);
  return path;
}

function normExplorerPath(path: string): string {
  const clean = stripVerbatimPrefix(path).replace(/[\\/]+$/, '');
  if (clean.includes('\\') || /^[a-zA-Z]:/.test(clean) || clean.startsWith('\\\\')) {
    return clean.replace(/\//g, '\\').toLowerCase();
  }
  return clean;
}

/** explorer 도구의 open/goto/select를 실제 탭 동작에 연결한다. */
export function ExplorerBridgeHost() {
  const { tabs, openTab, setActiveTab } = useWorkspaceTabs();

  useEffect(() => {
    const handle = (req: ExplorerRequest) => {
      const norm = normExplorerPath(req.path);
      const existing = tabs.find((tb) => {
        if (tb.type !== 'file-explorer') return false;
        const p = ((tb.meta ?? {}) as { path?: string }).path ?? '';
        return normExplorerPath(p) === norm;
      });
      if (existing) {
        setActiveTab(existing.id);
        return;
      }
      openTab({
        type: 'file-explorer',
        title: baseNameOf(req.path),
        meta: { path: req.path },
      });
    };
    setExplorerOpener(handle);
    return () => {
      setExplorerOpener(null);
    };
  }, [tabs, openTab, setActiveTab]);

  return null;
}
