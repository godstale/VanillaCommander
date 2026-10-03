// P11-50: 업데이트 화면. 현재 버전 표시 + 준비 중 안내 (기능 미구현).
import { RefreshCw } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const APP_VERSION = '0.1.0';

export function SettingsUpdate() {
  const { t } = useLanguage();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">{t('settingsUpdate.title')}</h2>
        <p className="text-xs text-muted-foreground mt-1">{t('settingsUpdate.desc')}</p>
      </div>

      <div className="border border-border rounded-xl p-5 bg-card/40 space-y-3">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{t('settingsUpdate.current')}</h3>
        </div>
        <p className="font-mono text-xs">
          Vanilla Commander v{APP_VERSION}
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t('settingsUpdate.comingSoon')}
        </p>
      </div>
    </div>
  );
}

export default SettingsUpdate;
