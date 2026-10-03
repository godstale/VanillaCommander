import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Moon, Sun, Monitor, Activity, Wand2, FolderOpen, ShieldCheck, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/context/ThemeContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { DEFAULT_MONITORING_INTERVAL_MS } from '@/lib/db/repositories/settingsRepo';
import { listAudit } from '@/lib/db/repositories/integrationsRepo';
import type { IntegrationAuditRow } from '@/lib/integrations/types';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

const MONITORING_INTERVAL_OPTIONS = [1000, 2000, 3000, 5000, 10000];

export function SettingsGeneral() {
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, markChosen, t } = useLanguage();
  const { settings, updateSettings } = useSettings();
  const navigate = useNavigate();
  const monitoringIntervalMs =
    settings.monitoringIntervalMs ?? DEFAULT_MONITORING_INTERVAL_MS;

  const pickLocale = (next: 'ko' | 'en') => {
    setLocale(next);
    markChosen();
  };

  // P11-50: 작업 폴더 변경 (두 단계 확인, 기존 파일은 이동하지 않음).
  const [confirmWorkFolder, setConfirmWorkFolder] = useState(false);
  const [workFolderBusy, setWorkFolderBusy] = useState(false);
  const [workFolderError, setWorkFolderError] = useState<string | null>(null);

  const changeWorkFolder = async () => {
    if (!confirmWorkFolder) {
      setConfirmWorkFolder(true);
      return;
    }
    setConfirmWorkFolder(false);
    setWorkFolderBusy(true);
    setWorkFolderError(null);
    try {
      const picked = await invoke<string | null>('pick_project_folder');
      if (picked) {
        await invoke('ensure_work_folder_layout', { workFolder: picked });
        await updateSettings({ workFolder: picked });
      }
    } catch (err) {
      setWorkFolderError(t('settingsGeneral.workFolderFailed', { err: err instanceof Error ? err.message : String(err) }));
    } finally {
      setWorkFolderBusy(false);
    }
  };

  // P11-50: 에이전트 허용 폴더.
  const [rootInput, setRootInput] = useState('');
  const allowedRoots = settings.agentAllowedRoots ?? [];
  const addRoot = async () => {
    const folder = rootInput.trim();
    if (!folder || allowedRoots.includes(folder)) return;
    const next = [...allowedRoots, folder];
    await updateSettings({ agentAllowedRoots: next });
    try {
      await invoke('set_agent_allowed_roots', { roots: next });
    } catch {
      // Rust 동기화 실패는 다음 워크스페이스 변경 시 재시도된다.
    }
    setRootInput('');
  };
  const removeRoot = async (folder: string) => {
    const next = allowedRoots.filter((f) => f !== folder);
    await updateSettings({ agentAllowedRoots: next });
    try {
      await invoke('set_agent_allowed_roots', { roots: next });
    } catch {
      // ignore — retried on next workspace change
    }
  };

  // P11-50: 외부 전송 감사 로그.
  const [auditRows, setAuditRows] = useState<IntegrationAuditRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    void listAudit({ limit: 50 })
      .then((rows) => {
        if (!cancelled) setAuditRows(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
            <Wand2 className="h-4 w-4 text-primary" />
            {t('setup.rerunTitle')}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('setup.rerunDesc')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate('/?setup=1')}>
          {t('setup.rerun')}
        </Button>
      </div>

      <div className="border border-border rounded-xl p-5 bg-card/40 space-y-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <FolderOpen className="h-4 w-4 text-primary" />
            {t('settingsGeneral.workFolder')}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('settingsGeneral.workFolderDesc')}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs flex items-center gap-2">
          <span className="font-mono truncate flex-1">
            {settings.workFolder ?? '—'}
          </span>
          <Button
            type="button"
            variant={confirmWorkFolder ? 'default' : 'outline'}
            size="sm"
            onClick={() => void changeWorkFolder()}
            disabled={workFolderBusy}
          >
            {confirmWorkFolder ? t('settingsGeneral.workFolderConfirm') : t('settingsGeneral.workFolderChange')}
          </Button>
        </div>
        {workFolderError && <p className="text-xs text-destructive">{workFolderError}</p>}
      </div>

      <div className="border border-border rounded-xl p-5 bg-card/40 space-y-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-primary" />
            {t('settingsGeneral.allowedRoots')}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('settingsGeneral.allowedRootsDesc')}
          </p>
        </div>
        {allowedRoots.length > 0 && (
          <ul className="space-y-1">
            {allowedRoots.map((folder) => (
              <li
                key={folder}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-border bg-background text-xs font-mono"
              >
                <span className="truncate">{folder}</span>
                <button
                  type="button"
                  onClick={() => void removeRoot(folder)}
                  aria-label={folder}
                  className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer shrink-0"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-1.5">
          <input
            type="text"
            value={rootInput}
            onChange={(e) => setRootInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addRoot();
            }}
            placeholder={t('settingsGeneral.allowedRootsPlaceholder')}
            className="flex-1 px-3 py-1.5 text-xs rounded-md border border-border bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <Button type="button" size="sm" variant="outline" onClick={() => void addRoot()}>
            {t('settingsGeneral.allowedRootsAdd')}
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-xl p-5 bg-card/40 space-y-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <History className="h-4 w-4 text-primary" />
            {t('settingsGeneral.auditTitle')}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('settingsGeneral.auditDesc')}
          </p>
        </div>
        {auditRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('settingsGeneral.auditEmpty')}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <tbody>
                {auditRows.map((row) => (
                  <tr key={row.id} className="border-b border-border/50 last:border-0">
                    <td className="px-2 py-1.5 font-mono text-[11px]">{row.purpose}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[11px]">{row.bytesSent}B</td>
                    <td className="px-2 py-1.5 text-right text-muted-foreground text-[11px] whitespace-nowrap">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
