// P11-23: 외부 에이전트 런타임. 매 턴 대화를 프롬프트로 만들어 CLI에 1회
// 실행하고 결과를 단일 청크로 반환한다 (D3). 우리 루프의 도구 호출은 없다.
import { callIntegration } from '@/lib/integrations/gateway';
import type { LlmChunk, LlmStreamChatFn } from '@/lib/llm/providerRuntime';

export interface ExternalAgentBinding {
  integrationId: string;
  cwd?: string;
}

/**
 * getStreamChatFn과 같은 시그니처의 스트리밍 함수.
 * 권한 검사·감사 로그는 게이트웨이(callIntegration)가 담당한다.
 */
export function getExternalAgentStreamFn(binding: ExternalAgentBinding): LlmStreamChatFn {
  return async function* (req, signal): AsyncIterable<LlmChunk> {
    const startedAt = Date.now();
    yield { thinking: '외부 에이전트 실행 중…', done: false };
    const res = await callIntegration(
      binding.integrationId,
      {
        purpose: 'chat-agent',
        dataClasses: ['personal'],
        messages: req.messages.map((m) => ({ role: m.role, content: m.content ?? '' })),
        temperature: req.temperature,
        maxTokens: req.maxTokens,
        cwd: binding.cwd,
      },
      signal,
    );
    if (!res.ok) {
      throw new Error(res.error ?? res.reasonKey);
    }
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    yield { content: res.text, done: true, thinking: `외부 에이전트 실행 완료 (${elapsed}s)` };
  };
}
