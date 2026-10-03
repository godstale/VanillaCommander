import { useState, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, User, Copy, Check, ChevronDown, ChevronRight, Brain, Clock, AlertCircle, Info, Settings2, BookPlus } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { AgentMessage } from '@/lib/agent/types';
import { SYSTEM_AUTO_GUIDE_PREFIX } from '@/lib/agent/types';
import type { ChatConfigSnapshot } from '@/lib/types/agent';
import { DEFAULT_TEMPERATURE } from '@/lib/types/agent';
import { getProviderPreset } from '@/lib/llm/providers';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { ToolCallCard } from './ToolCallCard';
import { MermaidViewer } from './MermaidViewer';
import { RechartsViewer } from './RechartsViewer';
import { CodeViewer } from './CodeViewer';
import { isChartDsl } from '@/lib/types/chartDsl';

export interface MessageBubbleProps {
  message: AgentMessage;
  isStreaming?: boolean;
  /** 스냅샷이 없는 구 히스토리용 폴백 (현재 설정을 표시). */
  fallbackConfig?: ChatConfigSnapshot;
  /** P11-26: 어시스턴트 응답을 위키에 저장한다. 미지정 시 버튼을 숨긴다. */
  onSaveToWiki?: (message: AgentMessage) => void;
  isSavingToWiki?: boolean;
}

function ConfigSnapshotRows({ snapshot }: { snapshot: ChatConfigSnapshot }) {
  const { t } = useLanguage();
  const providerLabel = getProviderPreset(snapshot.llmProvider).label;
  const isOllama = (snapshot.llmProvider ?? 'ollama') === 'ollama';
  // Provider별 샘플링 표시: Ollama는 top-k/반복 억제, OpenAI 호환은 빈도/주제 억제
  const sampling = isOllama
    ? `top-k ${snapshot.topK ?? 'auto'} / repeat ${snapshot.repeatPenalty ?? 'auto'}`
    : `freq ${snapshot.frequencyPenalty ?? 'auto'} / pres ${snapshot.presencePenalty ?? 'auto'}`;
  const rows: Array<[string, string]> = [
    [t('chat.configModel'), `${snapshot.agentName} • ${snapshot.model}`],
    [t('chat.configProvider'), providerLabel],
    [t('chat.configTemperature'), String(snapshot.temperature ?? DEFAULT_TEMPERATURE)],
    [t('chat.configContextSize'), `${(snapshot.contextSize || 8192).toLocaleString()} tokens`],
    [t('chat.configReasoning'), snapshot.reasoning],
    [t('chat.configEffort'), snapshot.reasoningEffort],
    [t('chat.configThink'), String(snapshot.think ?? 'default')],
    [t('chat.configTopP'), String(snapshot.topP ?? 'auto')],
    [t('chat.configSampling'), sampling],
    [t('chat.configSeed'), String(snapshot.seed ?? 'auto')],
    [t('chat.configStop'), snapshot.stopSequences?.join(', ') || 'auto'],
    [t('chat.configMaxTokens'), String(snapshot.maxOutputTokens ?? 'auto')],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px] leading-relaxed">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground font-sans">{label}</dt>
          <dd className="text-foreground break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const MessageBubble = memo(function MessageBubble({ message, isStreaming, fallbackConfig, onSaveToWiki, isSavingToWiki = false }: MessageBubbleProps) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  const handleCopy = () => {
    let textToCopy = '';
    if ('content' in message && typeof message.content === 'string') {
      textToCopy = message.content;
    }
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const timeFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (message.role === 'system') {
    // 설정 변경 안내는 채팅 중간에 중앙 배지로 표시한다 (LLM 컨텍스트·DB에 영향 없음).
    if (message.config) {
      return (
        <div className="py-2 flex justify-center w-full">
          <div className="max-w-3xl w-full px-4">
            <div className="flex flex-col gap-2 px-3.5 py-2.5 rounded-xl bg-muted/50 border border-border/70 text-xs">
              <div className="flex items-center justify-center gap-1.5 font-semibold text-foreground">
                <Settings2 className="h-3.5 w-3.5 text-primary" />
                <span>{message.content || t('chat.configChanged')}</span>
              </div>
              <ConfigSnapshotRows snapshot={message.config} />
            </div>
          </div>
        </div>
      );
    }
    // LLM 턴 중간의 자동 복구 안내는 파란 유저 말풍선이 아닌 별색 시스템 말풍선으로 표시한다.
    if (message.content.startsWith(SYSTEM_AUTO_GUIDE_PREFIX)) {
      return (
        <div className="py-2 flex justify-center w-full">
          <div className="max-w-3xl w-full px-4">
            <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-warning/10 border border-warning/30 text-xs text-foreground">
              <Info className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
              <p className="whitespace-pre-wrap leading-relaxed select-text">{message.content}</p>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="py-2 text-center text-[11px] text-muted-foreground font-mono">
        <span className="px-2 py-0.5 rounded-full bg-muted/60">
          {t('chat.systemPromptSet')}
        </span>
      </div>
    );
  }

  // ToolResult messages: render as compact tool execution cards
  if (message.role === 'toolResult') {
    return (
      <div className="max-w-3xl w-full my-1 pl-10">
        <ToolCallCard
          toolName={message.toolName || 'tool'}
          result={message.content}
          isError={message.isError}
        />
      </div>
    );
  }

  // User Message
  if (message.role === 'user') {
    // 해당 요청이 실행된 설정. 구 히스토리(스냅샷 없음)는 현재 설정으로 폴백한다.
    const configSnapshot = message.config ?? fallbackConfig;
    const isConfigFallback = !message.config && !!fallbackConfig;
    return (
      <div className="flex justify-end my-3 w-full">
        <div className="flex items-start gap-2.5 max-w-[85%] md:max-w-2xl">
          <div className="flex flex-col items-end gap-1 min-w-0">
            <div className="p-3.5 rounded-2xl bg-primary text-primary-foreground text-sm leading-relaxed shadow-xs">
              {message.images && message.images.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {message.images.map((src, i) => (
                    <img
                      key={`${i}-${src.slice(0, 32)}`}
                      src={src}
                      alt={t('chat.imageAlt', { n: i + 1 })}
                      className="h-20 w-20 rounded-lg object-cover border border-primary-foreground/30"
                    />
                  ))}
                </div>
              )}
              <p className="whitespace-pre-wrap select-text">{message.content}</p>
            </div>
            {/* Bubble Footer: Time & Copy & Config outside */}
            <div className="flex items-center gap-2 px-1 text-[10px] text-muted-foreground font-mono">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3 opacity-70" />
                <span>{timeFormatted}</span>
              </span>
              {configSnapshot && (
                <button
                  type="button"
                  onClick={() => setShowConfig((prev) => !prev)}
                  aria-expanded={showConfig}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  title={t('chat.configShow')}
                >
                  <Info className="h-3 w-3" />
                  <span>i</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title={t('chat.copyTitle')}
              >
                {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                <span>{copied ? t('chat.copied') : t('chat.copy')}</span>
              </button>
            </div>
            {configSnapshot && showConfig && (
              <div className="w-full max-w-md p-3 rounded-xl border border-border/70 bg-card/90 shadow-xs text-left">
                <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold text-foreground font-sans">
                  <Settings2 className="h-3.5 w-3.5 text-primary" />
                  <span>{t('chat.configTitle')}</span>
                </div>
                <ConfigSnapshotRows snapshot={configSnapshot} />
                {isConfigFallback && (
                  <p className="mt-2 text-[10px] text-muted-foreground font-sans">
                    {t('chat.configFallbackNote')}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center text-primary shrink-0 mt-0.5">
            <User className="h-4 w-4" />
          </div>
        </div>
      </div>
    );
  }

  const hasToolCalls = Boolean(message.toolCalls && message.toolCalls.length > 0);
  const hasContent = Boolean(message.content && message.content.trim().length > 0);
  const hasThinking = Boolean(message.thinking && message.thinking.trim().length > 0);
  const hasError = Boolean(message.errorMessage);

  // Skip rendering if assistant message is completely empty and done
  if (!hasContent && !hasThinking && !hasToolCalls && !hasError && !isStreaming) {
    return null;
  }

  // Case 1: Only tool calls, no text content yet (e.g. Turn 1 tool calling action)
  // Render tool call items OUTSIDE any bubble card as standalone agent action items
  if (hasToolCalls && !hasContent && !isStreaming && !hasError && !hasThinking) {
    return (
      <div className="max-w-3xl w-full my-1 pl-10 space-y-1.5">
        {message.toolCalls!.map((tc) => (
          <ToolCallCard
            key={tc.id}
            toolCall={tc}
            toolName={tc.name}
            args={tc.arguments}
            isLoading={false}
          />
        ))}
      </div>
    );
  }

  // Case 2: Final response content (or active streaming response)
  // Tool call items are displayed outside, and the bubble card contains only the final text result
  return (
    <div className="space-y-2 my-3 w-full">
      {/* Standalone Tool Calls outside bubble card if present */}
      {hasToolCalls && (
        <div className="max-w-3xl w-full pl-10 space-y-1.5 mb-1.5">
          {message.toolCalls!.map((tc) => (
            <ToolCallCard
              key={tc.id}
              toolCall={tc}
              toolName={tc.name}
              args={tc.arguments}
              isLoading={isStreaming && !hasContent}
            />
          ))}
        </div>
      )}

      {/* Assistant Bubble Card: Contains only user-facing final result */}
      {(hasContent || hasThinking || hasError || isStreaming) && (
        <div className="flex items-start gap-3 w-full group">
          <div className="h-7 w-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 mt-0.5 shadow-xs">
            <Bot className="h-4 w-4" />
          </div>

          <div className="flex-1 min-w-0 max-w-3xl">
            <div className="p-4 rounded-xl border border-border/80 bg-card/80 shadow-xs space-y-3">
              {/* Working Progress Indicator if streaming and no content yet */}
              {isStreaming && !hasContent && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-xs text-primary font-medium">
                  <span className="inline-block w-2 h-2 rounded-full bg-primary animate-ping" />
                  <span>{t('chat.working')}</span>
                </div>
              )}

              {/* Thinking collapsible if available */}
              {message.thinking && (
                <div className="border border-border/70 rounded-lg bg-muted/20 text-xs overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowThinking((prev) => !prev)}
                    className="w-full flex items-center gap-1.5 px-3 py-1.5 text-muted-foreground hover:text-foreground text-left cursor-pointer"
                  >
                    {showThinking ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    <Brain className="h-3.5 w-3.5 text-warning" />
                    <span className="font-medium text-[11px]">{t('chat.thinking')}</span>
                  </button>
                  {showThinking && (
                    <div className="px-3 py-2 border-t border-border/50 text-[11px] text-muted-foreground whitespace-pre-wrap font-mono bg-background/50 max-h-60 overflow-y-auto">
                      {message.thinking}
                    </div>
                  )}
                </div>
              )}

              {/* Final Markdown content */}
              {message.content ? (
                <div className="chat-markdown relative text-sm text-foreground leading-relaxed max-w-none break-words">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ className, children, ...props }) {
                        const match = /language-([\w+#-]+)/.exec(className || '');
                        const language = match ? match[1].toLowerCase() : '';
                        const codeString = String(children).replace(/\n$/, '');
                        const isInline = !match && !codeString.includes('\n');

                        if (
                          language === 'recharts' ||
                          language === 'chart' ||
                          (language === 'mermaid' && isChartDsl(codeString))
                        ) {
                          return <RechartsViewer code={codeString} />;
                        }

                        if (language === 'mermaid') {
                          return <MermaidViewer code={codeString} isStreaming={isStreaming} />;
                        }

                        if (isInline) {
                          return (
                            <code
                              className="px-1.5 py-0.5 mx-0.5 rounded-md bg-muted/80 font-mono text-[12px] text-primary border border-border/50"
                              {...props}
                            >
                              {children}
                            </code>
                          );
                        }

                        return (
                          <CodeViewer
                            code={codeString}
                            language={language || 'text'}
                          />
                        );
                      },
                      // GFM tables need explicit styling (no typography plugin).
                      table({ children, ...props }) {
                        return (
                          <div className="overflow-x-auto">
                            <table {...props}>{children}</table>
                          </div>
                        );
                      },
                      a({ href, children, ...props }) {
                        return (
                          <a
                            href={href}
                            onClick={(e) => {
                              if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
                                e.preventDefault();
                                invoke('open_in_browser', { url: href }).catch((err) => {
                                  console.error('Failed to open in browser:', err);
                                });
                              }
                            }}
                            className="text-primary underline hover:opacity-80 cursor-pointer"
                            {...props}
                          >
                            {children}
                          </a>
                        );
                      },
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                  {isStreaming && (
                    <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-primary animate-pulse" />
                  )}
                </div>
              ) : (
                isStreaming && (
                  <div className="text-xs text-muted-foreground italic">
                    {t('chat.writing')}
                  </div>
                )
              )}

              {/* Error Message if any */}
              {message.errorMessage && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{message.errorMessage}</span>
                </div>
              )}
            </div>

            {/* Bubble Footer outside: Time, Token stats, Copy button */}
            <div className="flex items-center justify-between px-1 pt-1.5 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-2 font-mono text-[10px]">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3 text-muted-foreground/60" />
                  <span>{timeFormatted}</span>
                </span>
                {message.usage && (
                  <span className="text-muted-foreground/60 hidden sm:inline">
                    {t('chat.tokens', { total: message.usage.total, input: message.usage.input, output: message.usage.output })}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1 text-xs hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-muted/70 cursor-pointer"
                >
                  {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                  <span>{copied ? t('chat.copied') : t('chat.copy')}</span>
                </button>
                {onSaveToWiki && hasContent && !hasError && (
                  <button
                    type="button"
                    onClick={() => onSaveToWiki(message)}
                    disabled={isSavingToWiki}
                    className="flex items-center gap-1 text-xs hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-muted/70 cursor-pointer disabled:opacity-40"
                    title={t('chat.saveToWikiTitle')}
                  >
                    <BookPlus className="h-3 w-3" />
                    <span>{t('chat.saveToWiki')}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
