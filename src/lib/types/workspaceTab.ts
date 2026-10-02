export type WorkspaceTabType =
  | 'chat'
  | 'editor'
  | 'image-viewer'
  | 'agent-editor'
  | 'agent-monitor'
  | 'skill-viewer'
  | 'file-explorer'
  | 'document-viewer'
  | 'archive-viewer'
  | 'wiki'
  | 'macro-editor';

export type SidePanelView =
  | 'explorer'
  | 'chat-sessions'
  | 'agents'
  | 'wiki'
  | 'macros'
  | null;

export interface WorkspaceTab {
  id: string;
  type: WorkspaceTabType;
  title: string;
  meta?: Record<string, unknown>;
  pane?: 'primary' | 'secondary';
}

const SUPPORTED_TAB_TYPES: ReadonlySet<string> = new Set<string>([
  'chat',
  'editor',
  'image-viewer',
  'agent-editor',
  'agent-monitor',
  'skill-viewer',
  'file-explorer',
  'document-viewer',
  'archive-viewer',
  'wiki',
  'macro-editor',
]);

// P11-01: 복원된 저장 탭 중 삭제된 타입('eval', 'agent-stats')을 조용히 버린다.
export function isSupportedTabType(type: string): type is WorkspaceTabType {
  return SUPPORTED_TAB_TYPES.has(type);
}
