import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import { tauriPackFs } from '@/lib/eval/packs/packFs';
import type { LoadedPackRef } from '@/lib/eval/packs/packLoader';
import { getEntries } from '@/lib/db/repositories/entriesRepo';
import type { Entry } from '@/lib/types/chat';
import {
  SAVE_EVAL_CASE_EVENT,
  createPersonalManifest,
  draftSampleId,
  maskSecrets,
  messageToSample,
  samplesToJsonl,
  type SaveCaseMode,
  type SaveEvalCaseDetail,
} from '@/lib/eval/personal/caseBuilder';
import { EvalSampleSchema } from '@/lib/eval/types';

interface SaveCaseDialogProps {
  projectPacks: LoadedPackRef[];
  onSaved?: (packId: string, sampleId: string) => void;
}

function entryMessages(entries: Entry[]): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  for (const e of entries) {
    if (e.type !== 'message') continue;
    const m = e.message;
    if (m.role === 'user' || m.role === 'assistant' || m.role === 'system') {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

export function SaveCaseDialog({ projectPacks, onSaved }: SaveCaseDialogProps) {
  const { t } = useLanguage();
  const workspace = useSafeWorkspace();
  const workspaceRoot = workspace?.workspaceRoot ?? undefined;
  const [detail, setDetail] = useState<SaveEvalCaseDetail | null>(null);
  const [contextText, setContextText] = useState('');
  const [mode, setMode] = useState<SaveCaseMode>('reference');
  const [keywords, setKeywords] = useState('');
  const [rubric, setRubric] = useState('');
  const [targetPackId, setTargetPackId] = useState('');
  const [newPackName, setNewPackName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function onEvent(ev: Event): Promise<void> {
      const d = (ev as CustomEvent<SaveEvalCaseDetail>).detail;
      if (!d) return;
      setError(null);
      setDetail(d);
      if (d.sessionId) {
        try {
          const entries = await getEntries(d.sessionId);
          const msgs = entryMessages(entries);
          const preview = msgs
            .slice(-6)
            .map((m) => `${m.role}: ${m.content.slice(0, 500)}`)
            .join('\n\n');
          setContextText(preview);
        } catch {
          setContextText(d.content);
        }
      } else {
        setContextText(d.content);
      }
    }
    window.addEventListener(SAVE_EVAL_CASE_EVENT, onEvent);
    return () => window.removeEventListener(SAVE_EVAL_CASE_EVENT, onEvent);
  }, []);

  const masked = useMemo(() => maskSecrets(contextText), [contextText]);
  const keywordList = useMemo(
    () => keywords.split(',').map((k) => k.trim()).filter((k) => k.length > 0),
    [keywords],
  );

  function close(): void {
    setDetail(null);
    setError(null);
    setTargetPackId('');
    setNewPackName('');
  }

  async function handleSave(): Promise<void> {
    setError(null);
    const packId = newPackName.trim().length > 0 ? newPackName.trim() : targetPackId;
    if (!packId) {
      setError(t('eval.personal.targetPack'));
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(packId)) {
      setError(packId);
      return;
    }
    if (mode === 'rules' && keywordList.length === 0) {
      setError(t('eval.personal.keywords'));
      return;
    }
    if (mode === 'rubric' && rubric.trim().length === 0) {
      setError(t('eval.personal.rubric'));
      return;
    }
    setSaving(true);
    try {
      const isNew = newPackName.trim().length > 0 || !projectPacks.some((p) => p.manifest.id === packId);
      // Derive Q/A from masked context: first user block = input, last assistant block = answer.
      const userMatch = /(?:^|\n)user:\s*([\s\S]*?)(?=\n(?:user|assistant|system):|$)/i.exec(masked.text);
      const assistantBlocks = [...masked.text.matchAll(/(?:^|\n)assistant:\s*([\s\S]*?)(?=\n(?:user|assistant|system):|$)/gi)];
      const input = (userMatch?.[1] ?? masked.text).trim().slice(0, 4000);
      const answer = (assistantBlocks[assistantBlocks.length - 1]?.[1] ?? '').trim().slice(0, 8000);
      if (input.length === 0) throw new Error('empty input');
      const sample = messageToSample({
        id: draftSampleId(input, Date.now() % 100000),
        messages: [
          { role: 'user', content: input },
          ...(answer ? [{ role: 'assistant' as const, content: answer }] : []),
        ],
        mode,
        keywords: keywordList,
        rubric: rubric.trim(),
      });
      const check = EvalSampleSchema.safeParse(sample);
      if (!check.success) throw new Error(check.error.issues[0]?.message ?? 'invalid sample');

      if (isNew) {
        const manifest = createPersonalManifest({
          id: packId,
          titleKo: packId,
          titleEn: packId,
        });
        await tauriPackFs.write('project', packId, [
          { relPath: 'manifest.json', content: JSON.stringify(manifest, null, 2) },
          { relPath: 'samples.jsonl', content: samplesToJsonl([sample]) },
        ], workspaceRoot);
      } else {
        let existing = '';
        try {
          existing = await tauriPackFs.read('project', packId, 'samples.jsonl', workspaceRoot);
        } catch {
          existing = '';
        }
        const next = existing.endsWith('\n') || existing.length === 0
          ? `${existing}${JSON.stringify(sample)}\n`
          : `${existing}\n${JSON.stringify(sample)}\n`;
        await tauriPackFs.write('project', packId, [
          { relPath: 'samples.jsonl', content: next },
        ], workspaceRoot);
      }
      onSaved?.(packId, sample.id);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={detail !== null} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">{t('eval.personal.saveTitle')}</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {t('eval.personal.secretNotice')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <div>
            <div className="mb-1 text-muted-foreground">{t('eval.personal.preview')}</div>
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px]">
              {masked.text.slice(0, 3000)}
            </pre>
            {masked.redacted && (
              <p className="mt-1 text-warning">{t('eval.personal.secretNotice')}</p>
            )}
            {masked.text.trim().length > 0 && answerMissing(masked.text) && (
              <p className="mt-1 text-muted-foreground">{t('eval.personal.noAnswer')}</p>
            )}
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">{t('eval.personal.mode')}</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as SaveCaseMode)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="reference">{t('eval.personal.mode.reference')}</option>
              <option value="rules">{t('eval.personal.mode.rules')}</option>
              <option value="rubric">{t('eval.personal.mode.rubric')}</option>
            </select>
          </label>
          {mode === 'rules' && (
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">{t('eval.personal.keywords')}</span>
              <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} className="h-8 text-xs" />
            </label>
          )}
          {mode === 'rubric' && (
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">{t('eval.personal.rubric')}</span>
              <textarea
                value={rubric}
                onChange={(e) => setRubric(e.target.value)}
                rows={3}
                className="rounded-md border border-input bg-background p-2 text-xs"
              />
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">{t('eval.personal.targetPack')}</span>
              <select
                value={targetPackId}
                onChange={(e) => setTargetPackId(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="">—</option>
                {projectPacks.map((p) => (
                  <option key={p.manifest.id} value={p.manifest.id}>{p.manifest.id}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">{t('eval.personal.newPack')}</span>
              <Input
                value={newPackName}
                onChange={(e) => setNewPackName(e.target.value)}
                placeholder={t('eval.personal.newPackPlaceholder')}
                className="h-8 font-mono text-xs"
              />
            </label>
          </div>
          <p className="text-muted-foreground">{t('eval.personal.dataClass')}</p>
          {error && <p className="text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={close}>
            {t('eval.personal.cancel')}
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
            {t('eval.personal.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function answerMissing(maskedText: string): boolean {
  return !/(?:^|\n)assistant:/i.test(maskedText);
}

export default SaveCaseDialog;
