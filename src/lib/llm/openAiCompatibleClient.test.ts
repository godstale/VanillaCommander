import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  streamChat,
  listModels,
  OpenAiModelNotFoundError,
  OpenAiConnectionError,
  OpenAiContextOverflowError,
  OpenAiAuthError,
  OpenAiRequestError,
} from './openAiCompatibleClient';

function sseStream(events: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const e of events) {
        controller.enqueue(new TextEncoder().encode(e));
      }
      controller.close();
    },
  });
}

function chatChunk(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
): string {
  return `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finishReason }] })}\n\n`;
}

describe('openAiCompatibleClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('streams SSE content chunks and usage', async () => {
    const stream = sseStream([
      chatChunk({ role: 'assistant', content: 'Hello' }),
      chatChunk({ content: ' world' }),
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } })}\n\n`,
      'data: [DONE]\n\n',
    ]);
    global.fetch = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));

    const chunks = [];
    for await (const chunk of streamChat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      chunks.push(chunk);
    }

    const text = chunks.map((c) => c.content ?? '').join('');
    expect(text).toBe('Hello world');
    expect(chunks[chunks.length - 1].done).toBe(true);
    expect(chunks[chunks.length - 1].usage).toEqual({ input: 20, output: 10, total: 30 });
  });

  it('accumulates tool_calls deltas split across SSE events', async () => {
    const args1 = '{"path": "/tmp/a';
    const args2 = '.txt"}';
    const stream = sseStream([
      chatChunk({ tool_calls: [{ index: 0, id: 'call_abc', function: { name: 'read', arguments: args1 } }] }),
      chatChunk({ tool_calls: [{ index: 0, function: { arguments: args2 } }] }),
      chatChunk({}, 'tool_calls'),
      'data: [DONE]\n\n',
    ]);
    global.fetch = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));

    const chunks = [];
    for await (const chunk of streamChat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'read file' }],
      tools: [{ type: 'function', function: { name: 'read' } }],
    })) {
      chunks.push(chunk);
    }

    const last = chunks[chunks.length - 1];
    expect(last.done).toBe(true);
    expect(last.toolCalls).toHaveLength(1);
    expect(last.toolCalls?.[0].id).toBe('call_abc');
    expect(last.toolCalls?.[0].function.name).toBe('read');
    expect(last.toolCalls?.[0].function.arguments).toEqual({ path: '/tmp/a.txt' });
  });

  it('collects reasoning_content as thinking', async () => {
    const stream = sseStream([
      chatChunk({ reasoning_content: 'let me think' }),
      chatChunk({ content: 'answer' }),
      chatChunk({}, 'stop'),
      'data: [DONE]\n\n',
    ]);
    global.fetch = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));

    let thinking = '';
    let content = '';
    for await (const chunk of streamChat({
      model: 'reasoning-model',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      thinking += chunk.thinking ?? '';
      content += chunk.content ?? '';
    }
    expect(thinking).toBe('let me think');
    expect(content).toBe('answer');
  });

  it('sends Authorization header when apiKey is provided', async () => {
    const stream = sseStream(['data: [DONE]\n\n']);
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    global.fetch = fetchMock;

    for await (const _chunk of streamChat({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      void _chunk;
    }

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['model']).toBe('gpt-4o-mini');
    expect(body['stream']).toBe(true);
  });

  it('maps think=true to reasoning_effort', async () => {
    const stream = sseStream(['data: [DONE]\n\n']);
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    global.fetch = fetchMock;

    for await (const _chunk of streamChat({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
      think: true,
    })) {
      void _chunk;
    }

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['reasoning_effort']).toBe('medium');
  });

  it('throws OpenAiAuthError on 401', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('invalid api key', { status: 401, statusText: 'Unauthorized' }),
    );
    const gen = streamChat({ model: 'm', messages: [] });
    await expect(async () => {
      for await (const _chunk of gen) { void _chunk;
        // drain
      }
    }).rejects.toBeInstanceOf(OpenAiAuthError);
  });

  it('throws OpenAiContextOverflowError on context window error', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'This model\'s maximum context length is 8192 tokens' } }), {
        status: 400,
        statusText: 'Bad Request',
      }),
    );
    const gen = streamChat({ model: 'm', messages: [] });
    await expect(async () => {
      for await (const _chunk of gen) { void _chunk;
        // drain
      }
    }).rejects.toBeInstanceOf(OpenAiContextOverflowError);
  });

  it('throws OpenAiModelNotFoundError when server reports unknown model', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'model_not_found: no such model foo' } }), {
        status: 404,
        statusText: 'Not Found',
      }),
    );
    const gen = streamChat({ model: 'foo', messages: [] });
    await expect(async () => {
      for await (const _chunk of gen) { void _chunk;
        // drain
      }
    }).rejects.toBeInstanceOf(OpenAiModelNotFoundError);
  });

  it('throws OpenAiRequestError on generic failure', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('boom', { status: 500, statusText: 'Server Error' }),
    );
    const gen = streamChat({ model: 'm', messages: [] });
    await expect(async () => {
      for await (const _chunk of gen) { void _chunk;
        // drain
      }
    }).rejects.toBeInstanceOf(OpenAiRequestError);
  });

  it('throws OpenAiConnectionError when fetch itself fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const gen = streamChat({ model: 'm', messages: [] });
    await expect(async () => {
      for await (const _chunk of gen) { void _chunk;
        // drain
      }
    }).rejects.toBeInstanceOf(OpenAiConnectionError);
  });

  it('listModels returns OpenAI /v1/models data array', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: 'qwen3-8b', owned_by: 'lmstudio' }] }),
        { status: 200 },
      ),
    );
    const models = await listModels('http://127.0.0.1:1234/v1');
    expect(models).toEqual([{ id: 'qwen3-8b', owned_by: 'lmstudio' }]);
  });

  it('listModels GET sends no Content-Type to avoid CORS preflight', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    global.fetch = fetchMock;
    await listModels('http://127.0.0.1:1234/v1');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('GET');
    expect(init.headers as Record<string, string>).not.toHaveProperty('Content-Type');
  });
});
