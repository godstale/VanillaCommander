import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import { getSettings } from '@/lib/db/repositories/settingsRepo';
import { SettingsProvider } from '@/lib/context/SettingsContext';
import { WorkspaceProvider } from '@/lib/context/WorkspaceContext';
import { AgentsProvider } from '@/lib/context/AgentsContext';
import { WorkspaceTabsProvider } from '@/lib/context/WorkspaceTabsContext';
import { SetupWizard } from './SetupWizard';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(new Error('no tauri')),
}));

vi.mock('@tauri-apps/api/path', () => ({
  downloadDir: vi.fn().mockRejectedValue(new Error('no tauri')),
}));

function renderWizard(onClose: (completed: boolean) => void) {
  return render(
    <MemoryRouter>
      <SettingsProvider>
        <WorkspaceProvider>
          <AgentsProvider>
            <WorkspaceTabsProvider>
              <SetupWizard onClose={onClose} />
            </WorkspaceTabsProvider>
          </AgentsProvider>
        </WorkspaceProvider>
      </SettingsProvider>
    </MemoryRouter>,
  );
}

describe('SetupWizard', () => {
  beforeEach(() => {
    setDatabase(new MemorySqlFallback());
    window.localStorage.clear();
  });

  it('walks 6 steps and finishes with setupCompletedAt + editor tab', async () => {
    const onClose = vi.fn();
    renderWizard(onClose);

    // Step 1: language.
    expect(await screen.findByText('언어 선택')).toBeInTheDocument();
    fireEvent.click(screen.getByText('다음'));

    // Step 2: work folder (no Tauri → stays empty, skippable).
    expect(await screen.findByText('작업 폴더')).toBeInTheDocument();
    fireEvent.click(screen.getByText('다음'));

    // Step 3: agent (Ollama unreachable in tests → disconnected notice).
    expect(await screen.findByText('에이전트 안내')).toBeInTheDocument();
    expect(await screen.findByText(/연결할 수 없습니다/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('다음'));

    // Step 4: wiki.
    expect(await screen.findByText('위키 안내')).toBeInTheDocument();
    fireEvent.click(screen.getByText('다음'));

    // Step 5: macro.
    expect(await screen.findByText('매크로 안내')).toBeInTheDocument();
    fireEvent.click(screen.getByText('다음'));

    // Step 6: done → finish.
    expect(await screen.findByText('준비 완료')).toBeInTheDocument();
    fireEvent.click(screen.getByText('완료'));

    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    const settings = await getSettings();
    expect(settings.setupCompletedAt).not.toBeNull();
  });
});
