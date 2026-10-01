import { MessageSquare, Bot, Files, Activity, FlaskConical, Settings, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { SidePanelView } from '@/lib/types/workspaceTab';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface ActivityBarProps {
  activeView: SidePanelView;
  onSelect: (view: Exclude<SidePanelView, null>) => void;
}

interface ActivityBarItem {
  view: Exclude<SidePanelView, null>;
  icon: LucideIcon;
  labelKey: string;
}

const ITEMS: ActivityBarItem[] = [
  { view: 'explorer', icon: Files, labelKey: 'activityBar.explorer' },
  { view: 'chat-sessions', icon: MessageSquare, labelKey: 'activityBar.chatSessions' },
  { view: 'agents', icon: Bot, labelKey: 'activityBar.agents' },
  { view: 'monitoring', icon: Activity, labelKey: 'activityBar.monitoring' },
  { view: 'evaluation', icon: FlaskConical, labelKey: 'eval.common.nav.evaluation' },
];

export function ActivityBar({ activeView, onSelect }: ActivityBarProps) {
  const { t } = useLanguage();
  const workspace = useSafeWorkspace();
  const hasWorkspace = workspace === null || Boolean(workspace.workspaceRoot);

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        aria-label="Activity Bar"
        className="w-12 shrink-0 h-full flex flex-col items-center justify-between bg-sidebar border-r border-border py-2 select-none"
      >
        <div className="flex flex-col items-center gap-1 w-full">
          {ITEMS.map(({ view, icon: Icon, labelKey }) => {
            const isActive = activeView === view;
            const isItemDisabled = !hasWorkspace && view !== 'explorer';
            const title = t(labelKey);
            const disabledTitle = `${title} ${t('activityBar.needFolder')}`;
            return (
              <Tooltip key={view}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={isItemDisabled}
                    onClick={() => {
                      if (!isItemDisabled) {
                        onSelect(view);
                      }
                    }}
                    aria-label={isItemDisabled ? disabledTitle : title}
                    className={cn(
                      'w-10 h-10 flex items-center justify-center rounded-md transition-colors relative',
                      isItemDisabled
                        ? 'text-muted-foreground/30 cursor-not-allowed hover:bg-transparent'
                        : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent cursor-pointer',
                      isActive && 'text-primary bg-primary/10 hover:text-primary hover:bg-primary/15 font-medium',
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{isItemDisabled ? disabledTitle : title}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            {!hasWorkspace ? (
              <button
                type="button"
                disabled
                aria-label={t('activityBar.settingsNeedFolder')}
                className="w-10 h-10 flex items-center justify-center rounded-md text-muted-foreground/30 cursor-not-allowed"
              >
                <Settings className="h-5 w-5" />
              </button>
            ) : (
              <Link
                to="/settings"
                aria-label={t('activityBar.settings')}
                className="w-10 h-10 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors cursor-pointer"
              >
                <Settings className="h-5 w-5" />
              </Link>
            )}
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{!hasWorkspace ? t('activityBar.settingsAvailable') : t('activityBar.settings')}</p>
          </TooltipContent>
        </Tooltip>
      </aside>
    </TooltipProvider>
  );
}
