import { useState } from 'react';
import {
  Puzzle,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Layers,
} from 'lucide-react';
import { useSkills } from '@/lib/context/SkillsContext';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export function SkillListPanel() {
  const { skills, diagnostics, isLoading, isSkillActive, toggleSkill, refreshSkills } =
    useSkills();
  const { openTab } = useWorkspaceTabs();
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const { t } = useLanguage();

  const handleOpenViewer = (skill: {
    name: string;
    filePath: string;
    baseDir: string;
  }) => {
    openTab({
      type: 'skill-viewer',
      id: `skill:${skill.name}`,
      title: skill.name,
      meta: {
        filePath: skill.filePath,
        baseDir: skill.baseDir,
        name: skill.name,
      },
    });
  };

  return (
    <div className="flex flex-col h-full bg-sidebar select-none overflow-hidden">
      {/* Panel Header */}
      <div className="flex items-center justify-between p-3 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5">
          <Puzzle className="h-4 w-4 text-tertiary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('skills.titleCount', { n: skills.length })}
          </span>
        </div>

        <Button
          size="icon"
          variant="ghost"
          onClick={refreshSkills}
          disabled={isLoading}
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          title={t('skills.refresh')}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
        </Button>
      </div>

      {/* Diagnostics collapsible banner */}
      {diagnostics.length > 0 && (
        <div className="p-2 border-b border-border bg-warning/10 text-warning text-xs shrink-0">
          <button
            type="button"
            onClick={() => setShowDiagnostics((prev) => !prev)}
            className="w-full flex items-center justify-between text-left font-medium text-[11px]"
          >
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{t('skills.diagnostics', { n: diagnostics.length })}</span>
            </div>
            {showDiagnostics ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>

          {showDiagnostics && (
            <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {diagnostics.map((d, idx) => (
                <div
                  key={idx}
                  className="p-1.5 rounded bg-background/80 border border-warning/20 text-[10px] text-muted-foreground leading-relaxed"
                >
                  <span className="font-semibold text-warning uppercase mr-1">
                    [{d.level}]
                  </span>
                  <span>{d.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Skill Cards List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-4">
            <Layers className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-xs font-medium">{t('skills.empty')}</p>
            <p className="text-[11px] opacity-70 mt-1">
              {t('skills.emptyDesc')}
            </p>
          </div>
        ) : (
          skills.map((skill) => {
            const active = isSkillActive(skill.name);

            return (
              <div
                key={skill.name}
                className={cn(
                  'group relative p-2.5 rounded-lg border transition-all duration-150',
                  active
                    ? 'bg-card/70 border-border hover:border-primary/40'
                    : 'bg-muted/20 border-border/40 opacity-60',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    onClick={() => handleOpenViewer(skill)}
                    className="flex-1 min-w-0 cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="font-mono font-medium text-xs text-foreground truncate group-hover:text-primary transition-colors">
                        {skill.name}
                      </span>
                      <span
                        className={cn(
                          'text-[9px] px-1.5 py-0.2 rounded-full font-medium',
                          skill.source === 'global'
                            ? 'bg-primary/10 text-primary border border-primary/20'
                            : 'bg-success/10 text-success border border-success/20',
                        )}
                      >
                        {skill.source === 'global' ? t('skills.global') : t('skills.workspace')}
                      </span>
                    </div>

                    <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                      {skill.description}
                    </p>
                  </div>

                  {/* Toggle active switch */}
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleSkill(skill.name)}
                      className={cn(
                        'w-7 h-4 rounded-full transition-colors relative focus:outline-hidden',
                        active ? 'bg-primary' : 'bg-muted-foreground/30',
                      )}
                      title={active ? t('skills.disable') : t('skills.enable')}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform',
                          active && 'transform translate-x-3',
                        )}
                      />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenViewer(skill)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-opacity"
                      title={t('skills.viewDoc')}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default SkillListPanel;
