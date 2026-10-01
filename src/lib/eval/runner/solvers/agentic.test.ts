import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { LlmChunk, LlmStreamChatFn } from '@/lib/llm/providerRuntime';
import { OllamaContextOverflowError } from '@/lib/llm/ollamaClient';
import type { ResolvedLlmRuntime } from '@/lib/llm/providers';
import type { ResourceSampler } from '@/lib/eval/runner/resourceSampler';
import type { CandidateSnapshot, EvalPackManifest, EvalSample, TrialOutcome } from '@/lib/eval/types';
import type { LoadedPack } from '@/lib/eval/packs/packLoader';
import type { EvalSnapshotEntry } from '@/lib/eval/ipc';
import { agenticSolver, registerAgenticSolver } from './agentic';
import { getSolver } from './index';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const SANDBOX = '/tmp/eval-sb-test';

let snapshotQueue: EvalSnapshotEntry[][];
let destroyed: string[];

function entry(path: string, content: string | null): EvalSnapshotEntry {
  return {
    path,
    size: content === null ? 10 : content.length,
    is_text: content !== null,
    content,
    modified_ms: 1,
  };
}

function installInvoke(): void {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args: unknown) => {
    const a = (args ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case 'eval_sandbox_create':
        return SANDBOX;
      case 'eval_sandbox_snapshot':
        return snapshotQueue.length > 0 ? snapshotQueue.shift()! : [];
      case 'eval_sandbox_destroy':
        destroyed.push(String(a['sandboxRoot']));
        return undefined;
      case 'list_dir':
        return [];
      case 'read_text_file': {
        const p = String(a['path'] ?? '');
        if (/AGENTS(\.override)?\.md$/i.test(p) || /CLAUDE\.md$/i.test(p)) {
          throw new Error(`not found: ${p}`);
        }
        return 'hello world\n';
      }
      case 'write_text_file':
        return undefined;
      default:
        throw new Error(`unexpected invoke: ${cmd}`);
    }
  });
}

function scriptedStream(turns: LlmChunk[][]): LlmStreamChatFn {
  let n = 0;
  return async function* () {
    const chunks = turns[Math.min(n++, turns.length - 1)];
    for (const c of chunks) yield c;
  };
}

function toolTurn(name: string, toolArgs: Record<string, unknown>, content = ''): LlmChunk[] {
  return [{ content, toolCalls: [{ function: { name, arguments: toolArgs } }], done: true }];
}

function textTurn(content: string): LlmChunk[] {
  return [{ content, done: true }];
}

function candidate(overrides: Partial<CandidateSnapshot> = {}): CandidateSnapshot {
  return {
    label: 'test',
    sourceAgentId: null,
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    endpointClass: 'local',
    model: 'test-model',
    systemPrompt: 'Be helpful.',
    temperature: 0,
    reasoning: 'default',
    reasoningEffort: 'medium',
    contextSize: 0,
    reserveTokens: 0,
    keepRecentTokens: 0,
    enabledBuiltinTools: ['read', 'ls', 'grep', 'find', 'write', 'edit', 'shell'],
    enabledSkills: [],
    ...overrides,
  };
}

function pack(overrides: { trusted?: boolean; maxTurns?: number } = {}): LoadedPack {
  const manifest = {
    id: 'test-pack',
    kind: 'agentic',
    trusted: overrides.trusted ?? true,
    defaults: { timeoutSec: 60, maxTurns: overrides.maxTurns ?? 5, epochs: 1, circular: false },
  } as unknown as EvalPackManifest;
  return { scope: 'user', manifest, contentHash: 'h', diagnostics: [], samples: [] };
}

function sample(overrides: Partial<EvalSample> = {}): EvalSample {
  return { id: 's1', input: 'Do the task.', fixture: { dir: 'fixtures/basic' }, ...overrides };
}

async function runSolver(opts: {
  stream: LlmStreamChatFn;
  trusted?: boolean;
  maxTurns?: number;
  sampleOverrides?: Partial<EvalSample>;
  candidateOverrides?: Partial<CandidateSnapshot>;
}): Promise<{ outcome: TrialOutcome; result: Awaited<ReturnType<typeof agenticSolver>> }> {
  const ctx = {
    runId: 'run1',
    candidate: candidate(opts.candidateOverrides),
    runtime: { baseUrl: 'http://localhost:11434', openAiCompatible: false } as unknown as ResolvedLlmRuntime,
    apiKey: undefined,
    pack: pack({ trusted: opts.trusted, maxTurns: opts.maxTurns }),
    sample: sample(opts.sampleOverrides),
    epoch: 0,
    rotation: 0,
    streamChat: opts.stream,
    signal: new AbortController().signal,
    timeoutMs: 60000,
    sampler: {} as unknown as ResourceSampler,
    emit: () => undefined,
  };
  const result = await agenticSolver(ctx);
  return { outcome: result.outcome, result };
}

describe('agentic solver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshotQueue = [];
    destroyed = [];
    installInvoke();
  });

  it('registers under the agentic kind', () => {
    registerAgenticSolver();
    expect(getSolver('agentic')).toBe(agenticSolver);
  });

  it('returns skipped_unsupported without a fixture and never creates a sandbox', async () => {
    const { outcome, result } = await runSolver({
      stream: scriptedStream([textTurn('hi')]),
      sampleOverrides: { fixture: undefined },
    });
    expect(outcome).toBe('skipped_unsupported');
    expect(result.toolCalls).toEqual([]);
    expect(invoke).not.toHaveBeenCalledWith(
      'eval_sandbox_create',
      expect.anything(),
    );
    expect(destroyed).toEqual([]);
  });

  it('runs a scripted tool-call turn, collects trajectory + transcript, snapshots state', async () => {
    snapshotQueue = [
      [entry('main.txt', 'hello\n')],
      [entry('main.txt', 'hello world\n'), entry('out.txt', 'done\n')],
    ];
    const { outcome, result } = await runSolver({
      stream: scriptedStream([
        toolTurn('read', { path: 'main.txt' }, 'Let me read.'),
        textTurn('Done.'),
      ]),
    });
    expect(outcome).toBe('ok');
    expect(result.toolCalls).toEqual([{ name: 'read', arguments: { path: 'main.txt' } }]);
    expect(result.outputText).toBe('Done.');
    const roles = (result.transcript ?? []).map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'toolResult', 'assistant']);
    expect(result.finalState?.files.map((f) => f.path).sort()).toEqual(['main.txt', 'out.txt']);
    const initial = result.extra?.['initialState'] as { files: Array<{ path: string }> };
    expect(initial.files.map((f) => f.path)).toEqual(['main.txt']);
    expect(result.extra?.['blockedToolCalls']).toBe(0);
    expect(result.turns).toBe(2);
    expect(invoke).toHaveBeenCalledWith('eval_sandbox_create', {
      scope: 'user',
      packId: 'test-pack',
      fixtureRelDir: 'fixtures/basic',
      workspaceRoot: undefined,
    });
    expect(destroyed).toEqual([SANDBOX]);
  });

  it('never exposes shell to the model; unregistered calls fail without executing', async () => {
    snapshotQueue = [[], []];
    const { outcome, result } = await runSolver({
      stream: scriptedStream([
        toolTurn('shell', { command: 'rm -rf /' }),
        textTurn('Done without shell.'),
      ]),
    });
    expect(outcome).toBe('ok');
    expect(result.toolCalls).toEqual([{ name: 'shell', arguments: { command: 'rm -rf /' } }]);
    expect(result.extra?.['blockedToolCalls']).toBe(0);
    const toolResult = (result.transcript ?? []).find((m) => m.role === 'toolResult');
    expect(toolResult?.role === 'toolResult' && toolResult.isError).toBe(true);
    expect(toolResult?.role === 'toolResult' && toolResult.content).toContain('not found');
    expect(destroyed).toEqual([SANDBOX]);
  });

  it('sandbox policy hook blocks shell and escapes when invoked directly', async () => {
    const { sandboxPolicyHooks } = await import('../sandboxPolicy');
    const signal = new AbortController().signal;
    const policy = sandboxPolicyHooks(SANDBOX);
    const shellBlock = await policy.beforeToolCall?.(
      { toolCallId: 'c1', toolName: 'shell', arguments: { command: 'rm -rf /' }, risk: 'high' },
      signal,
    );
    expect(shellBlock?.block).toBe(true);
    expect(shellBlock?.reason).toBe('blocked by evaluation sandbox policy');
    const escapeBlock = await policy.beforeToolCall?.(
      { toolCallId: 'c2', toolName: 'read', arguments: { path: '/etc/passwd' }, risk: 'low' },
      signal,
    );
    expect(escapeBlock?.block).toBe(true);
    expect(escapeBlock?.reason).toContain('blocked by evaluation sandbox policy');
    const allowed = await policy.beforeToolCall?.(
      { toolCallId: 'c3', toolName: 'read', arguments: { path: 'main.txt' }, risk: 'low' },
      signal,
    );
    expect(allowed).toBeUndefined();
    expect(policy.blockedToolCalls.count).toBe(2);
  });

  it('blocks paths escaping the sandbox root', async () => {
    snapshotQueue = [[], []];
    const { result } = await runSolver({
      stream: scriptedStream([
        toolTurn('read', { path: '../../etc/passwd' }),
        textTurn('Done.'),
      ]),
    });
    expect(result.extra?.['blockedToolCalls']).toBe(1);
    const toolResult = (result.transcript ?? []).find((m) => m.role === 'toolResult');
    expect(toolResult?.role === 'toolResult' && toolResult.isError).toBe(true);
  });

  it('returns max_turns when the turn budget is exhausted', async () => {
    snapshotQueue = [[], []];
    const { outcome, result } = await runSolver({
      maxTurns: 1,
      stream: scriptedStream([toolTurn('read', { path: 'main.txt' })]),
    });
    expect(outcome).toBe('max_turns');
    expect(result.turns).toBe(1);
    expect(destroyed).toEqual([SANDBOX]);
  });

  it('maps context overflow to provider_error', async () => {
    snapshotQueue = [[], []];
    const stream: LlmStreamChatFn = () => {
      throw new OllamaContextOverflowError('too long');
    };
    const { outcome } = await runSolver({ stream });
    expect(outcome).toBe('provider_error');
    expect(destroyed).toEqual([SANDBOX]);
  });

  it('scans skills only for trusted packs', async () => {
    snapshotQueue = [[], []];
    await runSolver({ stream: scriptedStream([textTurn('hi')]), trusted: true });
    expect(invoke).toHaveBeenCalledWith('list_dir', expect.anything());
    vi.clearAllMocks();
    snapshotQueue = [[], []];
    destroyed = [];
    installInvoke();
    await runSolver({ stream: scriptedStream([textTurn('hi')]), trusted: false });
    expect(invoke).not.toHaveBeenCalledWith('list_dir', expect.anything());
  });
});
