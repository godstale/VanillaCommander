import { useEffect, useRef, useState } from 'react';
import { Check, Info, Thermometer } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useSettings } from '@/lib/context/SettingsContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import {
  defaultKeepForContext,
  defaultReserveForContext,
} from '@/lib/compaction/settings';

/** 라벨 옆 [?] 아이콘. title 툴팁으로 상세 설명을 제공한다. */
function FieldHelp({ label, help }: { label: string; help: string }) {
  return (
    <span
      className="inline-flex items-center text-muted-foreground/70 hover:text-primary transition-colors cursor-help"
      title={help}
      aria-label={`${label} 도움말: ${help}`}
      role="img"
    >
      <Info className="h-3 w-3" />
    </span>
  );
}

function parseCount(raw: string, fallback: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export function SettingsModel() {
  const { t } = useLanguage();
  const { settings, updateSettings } = useSettings();

  const [temperature, setTemperature] = useState<string>(String(settings.defaultTemperature ?? 0.2));
  const [contextSize, setContextSize] = useState<string>(String(settings.defaultContextSize ?? 8192));
  const [reserveTokens, setReserveTokens] = useState<string>(String(settings.defaultReserveTokens ?? 0));
  const [keepRecentTokens, setKeepRecentTokens] = useState<string>(
    String(settings.defaultKeepRecentTokens ?? 0),
  );
  const [savedFlash, setSavedFlash] = useState(false);
  const syncedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatchRef = useRef<{
    defaultTemperature?: number;
    defaultContextSize?: number;
    defaultReserveTokens?: number;
    defaultKeepRecentTokens?: number;
  }>({});

  // 전역 설정이 늦게 로드되면 폼에 반영한다 (최초 1회).
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;
    setTemperature(String(settings.defaultTemperature ?? 0.2));
    setContextSize(String(settings.defaultContextSize ?? 8192));
    setReserveTokens(String(settings.defaultReserveTokens ?? 0));
    setKeepRecentTokens(String(settings.defaultKeepRecentTokens ?? 0));
  }, [settings]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const scheduleSave = (patch: {
    defaultTemperature?: number;
    defaultContextSize?: number;
    defaultReserveTokens?: number;
    defaultKeepRecentTokens?: number;
  }) => {
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const merged = pendingPatchRef.current;
      pendingPatchRef.current = {};
      void updateSettings(merged).then(() => {
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2000);
      });
    }, 500);
  };

  const tempNum = Number(temperature);
  const ctxNum = parseCount(contextSize, settings.defaultContextSize ?? 8192);
  const reserveNum = parseCount(reserveTokens, 0);
  const keepNum = parseCount(keepRecentTokens, 0);
  const effectiveReserve = reserveNum > 0 ? reserveNum : defaultReserveForContext(ctxNum);
  const effectiveKeep = keepNum > 0 ? keepNum : defaultKeepForContext(ctxNum);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold">{t('settingsModel.title')}</h2>
          {savedFlash && (
            <span className="flex items-center gap-1 text-xs text-success font-medium animate-fade-in">
              <Check className="h-3.5 w-3.5" />
              <span>{t('settingsModel.saved')}</span>
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {t('settingsModel.desc')}
        </p>
      </div>

      {/* Default generation temperature */}
      <div className="border border-border rounded-xl p-5 bg-card/40 space-y-4">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Thermometer className="h-4 w-4 text-primary" />
            <span>{t('settingsModel.temperature')}</span>
            <FieldHelp label={t('settingsModel.temperature')} help={t('settingsModel.temperatureHelp')} />
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('settingsModel.temperatureDesc')}
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-muted-foreground font-mono">
              {Number.isFinite(tempNum) ? tempNum.toFixed(2) : temperature}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={Number.isFinite(tempNum) ? Math.min(2, Math.max(0, tempNum)) : 0.2}
            onChange={(e) => {
              setTemperature(e.target.value);
              const v = Math.min(2, Math.max(0, parseFloat(e.target.value)));
              scheduleSave({ defaultTemperature: v });
            }}
            className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
          />
          <span className="text-[10px] text-muted-foreground block leading-tight mt-1.5">
            {t('settingsModel.temperatureHelp')}
          </span>
        </div>
      </div>

      {/* Context Size & Compaction Thresholds */}
      <div className="border border-border rounded-xl p-5 bg-card/40 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">{t('settingsModel.context')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('settingsModel.contextDesc')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium flex items-center gap-1">
              <span>{t('settingsModel.contextSize')}</span>
              <FieldHelp label={t('settingsModel.contextSize')} help={t('settingsModel.contextSizeHelp')} />
            </label>
            <Input
              type="number"
              min={1024}
              value={contextSize}
              onChange={(e) => {
                setContextSize(e.target.value);
                scheduleSave({ defaultContextSize: Math.max(1024, parseCount(e.target.value, 8192)) });
              }}
              className="text-xs font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium flex items-center gap-1">
              <span>{t('settingsModel.reserve')}</span>
              <FieldHelp label={t('settingsModel.reserve')} help={t('settingsModel.reserveHelp')} />
            </label>
            <Input
              type="number"
              min={0}
              placeholder={t('settingsModel.autoValue')}
              value={reserveTokens}
              onChange={(e) => {
                setReserveTokens(e.target.value);
                scheduleSave({ defaultReserveTokens: parseCount(e.target.value, 0) });
              }}
              className="text-xs font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium flex items-center gap-1">
              <span>{t('settingsModel.keepRecent')}</span>
              <FieldHelp label={t('settingsModel.keepRecent')} help={t('settingsModel.keepRecentHelp')} />
            </label>
            <Input
              type="number"
              min={0}
              placeholder={t('settingsModel.autoValue')}
              value={keepRecentTokens}
              onChange={(e) => {
                setKeepRecentTokens(e.target.value);
                scheduleSave({ defaultKeepRecentTokens: parseCount(e.target.value, 0) });
              }}
              className="text-xs font-mono"
            />
          </div>
        </div>

        <div className="p-3 rounded-lg bg-muted/40 border border-border/70 text-xs space-y-1 font-mono">
          <div className="flex justify-between">
            <span className="text-muted-foreground font-sans">{t('settingsModel.effectivePreview')}</span>
            <span className="font-semibold text-foreground">
              {t('settingsModel.effectivePreviewText', {
                ctx: ctxNum.toLocaleString(),
                reserve: effectiveReserve.toLocaleString(),
                keep: effectiveKeep.toLocaleString(),
              })}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground font-sans leading-relaxed">
            {t('settingsModel.stepTableText')}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsModel;
