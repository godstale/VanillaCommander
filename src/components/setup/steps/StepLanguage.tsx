import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { cn } from '@/lib/utils';

export function StepLanguage({ onApply }: { onApply: (apply: () => Promise<void>) => void }) {
  const { locale, setLocale, markChosen, t } = useLanguage();

  useEffect(() => {
    onApply(async () => {
      markChosen();
    });
  }, [onApply, markChosen]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{t('setup.lang.title')}</h3>
        <p className="text-xs text-muted-foreground mt-1">{t('setup.lang.desc')}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {(['ko', 'en'] as const).map((code) => (
          <Button
            key={code}
            type="button"
            variant="outline"
            onClick={() => setLocale(code)}
            className={cn(
              'h-16 text-sm transition-colors',
              locale === code
                ? 'border-primary bg-accent/40 text-foreground font-semibold'
                : 'text-muted-foreground',
            )}
          >
            {code === 'ko' ? t('languageSelect.koLabel') : t('languageSelect.enLabel')}
          </Button>
        ))}
      </div>
    </div>
  );
}
