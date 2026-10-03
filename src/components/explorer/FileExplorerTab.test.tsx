import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect } from 'react';
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
          { name: 'photo.png', path: 'C:/work/docs/photo.png', kind: 'file', size: 20, modified_ms: 1000, hidden: false, readonly: false, symlink: false, warning: false },
        ]);
      }
      return Promise.resolve([]);
    }
    if (cmd === 'fc_system_folders') return Promise.resolve([]);
    if (cmd === 'fc_zip' || cmd === 'fc_stat') return Promise.resolve(`job-${cmd}`);
    return Promise.resolve({ warning: false });
  },
  convertFileSrc: (p: string) => `asset://${p}`,
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

// 활성 탭으로 등록해 렌더한다. 탐색기 전역 단축키(window 리스너) 테스트용.
function renderActiveTab() {
  function Opener({ children }: { children: React.ReactNode }) {
    const { openTab } = useWorkspaceTabs();
    useEffect(() => {
      openTab({ id: TAB.id, type: TAB.type, title: TAB.title, meta: TAB.meta });
    }, [openTab]);
    return <>{children}</>;
  }
  return render(
    <MemoryRouter>
      <SettingsProvider>
        <WorkspaceProvider>
          <AgentsProvider>
            <JobsProvider>
              <WorkspaceTabsProvider>
                <StatusBarProvider>
                  <Opener>
                    <FileExplorerTab tab={TAB} />
                  </Opener>
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
    // 1 / 가로 2분할 / 세로 2분할 버튼 (단축키 포함 타이틀).
    expect(screen.getByTitle('1분할 (Alt+1)')).toBeInTheDocument();
    expect(screen.getByTitle('2분할 가로 (상·하) (Alt+2)')).toBeInTheDocument();
    expect(screen.getByTitle('2분할 세로 (좌·우) (Alt+3)')).toBeInTheDocument();
    // 폴더 트리 (시스템 폴더 보기 기반).
    expect(screen.getByRole('tree')).toBeInTheDocument();
    // 탭 상태바: 전체 개수 표시.
    expect(await screen.findByText(/2개/)).toBeInTheDocument();
  });

  it('splits into two panes', async () => {
    renderTab();
    expect(await screen.findByText('a.txt')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2분할 세로 (좌·우) (Alt+3)'));
    // 분할되면 같은 파일이 창마다 표시된다.
    await waitFor(() => {
      expect(screen.getAllByText('a.txt').length).toBe(2);
    });
    // 찾기는 평소에 아이콘만 보인다.
    expect(screen.getAllByTitle('찾기 (Ctrl+F)').length).toBe(2);
  });

  it('zips the selection via the toolbar button (F4)', async () => {
    renderTab();
    const row = await screen.findByText('a.txt');
    fireEvent.click(row);
    fireEvent.click(screen.getByTitle('압축하기 (F4)'));
    await waitFor(() => {
      const zip = calls.find((c) => c.cmd === 'fc_zip');
      expect(zip).toBeDefined();
      expect((zip?.args as { sources: string[] }).sources).toEqual(['C:/work/a.txt']);
    });
  });

  it('toggles the image album with the toolbar button and F9', async () => {
    renderActiveTab();
    expect(await screen.findByText('a.txt')).toBeInTheDocument();
    // docs 폴더로 이동한다 (b.txt + photo.png).
    fireEvent.doubleClick(screen.getByText('docs'));
    expect(await screen.findByText('b.txt')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('이미지 앨범 (F9)'));
    // 앨범에서는 폴더·이미지만 보이고 텍스트 파일은 숨겨진다.
    await waitFor(() => {
      expect(screen.queryByText('b.txt')).not.toBeInTheDocument();
    });
    const thumb = screen.getByAltText('photo.png') as HTMLImageElement;
    expect(thumb.src).toContain('asset://');
    expect(screen.getByText('..')).toBeInTheDocument();
    // F9로 목록으로 복귀한다.
    fireEvent.keyDown(window, { key: 'F9' });
    expect(await screen.findByText('b.txt')).toBeInTheDocument();
  });

  it('moves only within album entries with arrows (P13-08)', async () => {
    renderTab();
    expect(await screen.findByText('a.txt')).toBeInTheDocument();
    fireEvent.doubleClick(screen.getByText('docs'));
    expect(await screen.findByText('b.txt')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('이미지 앨범 (F9)'));
    expect(await screen.findByText('photo.png')).toBeInTheDocument();
    const tileOf = (name: string) => screen.getByText(name).parentElement as HTMLElement;
    const isSel = (name: string) => (tileOf(name).className ?? '').includes('bg-primary/15');
    // 아래로 이동하면 첫 앨범 항목('..')이 선택된다.
    fireEvent.keyDown(screen.getByText('..'), { key: 'ArrowDown' });
    expect(isSel('..')).toBe(true);
    // 오른쪽으로 이동하면 텍스트 파일(b.txt)을 건너뛰고 이미지가 선택된다.
    fireEvent.keyDown(screen.getByText('..'), { key: 'ArrowRight' });
    expect(isSel('photo.png')).toBe(true);
    expect(isSel('..')).toBe(false);
    // 왼쪽으로 돌아온다.
    fireEvent.keyDown(screen.getByText('photo.png'), { key: 'ArrowLeft' });
    expect(isSel('..')).toBe(true);
    // 목록에서는 좌·우가 동작하지 않는다.
    fireEvent.click(screen.getByTitle('이미지 앨범 (F9)'));
    expect(await screen.findByText('b.txt')).toBeInTheDocument();
  });

  it('moves active to the first album entry when toggling (P13-08)', async () => {
    renderTab();
    const row = await screen.findByText('a.txt');
    // 텍스트 파일을 활성 상태로 두고 앨범으로 전환한다.
    fireEvent.click(row);
    fireEvent.click(screen.getByTitle('이미지 앨범 (F9)'));
    expect(await screen.findByText('docs')).toBeInTheDocument();
    expect(screen.queryByText('a.txt')).not.toBeInTheDocument();
    // 보이지 않는 a.txt 대신 첫 앨범 항목('..')이 활성이 된다 (선택은 유지, 활성 링 표시).
    const up = screen.getByText('..').parentElement as HTMLElement;
    expect(up.className ?? '').toContain('outline-primary/50');
  });

  it('opens properties with F3 and shows idle hints in the status bar', async () => {
    renderActiveTab();
    const row = await screen.findByText('a.txt');
    fireEvent.click(row);
    // 평상시 상태바 좌측에는 자주 쓰는 단축키 안내가 표시된다.
    expect(screen.getByLabelText('explorer-status').textContent ?? '').toContain('F2');
    fireEvent.keyDown(window, { key: 'F3' });
    expect(await screen.findByText('정보')).toBeInTheDocument();
  });

  it('toggles agent chat dock via floating button and Alt+C', async () => {
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
    // 플로팅 터미널 버튼은 제거됐다 (터미널은 우클릭 메뉴에서 연다).
    expect(screen.queryByRole('button', { name: '터미널 열기' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /에이전트 채팅/ }));
    // 도크는 일반 채팅 탭과 동일한 ChatTab 화면을 재사용한다 (좁은 도크라 헤더는 압축 표시).
    expect(await screen.findByText(/위치:/)).toBeInTheDocument();
    expect(await screen.findByTitle('대화')).toBeInTheDocument();
  });

  it('keeps folder tree open when switching panes', async () => {
    renderTab();
    expect(await screen.findByText('a.txt')).toBeInTheDocument();
    expect(screen.getByRole('tree')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2분할 세로 (좌·우) (Alt+3)'));
    await waitFor(() => {
      expect(screen.getAllByText('a.txt').length).toBe(2);
    });
    // 두 번째 창을 클릭해도 트리는 그대로 열린 상태다.
    const second = screen.getAllByText('a.txt')[1];
    fireEvent.click(second);
    expect(screen.getByRole('tree')).toBeInTheDocument();
  });

  it('toggles search input with button and Ctrl+F', async () => {
    renderTab();
    expect(await screen.findByText('a.txt')).toBeInTheDocument();
    // 평소에는 찾기 아이콘만 보인다.
    expect(screen.getByTitle('찾기 (Ctrl+F)')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/찾기/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('찾기 (Ctrl+F)'));
    expect(await screen.findByPlaceholderText(/찾기/)).toBeInTheDocument();
    // Ctrl+F를 다시 누르면 닫힌다.
    const pane = screen.getAllByText('a.txt')[0];
    fireEvent.keyDown(pane, { key: 'f', ctrlKey: true });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/찾기/)).not.toBeInTheDocument();
    });
  });

  it('navigates back with Alt+Left', async () => {
    renderTab();
    expect(await screen.findByText('a.txt')).toBeInTheDocument();
    fireEvent.doubleClick(screen.getByText('docs'));
    expect(await screen.findByText('b.txt')).toBeInTheDocument();
    const row = screen.getByText('b.txt');
    fireEvent.keyDown(row, { key: 'ArrowLeft', altKey: true });
    expect(await screen.findByText('a.txt')).toBeInTheDocument();
  });

  it('refreshes with F5 and shows new shortcut titles', async () => {
    renderActiveTab();
    expect(await screen.findByText('a.txt')).toBeInTheDocument();
    const before = calls.filter((c) => c.cmd === 'fc_list_dir').length;
    fireEvent.keyDown(window, { key: 'F5' });
    await waitFor(() => {
      expect(calls.filter((c) => c.cmd === 'fc_list_dir').length).toBeGreaterThan(before);
    });
    // 새로고침·숨김·트리 버튼 타이틀에 단축키가 표시된다.
    expect(screen.getByTitle('새로고침 (F5)')).toBeInTheDocument();
    expect(screen.getByTitle('숨김 파일 표시 (Alt+H)')).toBeInTheDocument();
    expect(screen.getByTitle('폴더 트리 표시 (Alt+B)')).toBeInTheDocument();
  });

  it('switches split panes with Tab and focuses the chat input when the dock opens', async () => {
    function Opener({ children }: { children: React.ReactNode }) {
      const { openTab } = useWorkspaceTabs();
      useEffect(() => {
        openTab({ id: TAB.id, type: TAB.type, title: TAB.title, meta: TAB.meta });
      }, [openTab]);
      return <>{children}</>;
    }
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
                        <Opener>
                          <FileExplorerTab tab={TAB} />
                        </Opener>
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
    fireEvent.click(screen.getByTitle('2분할 세로 (좌·우) (Alt+3)'));
    await waitFor(() => {
      expect(screen.getAllByText('a.txt').length).toBe(2);
    });
    // 분할 후 활성 창 컨테이너로 포커스가 옮겨진다 (주소 입력창이 아님).
    await waitFor(() => {
      expect((document.activeElement as HTMLElement | null)?.className ?? '').toMatch(/ring-primary/);
    });
    expect((document.activeElement as HTMLElement | null)?.tagName).not.toBe('INPUT');
    const first = document.activeElement;
    // Tab으로 분할 창을 전환하면 포커스도 함께 옮겨진다.
    fireEvent.keyDown(window, { key: 'Tab' });
    await waitFor(() => {
      expect(document.activeElement).not.toBe(first);
    });
    expect((document.activeElement as HTMLElement | null)?.className ?? '').toMatch(/ring-primary/);
    // 채팅 도크를 열면 채팅 입력창에 포커스가 간다.
    fireEvent.click(screen.getByRole('button', { name: /에이전트 채팅/ }));
    expect(await screen.findByText(/위치:/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/메시지를 입력/)).toHaveFocus();
  });

  it('does not show folder path in tab status bar', async () => {
    renderTab();
    expect(await screen.findByText('a.txt')).toBeInTheDocument();
    const status = screen.getByLabelText('explorer-status');
    expect(status.textContent ?? '').not.toContain('C:/work');
  });

  it('shows shortcut badges on toolbar while Alt is held', async () => {
    renderTab();
    expect(await screen.findByText('a.txt')).toBeInTheDocument();
    // 평소에는 배지가 없다.
    expect(screen.queryByText('←', { selector: 'kbd' })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Alt', altKey: true });
    expect(await screen.findByText('←', { selector: 'kbd' })).toBeInTheDocument();
    fireEvent.keyUp(window, { key: 'Alt' });
  });
});
