import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getExternalAgentStreamFn } from './externalAgentClient';
import { callIntegration } from '@/lib/integrations/gateway';
import { getStreamChatFn } from './providerRuntime';

vi.mock('@/lib/integrations/gateway', () => ({
  callIntegration: vi.fn(),
}));

async function collect(
  fn: ReturnType<typeof getExternalAgentStreamFn>,
  model = 'ext-model',
) {
  const chunks = [];
  for await (const c of fn({
    model,
    messages: [{ role: 'user', content: 'hello' }],
  })) {
    chunks.push(c);
  }
  return chunks;
}

describe('getExternalAgentStreamFn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the CLI once via the gateway and returns a single chunk', async () => {
    vi.mocked(callIntegration).mockResolvedValue({ ok: true, text: 'cli says hi' });
    const chunks = await collect(
      getExternalAgentStreamFn({ integrationId: 'cli-1', cwd: 'C:/work' }),
    );
    expect(callIntegration).toHaveBeenCalledTimes(1);
    const [id, req] = vi.mocked(callIntegration).mock.calls[0];
    expect(id).toBe('cli-1');
    expect(req).toMatchObject({
      purpose: 'chat-agent',
      cwd: 'C:/work',
    });
    expect(req.messages).toEqual([{ role: 'user', content: 'hello' }]);
    const last = chunks[chunks.length - 1];
    expect(last.done).toBe(true);
    expect(last.content).toBe('cli says hi');
  });

  it('throws when the gateway denies or fails', async () => {
    vi.mocked(callIntegration).mockResolvedValue({
      ok: false,
      reasonKey: 'eval.integrations.denied.masterOff',
    });
    await expect(
      collect(getExternalAgentStreamFn({ integrationId: 'cli-1' })),
    ).rejects.toThrow('eval.integrations.denied.masterOff');
  });
});

describe('getStreamChatFn external branch', () => {
  it('returns the external client for external-agent bindings', async () => {
    vi.mocked(callIntegration).mockResolvedValue({ ok: true, text: 'x' });
    const fn = getStreamChatFn(
      { openAiCompatible: false, kind: 'external-agent', externalAgentId: 'cli-9', cwd: 'D:/data' },
    );
    const chunks = [];
    for await (const c of fn({ model: 'm', messages: [] })) {
      chunks.push(c);
    }
    expect(callIntegration).toHaveBeenCalledTimes(1);
    expect(vi.mocked(callIntegration).mock.calls[0][0]).toBe('cli-9');
    expect(chunks[chunks.length - 1].done).toBe(true);
  });

  it('falls back to built-in clients without a binding', () => {
    const ollama = getStreamChatFn({ openAiCompatible: false });
    const openai = getStreamChatFn({ openAiCompatible: true });
    expect(typeof ollama).toBe('function');
    expect(typeof openai).toBe('function');
    expect(ollama).not.toBe(openai);
  });
});
