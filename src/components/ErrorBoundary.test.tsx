import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ErrorBoundary } from './ErrorBoundary';

const ProblemChild = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test explosion in child component');
  }
  return <div>Normal Content</div>;
};

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // Suppress console.error in vitest output for expected error
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Normal Content')).toBeInTheDocument();
  });

  it('renders fallback error screen when error is thrown', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('예기치 않은 문제가 발생했습니다')).toBeInTheDocument();
    expect(screen.getByText('Test explosion in child component')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /다시 시도/i })).toBeInTheDocument();
  });

  it('toggles stack details view', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    const toggleBtn = screen.getByText('기술 상세 정보 (스택 추적)');
    fireEvent.click(toggleBtn);

    expect(screen.getByText(/ProblemChild/)).toBeInTheDocument();
  });
});
