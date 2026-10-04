import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  streamChat,
  getModelArchitectureInfo,
  calculateEstimatedKvCacheBytes,
  calculateHybridKvCacheBytes,
  OllamaModelNotFoundError,
  OllamaConnectionError,
  OllamaContextOverflowError,
  kvBytesPerElementForQuant,
} from './ollamaClient';
import {
  cleanThinkingText,
  mapAgentMessagesToOllama,
  mapAgentToolsToOllama,
} from './messageMapper';
import { z } from 'zod';
import type { AgentMessage, AgentTool } from '@/lib/agent/types';

describe('ollamaClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('streams NDJSON chunks and parses usage', async () => {
    const streamData = [
      JSON.stringify({ message: { content: 'Hello' }, done: false }) + '\n',
      JSON.stringify({ message: { content: ' world' }, done: false }) + '\n',
      JSON.stringify({
        message: { content: '!' },
        done: true,
        prompt_eval_count: 20,
        eval_count: 10,
      }) + '\n',
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of streamData) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    global.fetch = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));

    const chunks = [];
    for await (const chunk of streamChat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].content).toBe('Hello');
    expect(chunks[1].content).toBe(' world');
    expect(chunks[2].content).toBe('!');
    expect(chunks[2].done).toBe(true);
    expect(chunks[2].usage).toEqual({
      input: 20,
      output: 10,
      total: 30,
    });
  });

  it('throws OllamaModelNotFoundError on 404', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('model not found', { status: 404, statusText: 'Not Found' }),
    );

    const gen = streamChat({
      model: 'non-existent-model',
      messages: [],
    });

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of gen) {
        /* empty */
      }
    }).rejects.toThrow(OllamaModelNotFoundError);
  });

  it('throws OllamaConnectionError on network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const gen = streamChat({
      model: 'test-model',
      messages: [],
    });

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of gen) {
        /* empty */
      }
    }).rejects.toThrow(OllamaConnectionError);
  });

  it('throws OllamaContextOverflowError when response contains context window exceeded', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('context length exceeded the maximum context limit', {
        status: 500,
        statusText: 'Internal Server Error',
      }),
    );

    const gen = streamChat({
      model: 'test-model',
      messages: [],
    });

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of gen) {
        /* empty */
      }
    }).rejects.toThrow(OllamaContextOverflowError);
  });

  it('sends the think field only when explicitly set', async () => {
    const seenBodies: unknown[] = [];
    global.fetch = vi.fn().mockImplementation((_url: unknown, init?: { body?: string }) => {
      seenBodies.push(JSON.parse(init?.body ?? '{}'));
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(JSON.stringify({ done: true }) + '\n'),
          );
          controller.close();
        },
      });
      return Promise.resolve(new Response(stream, { status: 200 }));
    });

    for await (const chunk of streamChat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hi' }],
      think: 'high',
    })) {
      expect(chunk).toBeDefined();
    }
    expect((seenBodies[0] as Record<string, unknown>).think).toBe('high');

    seenBodies.length = 0;
    for await (const chunk of streamChat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      expect(chunk).toBeDefined();
    }
    expect('think' in (seenBodies[0] as Record<string, unknown>)).toBe(false);
  });

  it('passes jsonSchema as the format field', async () => {
    const seenBodies: Array<Record<string, unknown>> = [];
    global.fetch = vi.fn().mockImplementation((_url: unknown, init?: { body?: string }) => {
      seenBodies.push(JSON.parse(init?.body ?? '{}'));
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ done: true }) + '\n'));
          controller.close();
        },
      });
      return Promise.resolve(new Response(stream, { status: 200 }));
    });
    const schema = { type: 'object', properties: { a: { type: 'string' } } };

    for await (const chunk of streamChat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hi' }],
      jsonSchema: schema,
    })) {
      expect(chunk).toBeDefined();
    }
    expect(seenBodies[0].format).toEqual(schema);
  });

  it('parses thinking metadata from /api/show', async () => {
    const { showModel } = await import('./ollamaClient');
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model_info: { 'qwen3.context_length': 32768 },
          capabilities: ['tools', 'thinking'],
          thinking: { values: ['low', 'medium', 'high'], default: 'medium' },
        }),
        { status: 200 },
      ),
    );

    const info = await showModel(undefined, 'gpt-oss:20b');
    expect(info.contextLength).toBe(32768);
    expect(info.supportsTools).toBe(true);
    expect(info.thinking).toEqual({
      values: ['low', 'medium', 'high'],
      default: 'medium',
    });
  });

  it('parses hidden_size/num_layers aliases (MLX-style keys)', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model_info: {
            'qwen3_5.hidden_size': 5120,
            'qwen3_5.num_hidden_layers': 48,
            'qwen3_5.num_attention_heads': 40,
            'qwen3_5.num_key_value_heads': 8,
            'qwen3_5.intermediate_size': 17408,
            'qwen3_5.max_position_embeddings': 32768,
          },
          details: {
            family: 'qwen3_5',
            parameter_size: '35B',
            quantization_level: 'Q4_K_M',
            format: 'gguf',
          },
        }),
        { status: 200 },
      ),
    );

    const arch = await getModelArchitectureInfo(undefined, 'qwen3.5:35b-mlx');
    expect(arch.blockCount).toBe(48);
    expect(arch.embeddingLength).toBe(5120);
    expect(arch.headCount).toBe(40);
    expect(arch.headCountKv).toBe(8);
    expect(arch.feedForwardLength).toBe(17408);
    expect(arch.contextLimit).toBe(32768);
  });

  it('returns 0 KV estimate when arch dims are missing (no bogus GB)', () => {
    expect(calculateEstimatedKvCacheBytes(48, 0, 0, 0, 8192)).toBe(0);
    expect(calculateEstimatedKvCacheBytes(0, 8, 5120, 40, 8192)).toBe(0);
    // Sanity: full dims produce a positive estimate
    expect(calculateEstimatedKvCacheBytes(48, 8, 5120, 40, 8192)).toBeGreaterThan(0);
  });

  it('uses Q8 element size only for q8 KV quants', () => {
    expect(kvBytesPerElementForQuant('Q4_K_M')).toBe(2);
    expect(kvBytesPerElementForQuant('Q8_0')).toBe(1);
    expect(kvBytesPerElementForQuant('')).toBe(2);
  });
});

describe('messageMapper', () => {
  it('correctly maps AgentMessages to Ollama format', () => {
    const messages: AgentMessage[] = [
      { role: 'system', content: 'System instruction' },
      { role: 'user', content: 'User question' },
      {
        role: 'assistant',
        content: 'I will call a tool',
        stopReason: 'toolUse',
        toolCalls: [
          {
            id: 'call-1',
            name: 'read_file',
            arguments: { path: 'test.txt' },
          },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'read_file',
        content: 'file contents',
        isError: false,
      },
    ];

    const mapped = mapAgentMessagesToOllama(messages);
    expect(mapped).toEqual([
      { role: 'system', content: 'System instruction' },
      { role: 'user', content: 'User question' },
      {
        role: 'assistant',
        content: 'I will call a tool',
        tool_calls: [
          {
            function: {
              name: 'read_file',
              arguments: { path: 'test.txt' },
            },
          },
        ],
      },
      { role: 'tool', content: 'file contents' },
    ]);
  });

  it('maps AgentTools to Ollama tools definition with schema', () => {
    const tool: AgentTool = {
      name: 'read_file',
      label: 'Read File',
      description: 'Read file contents',
      risk: 'low',
      parameters: z.object({
        path: z.string().describe('Path to file'),
      }),
      execute: vi.fn(),
    };

    const mapped = mapAgentToolsToOllama([tool]);
    expect(mapped).toHaveLength(1);
    expect((mapped[0] as { function: { name: string } }).function.name).toBe('read_file');
  });

  it('strips <think> blocks and prunes older tool results to preserve context', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'What is the weather?' },
      {
        role: 'assistant',
        content: '<think>I should search for weather first.</think>I am searching now.',
        toolCalls: [{ id: 'tc-1', name: 'web_search', arguments: { query: 'weather' } }],
        stopReason: 'toolUse',
      },
      {
        role: 'toolResult',
        toolCallId: 'tc-1',
        toolName: 'web_search',
        content: 'A'.repeat(800), // long past tool result
        isError: false,
      },
      {
        role: 'assistant',
        content: '<think>Now I will fetch the details.</think>',
        toolCalls: [{ id: 'tc-2', name: 'web_fetch', arguments: { url: 'https://weather.com' } }],
        stopReason: 'toolUse',
      },
      {
        role: 'toolResult',
        toolCallId: 'tc-2',
        toolName: 'web_fetch',
        content: 'B'.repeat(800), // latest tool result
        isError: false,
      },
    ];

    const mapped = mapAgentMessagesToOllama(messages, {
      pastToolResultMaxChars: 100,
      keepRecentToolCount: 1,
    });

    // 1. Check thinking stripped from assistant messages
    expect(mapped[1].content).toBe('I am searching now.');
    expect(mapped[3].content).toBe(''); // Only contained thinking and had tool_calls

    // 2. Check older toolResult (index 2) was pruned
    expect(mapped[2].content).toContain('과거 단계 도구 결과');
    expect(mapped[2].content.length).toBeLessThan(300);

    // 3. Check latest toolResult (index 4) was NOT pruned
    expect(mapped[4].content).toBe('B'.repeat(800));
  });

  it('cleanThinkingText removes all variants of thinking tags and standalone tags', () => {
    const raw1 = '<think>some internal thoughts</think>Actual response';
    expect(cleanThinkingText(raw1)).toBe('Actual response');

    const raw2 = '<thinking>\nPlanning next steps...\n</thinking>\n\nHere is the answer';
    expect(cleanThinkingText(raw2)).toBe('Here is the answer');

    const raw3 = 'I will now read the file.\n</thinking>';
    expect(cleanThinkingText(raw3)).toBe('I will now read the file.');
  });
});

describe('model architecture parsing', () => {
  const mockShow = (modelInfo: Record<string, unknown>) => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ model_info: modelInfo }), { status: 200 }),
    );
  };

  it('ignores vision-tower keys and judges GQA from text-tower heads', async () => {
    mockShow({
      'general.architecture': 'qwen35',
      'qwen35.block_count': 32,
      'qwen35.embedding_length': 4096,
      'qwen35.attention.head_count': 16,
      'qwen35.attention.head_count_kv': 8,
      'qwen35.feed_forward_length': 12288,
      'qwen35.vision.block_count': 27,
      'qwen35.vision.embedding_length': 1152,
      'qwen35.vision.attention.head_count': 16,
    });
    const info = await getModelArchitectureInfo(undefined, 'qwen3.5:9b');
    expect(info.blockCount).toBe(32);
    expect(info.embeddingLength).toBe(4096);
    expect(info.headCount).toBe(16);
    expect(info.headCountKv).toBe(8);
    expect(info.attentionKind).toBe('GQA');
  });

  it('parses per-layer head_count_kv arrays as hybrid attention', async () => {
    // qwen3.5:9b 실측 — 32층 중 8층만 어텐션(층당 KV 4헤드)
    const kvArray = Array.from({ length: 32 }, (_, i) => (i % 4 === 3 ? 4 : 0));
    mockShow({
      'general.architecture': 'qwen35',
      'qwen35.block_count': 32,
      'qwen35.embedding_length': 4096,
      'qwen35.attention.head_count': 16,
      'qwen35.attention.head_count_kv': kvArray,
    });
    const info = await getModelArchitectureInfo(undefined, 'qwen3.5:9b');
    expect(info.attentionKind).toBe('hybrid');
    expect(info.attentionLayers).toBe(8);
    expect(info.kvHeadsTotal).toBe(32);
    expect(info.headCountKv).toBe(4);
    // 8층 x 4헤드 x dim 256 x 64k x F16 = 2,147,483,648 (약 2.1GB)
    expect(calculateHybridKvCacheBytes(32, 256, 65536, 2)).toBe(2147483648);
  });

  it('judges MHA/MQA/unknown without fabricating KV heads', async () => {
    mockShow({
      'qwen35.attention.head_count': 16,
      'qwen35.attention.head_count_kv': 16,
    });
    expect((await getModelArchitectureInfo(undefined, 'm')).attentionKind).toBe('MHA');

    mockShow({ 'llama.attention.head_count': 32, 'llama.attention.head_count_kv': 1 });
    expect((await getModelArchitectureInfo(undefined, 'm')).attentionKind).toBe('MQA');

    mockShow({ 'llama.attention.head_count': 32 });
    const unknown = await getModelArchitectureInfo(undefined, 'm');
    expect(unknown.attentionKind).toBe('unknown');
    expect(unknown.headCountKv).toBe(0);
    expect(calculateEstimatedKvCacheBytes(32, 0, 4096, 32, 65536)).toBe(0);
  });
});
