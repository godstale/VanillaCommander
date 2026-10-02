import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useAgents } from '@/lib/context/AgentsContext';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useChat } from '@/hooks/useChat';
import { MessageList } from '@/components/chat/MessageList';
import { MentionPopup } from '@/components/chat/MentionPopup';
import { useMention } from '@/hooks/useMention';
import { resolveMentions } from '@/lib/chat/mentions';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
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
  const workspace = useSafeWorkspace();
  const inputRef = useRef<HTMLInputElement>(null);
  const mention = useMention(cwd || null);
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
    mention.close();
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
    let full = `${contextLine}\n${trimmed}`;
    try {
      const resolved = await resolveMentions(trimmed, { cwd: cwd || undefined });
      if (resolved.refs.length > 0) {
        workspace?.addSessionRoots(resolved.refs.map((r) => r.path));
      }
      full = `${contextLine}\n${resolved.text}`;
    } catch {
      // 해석 실패는 원문 전송으로 폴백한다.
    }
    await chat.sendMessage(full);
  };

  const applyPick = (next: string, cursor: number) => {
    setText(next);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(cursor, cursor);
      }
    });
  };

  const handleInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mention.open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        mention.move(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        mention.move(-1);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        mention.pickCurrent(text, applyPick);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        mention.close();
        return;
      }
    }
    e.stopPropagation();
    if (e.key === 'Enter') void send();
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
      <div className="relative flex items-center gap-1 px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDrawerOpen((v) => !v)}
          className="h-7 w-7 shrink-0"
          aria-label={t('explorer.toggleResults')}
        >
          {drawerOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </Button>
        {mention.open && (
          <MentionPopup
            items={mention.items}
            index={mention.index}
            onPick={() => mention.pickCurrent(text, applyPick)}
            onHover={(i) => mention.move(i - mention.index)}
          />
        )}
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            mention.sync(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onSelect={(e) => mention.sync(text, e.currentTarget.selectionStart ?? text.length)}
          onKeyDown={handleInputKey}
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
