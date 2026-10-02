import { useEffect } from 'react';
import { Zap } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export function StepMacro({ onApply }: { onApply: (apply: () => Promise<void>) => void }) {
  const { t } = useLanguage();

  useEffect(() => {
    onApply(async () => {});
  }, [onApply]);

  return (
    <div className="space-y-4 text-xs">
      <div>
        <h3 className="text-sm font-semibold">{t('setup.macro.title')}</h3>
        <p className="text-xs text-muted-foreground mt-1">{t('setup.macro.desc')}</p>
      </div>
      <div className="rounded-lg border border-border bg-muted/40 p-3 flex items-center gap-2 text-muted-foreground">
        <Zap className="h-4 w-4 shrink-0" />
        <span>{t('setup.macro.desc')}</span>
      </div>
    </div>
  );
}
