import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import { tauriPackFs } from '@/lib/eval/packs/packFs';
import type { LoadedPackRef } from '@/lib/eval/packs/packLoader';
import { listSessions } from '@/lib/db/repositories/sessionsRepo';
import { getEntries } from '@/lib/db/repositories/entriesRepo';
import type { ChatSession, Entry } from '@/lib/types/chat';
import {
  createPersonalManifest,
  draftSampleId,
  maskSecrets,
  messageToSample,
  samplesToJsonl,
  type SaveCaseMode,
} from '@/lib/eval/personal/caseBuilder';
import { EvalSampleSchema } from '@/lib/eval/types';

interface BulkDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPacks: LoadedPackRef[];
  onSaved?: (packId: string, count: number) => void;
}

interface Draft {
  key: string;
  sessionId: string;
  sessionTitle: string;
  input: string;
  answer: string;
  include: boolean;
  mode: SaveCaseMode;
  keywords: string;
  rubric: string;
}

function draftsFromEntries(session: ChatSession, entries: Entry[]): Draft[] {
  const drafts: Draft[] = [];
  let pendingUser: string | null = null;
  let pairIndex = 0;
  for (const e of entries) {
    if (e.type !== 'message') continue;
    const m = e.message;
    if (m.role === 'user' && m.content.trim().length > 0) {
      pendingUser = m.content;
    } else if (m.role === 'assistant' && pendingUser) {
      const masked = maskSecrets(pendingUser);
      const maskedAnswer = maskSecrets(m.content);
      drafts.push({
        key: `${session.id}:${pairIndex}`,
        sessionId: session.id,
        sessionTitle: session.title,
        input: masked.text.slice(0, 4000),
        answer: maskedAnswer.text.slice(0, 8000),
        include: true,
        mode: 'reference',
        keywords: '',
        rubric: '',
      });
      pairIndex += 1;
      pendingUser = null;
    }
  }
  return drafts;
}

export function BulkDraftDialog({ open, onOpenChange, projectPacks, onSaved }: BulkDraftDialogProps) {
  const { t } = useLanguage();
  const workspace = useSafeWorkspace();
  const workspaceRoot = workspace?.workspaceRoot ?? undefined;
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(false);
  const [targetPackId, setTargetPackId] = useState('');
  const [newPackName, setNewPackName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      const list = await listSessions().catch(() => [] as ChatSession[]);
      if (!alive) return;
      setSessions(list.slice(0, 20));
      setError(null);
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  function toggleSession(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function loadDrafts(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const out: Draft[] = [];
      for (const id of selected) {
        const session = sessions.find((s) => s.id === id);
        if (!session) continue;
        const entries = await getEntries(id).catch(() => [] as Entry[]);
        out.push(...draftsFromEntries(session, entries));
      }
      setDrafts(out);
    } finally {
      setLoading(false);
    }
  }

  function updateDraft(key: string, patch: Partial<Draft>): void {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  async function handleConfirm(): Promise<void> {
    setError(null);
    const packId = newPackName.trim().length > 0 ? newPackName.trim() : targetPackId;
    if (!packId || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(packId)) {
      setError(t('eval.personal.targetPack'));
      return;
    }
    const included = drafts.filter((d) => d.include);
    if (included.length === 0) {
      setError(t('eval.personal.bulkEmpty'));
      return;
    }
    setSaving(true);
    try {
      const samples = included.map((d, i) => {
        const sample = messageToSample({
          id: draftSampleId(d.input, i),
          messages: [
            { role: 'user', content: d.input },
            ...(d.answer ? [{ role: 'assistant' as const, content: d.answer }] : []),
          ],
          mode: d.mode,
          keywords: d.keywords.split(',').map((k) => k.trim()).filter((k) => k.length > 0),
          rubric: d.rubric,
        });
        const check = EvalSampleSchema.safeParse(sample);
        if (!check.success) throw new Error(check.error.issues[0]?.message ?? 'invalid sample');
        return sample;
      });
      const isNew = newPackName.trim().length > 0 || !projectPacks.some((p) => p.manifest.id === packId);
      if (isNew) {
        const manifest = createPersonalManifest({ id: packId, titleKo: packId, titleEn: packId });
        await tauriPackFs.write('project', packId, [
          { relPath: 'manifest.json', content: JSON.stringify(manifest, null, 2) },
          { relPath: 'samples.jsonl', content: samplesToJsonl(samples) },
        ], workspaceRoot);
      } else {
        let existing = '';
        try {
          existing = await tauriPackFs.read('project', packId, 'samples.jsonl', workspaceRoot);
        } catch {
          existing = '';
        }
        const lines = samples.map((s) => JSON.stringify(s)).join('\n');
        const next = existing.length === 0 || existing.endsWith('\n') ? `${existing}${lines}\n` : `${existing}\n${lines}\n`;
        await tauriPackFs.write('project', packId, [
          { relPath: 'samples.jsonl', content: next },
        ], workspaceRoot);
      }
      onSaved?.(packId, samples.length);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">{t('eval.personal.bulkTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <div>
            <div className="mb-1 text-muted-foreground">{t('eval.personal.bulkSessions')}</div>
            <ul className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {sessions.map((s) => (
                <li key={s.id}>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggleSession(s.id)}
                    />
                    <span className="truncate">{s.title}</span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {s.updatedAt.slice(0, 10)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => void loadDrafts()} disabled={loading || selected.size === 0}>
              {t('eval.personal.bulkDrafts')}
            </Button>
          </div>
          <div>
            <div className="mb-1 text-muted-foreground">
              {t('eval.personal.bulkDrafts')} ({drafts.filter((d) => d.include).length}/{drafts.length})
            </div>
            {drafts.length === 0 ? (
              <p className="text-muted-foreground">{t('eval.personal.bulkEmpty')}</p>
            ) : (
              <ul className="max-h-56 space-y-2 overflow-y-auto">
                {drafts.map((d) => (
                  <li key={d.key} className="rounded-md border border-border p-2 space-y-1.5">
                    <label className="flex items-center gap-2 font-medium">
                      <input
                        type="checkbox"
                        checked={d.include}
                        onChange={(e) => updateDraft(d.key, { include: e.target.checked })}
                      />
                      <span className="truncate">{d.sessionTitle}</span>
                    </label>
                    <textarea
                      value={d.input}
                      onChange={(e) => updateDraft(d.key, { input: e.target.value })}
                      rows={2}
                      className="w-full rounded-md border border-input bg-background p-1.5 text-xs"
                    />
                    <div className="flex gap-2">
                      <select
                        value={d.mode}
                        onChange={(e) => updateDraft(d.key, { mode: e.target.value as SaveCaseMode })}
                        className="h-7 rounded-md border border-input bg-background px-1 text-xs"
                      >
                        <option value="reference">{t('eval.personal.mode.reference')}</option>
                        <option value="rules">{t('eval.personal.mode.rules')}</option>
                        <option value="rubric">{t('eval.personal.mode.rubric')}</option>
                      </select>
                      {d.mode === 'rules' && (
                        <Input
                          value={d.keywords}
                          onChange={(e) => updateDraft(d.key, { keywords: e.target.value })}
                          placeholder={t('eval.personal.keywords')}
                          className="h-7 text-xs"
                        />
                      )}
                      {d.mode === 'rubric' && (
                        <Input
                          value={d.rubric}
                          onChange={(e) => updateDraft(d.key, { rubric: e.target.value })}
                          placeholder={t('eval.personal.rubric')}
                          className="h-7 text-xs"
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
          <Button size="sm" onClick={() => void handleConfirm()} disabled={saving}>
            {t('eval.personal.bulkConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BulkDraftDialog;
