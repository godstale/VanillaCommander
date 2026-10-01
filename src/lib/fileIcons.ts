import type { LucideIcon } from 'lucide-react';
import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileKey,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileVideo,
  Folder,
  FolderCode,
  FolderCog,
  FolderDot,
  FolderGit,
  FolderOpen,
} from 'lucide-react';

export interface FileIconSpec {
  Icon: LucideIcon;
  color: string;
}

const icon = (Icon: LucideIcon, color: string): FileIconSpec => ({ Icon, color });

// Vibrant, theme-friendly colors
const BLUE = '#38bdf8'; // sky-400
const YELLOW = '#facc15'; // yellow-400
const ORANGE = '#fb923c'; // orange-400
const RED = '#f87171'; // red-400
const GREEN = '#4ade80'; // green-400
const PURPLE = '#c084fc'; // purple-400
const PINK = '#f472b6'; // pink-400
const TEAL = '#2dd4bf'; // teal-400
const AMBER = '#fbbf24'; // amber-400
const GRAY = '#9ca3af'; // gray-400

/** Extension -> spec (no dot, lowercase). */
const EXT_ICONS: Record<string, FileIconSpec> = {
  // Documents / Markdown
  md: icon(FileText, BLUE),
  markdown: icon(FileText, BLUE),
  mdx: icon(FileText, BLUE),
  txt: icon(FileText, GRAY),
  log: icon(FileText, GRAY),
  pdf: icon(FileText, RED),
  doc: icon(FileText, BLUE),
  docx: icon(FileText, BLUE),
  rtf: icon(FileText, BLUE),

  // Data / Config
  json: icon(FileJson, YELLOW),
  jsonc: icon(FileJson, YELLOW),
  webmanifest: icon(FileJson, YELLOW),
  yaml: icon(FileCog, RED),
  yml: icon(FileCog, RED),
  toml: icon(FileCog, AMBER),
  ini: icon(FileCog, AMBER),
  cfg: icon(FileCog, AMBER),
  conf: icon(FileCog, AMBER),
  env: icon(FileCog, AMBER),

  // Source code
  js: icon(FileCode, YELLOW),
  mjs: icon(FileCode, YELLOW),
  cjs: icon(FileCode, YELLOW),
  jsx: icon(FileCode, YELLOW),
  ts: icon(FileCode, BLUE),
  tsx: icon(FileCode, BLUE),
  html: icon(FileCode, ORANGE),
  htm: icon(FileCode, ORANGE),
  css: icon(FileCode, BLUE),
  scss: icon(FileCode, PINK),
  sass: icon(FileCode, PINK),
  less: icon(FileCode, BLUE),
  py: icon(FileCode, GREEN),
  rs: icon(FileCode, ORANGE),
  c: icon(FileCode, BLUE),
  h: icon(FileCode, BLUE),
  cpp: icon(FileCode, BLUE),
  hpp: icon(FileCode, BLUE),
  java: icon(FileCode, ORANGE),
  go: icon(FileCode, TEAL),
  sh: icon(FileTerminal, GREEN),
  bash: icon(FileTerminal, GREEN),
  zsh: icon(FileTerminal, GREEN),
  bat: icon(FileTerminal, GRAY),
  cmd: icon(FileTerminal, GRAY),
  ps1: icon(FileTerminal, BLUE),
  sql: icon(FileCode, TEAL),

  // Images
  png: icon(FileImage, PURPLE),
  jpg: icon(FileImage, PURPLE),
  jpeg: icon(FileImage, PURPLE),
  gif: icon(FileImage, PURPLE),
  svg: icon(FileImage, PURPLE),
  webp: icon(FileImage, PURPLE),
  bmp: icon(FileImage, PURPLE),
  ico: icon(FileImage, PURPLE),
  avif: icon(FileImage, PURPLE),

  // Media
  mp4: icon(FileVideo, PINK),
  mov: icon(FileVideo, PINK),
  webm: icon(FileVideo, PINK),
  mkv: icon(FileVideo, PINK),
  avi: icon(FileVideo, PINK),
  mp3: icon(FileAudio, PINK),
  wav: icon(FileAudio, PINK),
  ogg: icon(FileAudio, PINK),
  flac: icon(FileAudio, PINK),

  // Data / Sheets
  xls: icon(FileSpreadsheet, GREEN),
  xlsx: icon(FileSpreadsheet, GREEN),
  csv: icon(FileSpreadsheet, GREEN),
  tsv: icon(FileSpreadsheet, GREEN),

  // Archives
  zip: icon(FileArchive, ORANGE),
  tar: icon(FileArchive, ORANGE),
  gz: icon(FileArchive, ORANGE),
  '7z': icon(FileArchive, ORANGE),
  rar: icon(FileArchive, ORANGE),

  // Fonts
  ttf: icon(FileType, TEAL),
  otf: icon(FileType, TEAL),
  woff: icon(FileType, TEAL),
  woff2: icon(FileType, TEAL),

  // Security / Secrets
  lock: icon(FileLock, GRAY),
  key: icon(FileKey, AMBER),
  pem: icon(FileKey, AMBER),
};

/** Exact filename -> spec (lowercase) */
const NAME_ICONS: Record<string, FileIconSpec> = {
  '.env': icon(FileCog, AMBER),
  '.gitignore': icon(FileCog, GRAY),
  '.gitattributes': icon(FileCog, GRAY),
  '.prettierrc': icon(FileJson, YELLOW),
  '.eslintrc': icon(FileJson, YELLOW),
  'package.json': icon(FileJson, YELLOW),
  'tsconfig.json': icon(FileJson, YELLOW),
  'tauri.conf.json': icon(FileCog, BLUE),
  'cargo.toml': icon(FileCog, ORANGE),
  dockerfile: icon(FileCog, BLUE),
  makefile: icon(FileCog, ORANGE),
  readme: icon(FileText, BLUE),
  'readme.md': icon(FileText, BLUE),
  license: icon(FileText, GRAY),
};

/** Exact folder name -> spec (lowercase) */
const FOLDER_ICONS: Record<string, FileIconSpec> = {
  node_modules: icon(FolderDot, GRAY),
  '.git': icon(FolderGit, GRAY),
  src: icon(FolderCode, BLUE),
  'src-tauri': icon(FolderCog, ORANGE),
  dist: icon(FolderCog, GRAY),
  target: icon(FolderCog, GRAY),
  build: icon(FolderCog, GRAY),
  components: icon(FolderCode, BLUE),
  lib: icon(FolderCode, TEAL),
  hooks: icon(FolderCode, TEAL),
  public: icon(Folder, AMBER),
  assets: icon(Folder, PURPLE),
};

const DEFAULT_FILE: FileIconSpec = icon(File, GRAY);
const DEFAULT_FOLDER: FileIconSpec = icon(Folder, '#fbbf24'); // warm folder amber
const DEFAULT_FOLDER_OPEN: FileIconSpec = icon(FolderOpen, '#fbbf24');

/**
 * Resolve the icon and color for a tree node.
 * @param name File or folder name
 * @param isDir Whether the item is a directory
 * @param expanded Whether the folder is expanded
 */
export function getFileIcon(name: string, isDir: boolean, expanded = false): FileIconSpec {
  const lower = name.toLowerCase();
  if (isDir) {
    const spec = FOLDER_ICONS[lower] ?? (expanded ? DEFAULT_FOLDER_OPEN : DEFAULT_FOLDER);
    return expanded ? { Icon: FolderOpen, color: spec.color } : spec;
  }
  const byName = NAME_ICONS[lower];
  if (byName) return byName;
  const dotIndex = lower.lastIndexOf('.');
  if (dotIndex === -1) return DEFAULT_FILE;
  return EXT_ICONS[lower.slice(dotIndex + 1)] ?? DEFAULT_FILE;
}
