import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import '@testing-library/jest-dom/vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@/lib/context/WorkspaceContext', () => ({
  useSafeWorkspace: () => null,
}));

import { invoke } from '@tauri-apps/api/core';
import { PackEditor } from './PackEditor';

describe('PackEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it('rejects save with an invalid pack id', async () => {
    render(<PackEditor scope="project" packId="" />);
    fireEvent.click(screen.getByText(/저장|Save/));
    await waitFor(() => {
      expect(screen.getByText(/올바르지 않습니다|invalid/)).toBeInTheDocument();
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('saves manifest + samples via packFs.write and flags per-line sample errors', async () => {
    render(<PackEditor scope="project" packId="" />);
    const inputs = screen.getAllByRole('textbox');
    // packId, titleKo, titleEn, descKo, descEn, smoke, standard, full, samples(textarea)
    fireEvent.change(inputs[0], { target: { value: 'my-cases' } });
    fireEvent.change(inputs[1], { target: { value: '내 케이스' } });
    fireEvent.change(inputs[2], { target: { value: 'My cases' } });
    fireEvent.change(inputs[inputs.length - 1], {
      target: {
        value: '{"id":"s1","input":"hello"}\nnot json\n',
      },
    });
    expect(screen.getByText(/줄 2|Line 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/저장|Save/));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        'eval_write_pack_files',
        expect.objectContaining({ scope: 'project', packId: 'my-cases' }),
      );
    });
    expect(screen.getByText(/저장됨|Saved/)).toBeInTheDocument();
  });
});
