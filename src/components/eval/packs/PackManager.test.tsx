import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import '@testing-library/jest-dom/vitest';
import type { LoadedPackRef } from '@/lib/eval/packs/packLoader';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const { mockRefreshPacks } = vi.hoisted(() => ({ mockRefreshPacks: vi.fn() }));

vi.mock('@/lib/context/EvalContext', () => ({
  useEval: () => ({ packs: mockPacks(), packErrors: [], packsLoading: false, refreshPacks: mockRefreshPacks }),
}));

vi.mock('@/lib/context/WorkspaceContext', () => ({
  useSafeWorkspace: () => null,
}));

function ref(id: string, scope: 'builtin' | 'user' | 'project'): LoadedPackRef {
  return {
    scope,
    manifest: {
      schemaVersion: '1.0',
      id,
      version: '1.0.0',
      title: { ko: `${id} 제목`, en: `${id} title` },
      description: { ko: '설명', en: 'desc' },
      category: 'Q9',
      lang: ['ko'],
      license: { id: scope === 'builtin' ? 'bundled' : 'personal' },
      kind: 'single_turn',
      source: { type: 'jsonl', file: 'samples.jsonl' },
      useAgentSystemPrompt: false,
      scorers: [],
      metrics: [],
      tiers: { smoke: 1, standard: 2, full: 'all' },
      defaults: { timeoutSec: 180, maxTurns: 12, epochs: 1, circular: false },
      requires: { toolCalling: false, logprobs: false },
      trusted: scope === 'builtin',
    },
    contentHash: 'abc',
    diagnostics: [],
  };
}

function mockPacks(): LoadedPackRef[] {
  return [ref('builtin-pack', 'builtin'), ref('my-cases', 'project'), ref('global-pack', 'user')];
}

import { PackManager } from './PackManager';

describe('PackManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders scope groups with badges and license display', () => {
    render(<PackManager />);
    expect(screen.getByText('builtin-pack')).toBeInTheDocument();
    expect(screen.getByText('my-cases')).toBeInTheDocument();
    expect(screen.getByText(/bundled/)).toBeInTheDocument();
  });

  it('filters packs by search query', () => {
    render(<PackManager />);
    fireEvent.change(screen.getByPlaceholderText(/팩 검색|Search packs/), {
      target: { value: 'my-cases' },
    });
    expect(screen.getByText('my-cases')).toBeInTheDocument();
    expect(screen.queryByText('builtin-pack')).not.toBeInTheDocument();
  });

  it('surfaces load failures from validate-all as error diagnostics', async () => {
    const tauri = await import('@tauri-apps/api/core');
    vi.mocked(tauri.invoke).mockRejectedValue(new Error('read failed'));
    render(<PackManager />);
    fireEvent.click(screen.getByText(/전체 검증|Validate all/));
    await waitFor(() => {
      expect(screen.getAllByText(/read failed/).length).toBeGreaterThan(0);
    });
  });
});
