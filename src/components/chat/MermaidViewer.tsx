import React, { useEffect, useId, useMemo, useState } from 'react';
import mermaid from 'mermaid';
import { AlertCircle, Check, Copy } from 'lucide-react';
import { useTheme } from '../../lib/context/ThemeContext';
import { isChartDsl } from '../../lib/types/chartDsl';
import { RechartsViewer } from './RechartsViewer';

// Mermaid derives shades from hex inputs, so it cannot read the CSS variables; values mirror design/tokens.json.
const MERMAID_DARK = {
  darkMode: true,
  background: '#151515',
  primaryColor: '#1C1C1C',
  primaryTextColor: '#EDEDED',
  primaryBorderColor: '#F59A4A',
  secondaryColor: '#262626',
  secondaryBorderColor: '#7FA6FF',
  tertiaryColor: '#1A1A1A',
  tertiaryBorderColor: '#5BC98A',
  lineColor: '#A3A3A3',
  textColor: '#EDEDED',
  noteBkgColor: '#2A1C06',
  noteTextColor: '#EDEDED',
  noteBorderColor: '#E8B04A',
};

const MERMAID_LIGHT = {
  darkMode: false,
  background: '#FFFFFF',
  primaryColor: '#EAF6EF',
  primaryTextColor: '#111111',
  primaryBorderColor: '#187444',
  secondaryColor: '#EEF3FF',
  secondaryBorderColor: '#2459C9',
  tertiaryColor: '#FFF3E8',
  tertiaryBorderColor: '#C2570C',
  lineColor: '#595959',
  textColor: '#111111',
  noteBkgColor: '#FFF3E8',
  noteTextColor: '#111111',
  noteBorderColor: '#9A5B00',
};

interface MermaidViewerProps {
  code: string;
  /** 스트리밍 중에는 매 토큰마다 렌더하지 않고 코드로 표시한다 (깜빡임/무한 draw 방지). */
  isStreaming?: boolean;
}

let mermaidInitializedTheme: string | null = null;

const MermaidDiagramViewer: React.FC<MermaidViewerProps> = ({ code, isStreaming = false }) => {
  const { theme } = useTheme();
  const rawId = useId();
  // useId is stable per mount; memo keeps the mermaid render target id constant
  // across re-renders so scroll/parent updates never re-trigger a draw.
  const elementId = useMemo(
    () => 'mermaid-' + rawId.replace(/[^a-zA-Z0-9_-]/g, ''),
    [rawId],
  );

  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // 스트리밍 중에는 렌더하지 않는다. 부모(MessageBubble)가 코드 블록으로
    // 폴백 표시하고, 완료 후 한 번만 렌더한다.
    if (isStreaming) return;
    let active = true;
    const timer = setTimeout(() => {
      const renderDiagram = async () => {
        try {
          if (!active) return;
          setError(null);
          setSvg(null);

          const isDark =
            theme === 'dark' ||
            (theme === 'system' &&
              typeof window !== 'undefined' &&
              window.matchMedia('(prefers-color-scheme: dark)').matches);

          // 테마가 바뀔 때만 재초기화한다. 다이어그램마다 initialize를 호출하면
          // 마지막 마운트가 전역 테마를 덮어쓰는 레이스가 발생한다.
          const themeKey = isDark ? 'dark' : 'light';
          if (mermaidInitializedTheme !== themeKey) {
            mermaid.initialize({
              startOnLoad: false,
              suppressErrorRendering: true,
              theme: 'base',
              themeVariables: isDark ? MERMAID_DARK : MERMAID_LIGHT,
              securityLevel: 'strict',
              fontFamily: 'inherit',
            });
            mermaidInitializedTheme = themeKey;
          }

          const trimmedCode = code.trim();
          if (!trimmedCode) {
            if (active) setSvg('');
            return;
          }

          const renderResult = await mermaid.render(elementId, trimmedCode);
          if (active) {
            setSvg(renderResult.svg);
          }
        } catch (err) {
          // Clean up any stray error elements injected by mermaid into document.body
          const stray = document.querySelectorAll(`[id^="d${elementId}"], #${elementId}, .error-icon`);
          stray.forEach((el) => {
            if (el.parentElement === document.body) {
              el.remove();
            }
          });

          if (active) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
          }
        }
      };

      void renderDiagram();
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
      const stray = document.querySelectorAll(`[id^="d${elementId}"], #${elementId}`);
      stray.forEach((el) => {
        if (el.parentElement === document.body) {
          el.remove();
        }
      });
    };
  }, [code, theme, elementId, isStreaming]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard error
    }
  };

  if (error) {
    return (
      <div className="my-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-destructive mb-2">
          <AlertCircle className="w-4 h-4" />
          <span>Mermaid Diagram Syntax Error</span>
        </div>
        <div className="text-muted-foreground mb-2 text-[11px] font-mono break-words">{error}</div>
        <div className="relative">
          <button
            type="button"
            onClick={handleCopy}
            className="absolute top-2 right-2 p-1 rounded bg-background/80 hover:bg-background text-muted-foreground hover:text-foreground transition-colors"
            title="Copy code"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <pre className="overflow-x-auto rounded bg-background/50 p-2 font-mono text-[11px] text-foreground">
            <code>{code}</code>
          </pre>
        </div>
      </div>
    );
  }

  if (isStreaming) {
    return (
      <div className="relative my-3 rounded-lg border border-border bg-card/60 p-3">
        <pre className="overflow-x-auto rounded bg-background/50 p-2 font-mono text-[11px] text-muted-foreground whitespace-pre-wrap">
          <code>{code}</code>
        </pre>
        <div className="mt-1.5 text-center text-[11px] text-muted-foreground animate-pulse">
          Rendering diagram after streaming completes...
        </div>
      </div>
    );
  }

  return (
    <div className="relative my-3 rounded-lg border border-border bg-card p-4 overflow-x-auto shadow-sm">
      <div className="absolute top-2 right-2 z-10">
        <button
          type="button"
          onClick={handleCopy}
          className="p-1.5 rounded bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Copy diagram code"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      {svg ? (
        <div
          className="flex justify-center [&>svg]:max-w-full [&>svg]:h-auto"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="text-center py-4 text-xs text-muted-foreground animate-pulse">
          Rendering diagram...
        </div>
      )}
    </div>
  );
};

export const MermaidViewer: React.FC<MermaidViewerProps> = ({ code, isStreaming = false }) => {
  if (isChartDsl(code)) {
    return <RechartsViewer code={code} />;
  }
  return <MermaidDiagramViewer code={code} isStreaming={isStreaming} />;
};
