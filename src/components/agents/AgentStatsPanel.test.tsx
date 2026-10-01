import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import '@testing-library/jest-dom/vitest';
import { AgentStatsPanel } from './AgentStatsPanel';

// Mock sessionsRepo & entriesRepo
vi.mock('@/lib/db/repositories/sessionsRepo', () => ({
  listSessions: vi.fn().mockResolvedValue([
    { id: 'sess-1', agentId: 'agent-1', title: 'Analysis Session' },
    { id: 'sess-2', agentId: 'agent-2', title: 'Other Session' },
  ]),
}));

vi.mock('@/lib/db/repositories/entriesRepo', () => ({
  getEntries: vi.fn().mockResolvedValue([
    { id: 'e-1', type: 'message' },
    { id: 'e-2', type: 'message' },
    { id: 'e-3', type: 'custom' },
  ]),
}));

// Mock ResponsiveContainer
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="stats-chart" style={{ width: 400, height: 200 }}>
        {children}
      </div>
    ),
  };
});

describe('AgentStatsPanel', () => {
  it('renders aggregated metrics and chart for agent with sessions', async () => {
    render(<AgentStatsPanel agentId="agent-1" />);

    await waitFor(() => {
      expect(screen.getByText('총 대화 세션')).toBeInTheDocument();
      expect(screen.getByText('1회')).toBeInTheDocument();
      expect(screen.getByText('총 메시지 교환')).toBeInTheDocument();
      expect(screen.getByText('2건')).toBeInTheDocument();
      expect(screen.getByTestId('stats-chart')).toBeInTheDocument();
    });
  });

  it('renders empty message for agent with no sessions', async () => {
    render(<AgentStatsPanel agentId="agent-non-existent" />);

    await waitFor(() => {
      expect(
        screen.getByText('아직 이 에이전트로 진행된 대화 세션이 없습니다.'),
      ).toBeInTheDocument();
    });
  });
});
