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
import { WikiSearchTab } from './WikiSearchTab';

const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === 'grep_files') {
      return Promise.resolve([
        {
          file_path: 'C:/work/wiki/sources/ollama-setup.md',
          line_number: 3,
          line_content: 'ollama 모델 설정 방법',
        },
        {
          file_path: 'C:/work/wiki/sources/notes.md',
          line_number: 10,
          line_content: 'ollama 관련 메모',
        },
      ]);
    }
    return Promise.resolve(null);
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

function TabCountProbe() {
  const { tabs } = useWorkspaceTabs();
  return <span data-testid="tab-count">{tabs.length}</span>;
}

function renderSearchTab() {
  return render(
    <MemoryRouter>
      <SettingsProvider>
        <WorkspaceProvider>
          <AgentsProvider>
            <WorkspaceTabsProvider>
              <TabCountProbe />
              <WikiSearchTab />
            </WorkspaceTabsProvider>
          </AgentsProvider>
        </WorkspaceProvider>
      </SettingsProvider>
    </MemoryRouter>,
  );
}

describe('WikiSearchTab', () => {
  beforeEach(() => {
    calls.length = 0;
    setDatabase(new MemorySqlFallback());
    window.localStorage.clear();
    window.localStorage.setItem('vanilla-commander_current_workspace_root', 'C:/work');
  });

  it('검색 전에는 안내 문구를 보여준다', () => {
    renderSearchTab();
    expect(screen.getByPlaceholderText('검색어를 입력하세요')).toBeInTheDocument();
    expect(screen.getByText('검색어를 입력하고 검색해 보세요')).toBeInTheDocument();
    expect(calls.filter((c) => c.cmd === 'grep_files')).toHaveLength(0);
  });

  it('키워드로 wiki 경로를 grep 검색하고 결과를 보여준다', async () => {
    renderSearchTab();
    fireEvent.change(screen.getByPlaceholderText('검색어를 입력하세요'), {
      target: { value: 'ollama' },
    });
    fireEvent.click(screen.getByRole('button', { name: '검색' }));

    await waitFor(() => {
      expect(screen.getByText('검색 결과 2건')).toBeInTheDocument();
    });
    expect(screen.getByText('ollama 모델 설정 방법')).toBeInTheDocument();

    const grep = calls.find((c) => c.cmd === 'grep_files');
    expect(grep).toBeDefined();
    expect(grep?.args.path).toBe('wiki');
  });

  it('결과를 클릭하면 해당 파일 탭이 열린다', async () => {
    renderSearchTab();
    fireEvent.change(screen.getByPlaceholderText('검색어를 입력하세요'), {
      target: { value: 'ollama' },
    });
    fireEvent.click(screen.getByRole('button', { name: '검색' }));

    await waitFor(() => {
      expect(screen.getByText('ollama 모델 설정 방법')).toBeInTheDocument();
    });
    expect(screen.getByTestId('tab-count')).toHaveTextContent('0');
    fireEvent.click(screen.getByText('ollama 모델 설정 방법'));
    await waitFor(() => {
      expect(screen.getByTestId('tab-count')).toHaveTextContent('1');
    });
  });
});
