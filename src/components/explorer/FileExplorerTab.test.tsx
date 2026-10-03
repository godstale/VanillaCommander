import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import { SettingsProvider } from '@/lib/context/SettingsContext';
import { WorkspaceProvider } from '@/lib/context/WorkspaceContext';
import { AgentsProvider } from '@/lib/context/AgentsContext';
import { ChatSessionsProvider } from '@/lib/context/ChatSessionsContext';
import { MacrosProvider } from '@/lib/macros/MacrosProvider';
import { WorkspaceTabsProvider, useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { StatusBarProvider } from '@/lib/context/StatusBarContext';
import { JobsProvider } from '@/lib/commander/jobs';
import { FileExplorerTab } from './FileExplorerTab';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';

const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === 'fc_list_dir') {
      const path = args.path as string;
      if (path === 'C:/work') {
        return Promise.resolve([
          { name: 'docs', path: 'C:/work/docs', kind: 'dir', size: 0, modified_ms: 1000, hidden: false, readonly: false, symlink: false, warning: false },
          { name: 'a.txt', path: 'C:/work/a.txt', kind: 'file', size: 12, modified_ms: 1000, hidden: false, readonly: false, symlink: false, warning: false },
        ]);
      }
      if (path === 'C:/work/docs') {
        return Promise.resolve([
          { name: 'b.txt', path: 'C:/work/docs/b.txt', kind: 'file', size: 5, modified_ms: 1000, hidden: false, readonly: false, symlink: false, warning: false },
        ]);
      }
      return Promise.resolve([]);
    }
    if (cmd === 'fc_system_folders') return Promise.resolve([]);
    return Promise.resolve({ warning: false });
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const TAB: WorkspaceTab = {
  id: 'explorer:test',
  type: 'file-explorer',
  title: 'work',
  meta: { path: 'C:/work' },
};

function renderTab() {
  return render(
    <MemoryRouter>
      <SettingsProvider>
        <WorkspaceProvider>
          <AgentsProvider>
            <JobsProvider>
              <WorkspaceTabsProvider>
                <StatusBarProvider>
                  <FileExplorerTab tab={TAB} />
                </StatusBarProvider>
              </WorkspaceTabsProvider>
            </JobsProvider>
          </AgentsProvider>
        </WorkspaceProvider>
      </SettingsProvider>
    </MemoryRouter>,
  );
}

describe('FileExplorerTab', () => {
  beforeEach(() => {
    calls.length = 0;
    setDatabase(new MemorySqlFallback());
    window.localStorage.clear();
    window.confirm = vi.fn(() => true);
  });

  it('lists entries and navigates into folders', async () => {
    renderTab();
    expect(await screen.findByText('a.txt')).toBeInTheDocument();
    expect(screen.getByText('docs')).toBeInTheDocument();

    fireEvent.doubleClick(screen.getByText('docs'));
    expect(await screen.findByText('b.txt')).toBeInTheDocument();
    expect(calls.some((c) => c.cmd === 'fc_list_dir' && (c.args as { path: string }).path === 'C:/work/docs')).toBe(true);
  });

  it('renames via F2 and deletes via Delete (trash)', async () => {
    renderTab();
    const row = await screen.findByText('a.txt');
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'F2' });

    const input = screen.getByDisplayValue('a.txt');
    fireEvent.change(input, { target: { value: 'renamed.txt' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(calls.some((c) => c.cmd === 'fc_rename')).toBe(true);
    });

    fireEvent.click(screen.getByText('a.txt'));
    fireEvent.keyDown(screen.getByText('a.txt'), { key: 'Delete' });
    await waitFor(() => {
      const trash = calls.find((c) => c.cmd === 'fc_trash');
      expect(trash).toBeDefined();
      expect((trash?.args as { paths: string[] }).paths).toEqual(['C:/work/a.txt']);
    });
  });

  it('copies selection to clipboard with Ctrl+C', async () => {
    const { getFileClipboard } = await import('@/lib/commander/clipboard');
    renderTab();
    const row = await screen.findByText('a.txt');
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'c', ctrlKey: true });
    expect(getFileClipboard()).toEqual({ mode: 'copy', paths: ['C:/work/a.txt'] });
  });

  it('opens tab persistence helpers without crashing', async () => {
    function TabsProbe() {
      const { tabs } = useWorkspaceTabs();
      return <span data-testid="tabcount">{tabs.length}</span>;
    }
    render(
      <MemoryRouter>
        <SettingsProvider>
          <WorkspaceProvider>
            <AgentsProvider>
              <JobsProvider>
                <WorkspaceTabsProvider>
                  <StatusBarProvider>
                    <FileExplorerTab tab={TAB} />
                    <TabsProbe />
                  </StatusBarProvider>
                </WorkspaceTabsProvider>
              </JobsProvider>
            </AgentsProvider>
          </WorkspaceProvider>
        </SettingsProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('a.txt')).toBeInTheDocument();
  });

  it('shows split controls, folder tree and tab status bar', async () => {
    renderTab();
    expect(await screen.findByText('a.txt')).toBeInTheDocument();
    // 1/2/4 분할 버튼.
    expect(screen.getByTitle('1분할')).toBeInTheDocument();
    expect(screen.getByTitle('2분할')).toBeInTheDocument();
    expect(screen.getByTitle('4분할')).toBeInTheDocument();
    // 폴더 트리 (시스템 폴더 보기 기반).
    expect(screen.getByRole('tree')).toBeInTheDocument();
    // 탭 상태바: 전체 개수 표시.
    expect(await screen.findByText(/2개/)).toBeInTheDocument();
  });

  it('splits into two panes', async () => {
    renderTab();
    expect(await screen.findByText('a.txt')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2분할'));
    // 창마다 찾기 입력창이 하나씩 있다.
    await waitFor(() => {
      expect(screen.getAllByPlaceholderText(/찾기/).length).toBe(2);
    });
  });

  it('opens the agent chat dock with the same chat screen', async () => {
    render(
      <MemoryRouter>
        <SettingsProvider>
          <WorkspaceProvider>
            <AgentsProvider>
              <ChatSessionsProvider>
                <MacrosProvider>
                  <JobsProvider>
                    <WorkspaceTabsProvider>
                      <StatusBarProvider>
                        <FileExplorerTab tab={TAB} />
                      </StatusBarProvider>
                    </WorkspaceTabsProvider>
                  </JobsProvider>
                </MacrosProvider>
              </ChatSessionsProvider>
            </AgentsProvider>
          </WorkspaceProvider>
        </SettingsProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('a.txt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '에이전트 채팅' }));
    // 도크는 일반 채팅 탭과 동일한 ChatTab 화면을 재사용한다.
    expect(await screen.findByText(/위치:/)).toBeInTheDocument();
    expect(await screen.findByText('대화')).toBeInTheDocument();
  });
});
