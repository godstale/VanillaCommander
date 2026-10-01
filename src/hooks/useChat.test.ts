import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChat } from './useChat';
import { DEFAULT_AGENT } from '@/lib/agent/defaultAgent';
import { monitoringCollector } from '@/lib/monitoring/monitoringCollector';
import type { OllamaChunk } from '@/lib/llm/ollamaClient';

async function* mockStreamResponse(chunks: OllamaChunk[]): AsyncIterable<OllamaChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe('useChat hook', () => {
  afterEach(() => {
    monitoringCollector.stopAll();
    vi.restoreAllMocks();
  });  it('accumulates streaming chunks into assistant message and finishes streaming', async () => {
    const mockStream = vi.fn().mockImplementation(() => {
      return mockStreamResponse([
        { content: 'Hello', done: false },
        { content: ' there!', done: true, usage: { input: 10, output: 5, total: 15 } },
      ]);
    });

    const { result } = renderHook(() =>
      useChat('session_1', DEFAULT_AGENT, { streamChatFn: mockStream }),
    );

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.isStreaming).toBe(false);

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages.length).toBeGreaterThanOrEqual(2);

    const userMsg = result.current.messages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg?.content).toBe('Hello');

    const assistantMsg = result.current.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    if (assistantMsg && assistantMsg.role === 'assistant') {
      expect(assistantMsg.content).toBe('Hello there!');
      expect(assistantMsg.usage?.total).toBe(15);
    }

    expect(result.current.contextUsage.tokens).toBe(15);
  });

  it('stops immediately when stop() is called', async () => {
    const mockStream = vi.fn().mockImplementation((_req, signal?: AbortSignal) => {
      return (async function* () {
        yield { content: 'Initial', done: false };
        for (let i = 0; i < 20; i++) {
          if (signal?.aborted) {
            throw new Error('Operation aborted');
          }
          await new Promise((r) => setTimeout(r, 10));
          yield { content: ` item ${i}`, done: false };
        }
        yield { done: true };
      })();
    });

    const { result } = renderHook(() =>
      useChat('session_2', DEFAULT_AGENT, { streamChatFn: mockStream }),
    );

    let sendPromise: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage('Count up');
    });

    // Wait a tiny bit and call stop
    await new Promise((r) => setTimeout(r, 15));
    act(() => {
      result.current.stop();
    });

    await act(async () => {
      await sendPromise;
    });

    expect(result.current.isStreaming).toBe(false);
  });

  it('auto-starts monitoring on send and stops when the conversation ends (default on)', async () => {
    const startAuto = vi.spyOn(monitoringCollector, 'startAuto');
    const stopAuto = vi.spyOn(monitoringCollector, 'stopAuto');
    const mockStream = vi.fn().mockImplementation(() => {
      return mockStreamResponse([
        { content: 'Hi', done: true, usage: { input: 8, output: 4, total: 12 } },
      ]);
    });

    const { result } = renderHook(() =>
      useChat('session_auto_on', { ...DEFAULT_AGENT, autoMonitor: true }, { streamChatFn: mockStream }),
    );

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(startAuto).toHaveBeenCalled();
    // LLM 작업 완료 후 자동 모니터링 중단
    expect(monitoringCollector.isRunning(DEFAULT_AGENT.id)).toBe(false);
    expect(monitoringCollector.isAuto(DEFAULT_AGENT.id)).toBe(false);
    expect(stopAuto).toHaveBeenCalledWith(DEFAULT_AGENT.id);
  });

  it('does not auto-start monitoring when the agent disables it', async () => {
    const startAuto = vi.spyOn(monitoringCollector, 'startAuto');
    const mockStream = vi.fn().mockImplementation(() => {
      return mockStreamResponse([
        { content: 'Hi', done: true, usage: { input: 8, output: 4, total: 12 } },
      ]);
    });

    const { result } = renderHook(() =>
      useChat('session_auto_off', { ...DEFAULT_AGENT, autoMonitor: false }, { streamChatFn: mockStream }),
    );

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(startAuto).not.toHaveBeenCalled();
    expect(monitoringCollector.isRunning(DEFAULT_AGENT.id)).toBe(false);
  });
});
