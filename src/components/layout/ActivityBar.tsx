import { Files, MessageSquare, Bot, BookOpen, Zap, Settings, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { SidePanelView } from '@/lib/types/workspaceTab';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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

// P11-01(V1): 탐색기 · 채팅 · 에이전트 · 위키 · 매크로. D2에 따라 폴더 미선택 비활성화 없음.
const ITEMS: ActivityBarItem[] = [
  { view: 'explorer', icon: Files, labelKey: 'activityBar.explorer' },
  { view: 'chat-sessions', icon: MessageSquare, labelKey: 'activityBar.chatSessions' },
  { view: 'agents', icon: Bot, labelKey: 'activityBar.agents' },
  { view: 'wiki', icon: BookOpen, labelKey: 'activityBar.wiki' },
  { view: 'macros', icon: Zap, labelKey: 'activityBar.macros' },
];

export function ActivityBar({ activeView, onSelect }: ActivityBarProps) {
  const { t } = useLanguage();

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        aria-label="Activity Bar"
        className="w-12 shrink-0 h-full flex flex-col items-center justify-between bg-activitybar border-r border-border py-2 select-none"
      >
        <div className="flex flex-col items-center gap-1 w-full">
          {ITEMS.map(({ view, icon: Icon, labelKey }) => {
            const isActive = activeView === view;
            const title = t(labelKey);
            return (
              <Tooltip key={view}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(view);
                    }}
                    aria-label={title}
                    className={cn(
                      'w-10 h-10 flex items-center justify-center rounded-md transition-colors relative',
                      'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.08] cursor-pointer',
                      isActive && 'text-primary bg-primary/10 hover:text-primary hover:bg-primary/15 font-medium',
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{title}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/settings"
              aria-label={t('activityBar.settings')}
              className="w-10 h-10 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.08] transition-colors cursor-pointer"
            >
              <Settings className="h-5 w-5" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{t('activityBar.settings')}</p>
          </TooltipContent>
        </Tooltip>
      </aside>
    </TooltipProvider>
  );
}
