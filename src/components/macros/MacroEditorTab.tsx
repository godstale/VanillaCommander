// P11-40: 매크로 편집 탭. 프롬프트 순서 편집·`@` 참조·스케줄·테스트 실행.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Zap, Plus, Trash2, ArrowUp, ArrowDown, Play } from 'lucide-react';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useAgents } from '@/lib/context/AgentsContext';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useChatSessions } from '@/lib/context/ChatSessionsContext';
import { useMacros } from '@/lib/macros/useMacros';
import {
  buildMacroName,
  type Macro,
  type MacroDraft,
  type MacroSchedule,
} from '@/lib/macros/types';
import { launchMacroRun } from '@/lib/macros/launch';
import { useMention } from '@/hooks/useMention';
import { MentionPopup } from '@/components/chat/MentionPopup';
import { Button } from '@/components/ui/button';

interface MacroPromptRowProps {
  value: string;
  cwd: string | null;
  placeholder: string;
  onChange: (value: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  disableUp: boolean;
  disableDown: boolean;
  moveUpLabel: string;
  moveDownLabel: string;
  removeLabel: string;
}

function MacroPromptRow({
  value,
  cwd,
  placeholder,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  disableUp,
  disableDown,
  moveUpLabel,
  moveDownLabel,
  removeLabel,
}: MacroPromptRowProps) {
  const mention = useMention(cwd);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const applyPick = (next: string, cursor: number) => {
    onChange(next);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div className="relative flex items-start gap-1.5 p-2.5 rounded-lg border border-border/70 bg-card/60">
      {mention.open && (
        <MentionPopup
          items={mention.items}
          index={mention.index}
          onPick={() => mention.pickCurrent(value, applyPick)}
          onHover={(i) => mention.move(i - mention.index)}
        />
      )}
      <textarea
        ref={textareaRef}
        rows={2}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          mention.sync(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onSelect={(e) => mention.sync(value, e.currentTarget.selectionStart ?? value.length)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (!mention.open) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            mention.move(1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            mention.move(-1);
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            mention.pickCurrent(value, applyPick);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            mention.close();
          }
        }}
        placeholder={placeholder}
        className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-y"
      />
      <div className="flex flex-col gap-0.5 shrink-0">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={disableUp}
          title={moveUpLabel}
          aria-label={moveUpLabel}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-30 cursor-pointer"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={disableDown}
          title={moveDownLabel}
          aria-label={moveDownLabel}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-30 cursor-pointer"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          title={removeLabel}
          aria-label={removeLabel}
          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted/60 transition-colors cursor-pointer"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export interface MacroEditorTabProps {
  tab: WorkspaceTab;
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export function MacroEditorTab({ tab }: MacroEditorTabProps) {
  const { t } = useLanguage();
  const { agents, defaultAgent, getAgent } = useAgents();
  const workspace = useSafeWorkspace();
  const { openTab, updateTab, closeTab } = useWorkspaceTabs();
  const { refreshSessions } = useChatSessions();
  const { macros, create, update } = useMacros();

  const macroId = tab.meta?.macroId as string | undefined;
  const isNew = !macroId || macroId === 'new';
  const existing: Macro | undefined = isNew
    ? undefined
    : macros.find((m) => m.id === macroId);

  const [name, setName] = useState(existing?.name ?? '');
  const [agentId, setAgentId] = useState<string>(existing?.agentId ?? '');
  const [runRoot, setRunRoot] = useState(existing?.runRoot ?? '');
  const [prompts, setPrompts] = useState<string[]>(existing?.prompts ?? ['']);
  const [schedule, setSchedule] = useState<MacroSchedule>(existing?.schedule ?? { kind: 'none' });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cwd = runRoot.trim() || workspace?.workFolder || workspace?.workspaceRoot || null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 다른 매크로 전환 시 폼 교체
    setName(existing?.name ?? '');
    setAgentId(existing?.agentId ?? '');
    setRunRoot(existing?.runRoot ?? '');
    setPrompts(existing?.prompts ?? ['']);
    setSchedule(existing?.schedule ?? { kind: 'none' });
    setSaved(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [macroId]);

  const setPrompt = useCallback((index: number, value: string) => {
    setPrompts((prev) => prev.map((p, i) => (i === index ? value : p)));
    setSaved(false);
  }, []);

  const movePrompt = useCallback((index: number, delta: -1 | 1) => {
    setPrompts((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setSaved(false);
  }, []);

  const removePrompt = useCallback((index: number) => {
    setPrompts((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : ['']));
    setSaved(false);
  }, []);

  const collectDraft = useCallback((): MacroDraft | null => {
    const cleaned = prompts.map((s) => s.trim()).filter((s) => s.length > 0);
    if (cleaned.length === 0) {
      setError(t('macros.emptyPrompts'));
      return null;
    }
    setError(null);
    return {
      name: name.trim() || buildMacroName(cleaned, macros.map((m) => m.name)),
      prompts: cleaned,
      agentId: agentId || null,
      runRoot: runRoot.trim(),
      schedule,
    };
  }, [prompts, name, macros, agentId, runRoot, schedule, t]);

  const handleSave = useCallback(async (): Promise<Macro | null> => {
    const draft = collectDraft();
    if (!draft) return null;
    if (isNew) {
      const created = await create(draft);
      // 새 탭 id로 교체한다 (updateTab은 id 변경 불가).
      openTab({
        id: `macro-editor:${created.id}`,
        type: 'macro-editor',
        title: created.name,
        meta: { macroId: created.id },
      });
      closeTab(tab.id);
      setSaved(true);
      return created;
    }
    const updated = await update(macroId, draft);
    if (updated) {
      updateTab(tab.id, { title: updated.name });
      setSaved(true);
    }
    return updated;
  }, [collectDraft, isNew, create, update, macroId, updateTab, openTab, closeTab, tab.id]);

  const handleTestRun = useCallback(async () => {
    const macro = await handleSave();
    if (!macro) return;
    const resolvedAgentId =
      (macro.agentId && getAgent(macro.agentId)?.id) || defaultAgent.id;
    await launchMacroRun(macro, resolvedAgentId, openTab, { refreshSessions });
  }, [handleSave, getAgent, defaultAgent.id, openTab, refreshSessions]);

  const scheduleKind = schedule.kind;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">
            {isNew ? t('macros.editorNew') : t('macros.editorTitle')}
          </h2>
        </div>

        {error && (
          <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t('macros.name')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
              placeholder={t('macros.namePlaceholder')}
              className="w-full px-3 py-1.5 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t('macros.agent')}
            </label>
            <select
              value={agentId}
              onChange={(e) => {
                setAgentId(e.target.value);
                setSaved(false);
              }}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">
                {t('macros.agentDefault')} ({defaultAgent.name})
              </option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} • {agent.model}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            {t('macros.runRoot')}
          </label>
          <input
            type="text"
            value={runRoot}
            onChange={(e) => {
              setRunRoot(e.target.value);
              setSaved(false);
            }}
            placeholder={t('macros.runRootDefault')}
            className="w-full px-3 py-1.5 text-xs rounded-md border border-border bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-2">
          <span className="block text-xs font-medium text-muted-foreground">
            {t('macros.promptsLabel')}
          </span>
          {prompts.map((prompt, i) => (
            <MacroPromptRow
              key={i}
              value={prompt}
              cwd={cwd}
              placeholder={t('macros.promptPlaceholder')}
              onChange={(v) => setPrompt(i, v)}
              onMoveUp={() => movePrompt(i, -1)}
              onMoveDown={() => movePrompt(i, 1)}
              onRemove={() => removePrompt(i)}
              disableUp={i === 0}
              disableDown={i === prompts.length - 1}
              moveUpLabel={t('macros.moveUp')}
              moveDownLabel={t('macros.moveDown')}
              removeLabel={t('macros.removePrompt')}
            />
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setPrompts((prev) => [...prev, '']);
              setSaved(false);
            }}
            className="gap-1 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t('macros.addPrompt')}</span>
          </Button>
        </div>

        <div className="border border-border rounded-xl p-4 bg-card/40 space-y-3">
          <h3 className="text-sm font-semibold">{t('macros.schedule')}</h3>
          <select
            value={scheduleKind}
            onChange={(e) => {
              const kind = e.target.value as MacroSchedule['kind'];
              setSchedule(
                kind === 'interval'
                  ? { kind, minutes: 60 }
                  : kind === 'daily'
                    ? { kind, time: '09:00' }
                    : kind === 'weekly'
                      ? { kind, weekday: 1, time: '09:00' }
                      : { kind: 'none' },
              );
              setSaved(false);
            }}
            className="w-full md:w-64 px-2.5 py-1.5 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="none">{t('macros.scheduleNone')}</option>
            <option value="interval">{t('macros.scheduleInterval')}</option>
            <option value="daily">{t('macros.scheduleDaily')}</option>
            <option value="weekly">{t('macros.scheduleWeekly')}</option>
          </select>
          {schedule.kind === 'interval' && (
            <div className="flex items-center gap-2 text-xs">
              <label className="text-muted-foreground">{t('macros.intervalMinutes')}</label>
              <input
                type="number"
                min={1}
                value={schedule.minutes}
                onChange={(e) => {
                  setSchedule({ ...schedule, minutes: Math.max(1, Number(e.target.value) || 1) });
                  setSaved(false);
                }}
                className="w-24 px-2 py-1 text-xs rounded-md border border-border bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <label className="flex items-center gap-1 text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={schedule.catchUp ?? false}
                  onChange={(e) => {
                    setSchedule({ ...schedule, catchUp: e.target.checked });
                    setSaved(false);
                  }}
                  className="accent-primary"
                />
                {t('macros.catchUp')}
              </label>
            </div>
          )}
          {(schedule.kind === 'daily' || schedule.kind === 'weekly') && (
            <div className="flex items-center gap-2 text-xs">
              {schedule.kind === 'weekly' && (
                <>
                  <label className="text-muted-foreground">{t('macros.weeklyDay')}</label>
                  <select
                    value={schedule.weekday}
                    onChange={(e) => {
                      setSchedule({ ...schedule, weekday: Number(e.target.value) });
                      setSaved(false);
                    }}
                    className="px-2 py-1 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {WEEKDAYS.map((d) => (
                      <option key={d} value={d}>
                        {t(`macros.weekday${d}`)}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <label className="text-muted-foreground">{t('macros.dailyTime')}</label>
              <input
                type="time"
                value={schedule.time}
                onChange={(e) => {
                  setSchedule({ ...schedule, time: e.target.value || '09:00' });
                  setSaved(false);
                }}
                className="px-2 py-1 text-xs rounded-md border border-border bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <label className="flex items-center gap-1 text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={schedule.catchUp ?? false}
                  onChange={(e) => {
                    setSchedule({ ...schedule, catchUp: e.target.checked });
                    setSaved(false);
                  }}
                  className="accent-primary"
                />
                {t('macros.catchUp')}
              </label>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={() => void handleSave()}>
            {t('macros.save')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void handleTestRun()}
            className="gap-1.5"
          >
            <Play className="h-3.5 w-3.5" />
            <span>{t('macros.testRun')}</span>
          </Button>
          {saved && <span className="text-[11px] text-success">{t('macros.saved')}</span>}
        </div>
      </div>
    </div>
  );
}

export default MacroEditorTab;
