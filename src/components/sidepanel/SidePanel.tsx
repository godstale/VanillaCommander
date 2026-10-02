import { Zap } from 'lucide-react';
import type { SidePanelView } from '@/lib/types/workspaceTab';
import { ChatSessionList } from '@/components/chatsessions/ChatSessionList';
import { AgentListPanel } from '@/components/agents/AgentListPanel';
import { ExplorerPanel } from '@/components/explorer/ExplorerPanel';
import { WikiPanel } from '@/components/wiki/WikiPanel';
import { PanelPlaceholder } from './PanelPlaceholder';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface SidePanelProps {
  activeView: SidePanelView;
}

export function SidePanel({ activeView }: SidePanelProps) {
  const { t } = useLanguage();

  if (!activeView) {
    return null;
  }

  switch (activeView) {
    case 'chat-sessions':
      return <ChatSessionList />;
    case 'agents':
      return <AgentListPanel />;
    case 'explorer':
      return <ExplorerPanel />;
    case 'wiki':
      return <WikiPanel />;
    case 'macros':
      // P11-40에서 MacroPanel로 교체.
      return <PanelPlaceholder icon={Zap} title={t('activityBar.macros')} description={t('tabPlaceholder.desc')} />;
    default:
      return null;
  }
}

export default SidePanel;
