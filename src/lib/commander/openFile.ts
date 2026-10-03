// P11-14: 확장자 → 열기 방식 라우팅 (P11-33 문서 파서와 공유).
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import type { FcEntry } from './types';

export const LARGE_TEXT_BYTES = 5 * 1024 * 1024;

export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico']);

export const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonl', 'tsv', 'log',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java',
  'c', 'h', 'cpp', 'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'toml',
  'yaml', 'yml', 'xml', 'css', 'scss', 'sql', 'sh',
  'ps1', 'bat', 'cmd', 'ini', 'cfg', 'conf', 'env', 'gitignore',
]);

export type DocKind = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'csv';

export type OpenPlan =
  | { action: 'editor'; path: string; readOnlyHead: boolean }
  | { action: 'image'; path: string }
  | { action: 'document'; path: string; docKind: DocKind }
  | { action: 'archive'; path: string }
  | { action: 'external'; path: string };

export function extOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
}

/** 이미지 앨범에 나오는 항목 (폴더 + 이미지). 목록/앨범 키보드 이동 기준을 통일한다. */
export function isAlbumEntry(entry: FcEntry): boolean {
  return entry.kind === 'dir' || IMAGE_EXTS.has(extOf(entry.name));
}

export function planOpenFile(path: string, size = 0): OpenPlan {
  const name = path.split(/[\\/]/).pop() ?? path;
  const ext = extOf(name);
  if (IMAGE_EXTS.has(ext)) return { action: 'image', path };
  if (ext === 'pdf') return { action: 'document', path, docKind: 'pdf' };
  if (ext === 'docx') return { action: 'document', path, docKind: 'docx' };
  if (ext === 'xlsx' || ext === 'xls') return { action: 'document', path, docKind: 'xlsx' };
  if (ext === 'csv') return { action: 'document', path, docKind: 'csv' };
  if (ext === 'pptx') return { action: 'document', path, docKind: 'pptx' };
  if (ext === 'zip') return { action: 'archive', path };
  if (TEXT_EXTS.has(ext)) {
    return { action: 'editor', path, readOnlyHead: size > LARGE_TEXT_BYTES };
  }
  // HTML·동영상·음악·실행 파일·기타 → 시스템 기본 앱.
  return { action: 'external', path };
}

export function buildFileTab(plan: OpenPlan): Omit<WorkspaceTab, 'id'> & { id: string } {
  const name = plan.path.split(/[\\/]/).pop() ?? plan.path;
  switch (plan.action) {
    case 'editor':
      return {
        id: `editor:${plan.path}`,
        type: 'editor',
        title: name,
        meta: { filePath: plan.path, ...(plan.readOnlyHead ? { readOnlyHead: true } : {}) },
      };
    case 'image':
      return {
        id: `image-viewer:${plan.path}`,
        type: 'image-viewer',
        title: name,
        meta: { filePath: plan.path },
      };
    case 'document':
      return {
        id: `document:${plan.path}`,
        type: 'document-viewer',
        title: name,
        meta: { filePath: plan.path, docKind: plan.docKind },
      };
    case 'archive':
      return {
        id: `archive:${plan.path}`,
        type: 'archive-viewer',
        title: name,
        meta: { filePath: plan.path },
      };
    case 'external':
      throw new Error('external files are opened with the default app, not a tab');
  }
}
