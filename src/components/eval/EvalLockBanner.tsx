import { FlaskConical } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useEvalLock } from '@/lib/eval/evalLock';
import { useOpenEvalTab } from '@/lib/eval/ui/openEvalTab';
import { Button } from '@/components/ui/button';

export function EvalLockBanner() {
  const { t } = useLanguage();
  const lock = useEvalLock();
  const { openEvalRun } = useOpenEvalTab();
  if (!lock) return null;
  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs text-primary bg-primary/10 border-b border-primary/20 font-medium shrink-0 select-none">
      <FlaskConical className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{t('eval.lock.banner', { runName: lock.runName })}</span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="ml-auto h-6 shrink-0 px-2 text-[11px]"
        onClick={() => openEvalRun(lock.runId, lock.runName)}
      >
        {t('eval.lock.viewProgress')}
      </Button>
    </div>
  );
}
