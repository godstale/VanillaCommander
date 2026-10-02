import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveVisionSupport } from './vision';
import { mapAgentMessagesToOllama, mapAgentMessagesToOpenAi } from './messageMapper';
import type { AgentMessage } from '@/lib/agent/types';

vi.mock('./ollamaClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ollamaClient')>();
  return {
    ...actual,
    showModel: vi.fn(),
  };
});

import { showModel } from './ollamaClient';

const mockedShowModel = vi.mocked(showModel);

describe('resolveVisionSupport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns explicit 'yes' without probing the server", async () => {
    const v = await resolveVisionSupport({
      vision: 'yes',
      llmProvider: 'ollama',
      llmBaseUrl: undefined,
      model: 'llama3.1',
    });
    expect(v).toBe('yes');
    expect(mockedShowModel).not.toHaveBeenCalled();
  });

  it("returns explicit 'no' without probing the server", async () => {
    const v = await resolveVisionSupport({
      vision: 'no',
      llmProvider: 'ollama',
      llmBaseUrl: undefined,
      model: 'llama3.1',
    });
    expect(v).toBe('no');
    expect(mockedShowModel).not.toHaveBeenCalled();
  });

  it("returns 'unknown' for non-Ollama providers in auto mode", async () => {
    const v = await resolveVisionSupport({
      vision: 'auto',
      llmProvider: 'openai',
      llmBaseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
    });
    expect(v).toBe('unknown');
    expect(mockedShowModel).not.toHaveBeenCalled();
  });

  it("maps Ollama vision capability to 'yes'", async () => {
    mockedShowModel.mockResolvedValueOnce({
      contextLength: 8192,
      supportsTools: true,
      supportsVision: true,
    });
    const v = await resolveVisionSupport({
      vision: 'auto',
      llmProvider: 'ollama',
      llmBaseUrl: undefined,
      model: 'qwen3-vl',
    });
    expect(v).toBe('yes');
  });

  it("maps missing Ollama vision capability to 'no'", async () => {
    mockedShowModel.mockResolvedValueOnce({
      contextLength: 8192,
      supportsTools: true,
      supportsVision: false,
    });
    const v = await resolveVisionSupport({
      vision: 'auto',
      llmProvider: 'ollama',
      llmBaseUrl: undefined,
      model: 'llama3.1',
    });
    expect(v).toBe('no');
  });

  it("returns 'unknown' when the Ollama probe fails", async () => {
    mockedShowModel.mockRejectedValueOnce(new Error('connection refused'));
    const v = await resolveVisionSupport({
      vision: 'auto',
      llmProvider: 'ollama',
      llmBaseUrl: undefined,
      model: 'llama3.1',
    });
    expect(v).toBe('unknown');
  });
});

describe('message image mapping', () => {
  const userWithImages: AgentMessage = {
    role: 'user',
    content: '이 사진을 설명해줘',
    images: ['data:image/png;base64,AAA', 'data:image/jpeg;base64,BBB'],
  };

  it('passes images through to Ollama messages', () => {
    const mapped = mapAgentMessagesToOllama([userWithImages]);
    expect(mapped).toHaveLength(1);
    const msg = mapped[0] as { role: string; content: string; images?: string[] };
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('이 사진을 설명해줘');
    expect(msg.images).toEqual(['data:image/png;base64,AAA', 'data:image/jpeg;base64,BBB']);
  });

  it('omits the images field for Ollama messages without images', () => {
    const mapped = mapAgentMessagesToOllama([{ role: 'user', content: 'plain' }]);
    const msg = mapped[0] as { role: string; images?: string[] };
    expect(msg.images).toBeUndefined();
  });

  it('converts images to OpenAI image_url content parts', () => {
    const mapped = mapAgentMessagesToOpenAi([userWithImages]);
    expect(mapped).toHaveLength(1);
    const msg = mapped[0] as {
      role: string;
      content: Array<{ type: string; text?: string; image_url?: { url: string } }>;
    };
    expect(msg.role).toBe('user');
    expect(msg.content).toEqual([
      { type: 'text', text: '이 사진을 설명해줘' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBB' } },
    ]);
  });

  it('keeps plain string content for OpenAI messages without images', () => {
    const mapped = mapAgentMessagesToOpenAi([{ role: 'user', content: 'plain' }]);
    const msg = mapped[0] as { role: string; content: unknown };
    expect(msg.content).toBe('plain');
  });
});
