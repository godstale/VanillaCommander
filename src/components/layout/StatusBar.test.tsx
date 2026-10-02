import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import '@testing-library/jest-dom/vitest';
import { screen, act } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import { MemoryRouter } from 'react-router-dom';
import {
  StatusBarProvider,
  useStatusBar,
} from '@/lib/context/StatusBarContext';
import { StatusBar } from './StatusBar';
import { AgentsProvider } from '@/lib/context/AgentsContext';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(new Error('no tauri')),
}));

vi.mock('@/lib/db/repositories/settingsRepo', () => ({
  getSettings: vi.fn().mockResolvedValue({
    trustedWorkspaces: [],
    lastWorkspaceRoot: null,
    openTabs: [],
    activeTabId: null,
  }),
  updateSettings: vi.fn().mockResolvedValue(undefined),
  saveProjectTabs: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  vi.useRealTimers();
});

function Probe() {
  const { publish, clear, notify } = useStatusBar();
  return (
    <div>
      <button type="button" onClick={() => publish('jobs', { id: 'j1', content: 'job-one' })}>
        pub
      </button>
      <button type="button" onClick={() => clear('jobs', 'j1')}>
        clr
      </button>
      <button type="button" onClick={() => notify('hello-msg', 1000)}>
        note
      </button>
    </div>
  );
}

describe('StatusBarContext', () => {
  const wrap = (ui: ReactNode) =>
    render(
      <StatusBarProvider>
        <AgentsProvider>{ui}</AgentsProvider>
      </StatusBarProvider>,
    );

  it('publishes and clears slot items', () => {
    wrap(
      <>
        <StatusBar />
        <Probe />
      </>,
    );
    expect(screen.queryByText('job-one')).toBeNull();
    act(() => {
      screen.getByText('pub').click();
    });
    expect(screen.getByText('job-one')).toBeInTheDocument();
    act(() => {
      screen.getByText('clr').click();
    });
    expect(screen.queryByText('job-one')).toBeNull();
  });

  it('auto-clears transient messages', () => {
    vi.useFakeTimers();
    wrap(
      <>
        <StatusBar />
        <Probe />
      </>,
    );
    act(() => {
      screen.getByText('note').click();
    });
    expect(screen.getByText('hello-msg')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('hello-msg')).toBeNull();
  });

  it('shows the default agent slot', async () => {
    render(
      <MemoryRouter>
        <StatusBarProvider>
          <AgentsProvider>
            <StatusBar />
          </AgentsProvider>
        </StatusBarProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Vanilla Commander Default')).toBeInTheDocument();
  });
});
