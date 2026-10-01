export type WorkspaceTabType =
  | 'chat'
  | 'editor'
  | 'image-viewer'
  | 'agent-editor'
  | 'agent-stats'
  | 'agent-monitor'
  | 'skill-viewer'
  | 'eval';

export type SidePanelView =
  | 'chat-sessions'
  | 'explorer'
  | 'agents'
  | 'monitoring'
  | 'evaluation'
  | null;

export type EvalTabView = 'wizard' | 'run' | 'packs' | 'pack' | 'arena';

export interface WorkspaceTab {
  id: string;
  type: WorkspaceTabType;
  title: string;
  meta?: Record<string, unknown>;
  pane?: 'primary' | 'secondary';
}
