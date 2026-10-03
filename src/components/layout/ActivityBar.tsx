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
import { useAltHeld } from '@/hooks/useAltHeld';

export interface ActivityBarProps {
  activeView: SidePanelView;
  onSelect: (view: Exclude<SidePanelView, null>) => void;
}

interface ActivityBarItem {
  view: Exclude<SidePanelView, null>;
  icon: LucideIcon;
  labelKey: string;
  /** P13-03: Ctrl+Shift+<badge> 전역 단축키. */
  badge: string;
}

// P11-01(V1): 탐색기 · 채팅 · 에이전트 · 위키 · 매크로. D2에 따라 폴더 미선택 비활성화 없음.
// P13-04: 사이드 메뉴는 Alt+<badge> 전역 단축키 (Alt+D 주소 입력과 겹치지 않도록 D→G, G→M).
const ITEMS: ActivityBarItem[] = [
  { view: 'explorer', icon: Files, labelKey: 'activityBar.explorer', badge: 'A' },
  { view: 'chat-sessions', icon: MessageSquare, labelKey: 'activityBar.chatSessions', badge: 'S' },
  { view: 'agents', icon: Bot, labelKey: 'activityBar.agents', badge: 'G' },
  { view: 'wiki', icon: BookOpen, labelKey: 'activityBar.wiki', badge: 'F' },
  { view: 'macros', icon: Zap, labelKey: 'activityBar.macros', badge: 'M' },
];

export function ActivityBar({ activeView, onSelect }: ActivityBarProps) {
  const { t } = useLanguage();
  // P13-03: Alt를 누른 동안 단축키 배지를 버튼 안쪽 우하단에 표시한다 (바깥 -top은 잘림).
  const altHeld = useAltHeld();

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        aria-label="Activity Bar"
        className="w-12 shrink-0 h-full flex flex-col items-center justify-between bg-activitybar border-r border-border py-2 select-none"
      >
        <div className="flex flex-col items-center gap-1 w-full">
          {ITEMS.map(({ view, icon: Icon, labelKey, badge }) => {
            const isActive = activeView === view;
            const title = `${t(labelKey)} (Alt+${badge})`;
            return (
              <Tooltip key={view}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(view);
                    }}
                    aria-label={title}
                    title={title}
                    className={cn(
                      'w-10 h-10 flex items-center justify-center rounded-md transition-colors relative',
                      'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.08] cursor-pointer',
                      isActive && 'text-primary bg-primary/10 hover:text-primary hover:bg-primary/15 font-medium',
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {altHeld && (
                      <kbd className="absolute bottom-0 right-0 rounded border border-primary/50 bg-background px-1 text-[9px] leading-3 font-mono text-primary pointer-events-none shadow-sm">
                        {badge}
                      </kbd>
                    )}
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
              aria-label={`${t('activityBar.settings')} (Ctrl+,)`}
              title={`${t('activityBar.settings')} (Ctrl+,)`}
              className="w-10 h-10 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.08] transition-colors cursor-pointer relative"
            >
              <Settings className="h-5 w-5" />
              {altHeld && (
                <kbd className="absolute bottom-0 right-0 rounded border border-primary/50 bg-background px-1 text-[9px] leading-3 font-mono text-primary pointer-events-none shadow-sm whitespace-nowrap">
                  Ctrl+,
                </kbd>
              )}
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{`${t('activityBar.settings')} (Ctrl+,)`}</p>
          </TooltipContent>
        </Tooltip>
      </aside>
    </TooltipProvider>
  );
}
