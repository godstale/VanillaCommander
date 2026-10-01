import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractLogprobTrace,
  isLogprobsUnsupported,
  LOGPROBS_UNSUPPORTED,
  requestLogprobs,
} from './client';

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => data,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
  } as unknown as Response;
}

function textResponse(text: string, ok = false, status = 400): Response {
  return {
    ok,
    status,
    statusText: 'Error',
    json: async () => {
      throw new Error('not json');
    },
    text: async () => text,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('extractLogprobTrace', () => {
  const entry = {
    token: ' A',
    logprob: -0.2,
    top_logprobs: [
      { token: ' A', logprob: -0.2 },
      { token: 'B', logprob: -2.1 },
    ],
  };
  it('reads top-level logprobs with wrapped top lists', () => {
    const t = extractLogprobTrace({ logprobs: [entry], prompt_eval_count: 12 });
    expect(t).toMatchObject({
      tokens: [' A'],
      promptEvalCount: 12,
    });
    expect(t?.topLogprobs[0]).toHaveLength(2);
  });
  it('reads message.logprobs and bare single-entry positions', () => {
    const t = extractLogprobTrace({
      message: { role: 'assistant', content: 'B', logprobs: [{ token: 'B', logprob: -0.1 }] },
    });
    expect(t).toMatchObject({ tokens: ['B'] });
    expect(t?.topLogprobs).toEqual([[{ token: 'B', logprob: -0.1 }]]);
  });
  it('reads the split tokens + top_logprobs shape', () => {
    const t = extractLogprobTrace({
      tokens: ['A', 'B'],
      top_logprobs: [
        [{ token: 'A', logprob: -0.1 }],
        [{ token: 'B', logprob: -0.3 }],
      ],
    });
    expect(t).toMatchObject({ tokens: ['A', 'B'] });
  });
  it('returns null when no logprob fields are present', () => {
    expect(extractLogprobTrace({ message: { content: 'hi' }, done: true })).toBeNull();
    expect(extractLogprobTrace({ logprobs: [] })).toBeNull();
    expect(extractLogprobTrace(null)).toBeNull();
    expect(extractLogprobTrace({ logprobs: [{ nope: 1 }] })).toBeNull();
  });
});

describe('requestLogprobs', () => {
  const messages = [{ role: 'user', content: 'Say A' }];
  const payload = {
    message: { role: 'assistant', content: 'A' },
    done: true,
    prompt_eval_count: 5,
    logprobs: [{ token: 'A', logprob: -0.05, top_logprobs: [{ token: 'A', logprob: -0.05 }] }],
  };

  it('posts stream:false + logprobs + top_logprobs and returns the trace', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(payload));
    vi.stubGlobal('fetch', fetchMock);
    const t = await requestLogprobs({ model: 'm', messages });
    expect(t.tokens).toEqual(['A']);
    expect(t.promptEvalCount).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'm',
      stream: false,
      logprobs: true,
      top_logprobs: 20,
    });
    expect((body['options'] as Record<string, unknown>)['num_predict']).toBe(256);
  });

  it('throws logprobs unsupported when fields are missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: { content: 'x' } })));
    const err = await requestLogprobs({ model: 'm', messages }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(LOGPROBS_UNSUPPORTED);
    expect(isLogprobsUnsupported(err)).toBe(true);
    expect(isLogprobsUnsupported(new Error('other'))).toBe(false);
  });

  it('maps provider rejections mentioning logprobs to unsupported', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => textResponse('unknown field: logprobs', false, 400)),
    );
    await expect(requestLogprobs({ model: 'm', messages })).rejects.toThrow(LOGPROBS_UNSUPPORTED);
  });

  it('maps other provider errors to plain Errors with status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('model not found', false, 404)));
    const err = await requestLogprobs({ model: 'm', messages }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('404');
    expect(isLogprobsUnsupported(err)).toBe(false);
  });
});
