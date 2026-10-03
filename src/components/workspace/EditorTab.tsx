import { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { basicSetup } from 'codemirror';
import { EditorView, keymap, type ViewUpdate } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import {
  syntaxHighlighting,
  HighlightStyle,
  LanguageDescription,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Check,
  Loader2,
  Columns2,
  Eye,
  Code2,
  ZoomIn,
  ZoomOut,
  AlertTriangle,
} from 'lucide-react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import { cn } from '@/lib/utils';
import { getFileIcon } from '@/lib/fileIcons';
import { CodeViewer } from '@/components/chat/CodeViewer';
import { useTheme } from '@/lib/context/ThemeContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface EditorTabProps {
  tab: WorkspaceTab;
}

/**
 * Rich syntax highlighting style tailored for dark theme and Markdown documents
 */
const darkHighlightStyle = HighlightStyle.define([
  // Markdown Headings
  { tag: t.heading1, color: '#FFB877', fontWeight: 'bold', fontSize: '1.25em' },
  { tag: t.heading2, color: '#F59A4A', fontWeight: 'bold', fontSize: '1.15em' },
  { tag: t.heading3, color: '#7FA6FF', fontWeight: 'bold', fontSize: '1.05em' },
  {
    tag: [t.heading4, t.heading5, t.heading6],
    color: '#F59A4A',
    fontWeight: 'bold',
  },

  // Markdown Formatting
  { tag: t.strong, fontWeight: 'bold', color: '#F5F5F5' },
  { tag: t.emphasis, fontStyle: 'italic', color: '#EDEDED' },
  { tag: t.link, color: '#FFB877', textDecoration: 'underline' },
  { tag: t.url, color: '#7FA6FF' },
  { tag: t.quote, color: '#A3A3A3', fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', opacity: '0.6' },

  // Code & Tokens
  {
    tag: t.monospace,
    color: '#F59A4A',
    backgroundColor: 'rgba(245, 154, 74, 0.10)',
  },
  { tag: t.keyword, color: '#F59A4A', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: '#5BC98A' },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: '#8F8F8F',
    fontStyle: 'italic',
  },
  { tag: [t.number, t.integer, t.float], color: '#E8B04A' },
  { tag: [t.bool, t.null], color: '#F0766C', fontWeight: '600' },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: '#FFB877',
  },
  { tag: [t.typeName, t.className], color: '#E8B04A', fontWeight: '500' },
  { tag: [t.propertyName, t.attributeName], color: '#A8C2FF' },
  { tag: [t.variableName, t.definition(t.variableName)], color: '#EDEDED' },
  { tag: t.operator, color: '#B5B5B5' },
  { tag: [t.meta, t.documentMeta], color: '#F59A4A' },
  { tag: t.tagName, color: '#F0766C', fontWeight: '500' },
]);

/**
 * Clean syntax highlighting style tailored for light theme
 */
const lightHighlightStyle = HighlightStyle.define([
  // Markdown Headings
  { tag: t.heading1, color: '#187444', fontWeight: 'bold', fontSize: '1.25em' },
  { tag: t.heading2, color: '#2459C9', fontWeight: 'bold', fontSize: '1.15em' },
  { tag: t.heading3, color: '#2459C9', fontWeight: 'bold', fontSize: '1.05em' },
  {
    tag: [t.heading4, t.heading5, t.heading6],
    color: '#C2570C',
    fontWeight: 'bold',
  },

  // Markdown Formatting
  { tag: t.strong, fontWeight: 'bold', color: '#111111' },
  { tag: t.emphasis, fontStyle: 'italic', color: '#222222' },
  { tag: t.link, color: '#187444', textDecoration: 'underline' },
  { tag: t.url, color: '#2459C9' },
  { tag: t.quote, color: '#595959', fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', opacity: '0.6' },

  // Code & Tokens
  {
    tag: t.monospace,
    color: '#C2570C',
    backgroundColor: 'rgba(194, 87, 12, 0.06)',
  },
  { tag: t.keyword, color: '#C2570C', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: '#0F7A3E' },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: '#6B6B6B',
    fontStyle: 'italic',
  },
  { tag: [t.number, t.integer, t.float], color: '#2459C9' },
  { tag: [t.bool, t.null], color: '#9A5B00', fontWeight: '600' },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: '#2459C9',
  },
  { tag: [t.typeName, t.className], color: '#9A5B00', fontWeight: '500' },
  { tag: [t.propertyName, t.attributeName], color: '#1B45A0' },
  { tag: [t.variableName, t.definition(t.variableName)], color: '#111111' },
  { tag: t.operator, color: '#2459C9' },
  { tag: [t.meta, t.documentMeta], color: '#C2570C' },
  { tag: t.tagName, color: '#C4372C', fontWeight: '500' },
]);

const EDITOR_FONT =
  "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/**
 * Modern Dark Editor Theme
 */
const darkEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: '#EDEDED',
    backgroundColor: 'hsl(var(--editor))',
    fontSize: 'var(--editor-font-size, 13px)',
  },
  '.cm-content': {
    caretColor: '#FFB877',
    fontFamily: EDITOR_FONT,
    lineHeight: '1.65',
    padding: '12px 4px',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#FFB877',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    {
      backgroundColor: 'rgba(245, 154, 74, 0.28) !important',
    },
  '.cm-panels': {
    backgroundColor: '#151515',
    color: '#EDEDED',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid #2A2A2A',
  },
  '.cm-panels.cm-panels-bottom': {
    borderTop: '1px solid #2A2A2A',
  },
  '.cm-gutters': {
    backgroundColor: 'hsl(var(--editor))',
    color: '#8F8F8F',
    borderRight: '1px solid #2A2A2A',
    minWidth: '38px',
    paddingRight: '8px',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(245, 154, 74, 0.06)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(245, 154, 74, 0.10)',
    color: '#EDEDED',
    fontWeight: '600',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: '#262626',
    border: 'none',
    color: '#A3A3A3',
    borderRadius: '3px',
    padding: '0 4px',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(245, 154, 74, 0.2)',
    outline: '1px solid rgba(245, 154, 74, 0.45)',
  },
});

/**
 * Modern Light Editor Theme
 */
const lightEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: '#111111',
    backgroundColor: '#FFFFFF',
    fontSize: 'var(--editor-font-size, 13px)',
  },
  '.cm-content': {
    caretColor: '#187444',
    fontFamily: EDITOR_FONT,
    lineHeight: '1.65',
    padding: '12px 4px',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#187444',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    {
      backgroundColor: 'rgba(24, 116, 68, 0.18) !important',
    },
  '.cm-panels': {
    backgroundColor: '#F4F4F4',
    color: '#111111',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid #E0E0E0',
  },
  '.cm-panels.cm-panels-bottom': {
    borderTop: '1px solid #E0E0E0',
  },
  '.cm-gutters': {
    backgroundColor: '#F4F4F4',
    color: '#6B6B6B',
    borderRight: '1px solid #E6E6E6',
    minWidth: '38px',
    paddingRight: '8px',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(24, 116, 68, 0.04)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#E6E6E6',
    color: '#111111',
    fontWeight: '600',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: '#E6E6E6',
    border: 'none',
    color: '#595959',
    borderRadius: '3px',
    padding: '0 4px',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(24, 116, 68, 0.12)',
    outline: '1px solid rgba(24, 116, 68, 0.35)',
  },
});

async function resolveLanguageExtension(filePath: string): Promise<Extension> {
  const ext = filePath.split('.').pop()?.toLowerCase();

  if (ext === 'md' || ext === 'markdown') {
    return markdown({ codeLanguages: languages });
  }
  if (ext === 'json' || ext === 'jsonc') {
    return json();
  }
  if (ext === 'py') {
    return python();
  }
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') {
    return javascript({ jsx: true });
  }
  if (ext === 'ts' || ext === 'tsx') {
    return javascript({ typescript: true, jsx: true });
  }

  // Dynamic language loading via @codemirror/language-data
  const desc = LanguageDescription.matchFilename(languages, filePath);
  if (desc) {
    try {
      return await desc.load();
    } catch {
      return [];
    }
  }

  return [];
}

export function EditorTab({ tab }: EditorTabProps) {
  const { isDark } = useTheme();
  const { t } = useLanguage();
  const filePath =
    (tab.meta?.filePath as string) || tab.id.replace(/^editor:/, '');
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const isMarkdown = filePath.endsWith('.md') || filePath.endsWith('.markdown');
  // P11-14: 대용량 파일은 앞부분만 읽기 전용으로 연다.
  const readOnlyHead = tab.meta?.readOnlyHead === true;

  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const [content, setContent] = useState<string>('');
  const [loadedFilePath, setLoadedFilePath] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>(
    'saved',
  );
  const [mdMode, setMdMode] = useState<'edit' | 'split' | 'preview'>('edit');
  const [fontSize, setFontSize] = useState<number>(13);
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number }>({
    line: 1,
    col: 1,
  });

  const loading = loadedFilePath !== filePath;

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<string>('');

  const fileIconSpec = getFileIcon(fileName, false);

  const saveFile = useCallback(
    async (newContent: string) => {
      setSaveStatus('saving');
      try {
        await invoke('write_text_file', {
          path: filePath,
          contents: newContent,
        });
        setSaveStatus('saved');
      } catch (err) {
        console.error('Failed to save file:', err);
        setSaveStatus('error');
      }
    },
    [filePath],
  );

  const onDocChange = useCallback(
    (newDoc: string) => {
      if (readOnlyHead) return;
      setContent(newDoc);
      contentRef.current = newDoc;

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      setSaveStatus('saving');
      saveTimeoutRef.current = setTimeout(() => {
        void saveFile(newDoc);
      }, 500);
    },
    [saveFile, readOnlyHead],
  );

  // Load file content from disk (P11-14: readOnlyHead면 앞부분만).
  useEffect(() => {
    let cancelled = false;

    const load = readOnlyHead
      ? invoke<{ text: string }>('fc_read_text_head', { path: filePath }).then((r) => r.text)
      : invoke<string>('read_text_file', { path: filePath });
    load
      .then((data) => {
        if (cancelled) return;
        setContent(data);
        contentRef.current = data;
        setReadError(null);
        setLoadedFilePath(filePath);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to read file:', err);
        setReadError(String(err));
        setLoadedFilePath(filePath);
      });

    return () => {
      cancelled = true;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [filePath, readOnlyHead]);

  // Mount CodeMirror editor
  useEffect(() => {
    if (loading || !containerRef.current) return;

    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    let active = true;

    void resolveLanguageExtension(filePath).then((langExtension) => {
      if (!active || !containerRef.current) return;

      const extensions = [
        basicSetup,
        keymap.of([...defaultKeymap, indentWithTab]),
        langExtension,
        syntaxHighlighting(isDark ? darkHighlightStyle : lightHighlightStyle),
        isDark ? darkEditorTheme : lightEditorTheme,
        EditorView.editable.of(!readOnlyHead),
        EditorView.theme({
          '&': {
            '--editor-font-size': `${fontSize}px`,
          } as Record<string, string>,
        }),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged) {
            onDocChange(update.state.doc.toString());
          }
          if (update.selectionSet) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            setCursorPos({
              line: line.number,
              col: head - line.from + 1,
            });
          }
        }),
      ];

      const state = EditorState.create({
        doc: contentRef.current,
        extensions,
      });

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });

      viewRef.current = view;
    });

    return () => {
      active = false;
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [loading, filePath, onDocChange, fontSize, isDark, readOnlyHead]);

  const lineCount = content.split('\n').length;
  const charCount = content.length;

  return (
    <div className="flex flex-col h-full w-full bg-editor min-h-0 select-none">
      {/* Visual Editor Toolbar */}
      <div className="h-9 shrink-0 flex items-center justify-between px-3 border-b border-border bg-tabbar text-xs">
        {/* Left: File Icon & Name */}
        <div className="flex items-center gap-2 min-w-0">
          <fileIconSpec.Icon
            className="h-4 w-4 shrink-0"
            style={{ color: fileIconSpec.color }}
          />
          <span
            className="font-mono font-medium text-foreground text-xs truncate max-w-xs"
            title={filePath}
          >
            {fileName}
          </span>
          <span className="text-[11px] text-muted-foreground font-mono hidden sm:inline opacity-70">
            {t('editor.meta', { lines: lineCount, chars: charCount })}
          </span>
          {readOnlyHead && (
            <span className="text-[11px] text-warning font-medium hidden sm:inline">
              {t('editor.largeFileNotice')}
            </span>
          )}
        </div>

        {/* Right: Controls (Font size, Markdown toggles, Save status) */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Font Size Adjusters */}
          <div className="flex items-center rounded-md border border-border/70 bg-background/50 px-1 py-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setFontSize((f) => Math.max(10, f - 1))}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded hover:bg-muted"
              title={t('editor.fontDown')}
            >
              <ZoomOut className="h-3 w-3" />
            </button>
            <span className="px-1.5 font-mono text-[10px] text-muted-foreground min-w-[28px] text-center">
              {fontSize}px
            </span>
            <button
              type="button"
              onClick={() => setFontSize((f) => Math.min(22, f + 1))}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded hover:bg-muted"
              title={t('editor.fontUp')}
            >
              <ZoomIn className="h-3 w-3" />
            </button>
          </div>

          {/* Markdown View Toggle (Source | Split | Preview) */}
          {isMarkdown && (
            <div className="flex items-center rounded-md border border-border/80 bg-background/80 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setMdMode('edit')}
                className={cn(
                  'px-2 py-0.5 rounded flex items-center gap-1 transition-colors',
                  mdMode === 'edit'
                    ? 'bg-accent text-foreground font-medium shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
                title={t('editor.editOnlyTitle')}
              >
                <Code2 className="h-3 w-3" />
                <span>{t('editor.edit')}</span>
              </button>
              <button
                type="button"
                onClick={() => setMdMode('split')}
                className={cn(
                  'px-2 py-0.5 rounded flex items-center gap-1 transition-colors border-l border-border/50',
                  mdMode === 'split'
                    ? 'bg-accent text-foreground font-medium shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
                title={t('editor.splitTitle')}
              >
                <Columns2 className="h-3 w-3" />
                <span>{t('editor.split')}</span>
              </button>
              <button
                type="button"
                onClick={() => setMdMode('preview')}
                className={cn(
                  'px-2 py-0.5 rounded flex items-center gap-1 transition-colors border-l border-border/50',
                  mdMode === 'preview'
                    ? 'bg-accent text-foreground font-medium shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
                title={t('editor.previewTitle')}
              >
                <Eye className="h-3 w-3" />
                <span>{t('editor.preview')}</span>
              </button>
            </div>
          )}

          {/* Save Status Badge */}
          <div className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-muted/40 border border-border/60">
            {saveStatus === 'saving' && (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-warning" />
                <span className="text-warning">{t('editor.saving')}</span>
              </>
            )}
            {saveStatus === 'saved' && (
              <>
                <Check className="h-3 w-3 text-success" />
                <span className="text-success">{t('editor.saved')}</span>
              </>
            )}
            {saveStatus === 'error' && (
              <span className="text-destructive font-semibold">
                {t('editor.saveFailed')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Editor Main Content Area */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden select-text">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2 text-primary" />
            <span>{t('editor.loading')}</span>
          </div>
        ) : readError ? (
          <div className="flex-1 flex flex-col items-center justify-center text-xs text-destructive p-4 gap-2">
            <AlertTriangle className="h-6 w-6" />
            <span>{t('editor.loadFailed', { err: readError })}</span>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex overflow-hidden">
            {/* Split Mode with Resizable Panels */}
            {isMarkdown && mdMode === 'split' ? (
              <PanelGroup direction="horizontal" className="flex-1 min-h-0">
                <Panel
                  defaultSize={50}
                  minSize={20}
                  className="flex flex-col min-w-0"
                >
                  <div
                    ref={containerRef}
                    className="h-full w-full overflow-hidden"
                  />
                </Panel>
                <PanelResizeHandle className="w-1 bg-border hover:bg-primary data-[resize-handle-active]:bg-primary transition-colors cursor-col-resize" />
                <Panel
                  defaultSize={50}
                  minSize={20}
                  className="flex flex-col min-w-0 overflow-y-auto bg-card/20 p-6"
                >
                  <div
                    className={cn(
                      'prose prose-sm max-w-none break-words',
                      isDark && 'prose-invert',
                    )}
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({ className, children, ...props }) {
                          const match = /language-(\w+)/.exec(className || '');
                          const lang = match ? match[1].toLowerCase() : '';
                          const codeString = String(children).replace(
                            /\n$/,
                            '',
                          );
                          const isInline = !match && !codeString.includes('\n');

                          if (isInline) {
                            return (
                              <code
                                className="px-1.5 py-0.5 mx-0.5 rounded bg-muted/80 font-mono text-[12px] text-primary border border-border/50"
                                {...props}
                              >
                                {children}
                              </code>
                            );
                          }
                          return (
                            <CodeViewer
                              code={codeString}
                              language={lang || 'text'}
                            />
                          );
                        },
                      }}
                    >
                      {content}
                    </ReactMarkdown>
                  </div>
                </Panel>
              </PanelGroup>
            ) : isMarkdown && mdMode === 'preview' ? (
              /* Preview Mode */
              <div className="flex-1 overflow-y-auto bg-card/20 p-6">
                <div
                  className={cn(
                    'prose prose-sm max-w-3xl mx-auto break-words',
                    isDark && 'prose-invert',
                  )}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '');
                        const lang = match ? match[1].toLowerCase() : '';
                        const codeString = String(children).replace(/\n$/, '');
                        const isInline = !match && !codeString.includes('\n');

                        if (isInline) {
                          return (
                            <code
                              className="px-1.5 py-0.5 mx-0.5 rounded bg-muted/80 font-mono text-[12px] text-primary border border-border/50"
                              {...props}
                            >
                              {children}
                            </code>
                          );
                        }
                        return (
                          <CodeViewer
                            code={codeString}
                            language={lang || 'text'}
                          />
                        );
                      },
                    }}
                  >
                    {content}
                  </ReactMarkdown>
                </div>
              </div>
            ) : (
              /* Standard Code Editor */
              <div
                ref={containerRef}
                className="flex-1 h-full overflow-hidden"
              />
            )}
          </div>
        )}

        {/* Footer Status Bar */}
        <div className="h-6 shrink-0 flex items-center justify-between px-3 border-t border-border/60 bg-tabbar text-[11px] font-mono text-muted-foreground select-none">
          <div className="flex items-center gap-3">
            <span>
              Ln {cursorPos.line}, Col {cursorPos.col}
            </span>
            <span>UTF-8</span>
          </div>
          <div className="flex items-center gap-3">
            <span>
              {isMarkdown
                ? 'Markdown'
                : fileName.split('.').pop()?.toUpperCase() || 'Text'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default EditorTab;
