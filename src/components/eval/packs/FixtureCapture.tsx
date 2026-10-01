import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import {
  buildFixtureWhitelist,
  FIXTURE_MAX_BYTES,
  type FixtureCandidate,
} from '@/lib/eval/personal/caseBuilder';

export interface CapturedFixture {
  path: string;
  content: string;
}

interface FixtureCaptureProps {
  sampleId: string;
  onChange?: (fixtures: CapturedFixture[]) => void;
}

interface RowState extends FixtureCandidate {
  status: 'pending' | 'kept' | string;
  content?: string;
}

export function FixtureCapture({ sampleId, onChange }: FixtureCaptureProps) {
  const { t } = useLanguage();
  const workspace = useSafeWorkspace();
  const workspaceRoot = workspace?.workspaceRoot ?? undefined;
  const [pathInput, setPathInput] = useState('');
  const [rows, setRows] = useState<RowState[]>([]);
  const [loading, setLoading] = useState(false);

  const { kept, dropped } = useMemo(
    () => buildFixtureWhitelist(rows.map((r) => ({ path: r.path, size: r.size }))),
    [rows],
  );
  const keptPaths = useMemo(() => new Set(kept.map((k) => k.path)), [kept]);

  function addPath(): void {
    const p = pathInput.trim();
    if (!p) return;
    setRows((prev) => (prev.some((r) => r.path === p) ? prev : [...prev, { path: p, status: 'pending' }]));
    setPathInput('');
  }

  async function capture(): Promise<void> {
    setLoading(true);
    try {
      const next: RowState[] = [];
      for (const row of rows) {
        if (!keptPaths.has(row.path)) {
          next.push(row);
          continue;
        }
        try {
          const content = await invoke<string>('read_text_file', {
            path: row.path,
            workspaceRoot: workspaceRoot ?? null,
          });
          if (content.length > FIXTURE_MAX_BYTES) {
            next.push({ ...row, status: 'over-1mb' });
            continue;
          }
          next.push({ ...row, size: content.length, status: 'kept', content });
        } catch (err) {
          next.push({ ...row, status: err instanceof Error ? err.message : 'read failed' });
        }
      }
      setRows(next);
      onChange?.(
        next
          .filter((r) => r.status === 'kept' && typeof r.content === 'string')
          .map((r) => ({ path: `fixtures/${sampleId}/${r.path.split('/').pop() ?? 'file'}`, content: r.content as string })),
      );
    } finally {
      setLoading(false);
    }
  }

  function removeRow(path: string): void {
    setRows((prev) => prev.filter((r) => r.path !== path));
  }

  return (
    <div className="space-y-2 text-xs">
      <div className="font-medium">{t('eval.personal.fixtureTitle')}</div>
      <p className="text-muted-foreground">{t('eval.personal.fixtureCap')}</p>
      <div className="flex gap-2">
        <Input
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          placeholder={t('eval.personal.fixturePathPlaceholder')}
          className="h-8 font-mono text-xs"
          onKeyDown={(e) => { if (e.key === 'Enter') addPath(); }}
        />
        <Button size="sm" variant="outline" onClick={addPath}>
          {t('eval.personal.fixtureAdd')}
        </Button>
      </div>
      {rows.length > 0 && (
        <ul className="space-y-1">
          {rows.map((r) => {
            const drop = dropped.find((d) => d.path === r.path);
            return (
              <li key={r.path} className="flex items-center gap-2 rounded-md border border-border px-2 py-1">
                <span className="truncate font-mono text-[11px]">{r.path}</span>
                {typeof r.size === 'number' && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {(r.size / 1024).toFixed(1)}KB
                  </span>
                )}
                {drop ? (
                  <span className="text-warning">
                    {t('eval.personal.fixtureDropped', { reason: drop.reason })}
                  </span>
                ) : (
                  <span className="text-success">✓</span>
                )}
                {typeof r.status === 'string' && r.status !== 'pending' && r.status !== 'kept' && (
                  <span className="text-destructive">{r.status}</span>
                )}
                <button
                  type="button"
                  onClick={() => removeRow(r.path)}
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  aria-label={r.path}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > 0 && (
        <Button size="sm" variant="outline" onClick={() => void capture()} disabled={loading}>
          {t('eval.personal.fixtureTitle')}
        </Button>
      )}
    </div>
  );
}

export default FixtureCapture;
