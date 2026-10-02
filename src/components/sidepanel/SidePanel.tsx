import type { SidePanelView } from '@/lib/types/workspaceTab';
import { ChatSessionList } from '@/components/chatsessions/ChatSessionList';
import { AgentListPanel } from '@/components/agents/AgentListPanel';
import { ExplorerPanel } from '@/components/explorer/ExplorerPanel';
import { WikiPanel } from '@/components/wiki/WikiPanel';
import { MacroPanel } from '@/components/macros/MacroPanel';

export interface SidePanelProps {
  activeView: SidePanelView;
}

export function SidePanel({ activeView }: SidePanelProps) {
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
      return <MacroPanel />;
    default:
      return null;
  }
}

export default SidePanel;
