import { Moon, Sun, Monitor, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/context/ThemeContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { DEFAULT_MONITORING_INTERVAL_MS } from '@/lib/db/repositories/settingsRepo';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { cn } from '@/lib/utils';

const MONITORING_INTERVAL_OPTIONS = [1000, 2000, 3000, 5000, 10000];

export function SettingsGeneral() {
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, markChosen, t } = useLanguage();
  const { settings, updateSettings } = useSettings();
  const monitoringIntervalMs =
    settings.monitoringIntervalMs ?? DEFAULT_MONITORING_INTERVAL_MS;

  const pickLocale = (next: 'ko' | 'en') => {
    setLocale(next);
    markChosen();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">{t('settingsGeneral.title')}</h2>
        <p className="text-xs text-muted-foreground mt-1">{t('settingsGeneral.desc')}</p>
      </div>

      <div className="border border-border rounded-xl p-5 bg-card/40 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">{t('settingsGeneral.theme')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('settingsGeneral.themeDesc')}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setTheme('dark')}
            className={cn(
              'flex flex-col items-center gap-2 h-20 transition-colors',
              theme === 'dark'
                ? 'border-primary bg-accent/40 text-foreground font-semibold'
                : 'text-muted-foreground',
            )}
          >
            <Moon className={cn('h-5 w-5', theme === 'dark' && 'text-primary')} />
            <span className="text-xs">{t('settingsGeneral.dark')}</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => setTheme('light')}
            className={cn(
              'flex flex-col items-center gap-2 h-20 transition-colors',
              theme === 'light'
                ? 'border-primary bg-accent/40 text-foreground font-semibold'
                : 'text-muted-foreground',
            )}
          >
            <Sun className={cn('h-5 w-5', theme === 'light' && 'text-primary')} />
            <span className="text-xs">{t('settingsGeneral.light')}</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => setTheme('system')}
            className={cn(
              'flex flex-col items-center gap-2 h-20 transition-colors',
              theme === 'system'
                ? 'border-primary bg-accent/40 text-foreground font-semibold'
                : 'text-muted-foreground',
            )}
          >
            <Monitor className={cn('h-5 w-5', theme === 'system' && 'text-primary')} />
            <span className="text-xs">{t('settingsGeneral.system')}</span>
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-xl p-5 bg-card/40 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">{t('settingsGeneral.language')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('settingsGeneral.languageDesc')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={locale === 'ko' ? 'default' : 'outline'}
            size="sm"
            onClick={() => pickLocale('ko')}
            className={cn('text-xs', locale !== 'ko' && 'text-muted-foreground')}
          >
            {t('languageSelect.koLabel')}
          </Button>
          <Button
            variant={locale === 'en' ? 'default' : 'outline'}
            size="sm"
            onClick={() => pickLocale('en')}
            className={cn('text-xs', locale !== 'en' && 'text-muted-foreground')}
          >
            {t('languageSelect.enLabel')}
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-xl p-5 bg-card/40 space-y-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Activity className="h-4 w-4 text-primary" />
            {t('settingsGeneral.monitoring')}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('settingsGeneral.monitoringDesc')}
          </p>
        </div>
        <div>
          <label className="text-xs font-medium">{t('settingsGeneral.monitoringInterval')}</label>
          <div className="flex gap-2 mt-2 flex-wrap">
            {MONITORING_INTERVAL_OPTIONS.map((ms) => (
              <Button
                key={ms}
                variant={monitoringIntervalMs === ms ? 'default' : 'outline'}
                size="sm"
                onClick={() => void updateSettings({ monitoringIntervalMs: ms })}
                className={cn('text-xs', monitoringIntervalMs !== ms && 'text-muted-foreground')}
              >
                {t('settingsGeneral.monitoringIntervalSec', { n: String(ms / 1000) })}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsGeneral;
