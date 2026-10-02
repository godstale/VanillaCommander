import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import { getSession } from '@/lib/db/repositories/sessionsRepo';
import { SettingsProvider } from '@/lib/context/SettingsContext';
import { WorkspaceProvider } from '@/lib/context/WorkspaceContext';
import { AgentsProvider } from '@/lib/context/AgentsContext';
import { WorkspaceTabsProvider } from '@/lib/context/WorkspaceTabsContext';
import { StatusBarProvider } from '@/lib/context/StatusBarContext';
import { JobsProvider } from '@/lib/commander/jobs';
import { ExplorerChatBar } from './ExplorerChatBar';

const mockSend = vi.fn(async () => {});

vi.mock('@/hooks/useChat', () => ({
  useChat: () => ({
    messages: [],
    isStreaming: false,
    sendMessage: mockSend,
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(new Error('no tauri')),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

describe('ExplorerChatBar', () => {
  beforeEach(() => {
    mockSend.mockClear();
    setDatabase(new MemorySqlFallback());
    window.localStorage.clear();
  });

  it('creates an explorer session and sends with location context', async () => {
    const onFilesChanged = vi.fn();
    render(
      <MemoryRouter>
        <SettingsProvider>
          <WorkspaceProvider>
            <AgentsProvider>
              <JobsProvider>
                <WorkspaceTabsProvider>
                  <StatusBarProvider>
                    <ExplorerChatBar
                      tabId="explorer:test"
                      cwd="C:/work"
                      selectedPaths={['C:/work/a.txt', 'C:/work/b.txt']}
                      onFilesChanged={onFilesChanged}
                    />
                  </StatusBarProvider>
                </WorkspaceTabsProvider>
              </JobsProvider>
            </AgentsProvider>
          </WorkspaceProvider>
        </SettingsProvider>
      </MemoryRouter>,
    );

    const input = screen.getByPlaceholderText(/에이전트에게 묻기/);
    fireEvent.change(input, { target: { value: '요약해줘' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    const sent = mockSend.mock.calls[0][0] as string;
    expect(sent).toContain('[위치] C:/work');
    expect(sent).toContain('a.txt');
    expect(sent).toContain('요약해줘');

    const session = await getSession('explorer-explorer:test');
    expect(session?.origin).toBe('explorer');
  });
});
