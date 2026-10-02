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
import { TrustWorkspaceDialog } from '@/components/workspace/TrustWorkspaceDialog';
import { ApprovalDialog } from '@/components/chat/ApprovalDialog';
import type { SidePanelView } from '@/lib/types/workspaceTab';

import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { useSearchParams } from 'react-router-dom';
import { SetupWizard } from '@/components/setup/SetupWizard';

function WorkspaceContent() {
  useKeyboardShortcuts();
  const { t } = useLanguage();
  const { workspaceRoot } = useWorkspace();
  const { activeView, setActiveView } = useSidePanel();
  const { tabs, openTab, isTabsLoaded } = useWorkspaceTabs();
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

  // Automatically open a default chat tab on startup if workspaceRoot exists and no tabs after restoration
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!isTabsLoaded) return;
    if (workspaceRoot && tabs.length === 0) {
      autoOpenedRef.current = true;
      const newId = `chat:${Date.now()}`;
      openTab({
        type: 'chat',
        id: newId,
        title: t('workspace.newChat'),
        meta: { sessionId: newId.slice(5) },
      });
    }
  }, [isTabsLoaded, openTab, tabs.length, workspaceRoot, t]);

  // P11-01(D2): 폴더 미선택 상태에서도 전부 선택 가능.
  useEffect(() => {
    if (!workspaceRoot) {
      if (sidePanelRef.current?.isCollapsed()) {
        sidePanelRef.current.expand();
      }
    }
  }, [workspaceRoot]);

  const handleActivityBarSelect = (view: Exclude<SidePanelView, null>) => {
    const panel = sidePanelRef.current;
    if (!panel) return;
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
            <WorkspaceTabsProvider>
              <SidePanelProvider>
                <WorkspaceContent />
                <TrustWorkspaceDialog />
                <ApprovalDialog />
              </SidePanelProvider>
            </WorkspaceTabsProvider>
          </ChatSessionsProvider>
        </AgentsProvider>
      </SkillsProvider>
    </WorkspaceProvider>
    </StatusBarProvider>
  );
}

export default Workspace;
