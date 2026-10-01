import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { WorkspaceTabsProvider } from '@/lib/context/WorkspaceTabsContext';
import { QuantFidelityTable } from './QuantFidelityTable';
import { CategoryHeatmap } from './CategoryHeatmap';
import { DimensionRadar } from './DimensionRadar';
import { ParetoScatter } from './ParetoScatter';
import { ContextCurveChart } from './ContextCurveChart';
import { makeAgg, makeCandidate, makeScore, makeTrial } from './fixtures';

vi.mock('@/lib/db/repositories/agentsRepo', () => ({
  createAgent: vi.fn(async (a: { id: string }) => a),
}));

const cands = [makeCandidate('a', 'Alpha'), makeCandidate('b', 'Beta')];
const aggs = [
  makeAgg('a', 'composite', 'composite', 80),
  makeAgg('b', 'composite', 'composite', 79),
  ...(['Q', 'A', 'P', 'R', 'S'] as const).flatMap((d, i) => [
    makeAgg('a', 'dimension', d, 70 + i),
    makeAgg('b', 'dimension', d, 68 + i),
  ]),
  makeAgg('a', 'category', 'Q1', 72),
  makeAgg('b', 'category', 'Q1', 70),
];

function wrap(ui: React.ReactElement) {
  return render(
    <LanguageProvider>
      <WorkspaceTabsProvider>{ui}</WorkspaceTabsProvider>
    </LanguageProvider>,
  );
}

describe('QuantFidelityTable', () => {
  it('shows empty state without quant metrics', () => {
    wrap(<QuantFidelityTable candidates={cands} aggregates={aggs} />);
    expect(screen.getByText('양자화 충실도 데이터가 없습니다.')).toBeInTheDocument();
  });

  it('renders mean_kld/top1_agreement/divergence columns when present', () => {
    const withQuant = [
      ...aggs,
      makeAgg('a', 'metric', '@all:mean_kld', 0.05, 0.05),
      makeAgg('a', 'metric', '@all:top1_agreement', 0.9, 0.9),
      makeAgg('a', 'metric', '@all:divergence_pos_median', 42, 42),
    ];
    wrap(<QuantFidelityTable candidates={cands} aggregates={withQuant} />);
    expect(screen.getByText('평균 KLD')).toBeInTheDocument();
    expect(screen.getByText('0.050')).toBeInTheDocument();
  });
});

describe('CategoryHeatmap', () => {
  it('renders category columns and values', () => {
    wrap(<CategoryHeatmap candidates={cands} aggregates={aggs} mode="normalized" />);
    expect(screen.getByText('Q1')).toBeInTheDocument();
    expect(screen.getByText('72.0')).toBeInTheDocument();
  });
});

describe('DimensionRadar', () => {
  it('renders candidate toggles and radar', () => {
    wrap(<DimensionRadar candidates={cands} aggregates={aggs} />);
    expect(screen.getByRole('button', { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Beta/ })).toBeInTheDocument();
  });
});

describe('ParetoScatter', () => {
  it('renders chart labels', () => {
    const trials = [makeTrial('t1', 'a'), makeTrial('t2', 'b')];
    wrap(<ParetoScatter candidates={cands} aggregates={aggs} trials={trials} pareto={['a', 'b']} />);
    expect(screen.getByText(/파레토 경계/)).toBeInTheDocument();
  });
});

describe('ContextCurveChart', () => {
  it('shows empty state without token data', () => {
    wrap(<ContextCurveChart trials={[]} scores={[]} />);
    expect(screen.getByText('컨텍스트 곡선을 그릴 데이터가 없습니다.')).toBeInTheDocument();
  });

  it('renders accuracy curve with token data', () => {
    const trials = [
      makeTrial('t1', 'a', { inputTokens: 1000 }),
      makeTrial('t2', 'a', { inputTokens: 9000 }),
    ];
    const scores = [makeScore('s1', 't1', 1), makeScore('s2', 't2', 0)];
    const { container } = wrap(<ContextCurveChart trials={trials} scores={scores} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
