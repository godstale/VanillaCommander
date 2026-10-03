import type { SidePanelView } from '@/lib/types/workspaceTab';
import { ChatSessionList } from '@/components/chatsessions/ChatSessionList';
import { AgentListPanel } from '@/components/agents/AgentListPanel';
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
      // P12-02/P12-03: 탐색기 메뉴는 패널 대신 탐색기 탭을 쓴다. 패널은 비워 둔다.
      return null;
    case 'wiki':
      return <WikiPanel />;
    case 'macros':
      return <MacroPanel />;
    default:
      return null;
  }
}

export default SidePanel;
