import { useEffect } from 'react';
import { useJobs } from '@/lib/commander/useJobs';
import { useStatusBar } from '@/lib/context/StatusBarContext';
import { useFileClipboard } from '@/lib/commander/clipboard';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { ConflictDialog } from './dialogs/ConflictDialog';

/** 대기 중인 첫 충돌을 다이얼로그로 표시한다. */
export function ConflictDialogHost() {
  const { conflicts, resolveConflict } = useJobs();
  const current = conflicts[0];
  if (!current) return null;
  const sameJob = conflicts.filter((c) => c.jobId === current.jobId).length;
  return (
    <ConflictDialog
      conflict={current}
      pendingCount={sameJob}
      onResolve={(decision, applyToAll) => {
        void resolveConflict(current.jobId, current.conflictId, decision, applyToAll).catch(() => {
          // 워커가 이미 끝났으면 무시한다.
        });
      }}
    />
  );
}

/** StatusBar 백그라운드 작업·클립보드 슬롯을 퍼블리시한다. */
export function CommanderStatusPublishers() {
  const { t } = useLanguage();
  const { jobs } = useJobs();
  const { publish, clear } = useStatusBar();
  const clipboard = useFileClipboard();

  const running = jobs.filter((j) => j.status === 'running');

  useEffect(() => {
    if (running.length === 0) {
      clear('jobs');
      return;
    }
    const latest = running[running.length - 1];
    const progress =
      latest.totalFiles !== null
        ? t('jobs.filesProgress', {
            done: String(latest.doneFiles),
            total: String(latest.totalFiles),
          })
        : `${latest.doneFiles}`;
    publish('jobs', {
      id: 'commander-jobs',
      content: (
        <>
          <span className="font-medium">{t('jobs.title')}</span>
          <span>
            {running.length > 1 ? `${running.length} · ` : ''}
            {latest.label} ({progress})
          </span>
        </>
      ),
      title: t('jobs.title'),
    });
    return () => clear('jobs', 'commander-jobs');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running.length, running.map((j) => `${j.id}:${j.doneFiles}`).join(','), t]);

  useEffect(() => {
    if (!clipboard || clipboard.paths.length === 0) {
      clear('clipboard');
      return;
    }
    publish('clipboard', {
      id: 'file-clipboard',
      content: (
        <span>
          {clipboard.mode === 'copy'
            ? t('clipboard.copyPending', { n: String(clipboard.paths.length) })
            : t('clipboard.cutPending', { n: String(clipboard.paths.length) })}
        </span>
      ),
    });
    return () => clear('clipboard', 'file-clipboard');
  }, [clipboard, publish, clear, t]);

  return null;
}
