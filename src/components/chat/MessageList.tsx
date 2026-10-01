import { useRef, useEffect, useState, type UIEvent } from 'react';
import { ArrowDown, Bot } from 'lucide-react';
import type { AgentMessage } from '@/lib/agent/types';
import type { ChatConfigSnapshot } from '@/lib/types/agent';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { MessageBubble } from './MessageBubble';
import { CompactionBanner } from './CompactionBanner';
import { Button } from '@/components/ui/button';

export interface MessageListProps {
  messages: AgentMessage[];
  isStreaming: boolean;
  /** 스냅샷이 없는 구 메시지에 표시할 현재 설정 폴백. */
  fallbackConfig?: ChatConfigSnapshot;
}

export function MessageList({ messages, isStreaming, fallbackConfig }: MessageListProps) {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const isUserScrolledUpRef = useRef(false);
  const isProgrammaticScrollRef = useRef(false);

  const scrollToBottom = (smooth = false) => {
    if (containerRef.current) {
      isProgrammaticScrollRef.current = true;
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
      isUserScrolledUpRef.current = false;
      setShowScrollBottom(false);
      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
      });
    }
  };

  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
    if (isProgrammaticScrollRef.current) return;
    const target = e.currentTarget;
    const distanceToBottom =
      target.scrollHeight - target.scrollTop - target.clientHeight;

    const isUp = distanceToBottom > 80;
    isUserScrolledUpRef.current = isUp;
    setShowScrollBottom(isUp);
  };

  useEffect(() => {
    if (!isUserScrolledUpRef.current) {
      scrollToBottom(false);
    }
  }, [messages, isStreaming]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center select-none">
        <div className="max-w-md flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-xs">
            <Bot className="h-6 w-6" />
          </div>
          <h2 className="text-base font-semibold">Fortress Local AI Workstation</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t('chat.emptyGuide')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto overscroll-contain px-4 py-4 space-y-2"
      >
        {messages.map((msg, index) => {
          if (
            msg.role === 'system' &&
            msg.content.startsWith(
              'Below is a summary of the earlier conversation:',
            )
          ) {
            const summaryText = msg.content
              .replace(
                'Below is a summary of the earlier conversation:\n\n',
                '',
              )
              .trim();
            return (
              <CompactionBanner
                key={index}
                summary={summaryText}
                reason="threshold"
              />
            );
          }

          return (
            <MessageBubble
              key={index}
              message={msg}
              isStreaming={isStreaming && index === messages.length - 1}
              fallbackConfig={fallbackConfig}
            />
          );
        })}

        {/* If streaming and assistant message has not arrived yet, show agent working indicator */}
        {isStreaming &&
          messages.length > 0 &&
          (messages[messages.length - 1].role === 'user' ||
            messages[messages.length - 1].role === 'toolResult') && (
          <div className="flex items-start gap-3 my-3 w-full animate-in fade-in duration-200">
            <div className="h-7 w-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 mt-0.5 shadow-xs">
              <Bot className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0 max-w-3xl">
              <div className="p-4 rounded-xl border border-border/80 bg-card/80 shadow-xs space-y-2">
                <div className="flex items-center gap-2 text-xs text-primary font-medium">
                  <span className="inline-block w-2 h-2 rounded-full bg-primary animate-ping" />
                  <span>{t('chat.working')}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {showScrollBottom && (
        <div className="absolute bottom-4 right-6 z-10">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => scrollToBottom(true)}
            className="rounded-full shadow-md flex items-center gap-1.5 text-xs py-1 px-3 bg-card border border-border hover:bg-muted text-foreground"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            <span>{t('chat.scrollBottom')}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
