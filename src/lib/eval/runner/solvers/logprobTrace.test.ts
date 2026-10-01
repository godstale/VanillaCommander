import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ResolvedLlmRuntime } from '@/lib/llm/providers';
import type { CandidateSnapshot, EvalSample } from '../../types';
import type { LoadedPack } from '../../packs/packLoader';
import type { LogprobTrace } from '../../logprobs/client';
import { getSolver, type SolverContext } from './index';
import {
  analyzeQuantPair,
  isSameBaseModel,
  LOGPROB_TRACE_NUM_PREDICT,
  LOGPROB_TRACE_TOP_LOGPROBS,
  logprobTraceSolver,
  registerLogprobTraceSolver,
} from './logprobTrace';

vi.mock('../../logprobs/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../logprobs/client')>();
  return { ...mod, requestLogprobs: vi.fn() };
});

const { requestLogprobs } = await import('../../logprobs/client');
const requestMock = vi.mocked(requestLogprobs);

const demoTrace: LogprobTrace = {
  tokens: ['A'],
  topLogprobs: [[{ token: 'A', logprob: -0.1 }]],
  promptEvalCount: 7,
};

function ctx(): SolverContext {
  const candidate = { model: 'qwen3:8b', seed: 42 } as unknown as CandidateSnapshot;
  const pack = {
    manifest: {
      useAgentSystemPrompt: false,
      systemPrompt: 'sys',
      fewshot: [],
    },
    samples: [],
  } as unknown as LoadedPack;
  const sample = { id: 's1', input: 'Pick A or B.' } as unknown as EvalSample;
  return {
    runId: 'run-1',
    candidate,
    runtime: { baseUrl: 'http://127.0.0.1:11434' } as unknown as ResolvedLlmRuntime,
    pack,
    sample,
    epoch: 0,
    rotation: 0,
    streamChat: (() => {
      throw new Error('not used');
    }) as unknown as SolverContext['streamChat'],
    signal: new AbortController().signal,
    timeoutMs: 60_000,
    sampler: {} as unknown as SolverContext['sampler'],
    emit: () => undefined,
  };
}

beforeEach(() => {
  requestMock.mockReset();
});

describe('logprobTraceSolver', () => {
  it('stores the trace and decodes outputText from tokens', async () => {
    requestMock.mockResolvedValue(demoTrace);
    const r = await logprobTraceSolver(ctx());
    expect(r.outcome).toBe('ok');
    expect(r.outputText).toBe('A');
    expect(r.extra?.['logprobTrace']).toMatchObject({
      tokens: ['A'],
      promptEvalCount: 7,
    });
    expect(r.usage).toMatchObject({ input: 7, output: 1 });
    expect(requestMock).toHaveBeenCalledTimes(1);
    const arg = requestMock.mock.calls[0]?.[0];
    expect(arg).toMatchObject({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen3:8b',
      numPredict: LOGPROB_TRACE_NUM_PREDICT,
      topLogprobs: LOGPROB_TRACE_TOP_LOGPROBS,
      temperature: 0,
      seed: 42,
    });
    expect(LOGPROB_TRACE_NUM_PREDICT).toBe(256);
    expect(LOGPROB_TRACE_TOP_LOGPROBS).toBe(20);
  });
  it('maps unsupported providers to skipped_unsupported (N/A)', async () => {
    requestMock.mockRejectedValue(new Error('logprobs unsupported'));
    const r = await logprobTraceSolver(ctx());
    expect(r.outcome).toBe('skipped_unsupported');
    expect(r.extra).toMatchObject({ logprobUnsupported: true });
  });
  it('rethrows other provider errors', async () => {
    requestMock.mockRejectedValue(new Error('boom'));
    await expect(logprobTraceSolver(ctx())).rejects.toThrow('boom');
  });
  it('registers under logprob_trace', () => {
    registerLogprobTraceSolver();
    expect(getSolver('logprob_trace')).toBe(logprobTraceSolver);
  });
});

describe('analyzeQuantPair', () => {
  it('delegates to the fidelity math', () => {
    const r = analyzeQuantPair(demoTrace, {
      tokens: ['B'],
      topLogprobs: [[{ token: 'B', logprob: -0.2 }]],
    });
    expect(r.divergencePos).toBe(0);
    expect(r.meanKld).toBeNull();
    expect(r.top1Agreement).toBe(0);
    expect(r.positions).toBe(1);
  });
});

describe('isSameBaseModel', () => {
  it('matches on family + parameter_size, ignoring quantization', () => {
    expect(
      isSameBaseModel(
        { family: 'qwen3', parameter_size: '8.2B' },
        { family: 'Qwen3', parameterSize: '8.2B' },
      ),
    ).toBe(true);
  });
  it('rejects different family or size', () => {
    expect(isSameBaseModel({ family: 'qwen3', parameter_size: '8B' }, { family: 'llama', parameter_size: '8B' })).toBe(false);
    expect(isSameBaseModel({ family: 'qwen3', parameter_size: '8B' }, { family: 'qwen3', parameter_size: '14B' })).toBe(false);
    expect(isSameBaseModel({ family: '', parameter_size: '8B' }, { family: '', parameter_size: '8B' })).toBe(false);
  });
});
