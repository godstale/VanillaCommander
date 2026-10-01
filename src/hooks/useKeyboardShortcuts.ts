import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { approvalBus } from '@/lib/approval/approvalBus';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface KeyboardShortcutHandlers {
  onNewChat?: () => void;
  onCloseCurrentTab?: () => void;
  onOpenSettings?: () => void;
  onEscape?: () => void;
}

/**
 * Global keyboard shortcuts hook (§P7-02):
 * - Ctrl/Cmd + N: 새 채팅 생성 및 탭 열기
 * - Ctrl/Cmd + W: 현재 활성 탭 닫기
 * - Ctrl/Cmd + ,: 설정 페이지 열기
 * - Escape: 승인 대화상자/모달 닫기
 */
export function useKeyboardShortcuts(customHandlers?: KeyboardShortcutHandlers): void {
  const navigate = useNavigate();
  const { tabs, activeTabId, closeTab, openTab } = useWorkspaceTabs();
  const workspace = useSafeWorkspace();
  const { t } = useLanguage();
  const hasWorkspace = workspace === null || Boolean(workspace.workspaceRoot);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;

      // 1. Ctrl/Cmd + N: New Chat
      if (isMod && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        if (customHandlers?.onNewChat) {
          customHandlers.onNewChat();
        } else if (hasWorkspace) {
          const sessionId = crypto.randomUUID();
          openTab({
            id: `chat:${sessionId}`,
            type: 'chat',
            title: t('shortcuts.newChat'),
            meta: { sessionId },
          });
        }
        return;
      }

      // 2. Ctrl/Cmd + W: Close Active Tab
      if (isMod && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        if (customHandlers?.onCloseCurrentTab) {
          customHandlers.onCloseCurrentTab();
        } else if (activeTabId) {
          closeTab(activeTabId);
        }
        return;
      }

      // 3. Ctrl/Cmd + ,: Open Settings
      if (isMod && e.key === ',') {
        e.preventDefault();
        if (customHandlers?.onOpenSettings) {
          customHandlers.onOpenSettings();
        } else {
          navigate('/settings');
        }
        return;
      }

      // 4. Escape: Close open approvals / dismiss
      if (e.key === 'Escape') {
        if (customHandlers?.onEscape) {
          customHandlers.onEscape();
        } else {
          const pending = approvalBus.getPendingRequests();
          if (pending.length > 0) {
            approvalBus.resolve(pending[0].id, {
              approved: false,
              reason: t('shortcuts.escReject'),
            });
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    customHandlers,
    navigate,
    tabs,
    activeTabId,
    closeTab,
    openTab,
    hasWorkspace,
    t,
  ]);
}
