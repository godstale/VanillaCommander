// P11-34: 설정 > 문서 파싱 연동. 확장자별 파서 표 + 외부 파서 등록/테스트.
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FileText, Plus, Trash2, FlaskConical, RefreshCw, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/lib/context/SettingsContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { ParserSettings } from '@/lib/db/repositories/settingsRepo';
import {
  EXTERNAL_PARSER_PRESETS,
  splitCommand,
  type ExternalOutputMode,
} from '@/lib/parsers/external';
import { parseDocument, ParseError } from '@/lib/parsers/index';

const KNOWN_EXTS = ['pdf', 'docx', 'xlsx', 'xls', 'csv', 'pptx', 'md', 'txt'];

const BUILTIN_LABEL: Record<string, string> = {
  pdf: 'pdfjs',
  docx: 'mammoth',
  xlsx: 'sheetjs',
  xls: 'sheetjs',
  csv: 'sheetjs',
  pptx: 'office-rust',
  md: 'text',
  txt: 'text',
};

interface TestResult {
  method: string;
  chars: number;
  head: string;
  error?: string;
}

export function SettingsParsers() {
  const { t } = useLanguage();
  const { settings, updateSettings } = useSettings();

  const [overrides, setOverrides] = useState<ParserSettings['overrides']>(
    settings.parsers.overrides,
  );
  const [extInput, setExtInput] = useState('pdf');
  const [commandInput, setCommandInput] = useState('');
  const [modeInput, setModeInput] = useState<ExternalOutputMode>('stdout');
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(false);
  const [samplePath, setSamplePath] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 변경 시 폼 동기화
    setOverrides(settings.parsers.overrides);
  }, [settings.parsers.overrides]);

  const checkInstall = useCallback(async () => {
    setChecking(true);
    try {
      const exes = new Set<string>();
      for (const preset of EXTERNAL_PARSER_PRESETS) {
        const exe = splitCommand(preset.command)[0];
        if (exe) exes.add(exe);
      }
      for (const override of Object.values(overrides)) {
        const exe = splitCommand(override.command)[0];
        if (exe) exes.add(exe);
      }
      const next: Record<string, boolean> = {};
      await Promise.all(
        [...exes].map(async (exe) => {
          try {
            await invoke('find_executable', { name: exe });
            next[exe] = true;
          } catch {
            next[exe] = false;
          }
        }),
      );
      setInstalled(next);
    } finally {
      setChecking(false);
    }
  }, [overrides]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 진입 시 설치 여부 1회 확인
    void checkInstall();
  }, [checkInstall]);

  const persist = useCallback(async (next: ParserSettings['overrides']) => {
    setOverrides(next);
    await updateSettings({ parsers: { overrides: next } });
    setSaved(true);
  }, [updateSettings]);

  const addOverride = useCallback(() => {
    const ext = extInput.trim().toLowerCase().replace(/^\./, '');
    const command = commandInput.trim();
    if (!ext || !command) return;
    void persist({ ...overrides, [ext]: { command, outputMode: modeInput } });
    setCommandInput('');
  }, [extInput, commandInput, modeInput, overrides, persist]);

  const removeOverride = useCallback((ext: string) => {
    const next = { ...overrides };
    delete next[ext];
    void persist(next);
  }, [overrides, persist]);

  const applyPreset = useCallback((presetId: string) => {
    const preset = EXTERNAL_PARSER_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setCommandInput(preset.command);
    setModeInput(preset.outputMode);
  }, []);

  const runTest = useCallback(async () => {
    const path = samplePath.trim();
    if (!path || testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const parsed = await parseDocument(path, {
        parsers: { overrides },
        cwd: settings.workFolder ?? undefined,
      });
      setTestResult({
        method: parsed.method,
        chars: parsed.text.length,
        head: parsed.text.slice(0, 2000),
      });
    } catch (err) {
      setTestResult({
        method: err instanceof ParseError ? err.method : 'none',
        chars: 0,
        head: '',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  }, [samplePath, testing, overrides, settings.workFolder]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">{t('parsers.title')}</h2>
        <p className="text-xs text-muted-foreground mt-1">{t('parsers.desc')}</p>
      </div>

      {/* 확장자별 사용 파서 표 */}
      <div className="border border-border rounded-xl p-5 bg-card/40 space-y-3">
        <h3 className="text-sm font-semibold">{t('parsers.tableTitle')}</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-1.5 pr-2 font-medium">{t('parsers.tableExt')}</th>
              <th className="py-1.5 pr-2 font-medium">{t('parsers.tableParser')}</th>
              <th className="py-1.5 font-medium text-right">{t('parsers.tableStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {KNOWN_EXTS.map((ext) => {
              const override = overrides[ext];
              const exe = override ? splitCommand(override.command)[0] : null;
              const ok = exe ? installed[exe] : true;
              return (
                <tr key={ext} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 pr-2 font-mono">.{ext}</td>
                  <td className="py-1.5 pr-2 font-mono truncate max-w-[280px]" title={override?.command}>
                    {override ? override.command : `${t('parsers.builtin')}: ${BUILTIN_LABEL[ext]}`}
                  </td>
                  <td className="py-1.5 text-right">
                    {ok ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <Check className="h-3.5 w-3.5" />
                        {t('parsers.installed')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-warning" title={exe ?? undefined}>
                        <X className="h-3.5 w-3.5" />
                        {t('parsers.missing')}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 외부 파서 등록 */}
      <div className="border border-border rounded-xl p-5 bg-card/40 space-y-3">
        <h3 className="text-sm font-semibold">{t('parsers.addTitle')}</h3>
        <div className="flex flex-wrap gap-1.5">
          {EXTERNAL_PARSER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset.id)}
              title={preset.hint}
              className="px-2 py-1 text-[11px] rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[110px_1fr_130px_auto] gap-1.5">
          <input
            type="text"
            value={extInput}
            onChange={(e) => setExtInput(e.target.value)}
            placeholder={t('parsers.extPlaceholder')}
            aria-label={t('parsers.extLabel')}
            className="px-3 py-1.5 text-xs rounded-md border border-border bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            type="text"
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            placeholder={t('parsers.commandPlaceholder')}
            aria-label={t('parsers.commandLabel')}
            className="px-3 py-1.5 text-xs rounded-md border border-border bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <select
            value={modeInput}
            onChange={(e) => setModeInput(e.target.value as ExternalOutputMode)}
            aria-label={t('parsers.modeLabel')}
            className="px-2.5 py-1.5 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="stdout">{t('parsers.modeStdout')}</option>
            <option value="file">{t('parsers.modeFile')}</option>
          </select>
          <Button type="button" size="sm" variant="outline" onClick={addOverride}>
            <Plus className="h-3.5 w-3.5" />
            <span>{t('parsers.addButton')}</span>
          </Button>
        </div>
        {Object.keys(overrides).length > 0 && (
          <ul className="space-y-1">
            {Object.entries(overrides).map(([ext, override]) => (
              <li
                key={ext}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-border bg-background text-xs"
              >
                <span className="font-mono truncate" title={override.command}>
                  .{ext} → {override.command} ({override.outputMode})
                </span>
                <button
                  type="button"
                  onClick={() => removeOverride(ext)}
                  title={t('parsers.deleteTitle')}
                  aria-label={`${t('parsers.deleteTitle')}: .${ext}`}
                  className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {saved && <p className="text-[11px] text-success">{t('parsers.saved')}</p>}
      </div>

      {/* 설치 여부 + 테스트 */}
      <div className="border border-border rounded-xl p-5 bg-card/40 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <FlaskConical className="h-4 w-4 text-primary" />
            {t('parsers.testTitle')}
          </h3>
          <button
            type="button"
            onClick={() => void checkInstall()}
            disabled={checking}
            title={t('parsers.recheck')}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <FileText className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={samplePath}
              onChange={(e) => setSamplePath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runTest();
              }}
              placeholder={t('parsers.samplePlaceholder')}
              aria-label={t('parsers.sampleLabel')}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-border bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <Button type="button" size="sm" onClick={() => void runTest()} disabled={testing || !samplePath.trim()}>
            {testing ? t('parsers.testing') : t('parsers.runTest')}
          </Button>
        </div>
        {testResult && (
          <div className="rounded-lg border border-border bg-background p-3 text-xs space-y-1.5">
            {testResult.error ? (
              <p className="text-destructive">{testResult.error}</p>
            ) : (
              <>
                <p className="font-mono text-muted-foreground">
                  {t('parsers.testMethod', { method: testResult.method, n: testResult.chars })}
                </p>
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed max-h-64 overflow-y-auto">
                  {testResult.head}
                </pre>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SettingsParsers;
