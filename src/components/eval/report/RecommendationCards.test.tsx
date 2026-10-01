import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { WorkspaceTabsProvider } from '@/lib/context/WorkspaceTabsContext';
import { RecommendationCards } from './RecommendationCards';
import { makeAgg, makeCandidate } from './fixtures';
import type { Recommendation } from '@/lib/eval/scoring/recommend';

vi.mock('@/lib/db/repositories/agentsRepo', () => ({
  createAgent: vi.fn(async (a: unknown) => a),
}));

const cands = [makeCandidate('a', 'Alpha'), makeCandidate('b', 'Beta')];
const aggs = [
  makeAgg('a', 'composite', 'composite', 80),
  makeAgg('b', 'composite', 'composite', 79),
  makeAgg('a', 'dimension', 'Q', 70),
  makeAgg('a', 'dimension', 'A', 80),
  makeAgg('a', 'dimension', 'P', 60),
  makeAgg('b', 'dimension', 'Q', 72),
  makeAgg('b', 'dimension', 'A', 82),
  makeAgg('b', 'dimension', 'P', 75),
];

const rec: Recommendation = {
  eligible: ['a', 'b'],
  violations: { a: [], b: [] },
  pareto: ['a', 'b'],
  picks: { best: 'a', fast: 'b', quality: 'b' },
  groups: [['a'], ['b']],
};

describe('RecommendationCards', () => {
  it('renders reason sentences for best/fast/quality picks', () => {
    render(
      <LanguageProvider>
        <WorkspaceTabsProvider>
          <RecommendationCards candidates={cands} aggregates={aggs} recommendation={rec} />
        </WorkspaceTabsProvider>
      </LanguageProvider>,
    );
    expect(screen.getByText('종합 1위')).toBeInTheDocument();
    expect(screen.getByText('빠른 대안')).toBeInTheDocument();
    expect(screen.getByText(/Alpha.*종합 점수/)).toBeInTheDocument();
    expect(screen.getAllByText('이 설정으로 에이전트 만들기').length).toBeGreaterThan(0);
  });

  it('creates an agent and opens the editor tab', async () => {
    const { createAgent } = await import('@/lib/db/repositories/agentsRepo');
    render(
      <LanguageProvider>
        <WorkspaceTabsProvider>
          <RecommendationCards candidates={cands} aggregates={aggs} recommendation={rec} />
        </WorkspaceTabsProvider>
      </LanguageProvider>,
    );
    fireEvent.click(screen.getAllByText('이 설정으로 에이전트 만들기')[0]);
    await waitFor(() => {
      expect(createAgent).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText('에이전트를 만들고 편집 탭을 열었습니다.')).toBeInTheDocument();
    });
  });

  it('shows ineligible state when nobody passes constraints', () => {
    render(
      <LanguageProvider>
        <WorkspaceTabsProvider>
          <RecommendationCards
            candidates={cands}
            aggregates={aggs}
            recommendation={{ ...rec, eligible: [], picks: {} }}
          />
        </WorkspaceTabsProvider>
      </LanguageProvider>,
    );
    expect(screen.getByText('제약 조건을 만족하는 후보가 없습니다.')).toBeInTheDocument();
  });
});
