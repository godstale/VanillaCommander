import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import '@testing-library/jest-dom/vitest';
import { ResourceMiniChart } from './ResourceMiniChart';

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="chart-container">{children}</div>
    ),
  };
});

describe('ResourceMiniChart', () => {
  it('shows empty state without points', () => {
    render(<ResourceMiniChart points={[]} now={Date.now()} />);
    expect(
      screen.getByText('최근 120초 동안 수집된 리소스 데이터가 없습니다.'),
    ).toBeInTheDocument();
  });

  it('ignores points older than 120s', () => {
    const now = Date.now();
    render(
      <ResourceMiniChart
        now={now}
        points={[
          { t: now - 600_000, decodeTps: 10, vramUsedMb: 100, gpuUtilPct: 20 },
        ]}
      />,
    );
    expect(
      screen.getByText('최근 120초 동안 수집된 리소스 데이터가 없습니다.'),
    ).toBeInTheDocument();
  });

  it('renders a chart for recent points', () => {
    const now = Date.now();
    render(
      <ResourceMiniChart
        now={now}
        points={[
          { t: now - 1000, decodeTps: 42, vramUsedMb: 8000, gpuUtilPct: 55 },
          { t: now, decodeTps: null, vramUsedMb: null, gpuUtilPct: null },
        ]}
      />,
    );
    expect(screen.getByTestId('chart-container')).toBeInTheDocument();
  });
});
