// P11-24: 파일 커맨더 도구 공용 유틸.
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { FcSearchMatch } from '@/lib/commander/types';

/** 로컬 소형 모델의 파라미터 별칭 흡수 (wiki.ts preprocess 패턴). */
export function pickAlias(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k];
  }
  return undefined;
}

export function strArg(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  const v = pickAlias(obj, ...keys);
  if (typeof v === 'string') return v;
  if (v !== undefined && v !== null) return String(v);
  return undefined;
}

export function strArrayArg(obj: Record<string, unknown>, ...keys: string[]): string[] | undefined {
  const v = pickAlias(obj, ...keys);
  if (v === undefined) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .map((x) => (typeof x === 'string' ? x : String(x ?? '')))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface AwaitedJob {
  ok: boolean;
  result?: unknown;
  matches?: FcSearchMatch[];
  error?: string;
}

/** fc://progress 이벤트를 기다려 job 완료를 동기 호출처럼 만든다. */
export function awaitJobCompletion(jobId: string, timeoutMs = 10 * 60 * 1000): Promise<AwaitedJob> {
  return new Promise<AwaitedJob>((resolve) => {
    let unlisten: (() => void) | undefined;
    const done = (value: AwaitedJob) => {
      clearTimeout(timer);
      if (unlisten) unlisten();
      resolve(value);
    };
    const timer = setTimeout(() => {
      if (unlisten) unlisten();
      resolve({ ok: false, error: `job timed out: ${jobId}` });
    }, timeoutMs);
    const matches: FcSearchMatch[] = [];
    void listen('fc://progress', (event) => {
      const e = event.payload as
        | { kind: string; job_id: string; result?: unknown; message?: string; m?: FcSearchMatch };
      if (!e || e.job_id !== jobId) return;
      if (e.kind === 'match' && e.m) {
        matches.push(e.m);
        return;
      }
      if (e.kind === 'done') {
        done({ ok: true, result: e.result, matches });
      } else if (e.kind === 'error') {
        done({ ok: false, error: e.message ?? 'job failed', matches });
      } else if (e.kind === 'cancelled') {
        done({ ok: false, error: 'job cancelled', matches });
      } else if (e.kind === 'conflict') {
        done({ ok: false, error: 'conflict needs a user decision (use rename/skip/overwrite)', matches });
      }
    }).then((fn) => {
      unlisten = fn;
    });
  });
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function baseNameOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${sep}${name}`;
}

/**
 * 파괴적 실행 직전 스냅샷 (D10). `<workFolder>/backup/YYYY-MM-DD/<경로 해시>/`에 복사한다.
 * workFolder가 없으면 빈 배열을 반환한다 (백업 생략 + 결과에 고지).
 */
export async function snapshotForBackup(targets: string[], workFolder: string | undefined): Promise<string[]> {
  if (!workFolder || targets.length === 0) return [];
  const day = new Date().toISOString().slice(0, 10);
  const backed: string[] = [];
  for (const target of targets) {
    const destDir = joinPath(joinPath(joinPath(workFolder, 'backup'), day), fnv1a(target));
    try {
      await invoke('fc_mkdir', { path: destDir });
      const jobId = await invoke<string>('fc_copy', {
        sources: [target],
        destDir,
        conflict: 'rename',
      });
      const done = await awaitJobCompletion(jobId);
      if (done.ok) {
        backed.push(joinPath(destDir, baseNameOf(target)));
      }
    } catch {
      // 개별 백업 실패는 전체 작업을 막지 않는다. 결과에 고지한다.
    }
  }
  return backed;
}
