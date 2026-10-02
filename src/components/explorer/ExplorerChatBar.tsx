import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useAgents } from '@/lib/context/AgentsContext';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useChat } from '@/hooks/useChat';
import { MessageList } from '@/components/chat/MessageList';
import * as sessionsRepo from '@/lib/db/repositories/sessionsRepo';
import { cn } from '@/lib/utils';

export interface ExplorerChatBarProps {
  tabId: string;
  cwd: string;
  selectedPaths: string[];
  onFilesChanged: () => void;
}

function baseNames(paths: string[]): string {
  return paths
    .map((p) => p.split(/[\\/]/).filter(Boolean).pop() ?? p)
    .slice(0, 5)
    .join(', ');
}

export function ExplorerChatBar({ tabId, cwd, selectedPaths, onFilesChanged }: ExplorerChatBarProps) {
  const { t } = useLanguage();
  const { defaultAgent } = useAgents();
  const { openTab } = useWorkspaceTabs();
  const sessionId = `explorer-${tabId}`;
  const chat = useChat(sessionId, defaultAgent, { cwd: cwd || undefined });
  const [text, setText] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const lastCountRef = useRef(0);
  const filesChangedRef = useRef(onFilesChanged);
  useEffect(() => {
    filesChangedRef.current = onFilesChanged;
  }, [onFilesChanged]);

  // 에이전트가 파일을 바꾸면 탐색기 목록을 새로고침한다 (도구 결과 수신 기준).
  useEffect(() => {
    if (chat.messages.length <= lastCountRef.current) {
      lastCountRef.current = chat.messages.length;
      return;
    }
    lastCountRef.current = chat.messages.length;
    const last = chat.messages[chat.messages.length - 1];
    if (!last) return;
    if (last.role === 'toolResult' || (last.role === 'assistant' && last.toolCalls?.length)) {
      filesChangedRef.current();
    }
  }, [chat.messages]);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || chat.isStreaming) return;
    setText('');
    setDrawerOpen(true);
    try {
      const existing = await sessionsRepo.getSession(sessionId);
      if (!existing) {
        await sessionsRepo.createSession({
          id: sessionId,
          agentId: defaultAgent.id,
          workspaceRoot: cwd || null,
          origin: 'explorer',
          title: t('explorer.chatSessionTitle', { path: cwd }),
        });
      }
    } catch {
      // 세션 행이 없어도 useChat 인메모리 동작은 계속된다.
    }
    const contextLine =
      selectedPaths.length > 0
        ? `[위치] ${cwd}\n[선택] ${baseNames(selectedPaths)}`
        : `[위치] ${cwd}`;
    await chat.sendMessage(`${contextLine}\n${trimmed}`);
  };

  const openInChatTab = () => {
    openTab({
      id: `chat:${sessionId}`,
      type: 'chat',
      title: t('explorer.chatSessionTitle', { path: cwd }),
      meta: { sessionId, agentId: defaultAgent.id },
    });
  };

  return (
    <div className="border-t border-border shrink-0 bg-tabbar">
      {drawerOpen && (
        <div className="h-56 border-b border-border overflow-hidden flex flex-col">
          <div className="flex items-center gap-2 px-2 py-1 shrink-0">
            <span className="text-[11px] text-muted-foreground flex-1 truncate">
              {defaultAgent.name} · {cwd}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={openInChatTab}
              className="text-[11px] h-6 gap-1"
              title={t('explorer.openInChat')}
            >
              <ExternalLink className="h-3 w-3" />
              {t('explorer.openInChat')}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDrawerOpen(false)}
              className="h-6 w-6"
              aria-label={t('workspace.close')}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {chat.messages.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">{t('explorer.chatEmpty')}</p>
            ) : (
              <MessageList messages={chat.messages.slice(-12)} isStreaming={chat.isStreaming} />
            )}
          </div>
        </div>
      )}
      <div className="flex items-center gap-1 px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDrawerOpen((v) => !v)}
          className="h-7 w-7 shrink-0"
          aria-label={t('explorer.toggleResults')}
        >
          {drawerOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </Button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') void send();
          }}
          placeholder={t('explorer.chatPlaceholder')}
          disabled={chat.isStreaming}
          className={cn(
            'flex-1 min-w-0 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs outline-none',
            'focus:border-primary placeholder:text-muted-foreground/60 disabled:opacity-60',
          )}
        />
        <Button
          size="icon"
          onClick={() => void send()}
          disabled={!text.trim() || chat.isStreaming}
          className="h-7 w-7 shrink-0"
          title={t('chatInput.send')}
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
