// 위키 키워드 검색 탭. 에이전트를 거치지 않고 wiki 도구 query(grep 기반)로 직접 검색한다.
import { useCallback, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { createWikiTool } from '@/lib/tools/wiki';
import { buildFileTab, planOpenFile } from '@/lib/commander/openFile';

interface WikiSearchMatch {
  file_path: string;
  line_number: number;
  line_content: string;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function WikiSearchTab() {
  const { t } = useLanguage();
  const workspace = useSafeWorkspace();
  const { openTab } = useWorkspaceTabs();
  const workspaceRoot = workspace?.workspaceRoot ?? null;

  const [keyword, setKeyword] = useState('');
  const [searched, setSearched] = useState<string | null>(null);
  const [matches, setMatches] = useState<WikiSearchMatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const runSearch = useCallback(async () => {
    const q = keyword.trim();
    if (!q || busy || !workspaceRoot) return;
    setBusy(true);
    setFailed(false);
    try {
      const tool = createWikiTool({ workspaceRoot });
      const result = await tool.execute(
        crypto.randomUUID(),
        { action: 'query', query: q },
        new AbortController().signal,
      );
      const details = result.details as { matches?: WikiSearchMatch[] } | undefined;
      setMatches(details?.matches ?? []);
      setSearched(q);
    } catch {
      setFailed(true);
      setSearched(q);
      setMatches([]);
    } finally {
      setBusy(false);
    }
  }, [keyword, busy, workspaceRoot]);

  const openMatch = useCallback((match: WikiSearchMatch) => {
    openTab(buildFileTab(planOpenFile(match.file_path)));
  }, [openTab]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">{t('wiki.searchTabTitle')}</h2>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch();
            }}
            placeholder={t('wiki.searchPlaceholder')}
            disabled={!workspaceRoot || busy}
            aria-label={t('wiki.searchPlaceholder')}
            className="flex-1 px-3 py-1.5 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={!keyword.trim() || !workspaceRoot || busy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-default"
          >
            <Search className="h-3.5 w-3.5" />
            <span>{t('wiki.searchButton')}</span>
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {!workspaceRoot ? t('wiki.noWorkspace') : t('wiki.searchHint')}
        </p>

        <div>
          {failed ? (
            <p className="text-xs text-destructive">{t('wiki.searchFailed')}</p>
          ) : searched === null ? (
            <p className="text-xs text-muted-foreground">{t('wiki.searchEmpty')}</p>
          ) : matches.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('wiki.searchNoResults')}</p>
          ) : (
            <>
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide pb-1">
                {t('wiki.searchResults', { n: matches.length })}
              </h3>
              <ul className="space-y-1">
                {matches.map((match) => (
                  <li key={`${match.file_path}:${match.line_number}`}>
                    <button
                      type="button"
                      onClick={() => openMatch(match)}
                      title={match.file_path}
                      className="w-full text-left px-2.5 py-1.5 rounded-md border border-border/60 bg-card/40 hover:bg-card transition-colors cursor-pointer"
                    >
                      <span className="block text-[11px] font-medium truncate">
                        {fileName(match.file_path)}
                        <span className="ml-1.5 font-mono font-normal text-muted-foreground">
                          :{match.line_number}
                        </span>
                      </span>
                      <span className="block text-[11px] text-muted-foreground truncate">
                        {match.line_content}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default WikiSearchTab;
