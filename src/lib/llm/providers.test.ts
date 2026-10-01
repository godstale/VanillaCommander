import { describe, it, expect } from 'vitest';
import {
  LLM_PROVIDER_ORDER,
  LLM_PROVIDER_PRESETS,
  getProviderPreset,
  normalizeProviderFields,
  resolveAgentLlmRuntime,
} from './providers';

describe('llm providers', () => {
  it('exposes researched default endpoints for local runtimes', () => {
    expect(LLM_PROVIDER_PRESETS.ollama.defaultBaseUrl).toBe('http://127.0.0.1:11434');
    expect(LLM_PROVIDER_PRESETS.lmstudio.defaultBaseUrl).toBe('http://localhost:1234/v1');
    expect(LLM_PROVIDER_PRESETS.llamacpp.defaultBaseUrl).toBe('http://127.0.0.1:8080/v1');
    expect(LLM_PROVIDER_PRESETS.vllm.defaultBaseUrl).toBe('http://127.0.0.1:8000/v1');
    expect(LLM_PROVIDER_PRESETS.jan.defaultBaseUrl).toBe('http://127.0.0.1:1337/v1');
    expect(LLM_PROVIDER_PRESETS.openai.defaultBaseUrl).toBe('https://api.openai.com/v1');
  });

  it('marks only ollama as native, everything else OpenAI-compatible', () => {
    expect(LLM_PROVIDER_PRESETS.ollama.openAiCompatible).toBe(false);
    for (const kind of LLM_PROVIDER_ORDER.filter((k) => k !== 'ollama')) {
      expect(LLM_PROVIDER_PRESETS[kind].openAiCompatible).toBe(true);
    }
  });

  it('requires apiKey for cloud/gateway presets, not for local runtimes', () => {
    expect(LLM_PROVIDER_PRESETS.openai.requiresApiKey).toBe(true);
    expect(LLM_PROVIDER_PRESETS.anthropic.requiresApiKey).toBe(true);
    expect(LLM_PROVIDER_PRESETS.gemini.requiresApiKey).toBe(true);
    expect(LLM_PROVIDER_PRESETS.xai.requiresApiKey).toBe(true);
    expect(LLM_PROVIDER_PRESETS.deepseek.requiresApiKey).toBe(true);
    expect(LLM_PROVIDER_PRESETS.openrouter.requiresApiKey).toBe(true);
    expect(LLM_PROVIDER_PRESETS.lmstudio.requiresApiKey).toBe(false);
    expect(LLM_PROVIDER_PRESETS.jan.requiresApiKey).toBe(false);
    expect(LLM_PROVIDER_PRESETS.ollama.supportsApiKey).toBe(false);
  });

  it('exposes cloud preset endpoints and representative default models', () => {
    expect(LLM_PROVIDER_PRESETS.gemini.defaultBaseUrl).toContain('googleapis');
    expect(LLM_PROVIDER_PRESETS.xai.defaultBaseUrl).toBe('https://api.x.ai/v1');
    expect(LLM_PROVIDER_PRESETS.deepseek.defaultBaseUrl).toBe('https://api.deepseek.com/v1');
    expect(LLM_PROVIDER_PRESETS.openrouter.defaultBaseUrl).toBe('https://openrouter.ai/api/v1');
    expect(LLM_PROVIDER_PRESETS.openai.defaultModel).toBe('gpt-4o-mini');
    expect(LLM_PROVIDER_PRESETS['openai-compatible'].category).toBe('local');
    expect(LLM_PROVIDER_PRESETS.openrouter.category).toBe('gateway');
  });

  it('falls back to ollama preset for unknown kinds', () => {
    expect(getProviderPreset(undefined).kind).toBe('ollama');
  });

  it('resolveAgentLlmRuntime uses global Ollama URL for legacy agents', () => {
    const runtime = resolveAgentLlmRuntime({}, 'http://192.168.0.2:11434');
    expect(runtime.kind).toBe('ollama');
    expect(runtime.baseUrl).toBe('http://192.168.0.2:11434');
    expect(runtime.openAiCompatible).toBe(false);
  });

  it('resolveAgentLlmRuntime uses preset defaults when agent has no baseUrl', () => {
    const runtime = resolveAgentLlmRuntime({ llmProvider: 'lmstudio' }, 'http://127.0.0.1:11434');
    expect(runtime.baseUrl).toBe('http://localhost:1234/v1');
    expect(runtime.openAiCompatible).toBe(true);
  });

  it('resolveAgentLlmRuntime prefers agent-specific baseUrl and trims apiKey', () => {
    const runtime = resolveAgentLlmRuntime(
      { llmProvider: 'vllm', llmBaseUrl: 'http://gpu-server:8000/v1/', llmApiKey: '  secret ' },
      undefined,
    );
    expect(runtime.baseUrl).toBe('http://gpu-server:8000/v1');
    expect(runtime.apiKey).toBe('secret');
  });

  it('normalizeProviderFields stores empty baseUrl when equal to preset default', () => {
    const normalized = normalizeProviderFields({
      llmProvider: 'jan',
      llmBaseUrl: 'http://127.0.0.1:1337/v1',
      llmApiKey: '  x  ',
    });
    expect(normalized).toEqual({ llmProvider: 'jan', llmBaseUrl: '', llmApiKey: 'x' });
  });

  it('normalizeProviderFields keeps custom baseUrl', () => {
    const normalized = normalizeProviderFields({
      llmProvider: 'openai-compatible',
      llmBaseUrl: 'http://nas:8000/v1',
    });
    expect(normalized.llmBaseUrl).toBe('http://nas:8000/v1');
  });

  it('appends /v1 to OpenAI-compatible base URLs without a version path', () => {
    // LM Studio가 표시하는 주소 형태 (http://127.0.0.1:1234)를 그대로 입력해도
    // /v1/models, /v1/chat/completions 요청 경로가 맞도록 보정한다.
    const runtime = resolveAgentLlmRuntime({ llmProvider: 'lmstudio', llmBaseUrl: 'http://127.0.0.1:1234' });
    expect(runtime.baseUrl).toBe('http://127.0.0.1:1234/v1');
  });

  it('keeps existing version paths and never touches ollama native URLs', () => {
    expect(
      resolveAgentLlmRuntime({ llmProvider: 'openai', llmBaseUrl: 'https://api.openai.com/v1/' }).baseUrl,
    ).toBe('https://api.openai.com/v1');
    expect(
      resolveAgentLlmRuntime({ llmProvider: 'openai-compatible', llmBaseUrl: 'https://x.ai:8443/custom' }).baseUrl,
    ).toBe('https://x.ai:8443/custom');
    expect(
      resolveAgentLlmRuntime({ llmProvider: 'ollama', llmBaseUrl: 'http://127.0.0.1:11434' }).baseUrl,
    ).toBe('http://127.0.0.1:11434');
  });

  it('normalizeProviderFields treats a suffix-less URL equal to the preset default as default', () => {
    const normalized = normalizeProviderFields({
      llmProvider: 'lmstudio',
      llmBaseUrl: 'http://localhost:1234',
    });
    expect(normalized.llmBaseUrl).toBe('');
  });
});
