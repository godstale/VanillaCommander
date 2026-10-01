import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import '@testing-library/jest-dom/vitest';
import { RunLog } from './RunLog';
import type { RunnerEvent } from '@/lib/eval/runner/events';

type LogEvent = Extract<RunnerEvent, { type: 'log' }>;

function log(level: LogEvent['level'], message: string): LogEvent {
  return { type: 'log', level, message };
}

describe('RunLog', () => {
  it('shows empty state without warnings or errors', () => {
    render(<RunLog events={[log('info', 'trial started')]} />);
    expect(screen.getByText('경고 또는 오류 로그가 없습니다.')).toBeInTheDocument();
  });

  it('shows warnings, errors, and skip-related info logs', () => {
    render(
      <RunLog
        events={[
          log('info', 'trial started'),
          log('warn', 'unknown scorer: foo'),
          log('error', 'run failed'),
          log('info', 'candidate skipped by user'),
        ]}
      />,
    );
    expect(screen.queryByText('trial started')).not.toBeInTheDocument();
    expect(screen.getByText('unknown scorer: foo')).toBeInTheDocument();
    expect(screen.getByText('run failed')).toBeInTheDocument();
    expect(screen.getByText('candidate skipped by user')).toBeInTheDocument();
  });

  it('caps visible entries at 200', () => {
    const events = Array.from({ length: 250 }, (_, i) =>
      log('warn', `warning ${i}`),
    );
    render(<RunLog events={events} />);
    expect(screen.queryByText('warning 0')).not.toBeInTheDocument();
    expect(screen.getByText('warning 249')).toBeInTheDocument();
    expect(screen.getAllByText(/warning \d+/)).toHaveLength(200);
  });
});
