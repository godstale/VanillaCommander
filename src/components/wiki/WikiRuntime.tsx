// P14-01: 위키 감시·파이프라인 상시 구동. 패널 표시 여부와 무관하게 앱이 떠 있는 동안 동작한다.
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import { useAgents } from '@/lib/context/AgentsContext';
import { useStatusBar } from '@/lib/context/StatusBarContext';
import { useSidePanel } from '@/lib/context/SidePanelContext';
import {
  configureWikiPipeline,
  reconcileWikiFolders,
  startWikiPipeline,
  subscribeWikiPipeline,
  type WikiPipelineStatus,
} from '@/lib/wiki/pipeline';
import { cn } from '@/lib/utils';

export function WikiRuntime() {
  const { t } = useLanguage();
  const { settings } = useSettings();
  const workspace = useSafeWorkspace();
  const { agents, defaultAgent } = useAgents();
  const { publish, clear } = useStatusBar();
  const { setActiveView } = useSidePanel();
  const [pipelineStatus, setPipelineStatus] = useState<WikiPipelineStatus>({
    active: false,
    pending: 0,
    lastDoneAt: null,
    lastError: null,
  });
  const workspaceRoot = workspace?.workspaceRoot ?? null;
  const workFolder = workspace?.workFolder ?? undefined;

  const { watchEnabled, watchFolders, scanIntervalMin } = settings.wiki;
  const watchKey = watchFolders.map((f) => `${f.path}\n${f.recursive ? 'R' : '-'}`).join('\n');

  // 파이프라인 컨텍스트: 설정·에이전트가 바뀌면 재설정 (리스너 등록은 멱등).
  useEffect(() => {
    if (!workspaceRoot) return;
    configureWikiPipeline({
      workspaceRoot,
      workFolder,
      ollamaBaseUrl: settings.ollamaBaseUrl,
      getWikiSettings: () => settings.wiki,
      getParserSettings: () => settings.parsers,
      getAgents: () => agents,
      getDefaultAgent: () => defaultAgent,
    });
    void startWikiPipeline().catch((err) => {
      console.error('Failed to start wiki pipeline:', err);
    });
  }, [workspaceRoot, workFolder, settings, agents, defaultAgent]);

  // 감시 집합: 앱 시작 시와 on/off·폴더 변경 시 Rust 감시자에 반영한다.
  useEffect(() => {
    const folders = watchKey ? watchFolders.map((f) => ({ path: f.path, recursive: f.recursive })) : [];
    const apply = watchEnabled && folders.length > 0
      ? invoke('wiki_watch_set', { folders, recursive: false })
      : invoke('wiki_watch_stop');
    apply.catch((err) => {
      console.error('Failed to apply wiki watch:', err);
    });
  }, [watchEnabled, watchKey, watchFolders]);

  // 주기 스캔: 시작·설정 변경 시 즉시 1회, 이후 간격마다 (파이프라인 컨텍스트가 준비된 뒤).
  useEffect(() => {
    if (!workspaceRoot || !watchEnabled) return;
    const run = () => {
      void reconcileWikiFolders().catch((err) => {
        console.error('Wiki reconcile failed:', err);
      });
    };
    run();
    if (scanIntervalMin <= 0) return;
    const timer = setInterval(run, scanIntervalMin * 60_000);
    return () => clearInterval(timer);
  }, [workspaceRoot, watchEnabled, watchKey, scanIntervalMin]);

  useEffect(() => {
    const unsubscribe = subscribeWikiPipeline((status) => {
      setPipelineStatus(status);
    });
    return unsubscribe;
  }, []);

  // 위키 감시 상태 상시 표시 (에이전트 슬롯 우측). 처리 중이면 대기 건수를 함께 보여준다.
  useEffect(() => {
    const folderCount = watchFolders.length;
    const processing = pipelineStatus.active || pipelineStatus.pending > 0;
    const stateLabel = watchEnabled
      ? `${t('wiki.watchOn')} · ${t('wiki.watchFolders', { n: folderCount })}`
      : t('wiki.watchOff');
    const title = processing
      ? `${t('wiki.panelTitle')} — ${stateLabel} · ${t('wiki.statusBarProcessing', { n: pipelineStatus.pending })}`
      : `${t('wiki.panelTitle')} — ${stateLabel}`;
    publish('wiki', {
      id: 'wiki-watch',
      content: (
        <>
          {watchEnabled ? (
            <Eye className="h-3 w-3 text-success" />
          ) : (
            <EyeOff className="h-3 w-3" />
          )}
          <span className={cn(!watchEnabled && 'opacity-70')}>{stateLabel}</span>
          {processing && (
            <span className="flex items-center gap-1 text-warning font-medium">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('wiki.statusBarProcessing', { n: pipelineStatus.pending })}
            </span>
          )}
        </>
      ),
      title,
      onClick: () => setActiveView('wiki'),
    });
    return () => clear('wiki', 'wiki-watch');
  }, [publish, clear, t, setActiveView, watchEnabled, watchFolders.length, pipelineStatus]);

  return null;
}

export default WikiRuntime;
