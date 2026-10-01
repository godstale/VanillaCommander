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
  it('ActivityBar has explorer enabled and other buttons disabled when no folder is selected', () => {
    render(
      <MemoryRouter>
        <WorkspaceProvider>
          <ActivityBar activeView="explorer" onSelect={vi.fn()} />
        </WorkspaceProvider>
      </MemoryRouter>,
    );

    // Explorer should be enabled
    const explorerBtn = screen.getByRole('button', { name: /파일 탐색기/i });
    expect(explorerBtn).toBeEnabled();

    // Other views should be disabled
    const chatBtn = screen.getByRole('button', { name: /대화 목록/i });
    expect(chatBtn).toBeDisabled();

    const agentsBtn = screen.getByRole('button', { name: /에이전트 관리/i });
    expect(agentsBtn).toBeDisabled();

    const monitoringBtn = screen.getByRole('button', { name: /모니터링/i });
    expect(monitoringBtn).toBeDisabled();

    // Settings in activity bar should be disabled
    const settingsBtn = screen.getByRole('button', { name: /설정/i });
    expect(settingsBtn).toBeDisabled();
  });

  it('TopMenuBar has File menu enabled but Agent and View menus disabled when no folder is selected', () => {
    render(
      <MemoryRouter>
        <WorkspaceProvider>
          <ChatSessionsProvider>
            <WorkspaceTabsProvider>
              <SidePanelProvider>
                <TopMenuBar />
              </SidePanelProvider>
            </WorkspaceTabsProvider>
          </ChatSessionsProvider>
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

  it('SidePanelContext defaults to explorer and prevents selecting other views when no folder is selected', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WorkspaceProvider>
        <SidePanelProvider initialView="chat-sessions">{children}</SidePanelProvider>
      </WorkspaceProvider>
    );

    const { result } = renderHook(() => useSidePanel(), { wrapper });

    // Should default to explorer because workspaceRoot is null
    expect(result.current.activeView).toBe('explorer');

    // Attempting to switch to agents should be ignored
    act(() => {
      result.current.setActiveView('agents');
    });
    expect(result.current.activeView).toBe('explorer');

    // Attempting to toggle explorer should stay on explorer
    act(() => {
      result.current.toggleView('explorer');
    });
    expect(result.current.activeView).toBe('explorer');
  });

  it('WorkspaceTabsContext prevents opening tabs when no folder is selected', () => {
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
      expect(tabId).toBe('');
    });

    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeTabId).toBeNull();
  });
});
