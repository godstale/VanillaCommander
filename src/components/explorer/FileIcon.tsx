import {
  AppWindow,
  Archive,
  File as FileIcon,
  FileCode,
  FileImage,
  FileMusic,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  Link2,
  Presentation,
} from 'lucide-react';
import { IMAGE_EXTS, TEXT_EXTS, extOf } from '@/lib/commander/openFile';
import { cn } from '@/lib/utils';

export interface FileKindIconProps {
  name: string;
  kind: 'file' | 'dir' | 'symlink' | 'other';
  symlink?: boolean;
  className?: string;
}

const CODE_EXTS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java',
  'c', 'h', 'cpp', 'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'css',
  'scss', 'sql', 'sh', 'ps1', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml',
]);

const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma']);
const VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv']);
const ARCHIVE_EXTS = new Set(['zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz']);
const EXEC_EXTS = new Set(['exe', 'msi', 'dmg', 'app', 'com', 'scr']);

// 바닐라 커맨더가 뷰어로 보여줄 수 있는 파일은 일반 문서 아이콘과
// 구분되는 전용 컬러 아이콘으로 표시한다 (P11-14 openFile 라우팅 기준).
export function FileKindIcon({ name, kind, symlink, className }: FileKindIconProps) {
  const cls = cn('h-4 w-4 shrink-0', className);
  if (symlink) return <Link2 className={cn(cls, 'text-muted-foreground')} />;
  if (kind === 'dir') return <Folder className={cn(cls, 'text-warning')} />;
  const ext = extOf(name);
  if (IMAGE_EXTS.has(ext)) return <FileImage className={cn(cls, 'text-sky-400')} />;
  if (ext === 'pdf') return <FileText className={cn(cls, 'text-red-400')} />;
  if (ext === 'doc' || ext === 'docx') return <FileText className={cn(cls, 'text-blue-400')} />;
  if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') {
    return <FileSpreadsheet className={cn(cls, 'text-green-500')} />;
  }
  if (ext === 'ppt' || ext === 'pptx') return <Presentation className={cn(cls, 'text-orange-400')} />;
  if (ARCHIVE_EXTS.has(ext)) return <Archive className={cn(cls, 'text-violet-400')} />;
  if (AUDIO_EXTS.has(ext)) return <FileMusic className={cn(cls, 'text-pink-400')} />;
  if (VIDEO_EXTS.has(ext)) return <Film className={cn(cls, 'text-rose-400')} />;
  if (EXEC_EXTS.has(ext)) return <AppWindow className={cn(cls, 'text-slate-400')} />;
  if (CODE_EXTS.has(ext)) return <FileCode className={cn(cls, 'text-emerald-400')} />;
  if (TEXT_EXTS.has(ext)) return <FileText className={cn(cls, 'text-zinc-400')} />;
  if (ext === 'html' || ext === 'htm') return <FileCode className={cn(cls, 'text-amber-400')} />;
  return <FileIcon className={cn(cls, 'text-muted-foreground')} />;
}

export default FileKindIcon;
