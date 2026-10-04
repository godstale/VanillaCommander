// P14-01: 위키 감시·파이프라인 상시 구동. 패널 표시 여부와 무관하게 앱이 떠 있는 동안 동작한다.
import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import { useAgents } from '@/lib/context/AgentsContext';
import { useStatusBar } from '@/lib/context/StatusBarContext';
import {
  configureWikiPipeline,
  startWikiPipeline,
  subscribeWikiPipeline,
} from '@/lib/wiki/pipeline';

export function WikiRuntime() {
  const { t } = useLanguage();
  const { settings } = useSettings();
  const workspace = useSafeWorkspace();
  const { agents, defaultAgent } = useAgents();
  const { publish, clear } = useStatusBar();
  const workspaceRoot = workspace?.workspaceRoot ?? null;
  const workFolder = workspace?.workFolder ?? undefined;

  const { watchEnabled, watchFolders } = settings.wiki;
  const watchKey = watchFolders.join('\n');

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
    const folders = watchKey ? watchKey.split('\n') : [];
    const apply = watchEnabled && folders.length > 0
      ? invoke('wiki_watch_set', { folders })
      : invoke('wiki_watch_stop');
    apply.catch((err) => {
      console.error('Failed to apply wiki watch:', err);
    });
  }, [watchEnabled, watchKey]);

  useEffect(() => {
    const unsubscribe = subscribeWikiPipeline((status) => {
      if (status.active) {
        publish('wiki', { id: 'wiki-pipeline', content: t('wiki.pipelineActive') });
      } else {
        clear('wiki', 'wiki-pipeline');
      }
    });
    return unsubscribe;
  }, [publish, clear, t]);

  return null;
}

export default WikiRuntime;
