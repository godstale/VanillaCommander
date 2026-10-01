import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import '@testing-library/jest-dom/vitest';
import { useEval } from '@/lib/context/EvalContext';
import {
  getRun,
  listAggregates,
  listCandidates,
  listScores,
  listTrials,
} from '@/lib/db/repositories/evalRepo';
import type { RunnerEvent } from '@/lib/eval/runner/events';
import type {
  EvalCandidateRow,
  EvalRunRow,
  EvalScoreRow,
  EvalTrialRow,
} from '@/lib/eval/types';
import { EvalRunProgress } from './EvalRunProgress';

vi.mock('@/lib/context/EvalContext', () => ({
  useEval: vi.fn(),
}));

vi.mock('@/lib/db/repositories/evalRepo', () => ({
  getRun: vi.fn(),
  listAggregates: vi.fn(),
  listCandidates: vi.fn(),
  listTrials: vi.fn(),
  listScores: vi.fn(),
}));

vi.mock('@/lib/eval/packs/packLoader', () => ({
  loadPack: vi.fn().mockRejectedValue(new Error('no tauri in tests')),
}));

vi.mock('@/lib/eval/packs/packFs', () => ({
  tauriPackFs: {},
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === 'eval_read_run_log') {
      return {
        text: '{"v":1,"ts":"2026-09-27T00:00:00.000Z","runId":"run-1","kind":"log","level":"warn","message":"persisted warning"}\n',
        truncated: false,
      };
    }
    throw new Error('no tauri in tests');
  }),
}));

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="chart-container">{children}</div>
    ),
  };
});

const mockedUseEval = vi.mocked(useEval);
const mockedGetRun = vi.mocked(getRun);
const mockedListAggregates = vi.mocked(listAggregates);
const mockedListCandidates = vi.mocked(listCandidates);
const mockedListTrials = vi.mocked(listTrials);
const mockedListScores = vi.mocked(listScores);

function makeRun(over: Record<string, unknown> = {}): EvalRunRow {
  return {
    id: 'run-1',
    name: 'run one',
    config: {
      packs: [{ packId: 'pack-x', sampleIds: ['s1', 's2'], epochs: 1 }],
      judge: null,
      profile: { id: 'balanced', name: { ko: '균형', en: 'Balanced' } },
      candidates: [{ label: 'model-a', provider: 'ollama', model: 'model-a' }],
      options: {
        deterministicMode: true,
        reliabilityEpochs: 3,
        timeoutMultiplier: 1,
        perfRepeats: 1,
        unloadBetweenCandidates: false,
        sampleOrderSeed: 42,
      },
    },
    hardware: {
      gpuName: 'Test GPU',
      vramTotalMb: 12288,
      isNvidia: true,
      ramTotalMb: 32768,
      os: 'test-os',
      appVersion: '0.1.0',
      providerVersions: { ollama: '0.9.0' },
    },
    status: 'running',
    error: null,
    progressDone: 1,
    progressTotal: 4,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    finishedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  } as unknown as EvalRunRow;
}

function makeCandidate(): EvalCandidateRow {
  return { id: 'c1', runId: 'run-1', label: 'model-a', status: 'running', snapshot: { model: 'model-a' } } as unknown as EvalCandidateRow;
}

function makeTrial(): EvalTrialRow {
  return {
    id: 't1',
    runId: 'run-1',
    candidateId: 'c1',
    packId: 'pack-x',
    sampleId: 's1',
    epoch: 0,
    outcome: 'ok',
    turns: 3,
    toolCalls: 2,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  } as unknown as EvalTrialRow;
}

function makeScore(): EvalScoreRow {
  return { id: 'sc1', trialId: 't1', value: 1 } as unknown as EvalScoreRow;
}

const baseControls = {
  runs: [],
  packs: [],
  packErrors: [],
  packsLoading: false,
  pausePending: false,
  pauseRun: vi.fn(),
  resumeRun: vi.fn(),
  cancelRun: vi.fn(),
  skipCandidate: vi.fn(),
};

function setup(opts: {
  status?: string;
  active?: boolean;
  events?: RunnerEvent[];
  runOver?: Record<string, unknown>;
  pausePending?: boolean;
  aggregates?: Array<Record<string, unknown>>;
}) {
  const status = opts.status ?? 'running';
  mockedGetRun.mockResolvedValue(makeRun({ status, ...(opts.runOver ?? {}) }));
  mockedListAggregates.mockResolvedValue((opts.aggregates ?? []) as never);
  mockedListCandidates.mockResolvedValue([makeCandidate()]);
  mockedListTrials.mockResolvedValue([makeTrial()]);
  mockedListScores.mockResolvedValue([makeScore()]);
  mockedUseEval.mockReturnValue({
    ...baseControls,
    pausePending: opts.pausePending ?? false,
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    cancelRun: vi.fn(),
    skipCandidate: vi.fn(),
    activeRunner: opts.active === false ? null : { runId: 'run-1', status, done: 1, total: 4 },
    events: opts.events ?? [],
  } as unknown as ReturnType<typeof useEval>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EvalRunProgress', () => {
  it('renders header, progress, matrix, and pause note for a running run', async () => {
    const events: RunnerEvent[] = [
      { type: 'trial_start', candidateId: 'c1', packId: 'pack-x', sampleId: 's1', epoch: 0 },
      { type: 'trial_delta', candidateId: 'c1', packId: 'pack-x', sampleId: 's1', text: 'hello' },
      { type: 'eta', remainingSec: 90 },
      { type: 'resource', vramUsedMb: 8000, gpuUtilPct: 55, gpuTempC: 60, decodeTps: 42 },
      { type: 'log', level: 'warn', message: 'unknown scorer: foo' },
    ];
    setup({ events });
    render(<EvalRunProgress runId="run-1" />);

    expect(await screen.findByText('run one')).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 4 trials/)).toBeInTheDocument();
    expect(screen.getByText(/일시정지는 현재 trial이 끝난 뒤/)).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('unknown scorer: foo')).toBeInTheDocument();
    expect(screen.getByText('100.0%')).toBeInTheDocument();
    expect(screen.getByText(/테스트 대상/)).toBeInTheDocument();
    expect(screen.getByText(/남은 시간/)).toBeInTheDocument();
  });

  it('wires pause, skip, and two-step cancel controls', async () => {
    setup({});
    render(<EvalRunProgress runId="run-1" />);
    await screen.findByText('run one');

    fireEvent.click(screen.getByText('일시정지'));
    fireEvent.click(screen.getByText('후보 건너뛰기'));
    const ctx = mockedUseEval.mock.results[0].value as ReturnType<typeof useEval>;
    expect(ctx.pauseRun).toHaveBeenCalledTimes(1);
    expect(ctx.skipCandidate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('중단'));
    fireEvent.click(screen.getByText('중단하기'));
    expect(ctx.cancelRun).toHaveBeenCalledTimes(1);
  });

  it('shows resume control when paused', async () => {
    setup({ status: 'paused' });
    render(<EvalRunProgress runId="run-1" />);
    expect(await screen.findByText('재개')).toBeInTheDocument();
    expect(screen.queryByText('일시정지')).not.toBeInTheDocument();
  });

  it('shows pause-pending state after pause is requested', async () => {
    setup({ pausePending: true });
    render(<EvalRunProgress runId="run-1" />);
    const pending = await screen.findAllByText(/일시정지 대기 중/);
    expect(pending.length).toBeGreaterThanOrEqual(2);
    const pauseBtn = screen.getByRole('button', { name: /일시정지 대기 중/ });
    expect(pauseBtn).toBeDisabled();
  });

  it('shows completion notice with disabled report placeholder when completed', async () => {
    setup({ status: 'completed', active: false });
    render(<EvalRunProgress runId="run-1" />);
    await screen.findByText(/실행이 완료되었습니다/);
    const reportBtn = screen.getByText('리포트 보기');
    expect(reportBtn).toBeDisabled();
    expect(reportBtn).toHaveAttribute('data-future-view', 'report');
    expect(screen.queryByText('일시정지')).not.toBeInTheDocument();
  });

  it('falls back to time-based ETA estimate without eta events', async () => {
    setup({});
    render(<EvalRunProgress runId="run-1" />);
    await screen.findByText('run one');
    expect(screen.getByText(/남은 시간/)).toBeInTheDocument();
    expect(screen.queryByText('계산 중…')).not.toBeInTheDocument();
  });

  it('shows environment, per-candidate results, and the persisted log file', async () => {
    setup({});
    render(<EvalRunProgress runId="run-1" />);
    await screen.findByText('run one');
    expect(screen.getByText('실행 환경')).toBeInTheDocument();
    // Shown both in the environment card and the offload card header.
    expect(screen.getAllByText('Test GPU').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('평가 모니터링')).toBeInTheDocument();
    // Monitoring-style per-candidate cards replace the old text-only summary.
    expect(screen.getByText('CPU/GPU 오프로딩')).toBeInTheDocument();
    expect(screen.getByText('메모리 분배')).toBeInTheDocument();
    expect(screen.getByText(/GPU .* VRAM 추이/)).toBeInTheDocument();
    expect(screen.getByText('GPU 오프로딩 비율')).toBeInTheDocument();
    expect(screen.getByText('GPU VRAM')).toBeInTheDocument();
    expect(screen.getByText('시스템 RAM')).toBeInTheDocument();
    expect(screen.getByText('단위: GB')).toBeInTheDocument();
    expect(screen.getByText('토큰 정보')).toBeInTheDocument();
    expect(screen.getByText('모델 아키텍처')).toBeInTheDocument();
    // Architecture detail tiles mirror the monitor screen.
    expect(screen.getByText('아키텍처')).toBeInTheDocument();
    expect(screen.getByText('레이어 수')).toBeInTheDocument();
    expect(screen.getByText('임베딩 차원')).toBeInTheDocument();
    expect(screen.getByText('어텐션 헤드')).toBeInTheDocument();
    expect(screen.getByText('KV 헤드')).toBeInTheDocument();
    expect(screen.getByText('FFN 차원')).toBeInTheDocument();
    // Token tiles mirror the monitor screen.
    expect(screen.getByText('입력')).toBeInTheDocument();
    expect(screen.getByText('출력')).toBeInTheDocument();
    expect(screen.getByText('사고')).toBeInTheDocument();
    expect(screen.getByText('전체')).toBeInTheDocument();
    expect(screen.getByText(/progress\.jsonl/)).toBeInTheDocument();
    // Persisted file log merges with live events.
    expect(await screen.findByText('persisted warning')).toBeInTheDocument();
    expect(screen.getByText('로그 다운로드')).toBeInTheDocument();
  });

  it('shows the composite score once aggregates exist', async () => {
    setup({
      status: 'completed',
      active: false,
      aggregates: [
        { candidateId: 'c1', level: 'composite', key: 'composite', raw: 82.5, normalized: 82.5 },
      ],
    });
    render(<EvalRunProgress runId="run-1" />);
    expect(await screen.findByText(/종합 82\.5/)).toBeInTheDocument();
  });
});
