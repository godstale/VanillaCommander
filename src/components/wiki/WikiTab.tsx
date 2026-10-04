// P11-31: 위키 설정 탭. 감시·이동·분류·필터·프롬프트·처리 에이전트 + 처리 이력.
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openFolderDialog } from '@tauri-apps/plugin-dialog';
import { BookOpen, Plus, Trash2, RotateCcw, FolderSearch, FolderOpen } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import { useAgents } from '@/lib/context/AgentsContext';
import type { WikiSettings } from '@/lib/db/repositories/settingsRepo';
import { DEFAULT_WIKI_PROMPT, isSystemWatchFolder } from '@/lib/wiki/settings';
import {
  listWikiJobs,
  updateWikiJob,
  type WikiJob,
} from '@/lib/db/repositories/wikiJobsRepo';
import { fcReveal } from '@/lib/commander/ipc';
import { Button } from '@/components/ui/button';

export function WikiTab() {
  const { t } = useLanguage();
  const { settings, updateSettings } = useSettings();
  const workspace = useSafeWorkspace();
  const { agents, defaultAgent, loading: agentsLoading } = useAgents();
  const workspaceRoot = workspace?.workspaceRoot ?? null;

  const [form, setForm] = useState<WikiSettings>(settings.wiki);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<WikiJob[]>([]);
  const [saved, setSaved] = useState(false);

  // 편집 중(미저장) 값이 있으면 저장 결과가 되돌아와 입력을 덮어쓰지 않도록 동기화를 막는다.
  const dirtyRef = useRef(false);
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  }, [form]);

  // 다른 화면에서 바뀐 설정을 열 때마다 반영한다.
  useEffect(() => {
    if (dirtyRef.current) return;
    setForm(settings.wiki);
  }, [settings.wiki]);

  const refreshJobs = useCallback(async () => {
    try {
      setJobs(await listWikiJobs(100, workspaceRoot));
    } catch {
      // ignore
    }
  }, [workspaceRoot]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 탭 표시 시 이력 1회 로드
    void refreshJobs();
  }, [refreshJobs]);

  const set = useCallback(
    <K extends keyof WikiSettings>(key: K, value: WikiSettings[K]) => {
      dirtyRef.current = true;
      setForm((prev) => ({ ...prev, [key]: value }));
      setSaved(false);
    },
    [],
  );

  const addFoldersViaDialog = useCallback(async () => {
    setFolderError(null);
    let picked: string | string[] | null;
    try {
      picked = await openFolderDialog({ directory: true, multiple: true });
    } catch {
      setFolderError(t('wiki.watchApplyFailed'));
      return;
    }
    if (!picked) return;
    const dirs = Array.isArray(picked) ? picked : [picked];
    if (dirs.some((d) => isSystemWatchFolder(d))) {
      setFolderError(t('wiki.systemFolderBlocked'));
    }
    const paths = new Set(form.watchFolders.map((f) => f.path));
    const fresh = dirs.filter((d) => !isSystemWatchFolder(d) && !paths.has(d));
    if (fresh.length > 0) {
      set('watchFolders', [...form.watchFolders, ...fresh.map((path) => ({ path, recursive: false }))]);
    }
  }, [form.watchFolders, set, t]);

  const removeFolder = useCallback((path: string) => {
    set('watchFolders', form.watchFolders.filter((f) => f.path !== path));
  }, [form.watchFolders, set]);

  const pickInboxDirViaDialog = useCallback(async () => {
    let picked: string | string[] | null;
    try {
      picked = await openFolderDialog({ directory: true, multiple: false });
    } catch {
      return;
    }
    if (!picked) return;
    const dir = Array.isArray(picked) ? picked[0] : picked;
    if (!dir) return;
    set('inboxDir', dir);
  }, [set]);

  const toggleFolderRecursive = useCallback((path: string, value: boolean) => {
    set(
      'watchFolders',
      form.watchFolders.map((f) => (f.path === path ? { ...f, recursive: value } : f)),
    );
  }, [form.watchFolders, set]);

  // 변경 즉시 저장 (입력이 멈춘 뒤 잠시 후). 저장 버튼은 없다.
  const persist = useCallback(async (snapshot: WikiSettings) => {
    if (snapshot.watchFolders.some((f) => isSystemWatchFolder(f.path))) {
      setFolderError(t('wiki.systemFolderBlocked'));
      return;
    }
    setFolderError(null);
    // 구 백엔드·구 저장값 호환: 전역 recursive는 폴더별 값의 OR로 함께 저장한다.
    const payload: WikiSettings = {
      ...snapshot,
      recursive: snapshot.watchFolders.some((f) => f.recursive),
    };
    await updateSettings({ wiki: payload });
    // 저장하는 사이 추가 편집이 없었을 때만 동기화를 다시 허용한다.
    if (JSON.stringify(formRef.current) === JSON.stringify(snapshot)) {
      dirtyRef.current = false;
    }
    try {
      if (payload.watchEnabled) {
        await invoke('wiki_watch_set', {
          folders: payload.watchFolders,
          recursive: payload.recursive,
        });
      } else {
        await invoke('wiki_watch_stop');
      }
    } catch (err) {
      console.error('Failed to apply wiki watch:', err);
      setFolderError(t('wiki.watchApplyFailed'));
      return;
    }
    setSaved(true);
  }, [t, updateSettings]);

  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = setTimeout(() => {
      void persist(form);
    }, 600);
    return () => clearTimeout(timer);
  }, [form, persist]);

  const handleReprocess = useCallback(async (job: WikiJob) => {
    await updateWikiJob(job.id, { status: 'queued', reason: null }, workspaceRoot);
    void refreshJobs();
  }, [workspaceRoot, refreshJobs]);

  const handleReveal = useCallback(async (job: WikiJob) => {
    try {
      await fcReveal(job.sourcePath);
    } catch (err) {
      console.error('Failed to reveal source:', err);
    }
  }, []);

  const selectedAgent = form.agentId ? agents.find((a) => a.id === form.agentId) : undefined;
  // 첫 번째 선택지가 이미 "기본 에이전트(따라가기)"이므로 목록에서는 기본을 빼고
  // 나머지 에이전트만 고정 선택지로 보여준다. 에이전트가 1개면 선택지는 1개가 된다.
  const pinnableAgents = agents.filter((a) => a.id !== defaultAgent?.id);
  const agentSelectValue =
    form.agentId && form.agentId !== defaultAgent?.id ? form.agentId : '';

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">{t('wiki.tabTitle')}</h2>
        </div>

        {/* 폴더 감시 */}
        <section className="border border-border rounded-xl p-5 bg-card/40 space-y-3">
          <h3 className="text-sm font-semibold">{t('wiki.sectionWatch')}</h3>
          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={form.watchEnabled}
              onChange={(e) => set('watchEnabled', e.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <span>
              <span className="font-medium block">{t('wiki.watchEnabled')}</span>
              <span className="text-muted-foreground">{t('wiki.watchEnabledDesc')}</span>
            </span>
          </label>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t('wiki.scanInterval')}
            </label>
            <input
              type="number"
              min={0}
              max={1440}
              value={form.scanIntervalMin}
              onChange={(e) => set('scanIntervalMin', Math.max(0, Number(e.target.value) || 0))}
              className="w-32 px-3 py-1.5 text-xs rounded-md border border-border bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{t('wiki.scanIntervalDesc')}</p>
          </div>
          <div>
            <span className="block text-xs font-medium text-muted-foreground mb-1">
              {t('wiki.watchFoldersLabel')}
            </span>
            <ul className="space-y-1 mb-2">
              {form.watchFolders.map((folder) => (
                <li
                  key={folder.path}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-border bg-background text-xs"
                >
                  <span className="truncate font-mono" title={folder.path}>{folder.path}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <label
                      className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer"
                      title={t('wiki.recursiveDesc')}
                    >
                      <input
                        type="checkbox"
                        checked={folder.recursive}
                        onChange={(e) => toggleFolderRecursive(folder.path, e.target.checked)}
                        className="accent-primary"
                      />
                      <span>{t('wiki.recursiveFolder')}</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => removeFolder(folder.path)}
                      aria-label={folder.path}
                      className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex gap-1.5">
              <Button type="button" size="sm" variant="outline" onClick={() => void addFoldersViaDialog()}>
                <Plus className="h-3.5 w-3.5" />
                <span>{t('wiki.addFolder')}</span>
              </Button>
            </div>
            {folderError && (
              <p className="mt-1.5 text-[11px] text-destructive">{folderError}</p>
            )}
          </div>
        </section>

        {/* 등록 후 이동 */}
        <section className="border border-border rounded-xl p-5 bg-card/40 space-y-3">
          <h3 className="text-sm font-semibold">{t('wiki.sectionIngest')}</h3>
          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={form.moveAfterIngest}
              onChange={(e) => set('moveAfterIngest', e.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <span>
              <span className="font-medium block">{t('wiki.moveAfterIngest')}</span>
              <span className="text-muted-foreground">{t('wiki.moveAfterIngestDesc')}</span>
            </span>
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t('wiki.inboxDir')}
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={form.inboxDir}
                  onChange={(e) => set('inboxDir', e.target.value)}
                  placeholder={t('wiki.inboxPlaceholder')}
                  className="flex-1 min-w-0 px-3 py-1.5 text-xs rounded-md border border-border bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <Button type="button" size="sm" variant="outline" onClick={() => void pickInboxDirViaDialog()}>
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>{t('wiki.browseFolder')}</span>
                </Button>
              </div>
            </div>
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={form.allowNewCategories}
                onChange={(e) => set('allowNewCategories', e.target.checked)}
                className="mt-0.5 accent-primary"
              />
              <span>
                <span className="font-medium block">{t('wiki.allowNewCategories')}</span>
                <span className="text-muted-foreground">{t('wiki.allowNewCategoriesDesc')}</span>
              </span>
            </label>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t('wiki.categories')}
            </label>
            <textarea
              rows={6}
              value={form.categories.join('\n')}
              onChange={(e) =>
                set(
                  'categories',
                  e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                )
              }
              className="w-full px-3 py-1.5 text-xs rounded-md border border-border bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{t('wiki.categoriesDesc')}</p>
          </div>
        </section>

        {/* 필터 */}
        <section className="border border-border rounded-xl p-5 bg-card/40 space-y-3">
          <h3 className="text-sm font-semibold">{t('wiki.sectionFilter')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t('wiki.allowedExtensions')}
              </label>
              <input
                type="text"
                value={form.allowedExtensions.join(', ')}
                onChange={(e) =>
                  set(
                    'allowedExtensions',
                    e.target.value.split(',').map((s) => s.trim().replace(/^\./, '').toLowerCase()).filter(Boolean),
                  )
                }
                className="w-full px-3 py-1.5 text-xs rounded-md border border-border bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t('wiki.maxFileMb')}
              </label>
              <input
                type="number"
                min={1}
                max={500}
                value={form.maxFileMb}
                onChange={(e) => set('maxFileMb', Math.max(1, Number(e.target.value) || 20))}
                className="w-full px-3 py-1.5 text-xs rounded-md border border-border bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t('wiki.excludeGlobs')}
            </label>
            <textarea
              rows={2}
              value={form.excludeGlobs.join('\n')}
              onChange={(e) =>
                set(
                  'excludeGlobs',
                  e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                )
              }
              className="w-full px-3 py-1.5 text-xs rounded-md border border-border bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </section>

        {/* 프롬프트 */}
        <section className="border border-border rounded-xl p-5 bg-card/40 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t('wiki.sectionPrompt')}</h3>
            <button
              type="button"
              onClick={() => set('prompt', '')}
              className="text-[11px] text-primary hover:underline cursor-pointer"
            >
              {t('wiki.promptReset')}
            </button>
          </div>
          <textarea
            rows={6}
            value={form.prompt}
            onChange={(e) => set('prompt', e.target.value)}
            placeholder={DEFAULT_WIKI_PROMPT}
            className="w-full px-3 py-2 text-xs rounded-md border border-border bg-background font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </section>

        {/* 처리 에이전트 */}
        <section className="border border-border rounded-xl p-5 bg-card/40 space-y-3">
          <h3 className="text-sm font-semibold">{t('wiki.sectionAgent')}</h3>
          <select
            value={agentSelectValue}
            onChange={(e) => set('agentId', e.target.value || null)}
            disabled={agentsLoading}
            className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          >
            <option value="">
              {t('wiki.agentDefault')}
              {defaultAgent ? ` (${defaultAgent.name})` : ''}
            </option>
            {pinnableAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} • {agent.model}
                {selectedAgent?.id === agent.id && agent.vision === 'no' ? ' ⚠' : ''}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t('wiki.agentVisionNote')}
          </p>
        </section>

        <p className="text-[11px] text-muted-foreground h-4" aria-live="polite">
          {saved ? t('wiki.saved') : t('wiki.autoSaveHint')}
        </p>

        {/* 처리 이력 */}
        <section className="border border-border rounded-xl p-5 bg-card/40 space-y-3">
          <h3 className="text-sm font-semibold">{t('wiki.history')} ({jobs.length})</h3>
          {jobs.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('wiki.historyEmpty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-1.5 pr-2 font-medium">{t('wiki.colFile')}</th>
                    <th className="py-1.5 pr-2 font-medium">{t('wiki.colStatus')}</th>
                    <th className="py-1.5 pr-2 font-medium">{t('wiki.colResult')}</th>
                    <th className="py-1.5 pr-2 font-medium">{t('wiki.colTime')}</th>
                    <th className="py-1.5 font-medium text-right">{t('wiki.colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5 pr-2 font-mono truncate max-w-[220px]" title={job.sourcePath}>
                        {job.sourcePath.split(/[\\/]/).pop()}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap" title={job.reason ?? undefined}>
                        {t(`wiki.status.${job.status}`)}
                      </td>
                      <td className="py-1.5 pr-2 truncate max-w-[200px]" title={job.folder ?? undefined}>
                        {job.title ?? job.reason ?? '—'}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap text-muted-foreground">
                        {new Date(job.updatedAt).toLocaleString()}
                      </td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void handleReprocess(job)}
                          title={t('wiki.reprocess')}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleReveal(job)}
                          title={t('wiki.revealSource')}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                        >
                          <FolderSearch className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default WikiTab;
