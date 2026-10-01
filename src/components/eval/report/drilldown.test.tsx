import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { PackDrilldown } from './PackDrilldown';
import { HumanScoreEditor } from './HumanScoreEditor';
import { CompareRunsDialog } from './CompareRunsDialog';
import { makeCandidate, makeScore, makeTrial } from './fixtures';

vi.mock('@/lib/eval/scorers/human', () => ({
  saveHumanScore: vi.fn(async () => undefined),
}));

vi.mock('@/lib/db/repositories/evalRepo', () => ({
  getRun: vi.fn(async () => null),
  listRuns: vi.fn(async () => []),
  listCandidates: vi.fn(async () => []),
  listTrials: vi.fn(async () => []),
  listScores: vi.fn(async () => []),
  listAggregates: vi.fn(async () => []),
}));

function wrap(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe('PackDrilldown', () => {
  const cands = [makeCandidate('a', 'Alpha')];
  const trials = [
    makeTrial('t1', 'a', { packId: 'pack-a', sampleId: 's1' }),
    makeTrial('t2', 'a', { packId: 'pack-a', sampleId: 's2' }),
  ];
  const scores = [makeScore('s1', 't1', 1), makeScore('s2', 't2', 0)];

  it('expands a pack and selects a sample', () => {
    wrap(<PackDrilldown trials={trials} scores={scores} candidates={cands} />);
    fireEvent.click(screen.getByText('pack-a'));
    expect(screen.getByText('s1')).toBeInTheDocument();
    fireEvent.click(screen.getByText('s1'));
    expect(screen.getByText(/Alpha · pack-a · s1/)).toBeInTheDocument();
    expect(screen.getByText('사람 평가 입력')).toBeInTheDocument();
  });
});

describe('HumanScoreEditor', () => {
  it('saves a human score with verdict and note', async () => {
    const { saveHumanScore } = await import('@/lib/eval/scorers/human');
    const onSaved = vi.fn();
    wrap(<HumanScoreEditor trialId="t1" onSaved={onSaved} />);
    fireEvent.change(screen.getByPlaceholderText('메모'), { target: { value: 'looks good' } });
    fireEvent.click(screen.getByText('저장'));
    await waitFor(() => {
      expect(saveHumanScore).toHaveBeenCalledWith('t1', 'human', 1, 'correct', 'looks good');
    });
    expect(onSaved).toHaveBeenCalled();
  });
});

describe('CompareRunsDialog', () => {
  it('shows empty state when no other runs exist', async () => {
    wrap(
      <CompareRunsDialog open currentRunId="run1" currentAggregates={[]} currentCandidates={[]} onClose={() => undefined} />,
    );
    await waitFor(() => {
      expect(screen.getByText('비교할 다른 실행이 없습니다.')).toBeInTheDocument();
    });
  });
});
