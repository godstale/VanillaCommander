import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { WorkspaceTabsProvider } from '@/lib/context/WorkspaceTabsContext';
import { EvalReport } from './EvalReport';
import { makeAgg, makeCandidate, makeScore, makeTrial } from './fixtures';
import type { EvalRunRow } from '@/lib/eval/types';

vi.mock('@/lib/db/repositories/evalRepo', () => ({
  getRun: vi.fn(),
  listRuns: vi.fn(async () => []),
  listCandidates: vi.fn(),
  listAggregates: vi.fn(),
  listTrials: vi.fn(),
  listScores: vi.fn(),
}));

vi.mock('@/lib/db/repositories/agentsRepo', () => ({
  createAgent: vi.fn(async (a: unknown) => a),
}));

vi.mock('@/lib/eval/scorers/human', () => ({
  saveHumanScore: vi.fn(async () => undefined),
}));

import {
  getRun,
  listAggregates,
  listCandidates,
  listScores,
  listTrials,
} from '@/lib/db/repositories/evalRepo';

const cands = [makeCandidate('a', 'Alpha'), makeCandidate('b', 'Beta')];
const aggs = [
  makeAgg('a', 'composite', 'composite', 80, 0.8, 78, 82),
  makeAgg('b', 'composite', 'composite', 79, 0.79, 77, 81),
  ...(['Q', 'A', 'P', 'R', 'S'] as const).flatMap((d, i) => [
    makeAgg('a', 'dimension', d, 70 + i),
    makeAgg('b', 'dimension', d, 68 + i),
  ]),
  makeAgg('a', 'category', 'Q1', 72),
  makeAgg('b', 'category', 'Q1', 70),
];
const trials = [makeTrial('t1', 'a'), makeTrial('t2', 'b')];
const scores = [makeScore('s1', 't1', 1), makeScore('s2', 't2', 0)];

const run = {
  id: 'run1',
  name: 'Test run',
  config: {
    profile: {
      dimensionWeights: { Q: 1, A: 1, P: 1, R: 1, S: 1 },
      categoryWeights: {},
      constraints: [],
    },
  },
  status: 'completed',
} as unknown as EvalRunRow;

function setup() {
  vi.mocked(getRun).mockResolvedValue(run);
  vi.mocked(listCandidates).mockResolvedValue(cands);
  vi.mocked(listAggregates).mockResolvedValue(aggs);
  vi.mocked(listTrials).mockResolvedValue(trials);
  vi.mocked(listScores).mockResolvedValue(scores);
  return render(
    <LanguageProvider>
      <WorkspaceTabsProvider>
        <EvalReport runId="run1" />
      </WorkspaceTabsProvider>
    </LanguageProvider>,
  );
}

describe('EvalReport', () => {
  it('loads and renders all sections', async () => {
    setup();
    await waitFor(() => {
      expect(screen.getByText('Test run')).toBeInTheDocument();
    });
    expect(screen.getByText('순위표')).toBeInTheDocument();
    expect(screen.getByText('차원별 레이더')).toBeInTheDocument();
    expect(screen.getByText('파레토 (성능 vs 품질)')).toBeInTheDocument();
    expect(screen.getByText('카테고리 히트맵')).toBeInTheDocument();
    expect(screen.getByText('컨텍스트 곡선')).toBeInTheDocument();
    expect(screen.getByText('팩 드릴다운')).toBeInTheDocument();
    expect(screen.getByText('양자화 충실도')).toBeInTheDocument();
  });

  it('toggles raw vs normalized display', async () => {
    setup();
    await waitFor(() => {
      expect(screen.getByText('Test run')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('원시값'));
    expect(screen.getAllByText(/0\.8/).length).toBeGreaterThan(0);
  });

  it('shows run-missing state for unknown runs', async () => {
    vi.mocked(getRun).mockResolvedValue(null);
    render(
      <LanguageProvider>
        <WorkspaceTabsProvider>
          <EvalReport runId="missing" />
        </WorkspaceTabsProvider>
      </LanguageProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('실행을 찾을 수 없습니다.')).toBeInTheDocument();
    });
  });
});
