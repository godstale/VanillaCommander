import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import { useEval } from '@/lib/context/EvalContext';
import { tauriPackFs } from '@/lib/eval/packs/packFs';
import { ImportDialog } from '@/components/eval/interop/ImportDialog';
import { loadPack, type LoadedPackRef, type PackListError } from '@/lib/eval/packs/packLoader';
import type { PackDiagnostic, PackScope } from '@/lib/eval/types';

interface PackManagerProps {
  onEdit?: (scope: PackScope, packId: string) => void;
  onCreate?: () => void;
}

const SCOPE_ORDER: PackScope[] = ['builtin', 'user', 'project'];

function groupTitle(scope: PackScope, t: (k: string) => string): string {
  if (scope === 'builtin') return t('eval.packs.groupBuiltin');
  if (scope === 'user') return t('eval.packs.groupUser');
  return t('eval.packs.groupProject');
}

export function PackManager({ onEdit, onCreate }: PackManagerProps) {
  const { t } = useLanguage();
  const workspace = useSafeWorkspace();
  const workspaceRoot = workspace?.workspaceRoot ?? undefined;
  const { packs, packErrors, packsLoading, refreshPacks } = useEval();
  const [query, setQuery] = useState('');
  const [errors, setErrors] = useState<PackListError[]>([]);
  const [diagnostics, setDiagnostics] = useState<Record<string, PackDiagnostic[]>>({});
  const [validating, setValidating] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return packs;
    return packs.filter(
      (p) =>
        p.manifest.id.toLowerCase().includes(q) ||
        p.manifest.title.ko.toLowerCase().includes(q) ||
        p.manifest.title.en.toLowerCase().includes(q),
    );
  }, [packs, query]);

  async function validateAll(): Promise<void> {
    setValidating(true);
    try {
      const next: Record<string, PackDiagnostic[]> = {};
      const listErrors: PackListError[] = [];
      for (const ref of packs) {
        try {
          const loaded = await loadPack(tauriPackFs, ref, workspaceRoot);
          next[ref.manifest.id] = loaded.diagnostics;
        } catch (err) {
          listErrors.push({
            scope: ref.scope,
            packId: ref.manifest.id,
            error: err instanceof Error ? err.message : 'load failed',
          });
        }
      }
      setDiagnostics(next);
      setErrors(listErrors);
    } finally {
      setValidating(false);
    }
  }

  async function duplicateToEditable(ref: LoadedPackRef): Promise<void> {
    const base = ref.manifest.id;
    const targetId = `${base}-personal`;
    setBusy(`dup:${base}`);
    try {
      const manifestText = await tauriPackFs.read(ref.scope, base, 'manifest.json', workspaceRoot);
      const manifest = { ...JSON.parse(manifestText) as Record<string, unknown>, id: targetId };
      const files: Array<{ relPath: string; content: string }> = [
        { relPath: 'manifest.json', content: JSON.stringify(manifest, null, 2) },
      ];
      try {
        const samples = await tauriPackFs.read(ref.scope, base, 'samples.jsonl', workspaceRoot);
        files.push({ relPath: 'samples.jsonl', content: samples });
      } catch {
        files.push({ relPath: 'samples.jsonl', content: '' });
      }
      await tauriPackFs.write('user', targetId, files, workspaceRoot);
      await refreshPacks();
    } finally {
      setBusy(null);
    }
  }

  async function deletePack(scope: Exclude<PackScope, 'builtin'>, packId: string): Promise<void> {
    if (!window.confirm(t('eval.packs.deleteConfirm'))) return;
    setBusy(`del:${packId}`);
    try {
      await tauriPackFs.remove(scope, packId, workspaceRoot);
      await refreshPacks();
    } finally {
      setBusy(null);
    }
  }

  async function promoteToGlobal(ref: LoadedPackRef): Promise<void> {
    if (ref.scope !== 'project') return;
    const packId = ref.manifest.id;
    setBusy(`promote:${packId}`);
    try {
      const manifestText = await tauriPackFs.read('project', packId, 'manifest.json', workspaceRoot);
      const files: Array<{ relPath: string; content: string }> = [
        { relPath: 'manifest.json', content: manifestText },
      ];
      try {
        const samples = await tauriPackFs.read('project', packId, 'samples.jsonl', workspaceRoot);
        files.push({ relPath: 'samples.jsonl', content: samples });
      } catch {
        // jsonl missing (generator pack) — manifest copy is enough.
      }
      await tauriPackFs.write('user', packId, files, workspaceRoot);
      await refreshPacks();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{t('eval.packs.title')}</h2>
        <div className="flex-1" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('eval.packs.search')}
          className="h-8 max-w-56 text-xs"
        />
        <Button size="sm" variant="outline" onClick={() => void validateAll()} disabled={validating}>
          {validating ? t('eval.packs.validating') : t('eval.packs.validateAll')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
          {t('eval.interop.import.title')}
        </Button>
        {onCreate && (
          <Button size="sm" onClick={onCreate}>
            {t('eval.editor.newPack')}
          </Button>
        )}
      </div>

      {packErrors.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs space-y-1">
          <div className="font-semibold">{t('eval.wizard.packs.loadError', { err: '' })}</div>
          {packErrors.map((e) => (
            <div key={`ctx-${e.scope}/${e.packId}`} className="font-mono text-[11px]">
              {e.scope}/{e.packId}: {e.error}
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => void refreshPacks()}>
            {t('eval.wizard.packs.retry')}
          </Button>
        </div>
      )}
      {packsLoading && (
        <p className="text-xs text-muted-foreground">{t('eval.wizard.packs.loading')}</p>
      )}

      {errors.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs space-y-1">
          <div className="font-semibold">{t('eval.packs.errors')}</div>
          {errors.map((e) => (
            <div key={`${e.scope}/${e.packId}`} className="font-mono text-[11px]">
              {e.scope}/{e.packId}: {e.error}
            </div>
          ))}
        </div>
      )}

      {SCOPE_ORDER.map((scope) => {
        const group = filtered.filter((p) => p.scope === scope);
        return (
          <section key={scope} className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">{groupTitle(scope, t)}</h3>
            {group.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('eval.packs.empty')}</p>
            )}
            {group.map((ref) => {
              const diag = diagnostics[ref.manifest.id] ?? ref.diagnostics;
              return (
                <div
                  key={ref.manifest.id}
                  className="rounded-lg border border-border p-3 space-y-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{ref.manifest.id}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">
                      {t(`eval.packs.scope.${scope}`)}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">
                      {t('eval.packs.license')}: {ref.manifest.license.id}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">
                      {ref.manifest.trusted ? t('eval.packs.trusted') : t('eval.packs.untrusted')}
                    </span>
                    <div className="flex-1" />
                    {scope !== 'builtin' ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onEdit?.(scope, ref.manifest.id)}
                        >
                          {t('eval.packs.edit')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={busy === `del:${ref.manifest.id}`}
                          onClick={() => void deletePack(scope, ref.manifest.id)}
                        >
                          {t('eval.packs.delete')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === `dup:${ref.manifest.id}`}
                        onClick={() => void duplicateToEditable(ref)}
                      >
                        {t('eval.packs.duplicate')}
                      </Button>
                    )}
                    {scope === 'project' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === `promote:${ref.manifest.id}`}
                        onClick={() => void promoteToGlobal(ref)}
                      >
                        {t('eval.packs.promote')}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {ref.manifest.title.ko} · v{ref.manifest.version} · {ref.manifest.category}
                  </p>
                  <div className="text-[11px]">
                    {diag.length === 0 ? (
                      <span className="text-muted-foreground">{t('eval.packs.noErrors')}</span>
                    ) : (
                      <ul className="space-y-0.5 font-mono text-[11px] text-warning">
                        {diag.map((d, i) => (
                          <li key={i}>
                            {d.sampleId ? `${d.sampleId}: ` : ''}{d.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onSaved={() => void refreshPacks()}
      />
    </div>
  );
}

export default PackManager;
