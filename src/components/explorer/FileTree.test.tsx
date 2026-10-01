import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileTree } from './FileTree';
import { WorkspaceTabsProvider } from '@/lib/context/WorkspaceTabsContext';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('@/lib/context/WorkspaceContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/context/WorkspaceContext')>();
  const mockVal = {
    workspaceRoot: '/path/to/project',
    setWorkspaceRoot: vi.fn(),
    isTrusted: true,
    trustCurrentWorkspace: vi.fn(),
    rejectCurrentWorkspace: vi.fn(),
    recentWorkspaces: [],
    trustModalOpen: false,
    setTrustModalOpen: vi.fn(),
  };
  return {
    ...actual,
    useWorkspace: () => mockVal,
    useSafeWorkspace: () => mockVal,
  };
});

describe('FileTree Context Menus', () => {
  const mockTree = {
    name: 'test-project',
    path: '/path/to/project',
    is_dir: true,
    children: [
      {
        name: 'sample.txt',
        path: '/path/to/project/sample.txt',
        is_dir: false,
      },
      {
        name: 'subfolder',
        path: '/path/to/project/subfolder',
        is_dir: true,
        children: [],
      },
    ],
  };

  const renderComponent = () => {
    return render(
      <LanguageProvider>
        <WorkspaceTabsProvider>
          <FileTree />
        </WorkspaceTabsProvider>
      </LanguageProvider>,
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_project_folder_tree') {
        return mockTree;
      }
      return null;
    });
  });

  it('renders file context menu items on right clicking a file', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('sample.txt')).toBeInTheDocument();
    });

    const fileItem = screen.getByText('sample.txt');
    fireEvent.contextMenu(fileItem);

    expect(screen.getByRole('button', { name: '열기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '복사' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '잘라내기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '붙여넣기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이름 변경' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '탐색기에서 보기' })).toBeInTheDocument();
  });

  it('renders empty space context menu items on right clicking empty space', async () => {
    const { container } = renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('test-project').length).toBeGreaterThan(0);
    });

    // Right click on the container root or empty body area
    const explorerContainer = container.firstElementChild!;
    fireEvent.contextMenu(explorerContainer);

    expect(screen.getByRole('button', { name: '새 파일' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새 폴더' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '새로고침' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: '트리/목록 보기로 전환' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '모든 폴더 접기/펼치기' })).toBeInTheDocument();
  });

  it('closes context menu when Escape key is pressed', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('sample.txt')).toBeInTheDocument();
    });

    const fileItem = screen.getByText('sample.txt');
    fireEvent.contextMenu(fileItem);

    expect(screen.getByRole('button', { name: '탐색기에서 보기' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('button', { name: '탐색기에서 보기' })).not.toBeInTheDocument();
  });
});
