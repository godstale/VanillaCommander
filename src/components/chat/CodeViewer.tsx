import { useState, useMemo } from 'react';
import { Check, Copy, Code2 } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface CodeViewerProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
}

// Map common language aliases to readable names and accents
const LANGUAGE_META: Record<string, { label: string; badgeColor: string }> = {
  javascript: { label: 'JavaScript', badgeColor: 'text-amber-400 border-amber-400/30 bg-amber-400/10' },
  js: { label: 'JavaScript', badgeColor: 'text-amber-400 border-amber-400/30 bg-amber-400/10' },
  typescript: { label: 'TypeScript', badgeColor: 'text-sky-400 border-sky-400/30 bg-sky-400/10' },
  ts: { label: 'TypeScript', badgeColor: 'text-sky-400 border-sky-400/30 bg-sky-400/10' },
  tsx: { label: 'TSX / React', badgeColor: 'text-sky-400 border-sky-400/30 bg-sky-400/10' },
  jsx: { label: 'JSX / React', badgeColor: 'text-amber-400 border-amber-400/30 bg-amber-400/10' },
  python: { label: 'Python', badgeColor: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10' },
  py: { label: 'Python', badgeColor: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10' },
  rust: { label: 'Rust', badgeColor: 'text-orange-400 border-orange-400/30 bg-orange-400/10' },
  rs: { label: 'Rust', badgeColor: 'text-orange-400 border-orange-400/30 bg-orange-400/10' },
  json: { label: 'JSON', badgeColor: 'text-violet-400 border-violet-400/30 bg-violet-400/10' },
  html: { label: 'HTML', badgeColor: 'text-rose-400 border-rose-400/30 bg-rose-400/10' },
  css: { label: 'CSS', badgeColor: 'text-blue-400 border-blue-400/30 bg-blue-400/10' },
  sql: { label: 'SQL', badgeColor: 'text-indigo-400 border-indigo-400/30 bg-indigo-400/10' },
  bash: { label: 'Bash / Shell', badgeColor: 'text-teal-400 border-teal-400/30 bg-teal-400/10' },
  sh: { label: 'Shell', badgeColor: 'text-teal-400 border-teal-400/30 bg-teal-400/10' },
  yaml: { label: 'YAML', badgeColor: 'text-pink-400 border-pink-400/30 bg-pink-400/10' },
  yml: { label: 'YAML', badgeColor: 'text-pink-400 border-pink-400/30 bg-pink-400/10' },
  md: { label: 'Markdown', badgeColor: 'text-gray-400 border-gray-400/30 bg-gray-400/10' },
  markdown: { label: 'Markdown', badgeColor: 'text-gray-400 border-gray-400/30 bg-gray-400/10' },
};

/**
 * Lightweight syntax tokenizer for enhanced code display in markdown messages.
 * Breaks code into highlighted spans without heavyweight runtime dependencies.
 */
function highlightTokens(code: string, lang: string): (string | { type: string; text: string })[] {
  const normalized = lang.toLowerCase();
  const tokens: (string | { type: string; text: string })[] = [];

  // Keywords set based on language
  let keywordRegex = /\b(const|let|var|function|return|if|else|for|while|import|from|export|default|class|interface|type|extends|implements|async|await|try|catch|finally|throw|new|typeof|instanceof|switch|case|break|continue|null|undefined|true|false)\b/g;

  if (normalized === 'python' || normalized === 'py') {
    keywordRegex = /\b(def|class|return|if|elif|else|for|while|import|from|as|try|except|finally|raise|with|lambda|yield|async|await|None|True|False|is|in|not|and|or)\b/g;
  } else if (normalized === 'rust' || normalized === 'rs') {
    keywordRegex = /\b(fn|let|mut|pub|struct|enum|impl|trait|use|mod|match|if|else|loop|while|for|in|return|break|continue|self|Self|async|await|const|type|where)\b/g;
  } else if (normalized === 'sql') {
    keywordRegex = /\b(SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|DROP|JOIN|LEFT|RIGHT|INNER|OUTER|ON|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|AS|AND|OR|NOT|NULL|PRIMARY|KEY|FOREIGN)\b/gi;
  }

  // Combined token regex: comments, strings, keywords, numbers, function calls
  const tokenMasterRegex = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|(\b[a-zA-Z_]\w*(?=\s*\())|([a-zA-Z_]\w*)|([^\s\w]+|\s+)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenMasterRegex.exec(code)) !== null) {
    const [, comment, str, num, fnCall, word, other] = match;

    if (comment) {
      tokens.push({ type: 'comment', text: comment });
    } else if (str) {
      tokens.push({ type: 'string', text: str });
    } else if (num) {
      tokens.push({ type: 'number', text: num });
    } else if (fnCall) {
      if (keywordRegex.test(fnCall)) {
        keywordRegex.lastIndex = 0;
        tokens.push({ type: 'keyword', text: fnCall });
      } else {
        tokens.push({ type: 'function', text: fnCall });
      }
    } else if (word) {
      keywordRegex.lastIndex = 0;
      if (keywordRegex.test(word)) {
        tokens.push({ type: 'keyword', text: word });
      } else if (/^[A-Z][a-zA-Z0-9_]*$/.test(word)) {
        tokens.push({ type: 'type', text: word });
      } else {
        tokens.push(word);
      }
    } else if (other) {
      tokens.push(other);
    }

    if (tokenMasterRegex.lastIndex === lastIndex) {
      tokenMasterRegex.lastIndex++;
    }
    lastIndex = tokenMasterRegex.lastIndex;
  }

  return tokens.length > 0 ? tokens : [code];
}

export function CodeViewer({
  code,
  language = 'text',
  filename,
  showLineNumbers = true,
}: CodeViewerProps) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  const cleanLang = (language || 'text').replace(/^language-/, '').toLowerCase();
  const meta = LANGUAGE_META[cleanLang] || {
    label: cleanLang.toUpperCase(),
    badgeColor: 'text-muted-foreground border-border bg-muted/30',
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const lines = useMemo(() => code.split('\n'), [code]);

  return (
    <div className="relative my-3 rounded-xl border border-border/80 bg-code text-code-foreground overflow-hidden shadow-xs select-text">
      {/* Code Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-white/5 border-b border-white/10 text-xs select-none">
        <div className="flex items-center gap-2 min-w-0">
          <Code2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {filename ? (
            <span className="font-mono text-zinc-200 font-medium truncate">{filename}</span>
          ) : (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border font-semibold ${meta.badgeColor}`}>
              {meta.label}
            </span>
          )}
          <span className="text-[10px] text-zinc-500 font-mono hidden sm:inline">
            {t('codeViewer.lines', { n: lines.length })}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-sans text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
            title={t('codeViewer.copyTitle')}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-emerald-400">{t('codeViewer.copied')}</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>{t('codeViewer.copy')}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code Body */}
      <div className="p-3.5 overflow-x-auto font-mono text-xs leading-relaxed max-h-[520px] overflow-y-auto">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, idx) => {
              const lineTokens = highlightTokens(line, cleanLang);
              return (
                <tr key={idx} className="hover:bg-zinc-900/50 transition-colors group">
                  {showLineNumbers && (
                    <td className="w-9 pr-3 text-right text-[11px] text-zinc-600 select-none group-hover:text-zinc-500 align-top">
                      {idx + 1}
                    </td>
                  )}
                  <td className="whitespace-pre pl-1 text-zinc-200 font-mono">
                    {lineTokens.map((tok, tIdx) => {
                      if (typeof tok === 'string') {
                        return <span key={tIdx}>{tok}</span>;
                      }
                      let colorClass = 'text-zinc-200';
                      if (tok.type === 'keyword') {
                        colorClass = 'text-pink-400 font-medium';
                      } else if (tok.type === 'string') {
                        colorClass = 'text-emerald-300';
                      } else if (tok.type === 'comment') {
                        colorClass = 'text-zinc-500 italic';
                      } else if (tok.type === 'number') {
                        colorClass = 'text-amber-300';
                      } else if (tok.type === 'function') {
                        colorClass = 'text-sky-300';
                      } else if (tok.type === 'type') {
                        colorClass = 'text-yellow-300';
                      }
                      return (
                        <span key={tIdx} className={colorClass}>
                          {tok.text}
                        </span>
                      );
                    })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default CodeViewer;
