import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { CenterWorkspace } from './CenterWorkspace';
import { WorkspaceTabsProvider, useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { WorkspaceProvider } from '@/lib/context/WorkspaceContext';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@/lib/db/repositories/settingsRepo', () => ({
  getSettings: vi.fn().mockResolvedValue({
    trustedWorkspaces: ['/test/project'],
    lastWorkspaceRoot: '/test/project',
    openTabs: [],
    activeTabId: null,
  }),
  updateSettings: vi.fn().mockResolvedValue(undefined),
  saveProjectTabs: vi.fn().mockResolvedValue(undefined),
}));

// Mock tab contents to keep test lightweight
vi.mock('@/components/workspace/ChatTab', () => ({
  ChatTab: () => <div data-testid="chat-tab">Chat Content</div>,
}));

function TabInitializer() {
  const { openTab } = useWorkspaceTabs();
  return (
    <button
      data-testid="init-tabs"
      onClick={() => {
        openTab({ id: 'tab1', type: 'chat', title: 'Tab 1' });
        openTab({ id: 'tab2', type: 'chat', title: 'Tab 2' });
        openTab({ id: 'tab3', type: 'chat', title: 'Tab 3' });
      }}
    >
      Init
    </button>
  );
}

describe('CenterWorkspace tab header', () => {
  beforeEach(() => {
    localStorage.setItem('fortress_current_workspace_root', '/test/project');
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  const renderComponent = () => {
    return render(
      <LanguageProvider>
        <WorkspaceProvider>
          <WorkspaceTabsProvider>
            <TabInitializer />
            <CenterWorkspace />
          </WorkspaceTabsProvider>
        </WorkspaceProvider>
      </LanguageProvider>,
    );
  };

  it('renders tab items with draggable attribute and uniform h-9 styling', async () => {
    renderComponent();

    // Initialize 3 tabs
    act(() => {
      screen.getByTestId('init-tabs').click();
    });

    const tab1 = screen.getByTitle('Tab 1');
    const tab2 = screen.getByTitle('Tab 2');
    const tab3 = screen.getByTitle('Tab 3');

    expect(tab1).toHaveAttribute('draggable', 'true');
    expect(tab2).toHaveAttribute('draggable', 'true');
    expect(tab3).toHaveAttribute('draggable', 'true');

    expect(tab1).toHaveClass('h-9');
    expect(tab2).toHaveClass('h-9');
    expect(tab3).toHaveClass('h-9');
  });

  it('shows "좌측 탭 닫기" in context menu and closes left tabs when clicked', async () => {
    renderComponent();

    act(() => {
      screen.getByTestId('init-tabs').click();
    });

    const tab2 = screen.getByTitle('Tab 2');

    // Right click on Tab 2
    fireEvent.contextMenu(tab2);

    expect(screen.getByText('우측으로 화면 분할')).toBeInTheDocument();

    const closeLeftOption = screen.getByText('좌측 탭 닫기');
    expect(closeLeftOption).toBeInTheDocument();
    expect(closeLeftOption.closest('[role="menuitem"]')).not.toHaveAttribute('aria-disabled', 'true');

    // Click "좌측 탭 닫기"
    act(() => {
      fireEvent.click(closeLeftOption);
    });

    // Tab 1 should be closed, Tab 2 and Tab 3 remain
    expect(screen.queryByTitle('Tab 1')).not.toBeInTheDocument();
    expect(screen.getByTitle('Tab 2')).toBeInTheDocument();
    expect(screen.getByTitle('Tab 3')).toBeInTheDocument();
  });

  it('reorders tabs when a tab is dragged and dropped onto another tab', async () => {
    renderComponent();

    act(() => {
      screen.getByTestId('init-tabs').click();
    });

    const tab1 = screen.getByTitle('Tab 1');
    const tab2 = screen.getByTitle('Tab 2');

    // Start drag on Tab 1
    fireEvent.dragStart(tab1, {
      dataTransfer: {
        setData: vi.fn(),
        getData: () => 'tab1',
        effectAllowed: 'move',
      },
    });

    // Drop on Tab 2
    act(() => {
      fireEvent.drop(tab2, {
        dataTransfer: {
          getData: () => 'tab1',
        },
        clientX: 200,
      });
    });

    const tabTitles = screen
      .getAllByRole('button', { name: '탭 닫기' })
      .map((b) => b.parentElement?.title);
    expect(tabTitles).toEqual(['Tab 2', 'Tab 1', 'Tab 3']);
  });

  it('splits screen when choosing "우측으로 화면 분할" in context menu', async () => {
    renderComponent();

    act(() => {
      screen.getByTestId('init-tabs').click();
    });

    const tab2 = screen.getByTitle('Tab 2');
    act(() => {
      fireEvent.contextMenu(tab2, { clientX: 100, clientY: 100 });
    });

    const closeOption = screen.getByText('닫기');
    expect(closeOption).toBeInTheDocument();

    const splitOption = screen.getByText('우측으로 화면 분할');
    expect(splitOption).toBeInTheDocument();

    act(() => {
      fireEvent.click(splitOption);
    });

    expect(screen.getByTitle('분할 화면 닫기 (탭 병합)')).toBeInTheDocument();
  });

  it('splits screen when dragging a tab and dropping onto the content area', async () => {
    renderComponent();

    act(() => {
      screen.getByTestId('init-tabs').click();
    });

    const tab2 = screen.getByTitle('Tab 2');
    const contentArea = screen.getAllByTestId('chat-tab')[0].parentElement?.parentElement;
    expect(contentArea).toBeTruthy();

    // Drag Tab 2
    fireEvent.dragStart(tab2, {
      dataTransfer: {
        setData: vi.fn(),
        getData: () => 'tab2',
        effectAllowed: 'move',
      },
    });

    // Drag over content area
    act(() => {
      fireEvent.dragOver(contentArea!, {
        dataTransfer: {
          dropEffect: 'move',
        },
        clientX: 500,
        clientY: 300,
      });
    });

    // Drop onto content area
    act(() => {
      fireEvent.drop(contentArea!, {
        dataTransfer: {
          getData: () => 'tab2',
        },
      });
    });

    // Screen should now be split
    expect(screen.getByTitle('분할 화면 닫기 (탭 병합)')).toBeInTheDocument();
  });
});
