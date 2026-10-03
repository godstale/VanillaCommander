import { useState, useRef, useEffect, useMemo, type KeyboardEvent } from 'react';
import {
  Send,
  Square,
  CornerDownLeft,
  Puzzle,
  AlertCircle,
  Bot,
  Terminal,
  Zap,
  RotateCcw,
  BarChart2,
  Settings,
  Folder,
  FolderOpen,
  Layers,
  Info,
  Lock,
  Brain,
  Save,
  ImagePlus,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SkillManifest } from '@/lib/types/skill';
import type { ReasoningEffort, ReasoningMode } from '@/lib/types/agent';
import type { VisionVerdict } from '@/lib/llm/vision';
import { useSafeSkills } from '@/lib/context/SkillsContext';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import { resolveSkillInvocation, parseSkillCommand } from '@/lib/skills/invokeSkill';
import { resolveMentions } from '@/lib/chat/mentions';
import { MentionPopup } from './MentionPopup';
import { useMention } from '@/hooks/useMention';

import { ContextGauge } from './ContextGauge';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { cn } from '@/lib/utils';

export interface SlashCommandOption {
  type: 'command' | 'skill';
  name: string;
  syntax: string;
  description: string;
  source?: 'workspace' | 'global';
  icon?: typeof Terminal;
}

const BUILTIN_SLASH_COMMANDS: SlashCommandOption[] = [
  { type: 'command', name: 'clear', syntax: '/clear', description: 'chatInput.clearDesc', icon: RotateCcw },
  { type: 'command', name: 'usage', syntax: '/usage', description: 'chatInput.usageDesc', icon: BarChart2 },
  { type: 'command', name: 'agent', syntax: '/agent', description: 'chatInput.agentDesc', icon: Bot },
  { type: 'command', name: 'yolo', syntax: '/yolo', description: 'chatInput.yoloDesc', icon: Zap },
  { type: 'command', name: 'settings', syntax: '/settings', description: 'chatInput.settingsDesc', icon: Settings },
  { type: 'command', name: 'skills', syntax: '/skills', description: 'chatInput.skillsDesc', icon: Puzzle },
  { type: 'command', name: 'pwd', syntax: '/pwd', description: 'chatInput.pwdDesc', icon: Folder },
  { type: 'command', name: 'compact', syntax: '/compact', description: 'chatInput.compactDesc', icon: Layers },
  { type: 'command', name: 'status', syntax: '/status', description: 'chatInput.statusDesc', icon: Info },
];

export interface ChatInputProps {
  onSend: (text: string, images?: string[]) => void;
  onSteer: (text: string, images?: string[]) => void;
  onStop: () => void;
  onCompact?: (instructions?: string) => Promise<void> | void;
  onOpenCompactDialog?: () => void;
  onSlashCommand?: (command: string, args?: string) => boolean | Promise<boolean>;
  onQueue?: (item: {
    text: string;
    type: 'message' | 'slash_command' | 'skill';
    commandName?: string;
    commandArgs?: string;
    images?: string[];
  }) => void;
  isStreaming: boolean;
  isLockedByOtherSession?: boolean;
  isThisSessionBusy?: boolean;
  busySessionTitle?: string;
  placeholder?: string;
  skills?: SkillManifest[];
  /** 귀속된 에이전트의 reasoning 설정 (effort 셀렉터 비활성화 판단용) */
  agentReasoning?: ReasoningMode;
  contextUsage?: { tokens: number; limit: number };
  yoloMode?: boolean;
  /**
   * 세션 단위 reasoning/effort 오버라이드. 'agent'(기본값)면 Agent 설정을 따른다.
   * Ollama think 최상위 필드로만 전달되므로 변경해도 프롬프트/prefill 오버헤드가 없다.
   */
  reasoningOverride?: ReasoningMode | 'agent';
  effortOverride?: ReasoningEffort | 'agent';
  onReasoningOverrideChange?: (v: ReasoningMode | 'agent') => void;
  onEffortOverrideChange?: (v: ReasoningEffort | 'agent') => void;
  customHeight?: number | null;
  maxHeight?: number;
  /** 삭제된 에이전트 설정을 쓰는 채팅이면 true. 입력 전체를 비활성화한다. */
  isAgentDeleted?: boolean;
  /** 대화 로그(사용자 프롬프트 목록) 저장/불러오기 */
  onSaveLog?: () => void;
  onLoadLog?: () => void;
  canSaveLog?: boolean;
  hasSavedLog?: boolean;
  /**
   * 프롬프트 히스토리(↑/↓)의 스코프. 채팅 세션 ID를 넘기면 해당 채팅창만의
   * 히스토리(`vanilla-commander:prompt-history:<sessionId>`)를 사용한다. 미지정 시
   * 전역 키를 사용한다(테스트/레거시 호환).
   */
  sessionId?: string;
  /** `@` 참조 해석 기준 폴더. 미지정 시 상대 `@`는 텍스트 그대로 남는다. */
  cwd?: string | null;
  /**
   * P11-26: 귀속 에이전트의 비전 판정. 'no'면 이미지 첨부 시 전송 단계에서
   * 폴백 다이얼로그가 열린다(첨부 자체는 막지 않는다).
   */
  vision?: VisionVerdict;
}

export function ChatInput({
  onSend,
  onSteer,
  onStop,
  onCompact,
  onOpenCompactDialog,
  onSlashCommand,
  onQueue,
  isStreaming,
  isLockedByOtherSession = false,
  isThisSessionBusy = false,
  busySessionTitle,
  placeholder,
  skills: skillsProp,
  agentReasoning = 'default',
  contextUsage,
  yoloMode,
  reasoningOverride = 'agent',
  effortOverride = 'agent',
  onReasoningOverrideChange,
  onEffortOverrideChange,
  customHeight,
  maxHeight = 180,
  isAgentDeleted = false,
  onSaveLog,
  onLoadLog,
  canSaveLog = false,
  hasSavedLog = false,
  sessionId,
  cwd = null,
  vision = 'unknown',
}: ChatInputProps) {
  const { t } = useLanguage();
  const workspace = useSafeWorkspace();
  const mention = useMention(cwd);
  const safeSkillsCtx = useSafeSkills();
  const availableSkills = useMemo(() => {
    return skillsProp ?? safeSkillsCtx?.skills ?? [];
  }, [skillsProp, safeSkillsCtx?.skills]);

  const [text, setText] = useState('');
  const [autocompleteDismissed, setAutocompleteDismissed] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // P11-26: 첨부 이미지(data URL). DB에는 경로 저장이 원칙이나, 입력 단계의
  // 클립보드·드래그·파일 선택은 브라우저 File 객체이므로 data URL로 들고
  // 전송 직전 messageMapper가 Ollama images/OpenAI image_url로 변환한다.
  const MAX_IMAGES = 4;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const [images, setImages] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    });

  const addImageFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (list.length === 0) return;
    const room = MAX_IMAGES - images.length;
    if (room <= 0) {
      setErrorMessage(t('chatInput.imageLimit', { n: MAX_IMAGES }));
      return;
    }
    const accepted = list.slice(0, room);
    if (list.length > room) {
      setErrorMessage(t('chatInput.imageLimit', { n: MAX_IMAGES }));
    }
    const next: string[] = [];
    for (const file of accepted) {
      if (file.size > MAX_IMAGE_BYTES) {
        setErrorMessage(t('chatInput.imageTooBig'));
        continue;
      }
      try {
        const url = await readFileAsDataUrl(file);
        if (url.startsWith('data:image/')) next.push(url);
      } catch {
        setErrorMessage(t('chatInput.imageReadFailed'));
      }
    }
    if (next.length > 0) {
      setImages((prev) => [...prev, ...next].slice(0, MAX_IMAGES));
      setErrorMessage(null);
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Prompt history (↑/↓): per-chat recent-sent list, capped. Draft is preserved
  // while browsing so ArrowDown past the end restores what was typed.
  // 각 채팅창은 자기 세션의 히스토리만 조회한다.
  const historyKey = useMemo(
    () => (sessionId ? `vanilla-commander:prompt-history:${sessionId}` : 'vanilla-commander:prompt-history'),
    [sessionId],
  );
  const HISTORY_LIMIT = 100;
  const loadHistory = (key: string): string[] => {
    try {
      const raw = window.localStorage.getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string').slice(-HISTORY_LIMIT) : [];
    } catch {
      return [];
    }
  };
  const [history, setHistory] = useState<string[]>(() => loadHistory(historyKey));
  const [histIndex, setHistIndex] = useState<number | null>(null);
  const draftRef = useRef('');

  // 동일 컴포넌트 인스턴스가 다른 세션을 가리키게 되면 해당 채팅의 히스토리로 교체한다.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 세션 전환 시 해당 채팅의 히스토리로 교체
    setHistory(loadHistory(historyKey));
    setHistIndex(null);
    draftRef.current = '';
  }, [historyKey]);

  const pushHistory = (sent: string) => {
    const key = historyKey;
    setHistory((prev) => {
      const next = prev[prev.length - 1] === sent ? prev : [...prev, sent].slice(-HISTORY_LIMIT);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // ignore quota errors
      }
      return next;
    });
    setHistIndex(null);
    draftRef.current = '';
  };

  const browseHistory = (dir: -1 | 1) => {
    if (history.length === 0) return;
    let next: number | null;
    if (histIndex === null) {
      if (dir === 1) return;
      draftRef.current = text;
      next = history.length - 1;
    } else {
      next = histIndex + dir;
      if (next < 0) next = 0;
      if (next >= history.length) {
        setHistIndex(null);
        setText(draftRef.current);
        setAutocompleteDismissed(false);
        requestAnimationFrame(() => {
          textareaRef.current?.focus();
          const len = draftRef.current.length;
          textareaRef.current?.setSelectionRange(len, len);
        });
        return;
      }
    }
    setHistIndex(next);
    setText(history[next]);
    setAutocompleteDismissed(true);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const len = history[next].length;
      textareaRef.current?.setSelectionRange(len, len);
    });
  };

  // Detect `/` slash command or `/skill:<filter>` pattern before any whitespace
  const autocompleteQuery = useMemo(() => {
    if (autocompleteDismissed) return null;
    const match = text.match(/^\/([^\s]*)$/);
    if (!match) return null;
    return match[1].toLowerCase();
  }, [text, autocompleteDismissed]);

  const filteredOptions = useMemo<SlashCommandOption[]>(() => {
    if (autocompleteQuery === null) return [];
    let query = autocompleteQuery;
    let isSkillQuery = false;
    if (query.startsWith('skill:')) {
      query = query.slice(6);
      isSkillQuery = true;
    }

    const commandMatches = isSkillQuery
      ? []
      : BUILTIN_SLASH_COMMANDS.filter((cmd) => cmd.name.toLowerCase().includes(query));

    const skillMatches: SlashCommandOption[] = availableSkills
      .filter((s) => s.name.toLowerCase().includes(query))
      .map((s) => ({
        type: 'skill' as const,
        name: s.name,
        syntax: `/skill:${s.name} `,
        description: s.description,
        source: s.source,
      }));

    return [...commandMatches, ...skillMatches];
  }, [autocompleteQuery, availableSkills]);

  const isAutocompleteOpen =
    autocompleteQuery !== null && filteredOptions.length > 0;

  // Derive clamped selected index without setting state in effect
  const activeIndex =
    selectedIndex < filteredOptions.length ? selectedIndex : 0;

  // Auto-resize textarea height when not in fixed/custom height mode
  useEffect(() => {
    if (!textareaRef.current) return;
    if (customHeight) {
      textareaRef.current.style.height = '100%';
      return;
    }
    textareaRef.current.style.height = 'auto';
    const scrollHeight = textareaRef.current.scrollHeight;
    textareaRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
  }, [text, customHeight, maxHeight]);

  const selectOption = (opt: SlashCommandOption) => {
    if (opt.type === 'command') {
      if (opt.name === 'compact' && onOpenCompactDialog) {
        onOpenCompactDialog();
        setText('');
        setAutocompleteDismissed(true);
        return;
      }
      setText(`${opt.syntax} `);
      setAutocompleteDismissed(true);
      setSelectedIndex(0);
      textareaRef.current?.focus();
    } else {
      setText(opt.syntax);
      setAutocompleteDismissed(true);
      setSelectedIndex(0);
      textareaRef.current?.focus();
    }
  };

  const handleSubmit = async () => {
    if (isLockedByOtherSession || isAgentDeleted) return;
    const trimmed = text.trim();
    if (!trimmed && images.length === 0) return;

    setErrorMessage(null);

    // P11-16: `@` 참조를 먼저 해석한다 (파일 인라인 + 허용 루트 등록).
    // `@`가 없으면 동기 경로를 유지한다 (기존 테스트·동작 호환).
    let sendText = trimmed;
    if (trimmed.includes('@')) {
      try {
        const resolved = await resolveMentions(trimmed, { cwd: cwd ?? undefined });
        if (resolved.refs.length > 0) {
          workspace?.addSessionRoots(resolved.refs.map((r) => r.path));
        }
        sendText = resolved.text;
      } catch {
        // 해석 실패는 원문 전송으로 폴백한다.
      }
    }

    const resetAfterSend = () => {
      pushHistory(trimmed);
      setText('');
      setImages([]);
      setAutocompleteDismissed(false);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    };

    // 첨부 이미지는 텍스트와 함께 전달한다. 텍스트가 비어 있으면
    // 이미지 설명 요청으로 취급하되 빈 전송은 막는다.
    const attachedImages = images.length > 0 ? [...images] : undefined;

    // If this session is busy (running LLM or has pending queue items) and onQueue is available,
    // enqueue the request instead of executing immediately or overwriting
    if ((isThisSessionBusy || isStreaming) && onQueue) {
      // 1. Check if slash command
      const slashMatch = sendText.match(/^\/(\w+)(?:\s+([\s\S]*))?$/);
      if (slashMatch) {
        const commandName = slashMatch[1].toLowerCase();
        const args = slashMatch[2]?.trim();
        onQueue({
          text: sendText,
          type: 'slash_command',
          commandName,
          commandArgs: args,
          images: attachedImages,
        });
        resetAfterSend();
        return;
      }

      // 2. Check if skill command
      if (parseSkillCommand(sendText)) {
        onQueue({
          text: sendText,
          type: 'skill',
          images: attachedImages,
        });
        resetAfterSend();
        return;
      }

      // 3. Normal user message
      onQueue({
        text: sendText,
        type: 'message',
        images: attachedImages,
      });
      resetAfterSend();
      return;
    }

    // Check built-in slash commands
    const slashMatch = sendText.match(/^\/(\w+)(?:\s+([\s\S]*))?$/);
    if (slashMatch) {
      const commandName = slashMatch[1].toLowerCase();
      const args = slashMatch[2]?.trim();

      if (commandName === 'compact') {
        if (onCompact) {
          try {
            await onCompact(args);
            resetAfterSend();
            return;
          } catch (err) {
            setErrorMessage(
              err instanceof Error ? err.message : t('chatInput.compactFailed'),
            );
            return;
          }
        }
      }

      if (onSlashCommand) {
        const handled = await onSlashCommand(commandName, args);
        if (handled) {
          resetAfterSend();
          return;
        }
      }
    }

    let messageToSend = sendText;

    if (parseSkillCommand(sendText)) {
      try {
        const resolved = await resolveSkillInvocation(sendText, availableSkills);
        if (resolved) {
          messageToSend = resolved;
        }
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : t('chatInput.skillFailed'),
        );
        return;
      }
    }

    if (isStreaming) {
      if (attachedImages) onSteer(messageToSend, attachedImages);
      else onSteer(messageToSend);
    } else {
      if (attachedImages) onSend(messageToSend, attachedImages);
      else onSend(messageToSend);
    }

    resetAfterSend();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Prevent sending during IME composition (e.g. Korean / Japanese / Chinese typing)
    if (e.nativeEvent.isComposing) {
      return;
    }

    // P11-16: `@` 참조 팝업이 열려 있으면 슬래시 자동완성보다 우선한다.
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
        mention.pickCurrent(text, (next, cursor) => {
          setText(next);
          requestAnimationFrame(() => {
            const el = textareaRef.current;
            if (el) {
              el.focus();
              el.setSelectionRange(cursor, cursor);
            }
          });
        });
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        mention.close();
        return;
      }
    }

    if (isAutocompleteOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredOptions.length - 1 ? prev + 1 : 0,
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredOptions.length - 1,
        );
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const chosen = filteredOptions[activeIndex];
        if (chosen) {
          selectOption(chosen);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAutocompleteDismissed(true);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
      return;
    }

    // Prompt history: ↑/↓ recalls previous/next sent prompt when the caret is
    // on the first/last visual line. shift+enter로 만든 멀티라인 입력에서는
    // 첫 라인(↑)·마지막 라인(↓)에 닿았을 때만 히스토리를 넘나든다.
    // 새로 전송한 메시지는 pushHistory로 히스토리의 가장 마지막이 된다.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (e.shiftKey) return;
      const el = textareaRef.current;
      const posStart = el?.selectionStart ?? text.length;
      const posEnd = el?.selectionEnd ?? text.length;
      if (e.key === 'ArrowUp') {
        if (text.slice(0, posStart).includes('\n')) return;
        e.preventDefault();
        browseHistory(-1);
      } else {
        if (text.slice(posEnd).includes('\n')) return;
        e.preventDefault();
        browseHistory(1);
      }
    }
  };

  const handleTextChange = (val: string, cursor: number) => {
    setText(val);
    mention.sync(val, cursor);
    setAutocompleteDismissed(false);
    if (histIndex !== null) setHistIndex(null);
    if (errorMessage) {
      setErrorMessage(null);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (imgs.length > 0) {
        e.preventDefault();
        void addImageFiles(imgs);
      }
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (imgs.length > 0) {
        e.preventDefault();
        setIsDragOver(false);
        void addImageFiles(imgs);
      }
    }
  };

  const defaultPlaceholder = isAgentDeleted
    ? t('chatInput.agentDeletedPlaceholder')
    : isLockedByOtherSession
    ? t('chatInput.lockedOther')
    : isThisSessionBusy || isStreaming
    ? t('chatInput.busySelf')
    : t('chatInput.placeholder');

  // LLM 동작 중에는 다음 턴에 적용되는 실행 설정도 변경할 수 없다.
  // (입력 텍스트의 대기 큐 추가는 허용하되 reasoning/effort 셀렉터만 잠근다.)
  const settingsLocked =
    isAgentDeleted || isStreaming || isThisSessionBusy || isLockedByOtherSession;
  const settingsLockTitle = settingsLocked && !isAgentDeleted ? t('chatInput.settingsLocked') : undefined;

  return (
    <div
      style={customHeight ? { height: `${customHeight}px` } : undefined}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files')) {
          e.preventDefault();
          setIsDragOver(true);
        }
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={cn(
        'relative border border-border rounded-xl bg-background shadow-xs focus-within:ring-1 focus-within:ring-primary focus-within:border-primary transition-all',
        customHeight ? 'flex flex-col overflow-hidden' : '',
        isDragOver && 'ring-1 ring-primary border-primary',
      )}
    >
      {/* Mention popup (@ 파일 참조) */}
      {mention.open && !isAutocompleteOpen && (
        <MentionPopup
          items={mention.items}
          index={mention.index}
          onPick={() => {
            mention.pickCurrent(text, (next, cursor) => {
              setText(next);
              requestAnimationFrame(() => {
                const el = textareaRef.current;
                if (el) {
                  el.focus();
                  el.setSelectionRange(cursor, cursor);
                }
              });
            });
          }}
          onHover={(i) => mention.move(i - mention.index)}
        />
      )}
      {/* Autocomplete popup */}
      {isAutocompleteOpen && (
        <div
          ref={listRef}
          role="listbox"
          aria-label={t('chatInput.autocompleteLabel')}
          className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg z-50 animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
            <span>{t('chatInput.autocompleteHeader', { n: filteredOptions.length })}</span>
            <span className="text-[10px] text-muted-foreground/70 lowercase font-normal">
              {t('chatInput.autocompleteHint')}
            </span>
          </div>
          {filteredOptions.map((opt, idx) => {
            const isSelected = idx === activeIndex;
            const Icon = opt.icon || (opt.type === 'skill' ? Puzzle : Terminal);
            return (
              <button
                key={`${opt.type}-${opt.name}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => selectOption(opt)}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`w-full flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                  isSelected
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-foreground hover:bg-muted/50'
                }`}
              >
                <div
                  className={`p-1 rounded-md shrink-0 mt-0.5 ${
                    opt.type === 'command'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-warning/10 text-warning'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-semibold text-foreground">
                      {opt.syntax.trim()}
                    </span>
                    {opt.type === 'skill' && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-sm bg-muted text-muted-foreground">
                        {opt.source === 'workspace' ? t('chatInput.sourceWorkspace') : t('chatInput.sourceGlobal')}
                      </span>
                    )}
                    {opt.type === 'command' && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-sm bg-primary/10 text-primary font-mono">
                        {t('chatInput.builtin')}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                    {opt.type === 'command' ? t(opt.description) : opt.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Inline error if resolution failed */}
      {errorMessage && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-destructive bg-destructive/10 border-b border-destructive/20 rounded-t-xl shrink-0">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Lock banner when another session is busy */}
      {isLockedByOtherSession && !isAgentDeleted && (
        <div className="flex items-center gap-2 px-3.5 py-1.5 text-xs text-warning bg-warning/10 border-b border-warning/20 font-medium select-none">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {busySessionTitle
              ? t('chatInput.lockedBannerWith', { title: busySessionTitle })
              : t('chatInput.lockedBanner')}
          </span>
        </div>
      )}

      {/* Deleted-agent banner: 이 채팅은 삭제된 설정을 사용하므로 입력을 막는다 */}
      {isAgentDeleted && (
        <div className="flex items-center gap-2 px-3.5 py-1.5 text-xs text-destructive bg-destructive/10 border-b border-destructive/20 font-medium select-none">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t('chatInput.agentDeletedBanner')}</span>
        </div>
      )}

      {/* Session options bar (채팅은 하나의 에이전트 설정에 귀속되므로 에이전트 전환 UI 없음) */}
      <div className="flex items-center justify-between px-3.5 pt-2 pb-1 text-[11px] text-muted-foreground border-b border-border/30 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {/* YOLO Mode Badge */}
          {yoloMode && (
            <div
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/20 text-destructive border border-destructive/30 text-[10px] font-semibold animate-pulse"
              title={t('chatInput.yoloBadge')}
            >
              <Zap className="h-3 w-3 fill-current" />
              <span>{t('chatInput.yoloShort')}</span>
            </div>
          )}

          {/* Session reasoning/effort override (Ollama think field — no prefill overhead) */}
          <div
            className="flex items-center gap-1 shrink-0"
            title={settingsLockTitle ?? t('chatInput.thinkTitle')}
          >
            <Brain className="h-3.5 w-3.5 text-primary shrink-0" />
              <select
                value={reasoningOverride}
                onChange={(e) => onReasoningOverrideChange?.(e.target.value as ReasoningMode | 'agent')}
                disabled={settingsLocked}
                title={settingsLockTitle}
                className="bg-transparent text-foreground font-semibold cursor-pointer border-none outline-none focus:ring-0 text-[11px] max-w-[86px] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <option value="agent" className="bg-card text-foreground">
                  {t('chatInput.thinkFollowAgent')}
                </option>
                <option value="default" className="bg-card text-foreground">
                  {t('chatInput.thinkDefault')}
                </option>
                <option value="on" className="bg-card text-foreground">
                  {t('chatInput.thinkOn')}
                </option>
                <option value="off" className="bg-card text-foreground">
                  {t('chatInput.thinkOff')}
                </option>
              </select>
              <select
                value={effortOverride}
                disabled={
                  settingsLocked ||
                  (reasoningOverride === 'agent' ? agentReasoning : reasoningOverride) === 'off'
                }
                title={settingsLockTitle}
                onChange={(e) => onEffortOverrideChange?.(e.target.value as ReasoningEffort | 'agent')}
                className="bg-transparent text-foreground font-semibold cursor-pointer border-none outline-none focus:ring-0 text-[11px] font-mono max-w-[72px] disabled:opacity-40"
              >
                <option value="agent" className="bg-card text-foreground">
                  {t('chatInput.thinkFollowAgent')}
                </option>
                <option value="low" className="bg-card text-foreground">
                  {t('agentForm.effortLow')}
                </option>
                <option value="medium" className="bg-card text-foreground">
                  {t('agentForm.effortMedium')}
                </option>
                <option value="high" className="bg-card text-foreground">
                  {t('agentForm.effortHigh')}
                </option>
              </select>
            </div>
        </div>

        {contextUsage && (
          <div className="shrink-0 pl-2 flex items-center gap-1">
            {onSaveLog && (
              <button
                type="button"
                onClick={onSaveLog}
                disabled={!canSaveLog}
                title={t('chatInput.saveLogTitle')}
                aria-label={t('chatInput.saveLog')}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              >
                <Save className="h-3.5 w-3.5" />
              </button>
            )}
            {onLoadLog && (
              <button
                type="button"
                onClick={onLoadLog}
                disabled={!hasSavedLog}
                title={t('chatInput.loadLogTitle')}
                aria-label={t('chatInput.loadLog')}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
            )}
            <ContextGauge
              tokens={contextUsage.tokens}
              limit={contextUsage.limit}
              onClick={onOpenCompactDialog}
            />
          </div>
        )}
      </div>

      <div className={cn('relative', customHeight ? 'flex-1 min-h-0 flex flex-col' : '')}>
        {/* P11-26: 첨부 이미지 썸네일 */}
        {images.length > 0 && (
          <div className="flex items-center gap-2 px-3.5 pt-2 overflow-x-auto">
            {images.map((src, i) => (
              <div key={`${i}-${src.slice(0, 32)}`} className="relative shrink-0 group/thumb">
                <img
                  src={src}
                  alt={t('chatInput.imageAlt', { n: i + 1 })}
                  className="h-14 w-14 rounded-lg object-cover border border-border"
                />
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  aria-label={t('chatInput.imageRemove', { n: i + 1 })}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {vision === 'no' && images.length > 0 && (
          <p className="px-3.5 pt-1 text-[11px] text-warning">
            {t('chatInput.noVisionHint')}
          </p>
        )}
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={(e) => handleTextChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onSelect={(e) => mention.sync(text, e.currentTarget.selectionStart ?? text.length)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={isLockedByOtherSession || isAgentDeleted}
          placeholder={placeholder || defaultPlaceholder}
          style={customHeight ? undefined : { maxHeight: `${maxHeight}px` }}
          className={cn(
            'w-full resize-none bg-transparent px-3.5 py-2.5 pr-20 text-sm text-foreground placeholder:text-muted-foreground/60 border-0 outline-none focus:outline-none focus:ring-0 shadow-none leading-normal font-sans',
            (isLockedByOtherSession || isAgentDeleted) && 'opacity-60 cursor-not-allowed',
            customHeight
              ? 'flex-1 min-h-0 h-full overflow-y-auto'
              : 'min-h-[38px] overflow-y-auto',
          )}
        />

        <div className="absolute right-2.5 bottom-2 flex items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              if (e.target.files) void addImageFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLockedByOtherSession || isAgentDeleted}
            className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-30"
            title={vision === 'no' ? t('chatInput.attachNoVision') : t('chatInput.attach')}
          >
            <ImagePlus className="h-4 w-4" />
          </Button>
          {isStreaming && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={onStop}
              className="h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive transition-colors"
              title={t('chatInput.stop')}
            >
              <Square className="h-4 w-4 fill-current" />
            </Button>
          )}

          <Button
            type="button"
            size="icon"
            onClick={() => void handleSubmit()}
            disabled={isLockedByOtherSession || isAgentDeleted || (!text.trim() && images.length === 0)}
            className="h-8 w-8 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-30 disabled:pointer-events-none"
            title={
              isAgentDeleted
                ? t('chatInput.agentDeletedBanner')
                : isLockedByOtherSession
                ? t('chatInput.sendLocked')
                : isThisSessionBusy || isStreaming
                ? t('chatInput.sendQueue')
                : t('chatInput.send')
            }
          >
            {isThisSessionBusy || isStreaming ? (
              <CornerDownLeft className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
