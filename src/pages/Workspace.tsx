import { useRef, useEffect, useState } from 'react';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import { TopMenuBar } from '@/components/layout/TopMenuBar';
import { ActivityBar } from '@/components/layout/ActivityBar';
import { StatusBar } from '@/components/layout/StatusBar';
import { WorkspaceLayout } from '@/components/layout/WorkspaceLayout';
import { SidePanel } from '@/components/sidepanel/SidePanel';
import { CenterWorkspace } from '@/components/workspace/CenterWorkspace';
import { SidePanelProvider, useSidePanel } from '@/lib/context/SidePanelContext';
import { StatusBarProvider } from '@/lib/context/StatusBarContext';
import { WorkspaceTabsProvider, useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { WorkspaceProvider, useWorkspace } from '@/lib/context/WorkspaceContext';
import { SkillsProvider } from '@/lib/context/SkillsContext';
import { AgentsProvider } from '@/lib/context/AgentsContext';
import { ChatSessionsProvider } from '@/lib/context/ChatSessionsContext';
import { JobsProvider } from '@/lib/commander/jobs';
import { MacrosProvider } from '@/lib/macros/MacrosProvider';
import { TrustWorkspaceDialog } from '@/components/workspace/TrustWorkspaceDialog';
import { ApprovalDialog } from '@/components/chat/ApprovalDialog';
import type { SidePanelView } from '@/lib/types/workspaceTab';

import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { useSearchParams } from 'react-router-dom';
import { SetupWizard } from '@/components/setup/SetupWizard';
import { ConflictDialogHost, CommanderStatusPublishers } from '@/components/explorer/CommanderOverlays';
import { ExplorerBridgeHost } from '@/components/explorer/ExplorerBridgeHost';

function WorkspaceContent() {
  useKeyboardShortcuts();
  const { t } = useLanguage();
  const { workspaceRoot: wsRoot, workFolder } = useWorkspace();
  const effectiveRoot = workFolder ?? wsRoot;
  const { activeView, setActiveView } = useSidePanel();
  const { tabs, openTab, setActiveTab, isTabsLoaded } = useWorkspaceTabs();
  const { settings, loading: settingsLoading } = useSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const [wizardOpen, setWizardOpen] = useState(false);
  const wizardShownRef = useRef(false);
  const sidePanelRef = useRef<ImperativePanelHandle | null>(null);
  const autoOpenedRef = useRef(false);

  // P11-06(V8): 최초 1회 자동 실행 + ?setup=1 재실행. 기존 DB 사용자는 값이 프리필된다.
  // 게이트성 1회 오픈이라 set-state-in-effect 규칙을 예외 적용한다.
  useEffect(() => {
    if (wizardShownRef.current || settingsLoading) return;
    if (searchParams.get('setup') === '1') {
      wizardShownRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWizardOpen(true);
      return;
    }
    if (settings.setupCompletedAt == null) {
      wizardShownRef.current = true;
      setWizardOpen(true);
    }
  }, [settings, settingsLoading, searchParams]);

  const closeWizard = () => {
    setWizardOpen(false);
    if (searchParams.get('setup') === '1') {
      setSearchParams({});
    }
  };

  // P11-11(V7): 탭이 없으면 파일 탐색기 탭 1개를 연다 (폴더가 없어도 시스템 폴더 보기).
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!isTabsLoaded) return;
    if (tabs.length === 0) {
      autoOpenedRef.current = true;
      const root = effectiveRoot ?? '';
      const newId = `explorer:${Date.now()}`;
      openTab({
        type: 'file-explorer',
        id: newId,
        title: root ? root.split(/[\\/]/).filter(Boolean).pop() || root : t('activityBar.explorer'),
        meta: { path: root },
      });
    }
  }, [isTabsLoaded, openTab, tabs.length, effectiveRoot, t]);

  // P11-01(D2): 폴더 미선택 상태에서도 전부 선택 가능.
  useEffect(() => {
    if (!effectiveRoot) {
      if (sidePanelRef.current?.isCollapsed()) {
        sidePanelRef.current.expand();
      }
    }
  }, [effectiveRoot]);

  const handleActivityBarSelect = (view: Exclude<SidePanelView, null>) => {
    const panel = sidePanelRef.current;
    if (!panel) return;
    // P12-02: 파일 탐색기 메뉴는 패널을 열지 않는다. 대신 탐색기 탭을
    // 열거나(없으면 생성) 포커스한다. 즐겨찾기·시스템 폴더는 탭 상단 메뉴바에서 연다.
    if (view === 'explorer') {
      const existing = tabs.find((tb) => tb.type === 'file-explorer');
      if (existing) {
        setActiveTab(existing.id);
      } else {
        const root = effectiveRoot ?? '';
        openTab({
          type: 'file-explorer',
          title: root ? root.split(/[\\/]/).filter(Boolean).pop() || root : t('activityBar.explorer'),
          meta: { path: root },
        });
      }
      return;
    }
    if (activeView === view && !panel.isCollapsed()) {
      panel.collapse();
      setActiveView(null);
    } else {
      if (panel.isCollapsed()) {
        panel.expand();
      }
      setActiveView(view);
    }
  };

  // Prevent any residual window-level scroll offsets in desktop webview
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background text-foreground">
      <TopMenuBar />
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        <ActivityBar
          activeView={activeView}
          onSelect={handleActivityBarSelect}
        />
        <div className="flex-1 min-w-0 h-full overflow-hidden">
          <WorkspaceLayout
            sidePanelRef={sidePanelRef}
            sidePanel={<SidePanel activeView={activeView} />}
            centerWorkspace={<CenterWorkspace />}
          />
        </div>
      </div>
      <StatusBar />
      <ConflictDialogHost />
      <CommanderStatusPublishers />
      <ExplorerBridgeHost />
      {wizardOpen && <SetupWizard onClose={closeWizard} />}
    </div>
  );
}

export function Workspace() {
  return (
    <StatusBarProvider>
    <WorkspaceProvider>
      <SkillsProvider>
        <AgentsProvider>
          <ChatSessionsProvider>
            <JobsProvider>
            {/* P11-40: 매크로 저장소. 스케줄러(P11-41)가 같은 컨텍스트를 쓴다. */}
            <MacrosProvider>
            <WorkspaceTabsProvider>
              <SidePanelProvider>
                <WorkspaceContent />
                <TrustWorkspaceDialog />
                <ApprovalDialog />
              </SidePanelProvider>
            </WorkspaceTabsProvider>
            </MacrosProvider>
            </JobsProvider>
          </ChatSessionsProvider>
        </AgentsProvider>
      </SkillsProvider>
    </WorkspaceProvider>
    </StatusBarProvider>
  );
}

export default Workspace;
