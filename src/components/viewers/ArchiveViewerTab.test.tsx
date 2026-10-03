import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { AgentsProvider } from '@/lib/context/AgentsContext';
import { JobsProvider } from '@/lib/commander/jobs';
import { StatusBarProvider } from '@/lib/context/StatusBarContext';
import { ArchiveViewerTab } from './ArchiveViewerTab';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';

vi.mock('@/lib/commander/ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commander/ipc')>();
  return {
    ...actual,
    fcArchiveList: vi.fn(async () => [
      { name: 'docs/', size: 0, is_dir: true },
      { name: 'docs/readme.txt', size: 42, is_dir: false },
    ]),
    fcOpenDefault: vi.fn(async () => {}),
    fcUnzip: vi.fn(async () => 'job-1'),
  };
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const TAB: WorkspaceTab = {
  id: 'archive:C:/d/a.zip',
  type: 'archive-viewer',
  title: 'a.zip',
  meta: { filePath: 'C:/d/a.zip' },
};

describe('ArchiveViewerTab', () => {
  it('lists archive entries', async () => {
    render(
      <MemoryRouter>
        <AgentsProvider>
          <JobsProvider>
            <StatusBarProvider>
              <ArchiveViewerTab tab={TAB} />
            </StatusBarProvider>
          </JobsProvider>
        </AgentsProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('docs/readme.txt')).toBeInTheDocument();
    expect(screen.getByText('42 B')).toBeInTheDocument();
  });
});
