import { executeCompact, prepareCompaction } from '@/lib/compaction/compact';
import {
  buildCompactionUserPrompt,
  COMPACTION_SYSTEM_PROMPT,
} from '@/lib/compaction/prompts';
import { serializeMessagesForSummary } from '@/lib/compaction/serialize';
import type { AgentMessage } from '@/lib/agent/types';
import type {
  CandidateSnapshot,
  EvalMessage,
  EvalSample,
} from '@/lib/eval/types';
import type { LlmStreamChatFn } from '@/lib/llm/providerRuntime';
import type { Entry, MessageEntry } from '@/lib/types/chat';

export const COMPACTION_RECALL_KIND = 'compaction_recall';

// Forced budgets for the recall probe: the candidate's own contextSize is
// ignored so every candidate compacts under identical conditions.
export const COMPACTION_FORCED_CONTEXT = 8192;
export const COMPACTION_FORCED_KEEP_RECENT = 2048;
const COMPACTION_FORCED_RESERVE = 2048;

export interface CompactionRecallExtra {
  compactionMs: number;
}

export interface CompactionRecallResult {
  outputText: string;
  extra: CompactionRecallExtra;
}

// P10-10 owns the runner solver registry; this is the trial context shape the
// solver actually consumes. sampler/emit are optional progress hooks read via
// optional access only.
export interface CompactionRecallContext {
  candidate: CandidateSnapshot;
  sample: EvalSample;
  streamChat: unknown;
  signal: AbortSignal;
  timeoutMs: number;
  sampler?: unknown;
  emit?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toAgentMessages(input: EvalSample['input']): AgentMessage[] {
  const raw: EvalMessage[] =
    typeof input === 'string' ? [{ role: 'user', content: input }] : input;
  return raw.map((m): AgentMessage => {
    if (m.role === 'assistant') {
      return { role: 'assistant', content: m.content, stopReason: 'stop' };
    }
    if (m.role === 'system') {
      return { role: 'system', content: m.content };
    }
    return { role: 'user', content: m.content };
  });
}

function toMessageEntries(sessionId: string, messages: AgentMessage[]): Entry[] {
  const now = new Date().toISOString();
  return messages.map(
    (message, i): MessageEntry => ({
      id: `eval-compaction-${i}`,
      sessionId,
      parentId: null,
      seq: i,
      type: 'message',
      createdAt: now,
      message,
    }),
  );
}

function resolveStreamChat(streamChat: unknown): LlmStreamChatFn | null {
  if (typeof streamChat !== 'function') return null;
  return streamChat as LlmStreamChatFn;
}

function candidateString(
  candidate: CompactionRecallContext['candidate'],
  key: 'model' | 'baseUrl',
): string {
  const value: unknown = candidate[key];
  return typeof value === 'string' ? value : '';
}

function chunkText(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk;
  if (!isRecord(chunk)) return '';
  const direct = chunk['content'] ?? chunk['delta'] ?? chunk['text'];
  if (typeof direct === 'string') return direct;
  const message = chunk['message'];
  if (isRecord(message) && typeof message['content'] === 'string') {
    return message['content'];
  }
  const choices = chunk['choices'];
  if (Array.isArray(choices)) {
    const first: unknown = choices[0];
    if (isRecord(first)) {
      const inner = first['message'] ?? first['delta'];
      if (isRecord(inner) && typeof inner['content'] === 'string') {
        return inner['content'];
      }
      if (typeof first['text'] === 'string') return first['text'];
    }
  }
  return '';
}

function hasAsyncIterator(value: unknown): value is AsyncIterable<unknown> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }
  return Symbol.asyncIterator in value;
}

function hasSyncIterator(value: unknown): value is Iterable<unknown> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }
  return Symbol.iterator in value;
}

async function collectStreamText(result: unknown): Promise<string> {
  const awaited: unknown = result instanceof Promise ? await result : result;
  if (hasAsyncIterator(awaited)) {
    let out = '';
    for await (const chunk of awaited) out += chunkText(chunk);
    return out;
  }
  if (hasSyncIterator(awaited) && typeof awaited !== 'string') {
    let out = '';
    for (const chunk of awaited) out += chunkText(chunk);
    return out;
  }
  return chunkText(awaited);
}

function linkSignal(
  parent: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  const ctrl = new AbortController();
  const onAbort = (): void => {
    ctrl.abort(parent.reason);
  };
  if (parent.aborted) {
    ctrl.abort(parent.reason);
  } else {
    parent.addEventListener('abort', onAbort, { once: true });
  }
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timers.push(
      setTimeout(
        () => ctrl.abort(new Error('compaction-recall timeout')),
        timeoutMs,
      ),
    );
  }
  return {
    signal: ctrl.signal,
    dispose: () => {
      parent.removeEventListener('abort', onAbort);
      for (const t of timers) clearTimeout(t);
    },
  };
}

function safeEmit(emit: unknown, event: Record<string, unknown>): void {
  if (typeof emit !== 'function') return;
  try {
    (emit as (event: Record<string, unknown>) => unknown)(event);
  } catch {
    // Progress reporting is best-effort; it must never fail the trial.
  }
}

async function summarizeWithCompaction(
  sessionId: string,
  history: AgentMessage[],
  model: string,
  baseUrl: string,
  streamChat: LlmStreamChatFn,
  signal: AbortSignal,
): Promise<string> {
  const entries = toMessageEntries(sessionId, history);
  const prep = prepareCompaction(sessionId, entries, {
    contextSize: COMPACTION_FORCED_CONTEXT,
    reserveTokens: COMPACTION_FORCED_RESERVE,
    keepRecentTokens: COMPACTION_FORCED_KEEP_RECENT,
  });
  if (!prep) {
    return serializeMessagesForSummary(history);
  }
  try {
    const done = await executeCompact(
      prep,
      { model, baseUrl, streamChatFn: streamChat, reason: 'threshold' },
      signal,
    );
    return done.summary;
  } catch {
    // executeCompact persists entries to the app DB, which may be unavailable
    // inside the eval sandbox. Fall back to a direct summarization call that
    // reuses the same prompts without touching the DB.
    const userPrompt = buildCompactionUserPrompt(
      prep.serializedText,
      prep.previousSummary,
    );
    return collectStreamText(
      streamChat(
        {
          model,
          baseUrl,
          messages: [
            { role: 'system', content: COMPACTION_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
        },
        signal,
      ),
    );
  }
}

// Forces compaction of the sample dialogue, then answers the trailing recall
// question from the compacted context using the candidate runtime in ctx.
export async function compactionRecallSolver(
  ctx: CompactionRecallContext,
): Promise<CompactionRecallResult> {
  const startedAt = Date.now();
  const finish = (outputText: string): CompactionRecallResult => ({
    outputText,
    extra: { compactionMs: Date.now() - startedAt },
  });
  const streamChat = resolveStreamChat(ctx.streamChat);
  if (!streamChat) {
    throw new Error('compaction-recall: context provides no streamChat function');
  }
  const messages = toAgentMessages(ctx.sample.input);
  const last = messages[messages.length - 1];
  let question: string;
  let history: AgentMessage[];
  if (last !== undefined && last.role === 'user') {
    question = last.content;
    history = messages.slice(0, -1);
  } else {
    history = messages;
    const ref: unknown = ctx.sample.reference;
    question = typeof ref === 'string' ? ref : '';
  }
  const model = candidateString(ctx.candidate, 'model');
  const baseUrl = candidateString(ctx.candidate, 'baseUrl');
  const linked = linkSignal(ctx.signal, ctx.timeoutMs);
  try {
    const summary =
      history.length > 0
        ? await summarizeWithCompaction(
            'eval-compaction-recall',
            history,
            model,
            baseUrl,
            streamChat,
            linked.signal,
          )
        : '';
    const answer = await collectStreamText(
      streamChat(
        {
          model,
          baseUrl,
          messages: [
            {
              role: 'system',
              content:
                'Answer the question using only the compacted conversation summary. Reply with the recalled value directly.',
            },
            {
              role: 'user',
              content: `## Compacted summary\n${summary || '(empty)'}\n\n## Question\n${question}`,
            },
          ],
          temperature: 0,
        },
        linked.signal,
      ),
    );
    safeEmit(ctx.emit, {
      type: 'compaction_recall_done',
      compactionMs: Date.now() - startedAt,
      ...(isRecord(ctx.sampler)
        ? { sampler: ctx.sampler['kind'] ?? ctx.sampler['name'] ?? true }
        : {}),
    });
    return finish(answer.trim());
  } finally {
    linked.dispose();
  }
}

export interface CompactionRecallRegistration {
  kind: string;
  run: typeof compactionRecallSolver;
}

const localRegistry = new Map<string, CompactionRecallRegistration>();

export function localSolverKinds(): string[] {
  return [...localRegistry.keys()];
}

export function registerCompactionSolver(): void {
  // P10-10 owns src/lib/eval/runner/solvers/index.ts and the global
  // registerSolver() (neither file exists yet). When they land, replace this
  // body with registerSolver(COMPACTION_RECALL_KIND, compactionRecallSolver).
  // Until then, register locally so unit tests can resolve the solver.
  localRegistry.set(COMPACTION_RECALL_KIND, {
    kind: COMPACTION_RECALL_KIND,
    run: compactionRecallSolver,
  });
}
