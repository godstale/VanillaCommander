// P11-40: 매크로 사이드 패널. 목록·실행·스케줄 표시 + [새 매크로].
import { useCallback } from 'react';
import { Zap, Plus, Play, Pencil, Trash2, MessageSquare } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useMacros } from '@/lib/macros/useMacros';
import { useAgents } from '@/lib/context/AgentsContext';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useChatSessions } from '@/lib/context/ChatSessionsContext';
import { describeSchedule, isScheduleEnabled, type Macro } from '@/lib/macros/types';
import { launchMacroRun } from '@/lib/macros/launch';

export function MacroPanel() {
  const { t } = useLanguage();
  const { macros, remove } = useMacros();
  const { getAgent, defaultAgent } = useAgents();
  const { openTab } = useWorkspaceTabs();
  const { refreshSessions } = useChatSessions();

  const runMacro = useCallback(async (macro: Macro) => {
    const agentId = (macro.agentId && getAgent(macro.agentId)?.id) || defaultAgent.id;
    await launchMacroRun(macro, agentId, openTab, { refreshSessions });
  }, [getAgent, defaultAgent.id, openTab, refreshSessions]);

  const openEditor = useCallback((macroId: string, title: string) => {
    openTab({
      id: `macro-editor:${macroId}`,
      type: 'macro-editor',
      title,
      meta: { macroId },
    });
  }, [openTab]);

  const openSession = useCallback((macro: Macro) => {
    const sessionId = `macro:${macro.id}`;
    const agentId = (macro.agentId && getAgent(macro.agentId)?.id) || defaultAgent.id;
    openTab({
      id: `chat:${sessionId}`,
      type: 'chat',
      title: macro.name,
      meta: { sessionId, agentId },
    });
  }, [getAgent, defaultAgent.id, openTab]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <Zap className="h-3.5 w-3.5 text-primary" />
          <span>{t('macros.panelTitle')}</span>
        </div>
        <button
          type="button"
          onClick={() => openEditor('new', t('macros.editorNew'))}
          title={t('macros.new')}
          aria-label={t('macros.new')}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {macros.length === 0 ? (
          <p className="text-[11px] text-muted-foreground text-center py-8">
            {t('macros.empty')}
          </p>
        ) : (
          macros.map((macro) => {
            const agent = macro.agentId ? getAgent(macro.agentId) : undefined;
            return (
              <div
                key={macro.id}
                className="p-2.5 rounded-lg border border-border/70 bg-card/60 space-y-1.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-semibold truncate flex-1">{macro.name}</span>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                    {t('macros.prompts', { n: macro.prompts.length })}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">
                  {(agent?.name ?? defaultAgent.name)}
                  {' · '}
                  {isScheduleEnabled(macro.schedule)
                    ? describeSchedule(macro.schedule)
                    : t('macros.scheduleOff')}
                </p>
                {macro.lastResult && (
                  <p className="text-[11px] text-muted-foreground truncate" title={macro.lastResult}>
                    {t('macros.lastResult')}: {macro.lastResult}
                  </p>
                )}
                <div className="flex items-center gap-1 pt-0.5">
                  <button
                    type="button"
                    onClick={() => void runMacro(macro)}
                    title={t('macros.runTitle')}
                    className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition-colors cursor-pointer"
                  >
                    <Play className="h-3 w-3" />
                    <span>{t('macros.run')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditor(macro.id, macro.name)}
                    title={t('macros.edit')}
                    aria-label={`${t('macros.edit')}: ${macro.name}`}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openSession(macro)}
                    title={t('macros.openSession')}
                    aria-label={`${t('macros.openSession')}: ${macro.name}`}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(macro.id)}
                    title={t('macros.delete')}
                    aria-label={`${t('macros.delete')}: ${macro.name}`}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted/60 transition-colors cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default MacroPanel;
