import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, Folder, Monitor, Star } from 'lucide-react';
import { fcListDir, fcSystemFolders } from '@/lib/commander/ipc';
import type { FcEntry, FcSystemFolder } from '@/lib/commander/types';
import { useSettings } from '@/lib/context/SettingsContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { cn } from '@/lib/utils';

export interface FolderTreeProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

function normExplorerPath(path: string): string {
  const clean = path.replace(/[\\/]+$/, '');
  if (clean.includes('\\') || /^[a-zA-Z]:/.test(clean) || clean.startsWith('\\\\')) {
    return clean.replace(/\//g, '\\').toLowerCase();
  }
  return clean;
}

function baseNameOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function isUnderOrEqual(child: string, parent: string): boolean {
  const nChild = normExplorerPath(child);
  const nParent = normExplorerPath(parent);
  if (nChild === nParent) return true;
  const sep = nParent.includes('\\') ? '\\' : '/';
  return nChild.startsWith(nParent.endsWith(sep) ? nParent : nParent + sep);
}

function childDirs(entries: FcEntry[]): FcEntry[] {
  return entries.filter((e) => e.kind === 'dir' || e.symlink);
}

interface TreeNodeProps {
  entry: FcEntry;
  depth: number;
  currentNorm: string;
  expanded: Set<string>;
  childrenOf: Map<string, FcEntry[]>;
  loading: Set<string>;
  failed: Set<string>;
  onToggle: (path: string) => void;
  onNavigate: (path: string) => void;
}

function TreeNode({
  entry,
  depth,
  currentNorm,
  expanded,
  childrenOf,
  loading,
  failed,
  onToggle,
  onNavigate,
}: TreeNodeProps) {
  const norm = normExplorerPath(entry.path);
  const isOpen = expanded.has(norm);
  const isActive = currentNorm === norm;
  const children = childrenOf.get(norm) ?? [];
  const isLoading = loading.has(norm);
  const isFailed = failed.has(norm);

  return (
    <div>
      <div
        role="treeitem"
        aria-expanded={isOpen}
        onClick={() => onNavigate(entry.path)}
        className={cn(
          'group flex items-center gap-1 pr-2 py-1 cursor-pointer text-xs',
          isActive
            ? 'bg-primary/10 text-foreground font-medium'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent/40',
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        title={entry.path}
      >
        {isFailed ? (
          <span className="w-4 shrink-0" />
        ) : (
          <button
            type="button"
            aria-label={isOpen ? '접기' : '펼치기'}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(entry.path);
            }}
            className="w-4 h-4 shrink-0 flex items-center justify-center rounded hover:bg-muted"
          >
            {isLoading ? (
              <span className="h-2.5 w-2.5 rounded-full border border-muted-foreground/40 border-t-transparent animate-spin" />
            ) : isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        )}
        <Folder className="h-3.5 w-3.5 shrink-0 text-warning" />
        <span className="truncate flex-1">{entry.name}</span>
      </div>
      {isOpen && !isFailed && (
        <div role="group">
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              currentNorm={currentNorm}
              expanded={expanded}
              childrenOf={childrenOf}
              loading={loading}
              failed={failed}
              onToggle={onToggle}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FolderTree({ currentPath, onNavigate }: FolderTreeProps) {
  const { settings } = useSettings();
  const [systemFolders, setSystemFolders] = useState<FcSystemFolder[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childrenOf, setChildrenOf] = useState<Map<string, FcEntry[]>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const currentNorm = normExplorerPath(currentPath);
  const stateRef = useRef({ expanded, childrenOf, loading });
  useEffect(() => {
    stateRef.current = { expanded, childrenOf, loading };
  }, [expanded, childrenOf, loading]);

  useEffect(() => {
    let active = true;
    void fcSystemFolders()
      .then((list) => {
        if (active) setSystemFolders(list);
      })
      .catch(() => {
        if (active) setSystemFolders([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const loadChildren = useCallback(async (path: string): Promise<FcEntry[]> => {
    const norm = normExplorerPath(path);
    const st = stateRef.current;
    if (st.childrenOf.has(norm) || st.loading.has(norm)) {
      return st.childrenOf.get(norm) ?? [];
    }
    setLoading((prev) => new Set(prev).add(norm));
    try {
      const entries = await fcListDir(path, false);
      const dirs = childDirs(entries);
      setChildrenOf((prev) => new Map(prev).set(norm, dirs));
      return dirs;
    } catch {
      setFailed((prev) => new Set(prev).add(norm));
      return [];
    } finally {
      setLoading((prev) => {
        const next = new Set(prev);
        next.delete(norm);
        return next;
      });
    }
  }, []);

  const toggle = useCallback(
    (path: string) => {
      const norm = normExplorerPath(path);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(norm)) {
          next.delete(norm);
          return next;
        }
        next.add(norm);
        return next;
      });
      void loadChildren(path);
    },
    [loadChildren],
  );

  const roots = useMemo<FcEntry[]>(
    () => [
      ...settings.favorites.map((fav) => ({
        name: baseNameOf(fav),
        path: fav,
        kind: 'dir' as const,
        size: 0,
        modified_ms: null,
        hidden: false,
        readonly: false,
        symlink: false,
        warning: false,
      })),
      ...systemFolders.map((f) => ({
        name: f.label,
        path: f.path,
        kind: 'dir' as const,
        size: 0,
        modified_ms: null,
        hidden: false,
        readonly: false,
        symlink: false,
        warning: false,
      })),
    ],
    [settings.favorites, systemFolders],
  );

  // 현재 탐색 위치가 속한 루트부터 경로까지 조상을 자동 펼친다.
  useEffect(() => {
    if (!currentPath) return;
    let cancelled = false;
    void (async () => {
      const host = roots.find((r) => isUnderOrEqual(currentPath, r.path));
      if (!host) return;
      let cursor = host.path;
      const chain: string[] = [cursor];
      const target = normExplorerPath(currentPath);
      for (let depth = 0; depth < 12; depth += 1) {
        if (normExplorerPath(cursor) === target) break;
        const kids = await loadChildren(cursor);
        if (cancelled) return;
        const next = kids.find((k) => isUnderOrEqual(currentPath, k.path));
        if (!next) break;
        cursor = next.path;
        chain.push(cursor);
      }
      if (!cancelled) {
        setExpanded((prev) => {
          const next = new Set(prev);
          for (const p of chain) next.add(normExplorerPath(p));
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNorm]);

  const favRoots = roots.slice(0, settings.favorites.length);
  const sysRoots = roots.slice(settings.favorites.length);

  return (
    <div role="tree" aria-label="folder-tree" className="py-1">
      {favRoots.length > 0 && (
        <TreeSection
          title="favorites"
          icon={<Star className="h-3 w-3" />}
          entries={favRoots}
          depth={0}
          currentNorm={currentNorm}
          expanded={expanded}
          childrenOf={childrenOf}
          loading={loading}
          failed={failed}
          onToggle={toggle}
          onNavigate={onNavigate}
        />
      )}
      <TreeSection
        title="system"
        icon={<Monitor className="h-3 w-3" />}
        entries={sysRoots}
        depth={0}
        currentNorm={currentNorm}
        expanded={expanded}
        childrenOf={childrenOf}
        loading={loading}
        failed={failed}
        onToggle={toggle}
        onNavigate={onNavigate}
      />
    </div>
  );
}

function TreeSection({
  title,
  icon,
  entries,
  depth,
  currentNorm,
  expanded,
  childrenOf,
  loading,
  failed,
  onToggle,
  onNavigate,
}: {
  title: 'favorites' | 'system';
  icon: ReactNode;
  entries: FcEntry[];
  depth: number;
  currentNorm: string;
  expanded: Set<string>;
  childrenOf: Map<string, FcEntry[]>;
  loading: Set<string>;
  failed: Set<string>;
  onToggle: (path: string) => void;
  onNavigate: (path: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div>
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">
        {icon}
        <span>{title === 'favorites' ? t('explorer.favorites') : t('explorer.system')}</span>
      </div>
      {entries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={depth}
          currentNorm={currentNorm}
          expanded={expanded}
          childrenOf={childrenOf}
          loading={loading}
          failed={failed}
          onToggle={onToggle}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

export default FolderTree;
