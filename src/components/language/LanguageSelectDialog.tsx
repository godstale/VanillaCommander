import { useState } from 'react';
import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { Locale } from '@/lib/i18n/types';
import { cn } from '@/lib/utils';

export function LanguageSelectDialog() {
  const { locale, setLocale, t, hasChosen, markChosen } = useLanguage();
  const [draft, setDraft] = useState<Locale>(locale);

  const open = !hasChosen;

  const confirm = () => {
    setLocale(draft);
    markChosen();
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Languages className="h-5 w-5 text-primary" />
            {t('languageSelect.title')}
          </DialogTitle>
          <DialogDescription>{t('languageSelect.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          {(['ko', 'en'] as const).map((code) => (
            <Button
              key={code}
              type="button"
              variant="outline"
              onClick={() => setDraft(code)}
              className={cn(
                'h-16 text-sm transition-colors',
                draft === code
                  ? 'border-primary bg-accent/40 text-foreground font-semibold'
                  : 'text-muted-foreground',
              )}
            >
              {code === 'ko' ? t('languageSelect.koLabel') : t('languageSelect.enLabel')}
            </Button>
          ))}
        </div>

        <Button type="button" onClick={confirm} className="w-full">
          {t('languageSelect.confirm')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export default LanguageSelectDialog;
