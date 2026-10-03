import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Search, X } from 'lucide-react';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useJobs } from '@/lib/commander/useJobs';
import { getFileClipboard, setFileClipboard, clearFileClipboard } from '@/lib/commander/clipboard';
import {
  fcListDir,
  fcSystemFolders,
  fcCopy,
  fcMove,
  fcTrash,
  fcDeletePermanent,
  fcRename,
  fcMkdir,
  fcOpenDefault,
  fcSearch,
  fcZip,
  fcUnzip,
} from '@/lib/commander/ipc';
import type { FcEntry } from '@/lib/commander/types';
import { buildFileTab, extOf, planOpenFile } from '@/lib/commander/openFile';
import { AddressBar } from './AddressBar';
import { FileList, type SortKey, type SortDir } from './FileList';
import { PropertiesDialog } from './dialogs/PropertiesDialog';
import { SearchResultsView } from './dialogs/SearchResultsView';
import { cn } from '@/lib/utils';

export interface ExplorerPaneState {
  path: string;
  back: string[];
  fwd: string[];
  sortKey: SortKey;
  sortDir: SortDir;
  showHidden: boolean;
}

export interface PaneStats {
  path: string;
  total: number;
  totalBytes: number;
  selCount: number;
  selBytes: number;
  selNames: string[];
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  showHidden: boolean;
  searching: boolean;
}

export interface ExplorerPaneHandle {
  navigate: (path: string) => void;
  goBack: () => void;
  goForward: () => void;
  goUp: () => void;
  refresh: () => void;
  newFolder: () => void;
  toggleHidden: () => void;
  toggleSearch: () => void;
}

export interface ExplorerPaneProps {
  initial: ExplorerPaneState;
  active: boolean;
  oppositePath: string | null;
  refreshSignal: number;
  handleRef: MutableRefObject<ExplorerPaneHandle | null>;
  onActivate: () => void;
  onChange: (patch: ExplorerPaneState) => void;
  onStats: (stats: PaneStats) => void;
}

function baseNameOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function parentOf(path: string): string | null {
  if (!path) return null;
  const clean = path.replace(/[\\/]+$/, '');
  const idx = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  if (idx < 0) return null;
  if (/^[a-zA-Z]:$/.test(clean.slice(0, idx))) return `${clean.slice(0, idx + 1)}\\`;
  if (idx === 0) return '/';
  return clean.slice(0, idx);
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${sep}${name}`;
}

export function ExplorerPane({
  initial,
  active,
  oppositePath,
  refreshSignal,
  handleRef,
  onActivate,
  onChange,
  onStats,
}: ExplorerPaneProps) {
  const { t } = useLanguage();
  const { openTab } = useWorkspaceTabs();
  const { settings, updateSettings } = useSettings();
  const { jobs, registerJob, cancelJob, dismissJob } = useJobs();

  const [path, setPath] = useState(initial.path);
  const [back, setBack] = useState<string[]>(initial.back);
  const [fwd, setFwd] = useState<string[]>(initial.fwd);
  const [sortKey, setSortKey] = useState<SortKey>(initial.sortKey);
  const [sortDir, setSortDir] = useState<SortDir>(initial.sortDir);
  const [showHidden, setShowHidden] = useState(initial.showHidden);
  const [entries, setEntries] = useState<FcEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchJobId, setSearchJobId] = useState<string | null>(null);
  const [propsPaths, setPropsPaths] = useState<string[] | null>(null);
  const [editing, setEditing] = useState<{ path: string; value: string } | null>(null);
  const [mkdir, setMkdir] = useState(false);
  const [mkdirValue, setMkdirValue] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [lastRefresh, setLastRefresh] = useState(() => Date.now());
  const anchorRef = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // P12-01: 찾기 모드 종료 = job 정리 + 결과 화면 닫기 + 원래 목록 복원.
  const clearSearch = useCallback(() => {
    if (searchJobId) {
      dismissJob(searchJobId);
    }
    setSearchJobId(null);
  }, [searchJobId, dismissJob]);

  // 찾기 입력창 토글: 평소에는 아이콘만 보이고, Ctrl+F·버튼으로 펼쳤다 접었다 한다.
  const toggleSearch = useCallback(() => {
    setSearchOpen((prev) => {
      if (prev) {
        if (searchJobId) {
          dismissJob(searchJobId);
        }
        setSearchJobId(null);
        setSearchText('');
      }
      return !prev;
    });
  }, [searchJobId, dismissJob]);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!path) {
        const folders = await fcSystemFolders();
        setEntries(
          folders.map((f) => ({
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
        );
      } else {
        setEntries(await fcListDir(path, showHidden));
      }
    } catch (err) {
      setError(t('explorer.loadFailed', { err: err instanceof Error ? err.message : String(err) }));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [path, showHidden, t]);

  useEffect(() => {
    // 경로 변경 시 목록 로드 (데이터 페칭).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload, refreshSignal]);

  // 외부 새로고침 신호(채팅 종료·수동 새로고침).
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);
  const firstSignal = useRef(true);
  useEffect(() => {
    if (firstSignal.current) {
      firstSignal.current = false;
      return;
    }
    void reloadRef.current();
  }, [refreshSignal]);

  // job 완료 시 목록 새로고침.
  useEffect(() => {
    const fresh = jobs.some((j) => j.startedAt >= lastRefresh && j.status !== 'running');
    if (fresh) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastRefresh(Date.now());
      void reloadRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  const sorted = useMemo(() => {
    const arr = [...entries];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const aDir = a.kind === 'dir';
      const bDir = b.kind === 'dir';
      if (aDir !== bDir) return aDir ? -1 : 1;
      switch (sortKey) {
        case 'size':
          return (a.size - b.size) * dir;
        case 'kind':
          return extOf(a.name).localeCompare(extOf(b.name)) * dir;
        case 'modified':
          return ((a.modified_ms ?? 0) - (b.modified_ms ?? 0)) * dir;
        default:
          return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) * dir;
      }
    });
    return arr;
  }, [entries, sortKey, sortDir]);

  // 리스트 최상단은 항상 ".."(상위 폴더) 행이다. 탐색용이며 집계·일괄 선택에서는 제외한다.
  const parentPath = parentOf(path);
  const displayEntries = useMemo(() => {
    if (!parentPath) return sorted;
    const up: FcEntry = {
      name: '..',
      path: parentPath,
      kind: 'dir',
      size: 0,
      modified_ms: null,
      hidden: false,
      readonly: false,
      symlink: false,
      warning: false,
    };
    return [up, ...sorted];
  }, [sorted, parentPath]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const totalBytes = useMemo(() => entries.reduce((s, e) => s + e.size, 0), [entries]);
  const selEntries = useMemo(
    () => entries.filter((e) => selectedSet.has(e.path)),
    [entries, selectedSet],
  );
  const selBytes = useMemo(() => selEntries.reduce((s, e) => s + e.size, 0), [selEntries]);

  // 부모(상태바·툴바)에 창 요약 보고.
  const onStatsRef = useRef(onStats);
  useEffect(() => {
    onStatsRef.current = onStats;
  }, [onStats]);
  useEffect(() => {
    onStatsRef.current({
      path,
      total: entries.length,
      totalBytes,
      selCount: selected.length,
      selBytes,
      selNames: selEntries.map((e) => e.name),
      canBack: back.length > 0,
      canForward: fwd.length > 0,
      canUp: parentOf(path) !== null,
      showHidden,
      searching: searchJobId !== null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, entries.length, totalBytes, selected, selBytes, back.length, fwd.length, showHidden, searchJobId]);

  const emit = useCallback(
    (next: ExplorerPaneState) => {
      onChange(next);
    },
    [onChange],
  );

  const navigate = useCallback(
    (next: string, pushHistory = true) => {
      const current = path;
      let nb = back;
      const nf: string[] = [];
      if (pushHistory && current !== next) {
        nb = [...back, current];
      }
      setBack(nb);
      setFwd(nf);
      emit({ path: next, back: nb, fwd: nf, sortKey, sortDir, showHidden });
      setPath(next);
      setSelected([]);
      setActivePath(null);
      // P12-01: 폴더 이동 시 찾기 모드를 종료하고 원래 목록으로 복원한다.
      clearSearch();
      setSearchText('');
      setSearchOpen(false);
    },
    [emit, path, back, sortKey, sortDir, showHidden, clearSearch],
  );

  const goBack = useCallback(() => {
    const prev = back[back.length - 1];
    if (prev === undefined) return;
    const cur = path;
    const nb = back.slice(0, -1);
    const nf = [cur, ...fwd];
    setBack(nb);
    setFwd(nf);
    emit({ path: prev, back: nb, fwd: nf, sortKey, sortDir, showHidden });
    setPath(prev);
    setSelected([]);
    // P12-01: 백 버튼은 찾기 결과에서도 원래 폴더로 복원한다.
    clearSearch();
    setSearchOpen(false);
  }, [back, fwd, path, emit, sortKey, sortDir, showHidden, clearSearch]);

  const goForward = useCallback(() => {
    const next = fwd[0];
    if (next === undefined) return;
    const cur = path;
    const nb = [...back, cur];
    const nf = fwd.slice(1);
    setBack(nb);
    setFwd(nf);
    emit({ path: next, back: nb, fwd: nf, sortKey, sortDir, showHidden });
    setPath(next);
    setSelected([]);
    clearSearch();
    setSearchOpen(false);
  }, [back, fwd, path, emit, sortKey, sortDir, showHidden, clearSearch]);

  const goUp = useCallback(() => {
    const parent = parentOf(path);
    if (parent !== null) navigate(parent);
  }, [navigate, path]);

  const refresh = useCallback(() => {
    void reloadRef.current();
  }, []);

  const newFolder = useCallback(() => {
    setMkdirValue(t('explorer.newFolderName'));
    setMkdir(true);
  }, [t]);

  const toggleHidden = useCallback(() => {
    const next = !showHidden;
    setShowHidden(next);
    emit({ path, back, fwd, sortKey, sortDir, showHidden: next });
  }, [emit, path, back, fwd, sortKey, sortDir, showHidden]);

  useEffect(() => {
    handleRef.current = { navigate, goBack, goForward, goUp, refresh, newFolder, toggleHidden, toggleSearch };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, navigate, goBack, goForward, goUp, refresh, newFolder, toggleHidden, toggleSearch]);

  const openPath = useCallback(
    (target: string, isDir: boolean, size = 0) => {
      if (isDir) {
        navigate(target);
        return;
      }
      const plan = planOpenFile(target, size);
      if (plan.action === 'external') {
        void fcOpenDefault(target).catch((err) => {
          setError(t('explorer.opFailed', { err: err instanceof Error ? err.message : String(err) }));
        });
        return;
      }
      openTab(buildFileTab(plan));
    },
    [navigate, openTab, t],
  );

  const openEntry = useCallback(
    (entry: FcEntry) => {
      openPath(entry.path, entry.kind === 'dir', entry.size);
    },
    [openPath],
  );

  const effectivePaths = useCallback((): string[] => {
    if (selected.length > 0) return selected;
    if (activePath) return [activePath];
    return [];
  }, [selected, activePath]);

  // ".." 행(상위 폴더 경로)은 파일 작업 대상에서 제외한다.
  const opTargets = useCallback((): string[] => {
    const targets = effectivePaths();
    if (!parentPath) return targets;
    return targets.filter((p) => p !== parentPath);
  }, [effectivePaths, parentPath]);

  const runJob = useCallback(
    async (kind: 'copy' | 'move' | 'zip' | 'unzip', label: string, start: () => Promise<string>) => {
      try {
        const id = await start();
        registerJob(id, kind, label);
      } catch (err) {
        setError(t('explorer.opFailed', { err: err instanceof Error ? err.message : String(err) }));
      }
    },
    [registerJob, t],
  );

  const doCopyMove = useCallback(
    (isMove: boolean) => {
      const sources = opTargets();
      if (sources.length === 0 || !path) return;
      const dest = oppositePath && oppositePath !== path ? oppositePath : path;
      const sameDir = dest === path;
      const label = `${isMove ? t('explorer.ctxCut') : t('explorer.ctxCopy')} → ${baseNameOf(dest)}`;
      void runJob(isMove ? 'move' : 'copy', label, () =>
        isMove ? fcMove(sources, dest, sameDir ? 'rename' : 'ask') : fcCopy(sources, dest, sameDir ? 'rename' : 'ask'),
      );
    },
    [opTargets, path, oppositePath, runJob, t],
  );

  const doPaste = useCallback(() => {
    const clip = getFileClipboard();
    if (!clip || clip.paths.length === 0 || !path) return;
    const label = `${clip.mode === 'cut' ? t('explorer.ctxCut') : t('explorer.ctxCopy')} → ${baseNameOf(path)}`;
    void runJob(clip.mode === 'cut' ? 'move' : 'copy', label, () =>
      clip.mode === 'cut' ? fcMove(clip.paths, path, 'ask') : fcCopy(clip.paths, path, 'ask'),
    );
  }, [path, runJob, t]);

  const doDelete = useCallback(
    async (permanent: boolean) => {
      const targets = opTargets();
      if (targets.length === 0) return;
      if (permanent) {
        if (!window.confirm(t('explorer.permanentConfirm', { n: String(targets.length) }))) return;
        try {
          await fcDeletePermanent(targets);
          setSelected([]);
          void reloadRef.current();
        } catch (err) {
          setError(t('explorer.opFailed', { err: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }
      try {
        await fcTrash(targets);
        setSelected([]);
        void reloadRef.current();
      } catch (err) {
        setError(t('explorer.opFailed', { err: err instanceof Error ? err.message : String(err) }));
      }
    },
    [opTargets, t],
  );

  const doZip = useCallback(() => {
    const sources = opTargets();
    if (sources.length === 0 || !path) return;
    const dest = joinPath(path, 'archive.zip');
    void runJob('zip', `${t('explorer.ctxZip')} → archive.zip`, () => fcZip(sources, dest));
  }, [opTargets, path, runJob, t]);

  const doUnzip = useCallback(() => {
    const sources = opTargets().filter((p) => p.toLowerCase().endsWith('.zip'));
    if (sources.length === 0 || !path) return;
    const first = sources[0];
    void runJob('unzip', `${t('explorer.ctxUnzip')}`, () => fcUnzip(first, path));
  }, [opTargets, path, runJob, t]);

  const doFavorite = useCallback(() => {
    const dirs = opTargets().filter((p) => entries.some((e) => e.path === p && e.kind === 'dir'));
    const toAdd = dirs.length > 0 ? dirs : path ? [path] : [];
    if (toAdd.length === 0) return;
    const next = Array.from(new Set([...settings.favorites, ...toAdd]));
    void updateSettings({ favorites: next });
  }, [opTargets, entries, path, settings.favorites, updateSettings]);

  const commitRename = useCallback(async () => {
    if (!editing) return;
    if (editing.path === parentPath) {
      setEditing(null);
      return;
    }
    const value = editing.value.trim();
    setEditing(null);
    if (!value || baseNameOf(editing.path) === value) return;
    try {
      await fcRename(editing.path, value);
      setSelected((prev) => prev.map((p) => (p === editing.path ? joinPath(parentOf(editing.path) ?? path, value) : p)));
      void reloadRef.current();
    } catch (err) {
      setError(t('explorer.opFailed', { err: err instanceof Error ? err.message : String(err) }));
    }
  }, [editing, path, parentPath, t]);

  const commitMkdir = useCallback(async () => {
    const value = mkdirValue.trim();
    setMkdir(false);
    setMkdirValue('');
    if (!value || !path) return;
    try {
      await fcMkdir(joinPath(path, value));
      void reloadRef.current();
    } catch (err) {
      setError(t('explorer.opFailed', { err: err instanceof Error ? err.message : String(err) }));
    }
  }, [mkdirValue, path, t]);

  const select = useCallback(
    (target: string, mode: 'single' | 'toggle' | 'range') => {
      setActivePath(target);
      if (mode === 'toggle') {
        setSelected((prev) => (prev.includes(target) ? prev.filter((p) => p !== target) : [...prev, target]));
        anchorRef.current = target;
        return;
      }
      if (mode === 'range' && anchorRef.current) {
        const order = displayEntries.map((e) => e.path);
        const a = order.indexOf(anchorRef.current);
        const b = order.indexOf(target);
        if (a >= 0 && b >= 0) {
          const [from, to] = a <= b ? [a, b] : [b, a];
          setSelected(order.slice(from, to + 1));
          return;
        }
      }
      setSelected([target]);
      anchorRef.current = target;
    },
    [displayEntries],
  );

  const moveActive = useCallback(
    (delta: number, extend: boolean) => {
      if (displayEntries.length === 0) return;
      const idx = activePath ? displayEntries.findIndex((e) => e.path === activePath) : -1;
      const next = Math.min(displayEntries.length - 1, Math.max(0, (idx < 0 ? (delta > 0 ? -1 : 0) : idx) + delta));
      const target = displayEntries[next].path;
      if (extend) {
        select(target, 'range');
      } else {
        select(target, 'single');
      }
      setActivePath(target);
    },
    [displayEntries, activePath, select],
  );

  const startSearch = useCallback(async () => {
    const q = searchText.trim();
    // P12-01: 빈 검색어로 찾기를 실행하면 원래 폴더 보기로 복원한다.
    if (!q || !path) {
      clearSearch();
      return;
    }
    try {
      // 내용 쿼리는 정규식으로 해석되므로 리터럴로 이스케이프한다.
      // 이름 패턴은 Rust에서 glob 메타문자 없으면 부분 일치로 처리된다.
      const literal = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const id = await fcSearch({ root: path, namePattern: q, contentQuery: literal });
      registerJob(id, 'search', q);
      setSearchJobId(id);
    } catch (err) {
      setError(t('explorer.opFailed', { err: err instanceof Error ? err.message : String(err) }));
    }
  }, [searchText, path, registerJob, clearSearch, t]);

  const searchJob = searchJobId ? jobs.find((j) => j.id === searchJobId) : undefined;

  const handleKey = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        if (e.key === 'Escape') target.blur();
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      // Alt + ←/→: 이전/다음 폴더 (마우스 네비게이션 버튼과 동일).
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        goBack();
        return;
      }
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        goForward();
        return;
      }
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          if (activePath) {
            if (activePath === parentPath) {
              goUp();
            } else {
              const entry = displayEntries.find((en) => en.path === activePath);
              if (entry) openEntry(entry);
            }
          }
          break;
        case 'Backspace':
          e.preventDefault();
          goUp();
          break;
        case 'F2':
          e.preventDefault();
          if (activePath && activePath !== parentPath) {
            setEditing({ path: activePath, value: baseNameOf(activePath) });
          }
          break;
        case 'F5':
          e.preventDefault();
          doCopyMove(false);
          break;
        case 'F6':
          e.preventDefault();
          doCopyMove(true);
          break;
        case 'F7':
          e.preventDefault();
          setMkdirValue(t('explorer.newFolderName'));
          setMkdir(true);
          break;
        case 'Delete':
          e.preventDefault();
          void doDelete(e.shiftKey);
          break;
        case 'Escape':
          clearFileClipboard();
          setSelected([]);
          setCtxMenu(null);
          break;
        default:
          break;
      }
      if (ctrl && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        const targets = opTargets();
        if (targets.length > 0) setFileClipboard('copy', targets);
      } else if (ctrl && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        const targets = opTargets();
        if (targets.length > 0) setFileClipboard('cut', targets);
      } else if (ctrl && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        doPaste();
      } else if (ctrl && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        setSelected(sorted.map((en) => en.path));
      } else if (ctrl && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        toggleSearch();
      } else if (e.altKey && (e.key === 'Enter')) {
        e.preventDefault();
        const targets = effectivePaths();
        if (targets.length > 0) setPropsPaths(targets);
      }
      if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        moveActive(e.key === 'ArrowDown' ? 1 : -1, true);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        moveActive(e.key === 'ArrowDown' ? 1 : -1, false);
      }
    },
    [activePath, displayEntries, openEntry, goUp, goBack, goForward, parentPath, doCopyMove, doDelete, doPaste, effectivePaths, opTargets, sorted, moveActive, toggleSearch, t],
  );

  const openCtxMenu = useCallback(
    (e: React.MouseEvent, entry: FcEntry | null) => {
      e.preventDefault();
      if (entry && !selectedSet.has(entry.path)) {
        select(entry.path, 'single');
      }
      setCtxMenu({
        x: Math.min(e.clientX, window.innerWidth - 230),
        y: Math.min(e.clientY, window.innerHeight - 320),
      });
    },
    [selectedSet, select],
  );

  const clip = getFileClipboard();
  const ctxTargets = effectivePaths();
  const menuItem = 'flex w-full items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left cursor-pointer disabled:pointer-events-none disabled:opacity-50';

  return (
    <div
      className={cn(
        'flex flex-col h-full w-full min-h-0 bg-editor min-w-0',
        active && 'ring-1 ring-inset ring-primary/40',
      )}
      onKeyDown={handleKey}
      tabIndex={0}
      onClick={() => {
        setCtxMenu(null);
        onActivate();
      }}
      onFocus={onActivate}
      onMouseDown={(e) => {
        // 마우스 네비게이션 버튼(뒤로/앞으로): 상단 컨트롤 아이콘과 동일 동작.
        if (e.button === 3) {
          e.preventDefault();
          goBack();
        } else if (e.button === 4) {
          e.preventDefault();
          goForward();
        }
      }}
    >
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border shrink-0 min-w-0">
        <div className="flex-1 min-w-0">
          <AddressBar path={path} onNavigate={(next) => navigate(next)} />
        </div>
        {searchOpen ? (
          <div className="relative w-40 shrink-0 min-w-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
            <input
              ref={searchInputRef}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
                  e.preventDefault();
                  toggleSearch();
                  return;
                }
                if (e.key === 'Enter') void startSearch();
                if (e.key === 'Escape') toggleSearch();
              }}
              placeholder={t('explorer.searchPlaceholder')}
              className="w-full rounded-md border border-input bg-background pl-7 pr-7 py-1 text-xs outline-none focus:border-primary placeholder:text-muted-foreground/60"
            />
            <button
              type="button"
              onClick={toggleSearch}
              title={t('workspace.close')}
              aria-label={t('workspace.close')}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={toggleSearch}
            title={t('explorer.toggleSearch')}
            aria-label={t('explorer.toggleSearch')}
            className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {error && (
        <div className="px-3 py-1.5 text-xs text-destructive bg-destructive/10 border-b border-destructive/20 shrink-0 flex items-center justify-between gap-2">
          <span className="truncate">{error}</span>
          <button type="button" onClick={() => setError(null)} className="shrink-0 hover:opacity-70">
            {t('workspace.close')}
          </button>
        </div>
      )}
      {searchJobId && searchJob ? (
        <SearchResultsView
          matches={searchJob.matches}
          searching={searchJob.status === 'running'}
          onOpenPath={(p, isDir) => {
            if (isDir) {
              navigate(p);
            } else {
              clearSearch();
              openPath(p, false);
            }
          }}
          onCancel={() => {
            void cancelJob(searchJobId);
          }}
          onClear={() => {
            clearSearch();
          }}
        />
      ) : loading && entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
          {t('explorer.loading')}
        </div>
      ) : (
        <FileList
          entries={displayEntries}
          selected={selectedSet}
          activePath={activePath}
          sortKey={sortKey}
          sortDir={sortDir}
          editingPath={editing?.path ?? null}
          editingValue={editing?.value ?? ''}
          creatingMkdir={mkdir}
          mkdirValue={mkdirValue}
          onSelect={select}
          onOpen={openEntry}
          onContextMenu={openCtxMenu}
          onSort={(key) => {
            if (key === sortKey) {
              const next: SortDir = sortDir === 'asc' ? 'desc' : 'asc';
              setSortDir(next);
              emit({ path, back, fwd, sortKey, sortDir: next, showHidden });
            } else {
              setSortKey(key);
              emit({ path, back, fwd, sortKey: key, sortDir, showHidden });
            }
          }}
          onEditingChange={(value) => setEditing((prev) => (prev ? { ...prev, value } : prev))}
          onEditingCommit={() => void commitRename()}
          onEditingCancel={() => setEditing(null)}
          onMkdirChange={setMkdirValue}
          onMkdirCommit={() => void commitMkdir()}
          onMkdirCancel={() => {
            setMkdir(false);
            setMkdirValue('');
          }}
        />
      )}
      {ctxMenu && (
        <div
          role="menu"
          className="fixed z-50 w-56 rounded-md border border-border bg-popover/95 p-1 text-popover-foreground shadow-md backdrop-blur-sm text-xs select-none"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button type="button" role="menuitem" className={menuItem} disabled={ctxTargets.length === 0} onClick={() => { setCtxMenu(null); if (activePath) { const en = displayEntries.find((x) => x.path === activePath); if (en) openEntry(en); } }}>
            {t('explorer.ctxOpen')}
          </button>
          <button type="button" role="menuitem" className={menuItem} disabled={ctxTargets.length === 0} onClick={() => { setCtxMenu(null); for (const p of ctxTargets) void fcOpenDefault(p).catch(() => {}); }}>
            {t('explorer.ctxOpenDefault')}
          </button>
          <div className="-mx-1 my-1 h-px bg-border" />
          <button type="button" role="menuitem" className={menuItem} disabled={ctxTargets.length === 0} onClick={() => { setCtxMenu(null); if (ctxTargets.length > 0) setFileClipboard('copy', ctxTargets); }}>
            {t('explorer.ctxCopy')}
          </button>
          <button type="button" role="menuitem" className={menuItem} disabled={ctxTargets.length === 0} onClick={() => { setCtxMenu(null); if (ctxTargets.length > 0) setFileClipboard('cut', ctxTargets); }}>
            {t('explorer.ctxCut')}
          </button>
          <button type="button" role="menuitem" className={menuItem} disabled={!clip || !path} onClick={() => { setCtxMenu(null); doPaste(); }}>
            {t('explorer.ctxPaste')}
          </button>
          <button type="button" role="menuitem" className={menuItem} disabled={ctxTargets.length !== 1 || ctxTargets[0] === parentPath} onClick={() => { setCtxMenu(null); const p = ctxTargets[0]; if (p) setEditing({ path: p, value: baseNameOf(p) }); }}>
            {t('explorer.ctxRename')}
          </button>
          <button type="button" role="menuitem" className={menuItem} disabled={ctxTargets.length === 0} onClick={() => { setCtxMenu(null); void doDelete(false); }}>
            {t('explorer.ctxDelete')}
          </button>
          <button type="button" role="menuitem" className={menuItem} disabled={ctxTargets.length === 0} onClick={() => { setCtxMenu(null); void doDelete(true); }}>
            {t('explorer.ctxPermanentDelete')}
          </button>
          <div className="-mx-1 my-1 h-px bg-border" />
          <button type="button" role="menuitem" className={menuItem} disabled={ctxTargets.length === 0} onClick={() => { setCtxMenu(null); doZip(); }}>
            {t('explorer.ctxZip')}
          </button>
          <button type="button" role="menuitem" className={menuItem} disabled={!ctxTargets.some((p) => p.toLowerCase().endsWith('.zip'))} onClick={() => { setCtxMenu(null); doUnzip(); }}>
            {t('explorer.ctxUnzip')}
          </button>
          <button type="button" role="menuitem" className={menuItem} disabled={ctxTargets.length === 0} onClick={() => { setCtxMenu(null); const text = ctxTargets.join('\n'); void navigator.clipboard?.writeText(text).catch(() => {}); }}>
            {t('explorer.ctxCopyPath')}
          </button>
          <button type="button" role="menuitem" className={menuItem} onClick={() => { setCtxMenu(null); doFavorite(); }}>
            {t('explorer.ctxFavorite')}
          </button>
          <button type="button" role="menuitem" className={menuItem} disabled={ctxTargets.length === 0} onClick={() => { setCtxMenu(null); setPropsPaths(ctxTargets); }}>
            {t('explorer.ctxInfo')}
          </button>
          <div className="-mx-1 my-1 h-px bg-border" />
          <button type="button" role="menuitem" className={menuItem} disabled title={t('explorer.ctxAskAgent')}>
            {t('explorer.ctxAskAgent')}
          </button>
        </div>
      )}
      {propsPaths && <PropertiesDialog paths={propsPaths} onClose={() => setPropsPaths(null)} />}
    </div>
  );
}

export default ExplorerPane;
