import type { ReactNode, RefObject } from 'react';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';

export interface WorkspaceLayoutProps {
  sidePanelRef: RefObject<ImperativePanelHandle | null>;
  sidePanel: ReactNode;
  centerWorkspace: ReactNode;
}

function ResizeHandle() {
  return (
    <PanelResizeHandle className="w-1 hover:w-1.5 -mx-0.5 z-10 bg-border/40 hover:bg-primary/80 data-[resize-handle-active]:bg-primary transition-colors cursor-col-resize flex items-center justify-center" />
  );
}

export function WorkspaceLayout({
  sidePanelRef,
  sidePanel,
  centerWorkspace,
}: WorkspaceLayoutProps) {
  return (
    <PanelGroup
      direction="horizontal"
      autoSaveId="fortress-layout-v1"
      className="h-full w-full overflow-hidden"
    >
      <Panel
        id="fortress-side-panel"
        order={1}
        defaultSize={20}
        minSize={16}
        collapsible
        collapsedSize={0}
        ref={sidePanelRef}
        className="min-w-0 h-full overflow-hidden"
      >
        {sidePanel}
      </Panel>
      <ResizeHandle />
      <Panel
        id="fortress-center-workspace"
        order={2}
        minSize={40}
        className="min-w-0 h-full overflow-hidden"
      >
        {centerWorkspace}
      </Panel>
    </PanelGroup>
  );
}
