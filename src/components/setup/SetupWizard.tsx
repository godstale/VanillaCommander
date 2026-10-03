import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { useAgents } from '@/lib/context/AgentsContext';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { StepLanguage } from './steps/StepLanguage';
import { StepWorkFolder } from './steps/StepWorkFolder';
import { StepAgent } from './steps/StepAgent';
import { StepWiki } from './steps/StepWiki';
import { StepMacro } from './steps/StepMacro';
import { StepDone } from './steps/StepDone';

const STEPS = [StepLanguage, StepWorkFolder, StepAgent, StepWiki, StepMacro, StepDone];

export function SetupWizard({ onClose }: { onClose: (completed: boolean) => void }) {
  const { t } = useLanguage();
  const { updateSettings } = useSettings();
  const { defaultAgent } = useAgents();
  const { openTab } = useWorkspaceTabs();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const applyRef = useRef<() => Promise<void>>(async () => {});

  const registerApply = useCallback((apply: () => Promise<void>) => {
    applyRef.current = apply;
  }, []);

  const goNext = async () => {
    setBusy(true);
    try {
      await applyRef.current();
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    } finally {
      setBusy(false);
    }
  };

  const skip = () => {
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const finish = async () => {
    setBusy(true);
    try {
      await applyRef.current();
      await updateSettings({ setupCompletedAt: new Date().toISOString() });
      // D9: 완료 시 기본 에이전트 편집 탭을 연다.
      openTab({
        id: `agent-editor:${defaultAgent.id}`,
        type: 'agent-editor',
        title: t('agentList.edit', { name: defaultAgent.name }),
        meta: { agentId: defaultAgent.id },
      });
      onClose(true);
    } finally {
      setBusy(false);
    }
  };

  const Step = STEPS[step] ?? StepLanguage;
  const last = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">{t('setup.title')}</h2>
          <span className="text-[11px] text-muted-foreground">
            {t('setup.stepOf', { a: String(step + 1), b: String(STEPS.length) })}
          </span>
        </div>
        <div className="px-5 py-4 min-h-64">
          <Step onApply={registerApply} />
        </div>
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <div>
            {step > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={() => setStep((s) => s - 1)} disabled={busy}>
                {t('setup.back')}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!last && (
              <Button type="button" variant="ghost" size="sm" onClick={skip} disabled={busy}>
                {t('setup.skip')}
              </Button>
            )}
            {last ? (
              <Button type="button" size="sm" onClick={() => void finish()} disabled={busy}>
                {t('setup.finish')}
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => void goNext()} disabled={busy}>
                {t('setup.next')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SetupWizard;
