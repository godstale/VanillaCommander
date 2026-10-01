import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { MemoryRouter } from 'react-router-dom';
import { WorkspaceTabsProvider } from '@/lib/context/WorkspaceTabsContext';
import { ChatSessionsProvider } from '@/lib/context/ChatSessionsContext';
import { WorkspaceProvider } from '@/lib/context/WorkspaceContext';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <LanguageProvider>
    <MemoryRouter>
      <WorkspaceProvider>
        <ChatSessionsProvider>
          <WorkspaceTabsProvider>{children}</WorkspaceTabsProvider>
        </ChatSessionsProvider>
      </WorkspaceProvider>
    </MemoryRouter>
  </LanguageProvider>
);

describe('useKeyboardShortcuts', () => {
  it('triggers custom handlers on shortcut press', () => {
    const onNewChat = vi.fn();
    const onCloseCurrentTab = vi.fn();
    const onOpenSettings = vi.fn();
    const onEscape = vi.fn();

    renderHook(
      () =>
        useKeyboardShortcuts({
          onNewChat,
          onCloseCurrentTab,
          onOpenSettings,
          onEscape,
        }),
      { wrapper: Wrapper },
    );

    // Ctrl+N
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }));
    expect(onNewChat).toHaveBeenCalledTimes(1);

    // Ctrl+W
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true }));
    expect(onCloseCurrentTab).toHaveBeenCalledTimes(1);

    // Ctrl+,
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    // Escape
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
