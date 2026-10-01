import { ShieldCheck, AlertTriangle, ShieldAlert, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ApprovalMode } from '@/lib/types/agent';
import { useSettings } from '@/lib/context/SettingsContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export function SettingsApproval() {
  const { t } = useLanguage();
  const { settings, setDefaultApprovalMode, loading } = useSettings();
  const currentMode = settings.defaultApprovalMode;

  const handleSelectMode = async (mode: ApprovalMode) => {
    try {
      await setDefaultApprovalMode(mode);
    } catch (err) {
      console.error('Failed to update default approval mode:', err);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-bold text-foreground">{t('settingsApproval.title')}</h2>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          {t('settingsApproval.desc')}
        </p>
      </div>

      <div className="border border-border rounded-xl p-5 bg-card/40 space-y-4 shadow-xs">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('settingsApproval.defaultMode')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('settingsApproval.defaultModeDesc')}
            </p>
          </div>
          {loading && <span className="text-xs text-muted-foreground animate-pulse">{t('settingsApproval.loading')}</span>}
        </div>

        <div className="space-y-3 pt-2">
          {/* dangerous-only */}
          <div
            onClick={() => void handleSelectMode('dangerous-only')}
            className={cn(
              'border rounded-lg p-4 cursor-pointer transition-colors relative',
              currentMode === 'dangerous-only'
                ? 'border-primary bg-accent/30 ring-1 ring-primary/40'
                : 'border-border hover:bg-accent/10',
            )}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span className="text-xs font-semibold text-foreground">
                {t('settingsApproval.dangerousOnly')}
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-primary/20 text-primary font-mono ml-auto">
                {t('settingsApproval.isDefault')}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 ml-6 leading-relaxed">
              {t('settingsApproval.dangerousOnlyDesc')}
            </p>
          </div>

          {/* always */}
          <div
            onClick={() => void handleSelectMode('always')}
            className={cn(
              'border rounded-lg p-4 cursor-pointer transition-colors',
              currentMode === 'always'
                ? 'border-primary bg-accent/30 ring-1 ring-primary/40'
                : 'border-border hover:bg-accent/10',
            )}
          >
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-destructive" />
              <span className="text-xs font-semibold text-foreground">{t('settingsApproval.strict')}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 ml-6 leading-relaxed">
              {t('settingsApproval.strictDesc')}
            </p>
          </div>

          {/* never */}
          <div
            onClick={() => void handleSelectMode('never')}
            className={cn(
              'border rounded-lg p-4 cursor-pointer transition-colors',
              currentMode === 'never'
                ? 'border-primary bg-accent/30 ring-1 ring-primary/40'
                : 'border-border hover:bg-accent/10',
            )}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-foreground">{t('settingsApproval.yolo')}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 ml-6 leading-relaxed">
              {t('settingsApproval.yoloDesc')}
            </p>
            <div className="mt-2.5 ml-6 p-2 rounded bg-destructive/10 border border-destructive/20 text-[11px] text-destructive flex items-start gap-1.5 font-medium">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                {t('settingsApproval.shellNote')}
              </span>
            </div>
          </div>
        </div>

        {/* Shell Tool Security Notice */}
        <div className="mt-4 p-3 rounded-lg bg-muted/40 border border-border/70 flex items-start gap-2.5 text-xs text-muted-foreground">
          <Terminal className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold text-foreground text-xs">{t('settingsApproval.shellBoundary')}</span>
            <p className="text-[11px] leading-relaxed">
              {t('settingsApproval.shellBoundaryDesc')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsApproval;
