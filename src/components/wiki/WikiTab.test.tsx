import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { open as openFolderDialog } from '@tauri-apps/plugin-dialog';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import { SettingsProvider } from '@/lib/context/SettingsContext';
import { WorkspaceProvider } from '@/lib/context/WorkspaceContext';
import { AgentsProvider } from '@/lib/context/AgentsContext';
import { WorkspaceTabsProvider } from '@/lib/context/WorkspaceTabsContext';
import { WikiTab } from './WikiTab';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: () => Promise.resolve(null),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

function renderWikiTab() {
  return render(
    <MemoryRouter>
      <SettingsProvider>
        <WorkspaceProvider>
          <AgentsProvider>
            <WorkspaceTabsProvider>
              <WikiTab />
            </WorkspaceTabsProvider>
          </AgentsProvider>
        </WorkspaceProvider>
      </SettingsProvider>
    </MemoryRouter>,
  );
}

describe('WikiTab inbox folder browse', () => {
  beforeEach(() => {
    setDatabase(new MemorySqlFallback());
    window.localStorage.clear();
    window.localStorage.setItem('vanilla-commander_current_workspace_root', 'C:/work');
    vi.mocked(openFolderDialog).mockReset();
  });

  it('보관 폴더 옆에 찾아보기 버튼이 있다', () => {
    renderWikiTab();
    expect(screen.getByRole('button', { name: '찾아보기' })).toBeInTheDocument();
  });

  it('폴더를 고르면 보관 폴더 입력에 반영된다', async () => {
    vi.mocked(openFolderDialog).mockResolvedValue('C:/archive');
    renderWikiTab();
    fireEvent.click(screen.getByRole('button', { name: '찾아보기' }));
    await waitFor(() => {
      expect(openFolderDialog).toHaveBeenCalledWith({ directory: true, multiple: false });
    });
    const input = screen.getByPlaceholderText(
      '비우면 작업 폴더/wiki-inbox',
    ) as HTMLInputElement;
    await waitFor(() => {
      expect(input.value).toBe('C:/archive');
    });
  });

  it('대화상자를 취소하면 입력이 그대로 둔다', async () => {
    vi.mocked(openFolderDialog).mockResolvedValue(null);
    renderWikiTab();
    const input = screen.getByPlaceholderText(
      '비우면 작업 폴더/wiki-inbox',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'custom-dir' } });
    fireEvent.click(screen.getByRole('button', { name: '찾아보기' }));
    await waitFor(() => {
      expect(openFolderDialog).toHaveBeenCalled();
    });
    expect(input.value).toBe('custom-dir');
  });
});
