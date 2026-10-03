import { useEffect, useState } from 'react';
import { Plus, X, Folder, Star, ChevronUp, ChevronDown, Monitor } from 'lucide-react';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useWorkspace } from '@/lib/context/WorkspaceContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { fcSystemFolders } from '@/lib/commander/ipc';
import type { FcSystemFolder } from '@/lib/commander/types';
import { cn } from '@/lib/utils';

function stripVerbatimPrefix(path: string): string {
  if (path.startsWith('\\\\?\\UNC\\')) return `\\${path.slice(7)}`;
  if (path.startsWith('\\\\?\\')) return path.slice(4);
  return path;
}

function normExplorerPath(path: string): string {
  const clean = stripVerbatimPrefix(path).replace(/[\\/]+$/, '');
  // Windows 경로는 대소문자를 구분하지 않으므로 소문자로 비교한다.
  if (clean.includes('\\') || /^[a-zA-Z]:/.test(clean) || clean.startsWith('\\\\')) {
    return clean.replace(/\//g, '\\').toLowerCase();
  }
  return clean;
}

function baseNameOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function defaultPath(workFolder: string | null, workspaceRoot: string | null): string {
  return workFolder ?? workspaceRoot ?? '';
}

export function ExplorerPanel() {
  const { t } = useLanguage();
  const { tabs, activeTabId, openTab, setActiveTab, closeTab, updateTab, isTabsLoaded } = useWorkspaceTabs();
  const { workFolder, workspaceRoot } = useWorkspace();
  const { settings, updateSettings } = useSettings();
  const [systemFolders, setSystemFolders] = useState<FcSystemFolder[]>([]);

  const explorerTabs = tabs.filter((tb) => tb.type === 'file-explorer');

  // 요구사항: 사이드바 클릭 시 열린 탐색기 탭이 없으면 1개 생성.
  useEffect(() => {
    if (!isTabsLoaded) return;
    if (explorerTabs.length === 0) {
      const root = defaultPath(workFolder, workspaceRoot);
      openTab({
        type: 'file-explorer',
        title: root ? baseNameOf(root) : t('activityBar.explorer'),
        meta: { path: root },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTabsLoaded]);

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

  const openOrFocus = (path: string) => {
    const norm = normExplorerPath(path);
    const existing = explorerTabs.find((tb) => {
      const p = ((tb.meta ?? {}) as { path?: string }).path ?? '';
      return normExplorerPath(p) === norm;
    });
    if (existing) {
      setActiveTab(existing.id);
      return;
    }
    // 같은 경로의 탭이 없으면 현재 탐색기 탭에서 이동한다. 새 탭을 열지 않는다.
    const activeExplorer = explorerTabs.find((tb) => tb.id === activeTabId) ?? explorerTabs[0];
    if (activeExplorer) {
      updateTab(activeExplorer.id, {
        title: baseNameOf(path),
        meta: { ...((activeExplorer.meta ?? {}) as Record<string, unknown>), path },
      });
      setActiveTab(activeExplorer.id);
      return;
    }
    openTab({
      type: 'file-explorer',
      title: baseNameOf(path),
      meta: { path },
    });
  };

  const newTab = () => {
    const root = defaultPath(workFolder, workspaceRoot);
    openTab({
      type: 'file-explorer',
      title: root ? baseNameOf(root) : t('activityBar.explorer'),
      meta: { path: root },
    });
  };

  const favorites = settings.favorites;
  const activeExplorerPath =
    ((explorerTabs.find((tb) => tb.id === activeTabId)?.meta ?? {}) as { path?: string }).path ?? '';

  const addFavorite = (path: string) => {
    if (!path || favorites.includes(path)) return;
    void updateSettings({ favorites: [...favorites, path] });
  };

  const removeFavorite = (path: string) => {
    void updateSettings({ favorites: favorites.filter((f) => f !== path) });
  };

  const moveFavorite = (path: string, delta: -1 | 1) => {
    const idx = favorites.indexOf(path);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= favorites.length) return;
    const next = [...favorites];
    const [item] = next.splice(idx, 1);
    next.splice(to, 0, item);
    void updateSettings({ favorites: next });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const paths: string[] = [];
    for (const file of Array.from(e.dataTransfer.files)) {
      const p = (file as unknown as { path?: string }).path;
      if (typeof p === 'string' && p.length > 0) paths.push(p);
    }
    const uriList = e.dataTransfer.getData('text/uri-list');
    if (uriList) {
      for (const line of uriList.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('file://')) {
          try {
            paths.push(decodeURIComponent(new URL(trimmed).pathname));
          } catch {
            // ignore malformed URI
          }
        }
      }
    }
    if (paths.length > 0) {
      const next = Array.from(new Set([...favorites, ...paths]));
      void updateSettings({ favorites: next });
    }
  };

  return (
    <div className="flex flex-col h-full w-full min-h-0 text-xs">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border shrink-0">
        <span className="font-semibold text-foreground flex-1">{t('activityBar.explorer')}</span>
        <button
          type="button"
          aria-label={t('explorer.newTab')}
          title={t('explorer.newTab')}
          onClick={newTab}
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">
          {t('explorer.openTabs')}
        </div>
        {explorerTabs.length === 0 ? (
          <p className="px-3 py-1 text-muted-foreground">{t('explorer.noOpenTabs')}</p>
        ) : (
          explorerTabs.map((tb) => {
            const isActive = tb.id === activeTabId;
            return (
              <div
                key={tb.id}
                onClick={() => setActiveTab(tb.id)}
                className={cn(
                  'group flex items-center gap-2 px-3 py-1.5 cursor-pointer',
                  isActive ? 'bg-primary/10 text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent/40',
                )}
              >
                <Folder className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate flex-1">{tb.title}</span>
                <button
                  type="button"
                  aria-label={t('workspace.closeTab')}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tb.id);
                  }}
                  className="p-0.5 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-muted shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        )}

        <div
          className="px-3 pt-3 pb-1 text-[11px] font-medium text-muted-foreground flex items-center gap-1"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <span className="flex-1">{t('explorer.favorites')}</span>
          <button
            type="button"
            aria-label={t('explorer.addFavorite')}
            title={t('explorer.addFavorite')}
            disabled={!activeExplorerPath}
            onClick={() => addFavorite(activeExplorerPath)}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40 disabled:opacity-30 disabled:pointer-events-none"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {favorites.length === 0 ? (
          <p className="px-3 py-1 text-muted-foreground">{t('explorer.noFavorites')}</p>
        ) : (
          favorites.map((fav) => (
            <div
              key={fav}
              onClick={() => openOrFocus(fav)}
              className="group flex items-center gap-2 px-3 py-1.5 cursor-pointer text-muted-foreground hover:text-foreground hover:bg-accent/40"
            >
              <Star className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate flex-1" title={fav}>{baseNameOf(fav)}</span>
              <span className="hidden group-hover:flex items-center shrink-0">
                <button
                  type="button"
                  aria-label={t('explorer.moveUp')}
                  onClick={(e) => {
                    e.stopPropagation();
                    moveFavorite(fav, -1);
                  }}
                  className="p-0.5 rounded hover:bg-muted"
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label={t('explorer.moveDown')}
                  onClick={(e) => {
                    e.stopPropagation();
                    moveFavorite(fav, 1);
                  }}
                  className="p-0.5 rounded hover:bg-muted"
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label={t('explorer.removeFavorite')}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFavorite(fav);
                  }}
                  className="p-0.5 rounded hover:bg-muted"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            </div>
          ))
        )}

        <div className="px-3 pt-3 pb-1 text-[11px] font-medium text-muted-foreground">
          {t('explorer.system')}
        </div>
        {systemFolders.map((folder) => (
          <div
            key={folder.id}
            onClick={() => openOrFocus(folder.path)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 cursor-pointer text-muted-foreground hover:text-foreground hover:bg-accent/40',
              !folder.exists && 'opacity-40',
            )}
            title={folder.path}
          >
            <Monitor className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate flex-1">{folder.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ExplorerPanel;
