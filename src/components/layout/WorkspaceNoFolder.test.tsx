import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { ActivityBar } from './ActivityBar';
import { TopMenuBar } from './TopMenuBar';
import { SidePanelProvider, useSidePanel } from '@/lib/context/SidePanelContext';
import { WorkspaceTabsProvider, useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { WorkspaceProvider } from '@/lib/context/WorkspaceContext';
import { AgentsProvider } from '@/lib/context/AgentsContext';
import { ChatSessionsProvider } from '@/lib/context/ChatSessionsContext';
import { renderHook, act } from '@testing-library/react';

// Mock Tauri invoke and window
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isMaximized: vi.fn().mockResolvedValue(false),
    onResized: vi.fn().mockResolvedValue(() => {}),
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    startDragging: vi.fn(),
  }),
}));

vi.mock('@/lib/db/repositories/settingsRepo', () => ({
  getSettings: vi.fn().mockResolvedValue({
    trustedWorkspaces: [],
    lastWorkspaceRoot: null,
    openTabs: [],
    activeTabId: null,
  }),
  updateSettings: vi.fn().mockResolvedValue(undefined),
  saveProjectTabs: vi.fn().mockResolvedValue(undefined),
}));

describe('Workspace without selected folder', () => {
  it('ActivityBar has all five menus enabled even when no folder is selected (P11-01, D2)', () => {
    render(
      <MemoryRouter>
        <WorkspaceProvider>
          <ActivityBar activeView="explorer" onSelect={vi.fn()} />
        </WorkspaceProvider>
      </MemoryRouter>,
    );

    for (const name of [/파일 탐색기/i, /대화 목록/i, /에이전트 관리/i, /위키/i, /매크로/i]) {
      expect(screen.getByRole('button', { name })).toBeEnabled();
    }

    // Settings is always available (no folder gating since P11-01).
    expect(screen.getByRole('link', { name: /설정/i })).toBeEnabled();
  });

  it('TopMenuBar has File menu enabled but Agent and View menus disabled when no folder is selected', () => {
    render(
      <MemoryRouter>
        <WorkspaceProvider>
          <AgentsProvider>
            <ChatSessionsProvider>
              <WorkspaceTabsProvider>
                <SidePanelProvider>
                  <TopMenuBar />
                </SidePanelProvider>
              </WorkspaceTabsProvider>
            </ChatSessionsProvider>
          </AgentsProvider>
        </WorkspaceProvider>
      </MemoryRouter>,
    );

    // File menu should be enabled
    const fileMenuBtn = screen.getByRole('button', { name: /파일 \(File\)/i });
    expect(fileMenuBtn).toBeEnabled();

    // Agent and View menus should be disabled
    const agentMenuBtn = screen.getByRole('button', { name: /에이전트/i });
    expect(agentMenuBtn).toBeDisabled();

    const viewMenuBtn = screen.getByRole('button', { name: /보기 \(View\)/i });
    expect(viewMenuBtn).toBeDisabled();
  });

  it('SidePanelContext allows selecting any view when no folder is selected (P11-01, D2)', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WorkspaceProvider>
        <SidePanelProvider initialView="chat-sessions">{children}</SidePanelProvider>
      </WorkspaceProvider>
    );

    const { result } = renderHook(() => useSidePanel(), { wrapper });

    // Initial view is respected (no forced explorer since P11-01).
    expect(result.current.activeView).toBe('chat-sessions');

    // Switching to another view works without a folder.
    act(() => {
      result.current.setActiveView('agents');
    });
    expect(result.current.activeView).toBe('agents');

    // Toggling the active view collapses it.
    act(() => {
      result.current.toggleView('agents');
    });
    expect(result.current.activeView).toBeNull();
  });

  it('WorkspaceTabsContext allows opening tabs when no folder is selected (P11-11, D2)', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WorkspaceProvider>
        <WorkspaceTabsProvider>{children}</WorkspaceTabsProvider>
      </WorkspaceProvider>
    );

    const { result } = renderHook(() => useWorkspaceTabs(), { wrapper });

    act(() => {
      const tabId = result.current.openTab({
        type: 'chat',
        title: 'New Chat',
      });
      expect(tabId).not.toBe('');
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).not.toBeNull();
  });
});
