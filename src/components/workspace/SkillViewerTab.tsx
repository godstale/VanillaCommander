import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { invoke } from '@tauri-apps/api/core';
import { Puzzle, Folder, FileCode, AlertCircle } from 'lucide-react';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import { parseFrontmatter } from '@/lib/skills/frontmatter';
import { useLanguage } from '@/lib/i18n/LanguageContext';

interface DirItem {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

export interface SkillViewerTabProps {
  tab: WorkspaceTab;
}

export function SkillViewerTab({ tab }: SkillViewerTabProps) {
  const filePath = (tab.meta?.filePath as string) || '';
  const baseDir = (tab.meta?.baseDir as string) || '';
  const skillName = (tab.meta?.name as string) || tab.title;

  const [body, setBody] = useState<string>('');
  const [frontmatter, setFrontmatter] = useState<Record<string, string | boolean>>({});
  const [folderFiles, setFolderFiles] = useState<DirItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLanguage();

  useEffect(() => {
    let cancelled = false;

    async function loadSkillData() {
      if (!filePath) return;
      setLoading(true);
      setError(null);

      try {
        const content = await invoke<string>('read_text_file', { path: filePath });
        if (cancelled) return;

        const parsed = parseFrontmatter(content);
        setBody(parsed.body);
        setFrontmatter(parsed.frontmatter);

        // Also list files in baseDir
        if (baseDir) {
          try {
            const entries = await invoke<DirItem[]>('list_dir', { path: baseDir });
            if (!cancelled) {
              setFolderFiles(entries);
            }
          } catch {
            // ignore folder listing error
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadSkillData();

    return () => {
      cancelled = true;
    };
  }, [filePath, baseDir]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full w-full text-xs text-muted-foreground">
        {t('skillViewer.loading')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full p-6 text-center text-destructive gap-2">
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm font-semibold">{t('skillViewer.failed')}</p>
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/40 text-xs shrink-0">
        <div className="flex items-center gap-2 font-medium min-w-0">
          <Puzzle className="h-4 w-4 text-tertiary shrink-0" />
          <span className="font-semibold text-foreground truncate">{skillName}</span>
          <span className="text-[11px] text-muted-foreground font-mono truncate">
            ({filePath})
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full space-y-6">
        {/* Frontmatter metadata summary */}
        {Object.keys(frontmatter).length > 0 && (
          <div className="p-3.5 rounded-lg bg-muted/30 border border-border/60 text-xs space-y-1.5 font-mono">
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">
              {t('skillViewer.meta')}
            </div>
            {Object.entries(frontmatter).map(([k, v]) => (
              <div key={k} className="flex items-start gap-2">
                <span className="text-muted-foreground shrink-0">{k}:</span>
                <span className="text-foreground font-medium break-all">
                  {typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Markdown instructions */}
        <div className="prose prose-sm dark:prose-invert max-w-none break-words">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </div>

        {/* Skill folder files / resources */}
        {folderFiles.length > 0 && (
          <div className="pt-4 border-t border-border">
            <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5 mb-2.5">
              <Folder className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{t('skillViewer.resources', { n: folderFiles.length })}</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {folderFiles.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center gap-2 p-2 rounded-md bg-muted/20 border border-border/40 text-xs font-mono text-muted-foreground"
                >
                  {file.is_dir ? (
                    <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
                  ) : (
                    <FileCode className="h-3.5 w-3.5 text-success shrink-0" />
                  )}
                  <span className="truncate">{file.name}</span>
                  {!file.is_dir && (
                    <span className="text-[10px] text-muted-foreground/60 ml-auto shrink-0">
                      {file.size} B
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
