import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkProviderModel,
  listProviderModelsWithFallback,
  loopbackFallbackUrl,
} from './providerRuntime';
import { listModels as listOpenAiModels } from './openAiCompatibleClient';
import { listModels as listOllamaModels, showModel as showOllamaModel } from './ollamaClient';

vi.mock('./openAiCompatibleClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./openAiCompatibleClient')>();
  return { ...actual, listModels: vi.fn() };
});

vi.mock('./ollamaClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ollamaClient')>();
  return { ...actual, listModels: vi.fn(), showModel: vi.fn() };
});

const mockedListOpenAiModels = vi.mocked(listOpenAiModels);
const mockedListOllamaModels = vi.mocked(listOllamaModels);
const mockedShowOllamaModel = vi.mocked(showOllamaModel);

function ollamaRuntime(baseUrl: string) {
  return {
    kind: 'ollama' as const,
    preset: {
      kind: 'ollama' as const,
      label: 'Ollama',
      defaultBaseUrl: 'http://127.0.0.1:11434',
      category: 'local' as const,
      openAiCompatible: false,
      supportsApiKey: false,
      requiresApiKey: false,
      supportsModelList: true,
      supportsAutoContextSize: true,
      hint: '',
    },
    baseUrl,
    apiKey: undefined,
    openAiCompatible: false,
  };
}

function openAiRuntime(baseUrl: string) {
  return {
    kind: 'lmstudio' as const,
    preset: {
      kind: 'lmstudio' as const,
      label: 'LM Studio',
      defaultBaseUrl: 'http://localhost:1234/v1',
      category: 'local' as const,
      openAiCompatible: true,
      supportsApiKey: true,
      requiresApiKey: false,
      supportsModelList: true,
      supportsAutoContextSize: false,
      hint: '',
    },
    baseUrl,
    apiKey: undefined,
    openAiCompatible: true,
  };
}

describe('loopbackFallbackUrl', () => {
  it('swaps 127.0.0.1 and localhost symmetrically', () => {
    expect(loopbackFallbackUrl('http://127.0.0.1:1234/v1')).toBe('http://localhost:1234/v1');
    expect(loopbackFallbackUrl('http://localhost:1234/v1')).toBe('http://127.0.0.1:1234/v1');
  });

  it('returns null for non-loopback hosts and invalid URLs', () => {
    expect(loopbackFallbackUrl('https://api.openai.com/v1')).toBeNull();
    expect(loopbackFallbackUrl('http://192.168.0.5:1234/v1')).toBeNull();
    expect(loopbackFallbackUrl('not a url')).toBeNull();
  });
});

describe('listProviderModelsWithFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns primary result without fallback when reachable', async () => {
    mockedListOpenAiModels.mockResolvedValue([{ id: 'qwen3-8b' }]);
    const result = await listProviderModelsWithFallback(openAiRuntime('http://localhost:1234/v1'));
    expect(result).toEqual({
      models: [{ name: 'qwen3-8b' }],
      baseUrl: 'http://localhost:1234/v1',
      fromFallback: false,
    });
    expect(mockedListOpenAiModels).toHaveBeenCalledTimes(1);
  });

  it('retries the alternate loopback host when the primary fails', async () => {
    mockedListOpenAiModels.mockRejectedValueOnce(new Error('Failed to fetch'));
    mockedListOpenAiModels.mockResolvedValueOnce([{ id: 'qwen3-8b' }]);
    const result = await listProviderModelsWithFallback(openAiRuntime('http://localhost:1234/v1'));
    expect(result.fromFallback).toBe(true);
    expect(result.baseUrl).toBe('http://127.0.0.1:1234/v1');
    expect(result.models).toEqual([{ name: 'qwen3-8b' }]);
    expect(mockedListOpenAiModels).toHaveBeenCalledTimes(2);
  });

  it('throws when both loopback variants fail', async () => {
    mockedListOpenAiModels.mockRejectedValue(new Error('Failed to fetch'));
    await expect(
      listProviderModelsWithFallback(openAiRuntime('http://localhost:1234/v1')),
    ).rejects.toThrow('Failed to fetch');
    expect(mockedListOpenAiModels).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-loopback hosts', async () => {
    mockedListOpenAiModels.mockRejectedValue(new Error('Unauthorized'));
    await expect(
      listProviderModelsWithFallback(openAiRuntime('https://api.openai.com/v1')),
    ).rejects.toThrow('Unauthorized');
    expect(mockedListOpenAiModels).toHaveBeenCalledTimes(1);
  });
});

describe('checkProviderModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns connected when the model is in the OpenAI-compatible list', async () => {
    mockedListOpenAiModels.mockResolvedValue([{ id: 'qwen3-8b' }]);
    await expect(
      checkProviderModel(openAiRuntime('http://127.0.0.1:1234/v1'), 'QWEN3-8B'),
    ).resolves.toBe('connected');
  });

  it('returns model-missing when the server responds but the model is absent', async () => {
    mockedListOpenAiModels.mockResolvedValue([{ id: 'other-model' }]);
    await expect(
      checkProviderModel(openAiRuntime('http://127.0.0.1:1234/v1'), 'qwen3-8b'),
    ).resolves.toBe('model-missing');
  });

  it('throws when the server itself is unreachable', async () => {
    mockedListOpenAiModels.mockRejectedValue(new Error('Failed to fetch'));
    await expect(
      checkProviderModel(openAiRuntime('http://127.0.0.1:1234/v1'), 'qwen3-8b'),
    ).rejects.toThrow('Failed to fetch');
  });

  it('falls back to /api/show for unlisted Ollama models', async () => {
    mockedListOllamaModels.mockResolvedValue([{ name: 'a', size: 0, digest: '', modified_at: '' }]);
    mockedShowOllamaModel.mockResolvedValue({ contextLength: 8192, supportsTools: true });
    await expect(
      checkProviderModel(ollamaRuntime('http://127.0.0.1:11434'), 'b'),
    ).resolves.toBe('connected');
  });

  it('returns model-missing when Ollama is reachable but the model is unknown', async () => {
    mockedListOllamaModels.mockResolvedValue([{ name: 'a', size: 0, digest: '', modified_at: '' }]);
    mockedShowOllamaModel.mockRejectedValue(new Error('not found'));
    await expect(
      checkProviderModel(ollamaRuntime('http://127.0.0.1:11434'), 'b'),
    ).resolves.toBe('model-missing');
  });
});
