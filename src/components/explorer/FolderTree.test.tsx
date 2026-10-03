import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import { SettingsProvider } from '@/lib/context/SettingsContext';
import { FolderTree } from './FolderTree';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: Record<string, unknown>) => {
    if (cmd === 'fc_system_folders') {
      return Promise.resolve([
        { id: 'home', label: '홈', path: 'C:/home', exists: true },
      ]);
    }
    if (cmd === 'fc_list_dir') {
      if (args.path === 'C:/home') {
        return Promise.resolve([
          { name: 'docs', path: 'C:/home/docs', kind: 'dir', size: 0, modified_ms: 1, hidden: false, readonly: false, symlink: false, warning: false },
          { name: 'a.txt', path: 'C:/home/a.txt', kind: 'file', size: 3, modified_ms: 1, hidden: false, readonly: false, symlink: false, warning: false },
        ]);
      }
      return Promise.resolve([]);
    }
    return Promise.resolve(null);
  },
}));

describe('FolderTree', () => {
  beforeEach(() => {
    setDatabase(new MemorySqlFallback());
    window.localStorage.clear();
  });

  it('expands roots and navigates into folders', async () => {
    const onNavigate = vi.fn();
    render(
      <SettingsProvider>
        <FolderTree currentPath="C:/home" onNavigate={onNavigate} />
      </SettingsProvider>,
    );
    expect(await screen.findByText('홈')).toBeInTheDocument();

    // 현재 경로까지 자동 펼침: 루트 하위 폴더가 별도 클릭 없이 표시된다.
    expect(await screen.findByText('docs')).toBeInTheDocument();
    expect(screen.queryByText('a.txt')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('docs'));
    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith('C:/home/docs');
    });
  });
});
