import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { renderWithProviders as render } from '@/test-utils';
import { BUILTIN_PROFILES } from '@/lib/eval/constants';
import type { LoadedPackRef } from '@/lib/eval/packs/packLoader';
import type { Agent } from '@/lib/types/agent';

vi.mock('@/lib/context/EvalContext', () => ({
  useEval: () => ({
    runs: [],
    packs: mockRefs,
    packErrors: [],
    packsLoading: false,
    profiles: BUILTIN_PROFILES,
    integrationSettings: null,
    activeRunner: null,
    events: [],
    refreshRuns: vi.fn(),
    refreshPacks: vi.fn(),
    createRun: vi.fn(),
    startRun: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    cancelRun: vi.fn(),
    skipCandidate: vi.fn(),
    deleteRun: vi.fn(),
    renameRun: vi.fn(),
    cloneRun: vi.fn(),
  }),
}));

vi.mock('@/lib/context/AgentsContext', () => ({
  useAgents: () => ({ agents: mockAgents, defaultAgent: mockAgents[0], loading: false }),
}));

vi.mock('@/lib/context/WorkspaceTabsContext', () => ({
  useWorkspaceTabs: () => ({
    openTab: vi.fn(),
    closeTab: vi.fn(),
    closeTabs: vi.fn(),
  }),
}));

const mockRefs: LoadedPackRef[] = [
  {
    scope: 'builtin',
    manifest: {
      schemaVersion: '1.0',
      id: 'ko-write-smoke',
      version: '1.0.0',
      title: { ko: '작문', en: 'Writing' },
      description: { ko: 'd', en: 'd' },
      category: 'Q4',
      lang: ['ko'],
      license: { id: 'mit' },
      kind: 'single_turn',
      source: { type: 'generator', generator: 'perf-probe-v1', params: {} },
      useAgentSystemPrompt: false,
      scorers: [],
      metrics: [],
      tiers: { smoke: 5, standard: 20, full: 'all' },
      defaults: { timeoutSec: 60, maxTurns: 4, epochs: 1, circular: false },
      requires: { toolCalling: false, logprobs: false },
      trusted: true,
    },
    contentHash: 'h1',
    diagnostics: [],
  },
];

const mockAgents: Agent[] = [
  {
    id: 'agent-1',
    name: '작문가',
    systemPrompt: 'sys',
    model: 'qwen3:8b',
    temperature: 0.7,
    contextSize: 8192,
    reserveTokens: 1024,
    keepRecentTokens: 2048,
    enabledSkills: [],
    enabledBuiltinTools: [],
    approvalMode: 'dangerous-only',
    llmProvider: 'ollama',
    llmBaseUrl: 'http://127.0.0.1:11434',
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

import { EvalRunWizard } from './EvalRunWizard';
import { MatrixBuilder } from './MatrixBuilder';

describe('EvalRunWizard', () => {
  it('navigates steps and gates the review create button on confirmations', async () => {
    render(<EvalRunWizard />);
    // Step 1: profile
    expect(screen.getByText('평가 프로파일 선택')).toBeInTheDocument();
    fireEvent.click(screen.getByText('다음'));
    // Step 2: packs — quick preset auto-selects the pack
    expect(screen.getByText('평가 크기 선택')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('ko-write-smoke')).toBeChecked();
    });
    fireEvent.click(screen.getByText('다음'));
    // Step 3: candidates — blocked reason until an agent is picked
    expect(screen.getByText('후보 에이전트 선택')).toBeInTheDocument();
    expect(screen.getByTestId('next-blocked')).toHaveTextContent('1개 이상의 후보를 선택하세요.');
    fireEvent.click(screen.getByLabelText('작문가'));
    await waitFor(() => {
      expect(screen.queryByTestId('next-blocked')).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('다음'));
    // Step 4: review — run name suggests agent + profile, create gated on confirmations
    await waitFor(() => {
      expect(screen.getByText('검토 후 실행 생성')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue(/작문가_balanced_/)).toBeInTheDocument();
    const createBtn = screen.getByText('실행 생성');
    expect(createBtn).toBeInTheDocument();
    expect(createBtn.closest('button')).toBeDisabled();
  });

  it('disables future step headers until each step is complete', async () => {
    render(<EvalRunWizard />);
    const headerBtn = (label: string): HTMLButtonElement => {
      const el = screen.getByText(label).closest('button');
      if (!(el instanceof HTMLButtonElement)) throw new Error(`no header button: ${label}`);
      return el;
    };
    // 처음에는 평가셋까지만 갈 수 있다 (프로파일은 항상 완료)
    expect(headerBtn('프로파일').disabled).toBe(false);
    expect(headerBtn('평가셋').disabled).toBe(false);
    expect(headerBtn('후보').disabled).toBe(true);
    expect(headerBtn('검토·생성').disabled).toBe(true);
    // 다음으로 평가셋에 가면 quick이 자동 선택되어 후보 헤더가 열린다
    fireEvent.click(screen.getByText('다음'));
    await waitFor(() => {
      expect(headerBtn('후보').disabled).toBe(false);
    });
    expect(headerBtn('검토·생성').disabled).toBe(true);
    // 후보를 고르면 검토 헤더까지 열린다
    fireEvent.click(screen.getByText('다음'));
    fireEvent.click(screen.getByLabelText('작문가'));
    await waitFor(() => {
      expect(headerBtn('검토·생성').disabled).toBe(false);
    });
  });

  it('offers quick/standard/full sizes with per-pack advanced settings', async () => {
    render(<EvalRunWizard />);
    fireEvent.click(screen.getByText('다음'));
    expect(screen.getByText('Quick')).toBeInTheDocument();
    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.getByText('Full')).toBeInTheDocument();
    // per-pack details live behind the advanced fold
    fireEvent.click(screen.getByText('고급 설정 (문제집별 세부)'));
    expect(screen.getByText('티어')).toBeInTheDocument();
  });
});

describe('MatrixBuilder', () => {
  it('shows the combination count for axes', () => {
    render(
      <MatrixBuilder
        agents={mockAgents}
        baseAgentId="agent-1"
        onBaseChange={() => undefined}
        axes={{ model: ['m1', 'm2'], temperature: [0, 0.7] }}
        onAxesChange={() => undefined}
        onExpand={() => undefined}
      />,
    );
    expect(screen.getByText(/조합 4개 미리보기/)).toBeInTheDocument();
  });

  it('warns when combinations exceed 24', () => {
    const models = Array.from({ length: 5 }, (_, i) => `m${i}`);
    render(
      <MatrixBuilder
        agents={mockAgents}
        baseAgentId="agent-1"
        onBaseChange={() => undefined}
        axes={{ model: models, temperature: [0, 0.5, 0.7, 1, 1.2, 1.5] }}
        onAxesChange={() => undefined}
        onExpand={() => undefined}
      />,
    );
    expect(screen.getByText(/상한/)).toBeInTheDocument();
  });
});
