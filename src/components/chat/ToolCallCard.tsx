import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Terminal,
  FileText,
  Search,
  Globe,
  Compass,
  Edit3,
  Folder,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import type { AgentToolCall, AgentToolResult } from '@/lib/agent/types';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface ToolCallCardProps {
  toolCall?: AgentToolCall;
  toolName: string;
  args?: unknown;
  result?: AgentToolResult | string;
  isError?: boolean;
  isLoading?: boolean;
}

function getToolIcon(name: string) {
  switch (name) {
    case 'read':
      return <FileText className="h-3.5 w-3.5 text-primary" />;
    case 'write':
    case 'edit':
      return <Edit3 className="h-3.5 w-3.5 text-warning" />;
    case 'ls':
      return <Folder className="h-3.5 w-3.5 text-success" />;
    case 'grep':
    case 'find':
      return <Search className="h-3.5 w-3.5 text-tertiary" />;
    case 'shell':
      return <Terminal className="h-3.5 w-3.5 text-destructive" />;
    case 'web_search':
      return <Globe className="h-3.5 w-3.5 text-info" />;
    case 'web_fetch':
      return <Compass className="h-3.5 w-3.5 text-primary" />;
    default:
      return <Terminal className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

export function ToolCallCard({
  toolName,
  args,
  result,
  isError,
  isLoading,
}: ToolCallCardProps) {
  const { t } = useLanguage();
  const [isExpanded, setIsExpanded] = useState(false);

  const resultContent = typeof result === 'string' ? result : result?.content;
  const resultDetails = typeof result === 'object' ? result?.details : undefined;

  let argsPreview = '';
  if (args && typeof args === 'object') {
    const entries = Object.entries(args as Record<string, unknown>);
    argsPreview = entries
      .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : JSON.stringify(v)}`)
      .slice(0, 2)
      .join(', ');
  }

  return (
    <div className="my-2 border border-border/80 rounded-lg bg-card/60 text-xs overflow-hidden shadow-xs">
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/40 transition-colors gap-2"
      >
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          {getToolIcon(toolName)}
          <span className="font-mono font-medium text-foreground">{toolName}</span>
          {argsPreview && (
            <span className="text-muted-foreground truncate font-mono text-[11px]">
              ({argsPreview})
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
          ) : isError ? (
            <div className="flex items-center gap-1 text-destructive text-[11px]">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{t('toolCard.failed')}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-success text-[11px]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{t('toolCard.done')}</span>
            </div>
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 py-2.5 border-t border-border/60 bg-muted/20 font-mono text-[11px] space-y-2">
          {args !== undefined && (
            <div>
              <div className="text-[10px] uppercase text-muted-foreground font-semibold mb-1">
                {t('toolCard.args')}
              </div>
              <pre className="p-2 rounded bg-background border border-border/50 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}

          {resultContent ? (
            <div>
              <div className="text-[10px] uppercase text-muted-foreground font-semibold mb-1">
                {t('toolCard.result')}
              </div>
              <pre
                className={`p-2 rounded bg-background border overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto ${
                  isError ? 'border-destructive/40 text-destructive' : 'border-border/50'
                }`}
              >
                {resultContent}
              </pre>
            </div>
          ) : null}

          {resultDetails !== undefined && (
            <div>
              <div className="text-[10px] uppercase text-muted-foreground font-semibold mb-1">
                {t('toolCard.raw')}
              </div>
              <pre className="p-2 rounded bg-background border border-border/50 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                {JSON.stringify(resultDetails, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
