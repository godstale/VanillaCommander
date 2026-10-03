import { ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { ChatTab } from '@/components/workspace/ChatTab';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';

export interface ExplorerChatDockProps {
  sessionId: string;
  title: string;
  cwd: string;
  selCount: number;
  onClose: () => void;
  onOpenInChatTab: () => void;
}

// 탐색기 우측 채팅 도크. 일반 채팅 탭과 동일한 ChatTab 화면을 재사용하므로
// 스크롤·큐·승인·압축 동작이 같고, 세션(origin='chat')은 대화 목록에 등록된다.
export function ExplorerChatDock({
  sessionId,
  title,
  cwd,
  selCount,
  onClose,
  onOpenInChatTab,
}: ExplorerChatDockProps) {
  const { t } = useLanguage();
  const chatTab: WorkspaceTab = {
    id: `chat:${sessionId}`,
    type: 'chat',
    title,
    meta: { sessionId },
  };

  return (
    <div className="w-[380px] shrink-0 h-full min-h-0 flex flex-col border-l border-border bg-editor">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border shrink-0">
        <span className="text-[11px] text-muted-foreground truncate flex-1" title={cwd}>
          {t('explorer.chatContextLocation')}: {cwd || '—'}
          {selCount > 0 && ` · ${t('explorer.chatContextSelection', { n: String(selCount) })}`}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenInChatTab}
          className="h-6 w-6 shrink-0"
          title={t('explorer.openInChat')}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-6 w-6 shrink-0"
          aria-label={t('workspace.close')}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <ChatTab tab={chatTab} />
      </div>
    </div>
  );
}

export default ExplorerChatDock;
