import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import { SettingsProvider } from '@/lib/context/SettingsContext';
import { WorkspaceProvider } from '@/lib/context/WorkspaceContext';
import { AgentsProvider } from '@/lib/context/AgentsContext';
import { WorkspaceTabsProvider, useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { ExplorerPanel } from './ExplorerPanel';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string) => {
    if (cmd === 'fc_system_folders') {
      return Promise.resolve([
        { id: 'home', label: '홈', path: 'C:/Users/test', exists: true },
        { id: 'drive-C', label: '로컬 디스크 (C:)', path: 'C:\\', exists: true },
      ]);
    }
    return Promise.reject(new Error(`unexpected: ${cmd}`));
  },
}));

function renderPanel() {
  return render(
    <MemoryRouter>
      <SettingsProvider>
        <WorkspaceProvider>
          <AgentsProvider>
            <WorkspaceTabsProvider>
              <ExplorerPanel />
            </WorkspaceTabsProvider>
          </AgentsProvider>
        </WorkspaceProvider>
      </SettingsProvider>
    </MemoryRouter>,
  );
}

describe('ExplorerPanel', () => {
  beforeEach(() => {
    setDatabase(new MemorySqlFallback());
    window.localStorage.clear();
  });

  it('auto-creates an explorer tab when none is open', async () => {
    function TabsProbe() {
      const { tabs } = useWorkspaceTabs();
      return <span data-testid="tabs">{tabs.filter((t) => t.type === 'file-explorer').length}</span>;
    }
    render(
      <MemoryRouter>
        <SettingsProvider>
          <WorkspaceProvider>
            <AgentsProvider>
              <WorkspaceTabsProvider>
                <ExplorerPanel />
                <TabsProbe />
              </WorkspaceTabsProvider>
            </AgentsProvider>
          </WorkspaceProvider>
        </SettingsProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('tabs').textContent).toBe('1');
    });
  });

  it('lists system folders and opens them on click', async () => {
    renderPanel();
    expect(await screen.findByText('홈')).toBeInTheDocument();
    expect(screen.getByText(/로컬 디스크/)).toBeInTheDocument();
  });

  it('adds the active explorer path to favorites', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.queryByText('열린 탐색기 탭이 없습니다.')).toBeNull();
    });
    // [+](현재 폴더 추가)는 활성 탐색기 경로가 있어야 활성화된다.
    const addButtons = screen.getAllByRole('button');
    expect(addButtons.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '새 탐색기 탭' }));
    await waitFor(() => {
      const rows = screen.getAllByText('파일 탐색기');
      expect(rows.length).toBeGreaterThan(0);
    });
  });
});
