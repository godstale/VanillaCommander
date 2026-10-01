import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import '@testing-library/jest-dom/vitest';
import { CompactionBanner } from './CompactionBanner';

describe('CompactionBanner component', () => {
  it('renders summary banner with token reduction and toggles expanded view', () => {
    render(
      <CompactionBanner
        summary={`## Goal

Complete refactoring

## Progress
### Done
- Modularized code`}
        tokensBefore={4000}
        tokensAfter={1200}
        reason="threshold"
      />,
    );

    expect(screen.getByText(/대화 기록이 요약되었습니다/)).toBeInTheDocument();
    expect(screen.getByText(/\(4,000 → 1,200 토큰\)/)).toBeInTheDocument();
    expect(screen.getByText('자동 요약')).toBeInTheDocument();

    // Summary content should initially be collapsed
    expect(screen.queryByText('Complete refactoring')).not.toBeInTheDocument();

    // Click to expand
    const toggleButton = screen.getByRole('button', { name: /요약 보기/ });
    fireEvent.click(toggleButton);

    expect(screen.getByText('Complete refactoring')).toBeInTheDocument();

    // Click to collapse
    const collapseButton = screen.getByRole('button', { name: /요약 접기/ });
    fireEvent.click(collapseButton);

    expect(screen.queryByText('Complete refactoring')).not.toBeInTheDocument();
  });
});
