import { useEffect } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export function StepDone({ onApply }: { onApply: (apply: () => Promise<void>) => void }) {
  const { t } = useLanguage();

  useEffect(() => {
    onApply(async () => {});
  }, [onApply]);

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-col items-center text-center gap-2 py-4">
        <CheckCircle2 className="h-10 w-10 text-success" />
        <h3 className="text-sm font-semibold">{t('setup.done.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('setup.done.desc')}</p>
      </div>
    </div>
  );
}
