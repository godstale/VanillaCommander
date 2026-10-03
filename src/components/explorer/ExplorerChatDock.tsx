import { ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { ChatTab } from '@/components/workspace/ChatTab';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import { cn } from '@/lib/utils';

export interface ExplorerChatDockProps {
  sessionId: string;
  title: string;
  cwd: string;
  selCount: number;
  /** 'row'면 활성 창 오른쪽, 'col'이면 활성 창 아래에 붙는다. */
  orientation?: 'row' | 'col';
  onClose: () => void;
  onOpenInChatTab: () => void;
}

// 탐색기 활성 창을 추가 분할하는 채팅 도크. 일반 채팅 탭과 동일한 ChatTab 화면을
// 재사용하되 좁은 공간에서도 깨지지 않도록 compact 헤더로 렌더링한다.
export function ExplorerChatDock({
  sessionId,
  title,
  cwd,
  selCount,
  orientation = 'row',
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
    <div
      className={cn(
        'flex flex-col min-h-0 min-w-0 bg-editor overflow-hidden',
        orientation === 'row' ? 'flex-1 border-l border-border' : 'flex-1 border-t border-border',
      )}
    >
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border shrink-0 min-w-0">
        <span className="text-[11px] text-muted-foreground truncate flex-1 min-w-0" title={cwd}>
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
      <div className="flex-1 min-h-0 min-w-0">
        <ChatTab tab={chatTab} dense />
      </div>
    </div>
  );
}

export default ExplorerChatDock;
