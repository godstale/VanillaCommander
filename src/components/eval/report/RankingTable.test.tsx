import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { RankingTable } from './RankingTable';
import { makeAgg, makeCandidate } from './fixtures';

const cands = [makeCandidate('a', 'Alpha'), makeCandidate('b', 'Beta')];
const aggs = [
  makeAgg('a', 'composite', 'composite', 80, 0.8, 78, 82),
  makeAgg('b', 'composite', 'composite', 79, 0.79, 77, 81),
  ...(['Q', 'A', 'P', 'R', 'S'] as const).flatMap((d, i) => [
    makeAgg('a', 'dimension', d, 70 + i),
    makeAgg('b', 'dimension', d, 68 + i),
  ]),
];

function renderTable(props?: Partial<Parameters<typeof RankingTable>[0]>) {
  return render(
    <LanguageProvider>
      <RankingTable
        candidates={cands}
        aggregates={aggs}
        groups={[['a', 'b']]}
        violations={{ a: [], b: [{ metric: 'P1', op: '>=', value: 50, actual: 10 }] }}
        mode="normalized"
        {...props}
      />
    </LanguageProvider>,
  );
}

describe('RankingTable', () => {
  it('renders candidates with composite and CI', () => {
    renderTable();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText(/80\.0/)).toBeInTheDocument();
    expect(screen.getByText(/78\.0–82\.0/)).toBeInTheDocument();
  });

  it('shows constraint badges with tooltips', () => {
    renderTable();
    expect(screen.getByText('통과')).toBeInTheDocument();
    const badge = screen.getByText('1건 위반');
    expect(badge).toBeInTheDocument();
    expect(badge.getAttribute('title')).toContain('P1');
  });

  it('raw mode falls back to raw values', () => {
    renderTable({ mode: 'raw' });
    expect(screen.getAllByText(/0\.8/).length).toBeGreaterThan(0);
  });
});
