// P11-22: 평가 시절 `llm-api` 연동 레코드를 클라우드 프로바이더 에이전트로
// 1회 변환한다. 변환된 레코드는 삭제하므로 재실행해도 no-op이다.
import * as agentsRepo from '@/lib/db/repositories/agentsRepo';
import {
  deleteIntegration,
  listIntegrations,
} from '@/lib/db/repositories/integrationsRepo';
import { DEFAULT_AGENT } from '@/lib/agent/defaultAgent';
import {
  APP_DEFAULT_APPROVAL_MODE,
  APP_DEFAULT_BUILTIN_TOOLS,
  APP_DEFAULT_SKILLS,
  APP_DEFAULT_TEMPERATURE,
} from '@/lib/agent/defaults';

/** 변환된 에이전트 수. 실패한 레코드는 남겨 다음 기회에 재시도한다. */
export async function migrateLlmApiToAgents(): Promise<number> {
  let integrations;
  try {
    integrations = await listIntegrations();
  } catch {
    return 0;
  }
  const targets = integrations.filter((it) => it.kind === 'llm-api' && it.llm);
  let migrated = 0;
  for (const it of targets) {
    const llm = it.llm;
    if (!llm) continue;
    try {
      await agentsRepo.createAgent({
        id: crypto.randomUUID(),
        name: it.name,
        description: `외부 연동 '${it.name}'에서 이관됨. 저장 시 외부 전송 동의를 다시 확인하세요.`,
        systemPrompt: DEFAULT_AGENT.systemPrompt,
        model: llm.model,
        temperature: APP_DEFAULT_TEMPERATURE,
        contextSize: 0,
        reserveTokens: 0,
        keepRecentTokens: 0,
        enabledSkills: [...APP_DEFAULT_SKILLS],
        enabledBuiltinTools: [...APP_DEFAULT_BUILTIN_TOOLS],
        approvalMode: APP_DEFAULT_APPROVAL_MODE,
        llmProvider: llm.provider,
        llmBaseUrl: llm.baseUrl || undefined,
        llmApiKey: llm.apiKey,
        autoMonitor: true,
        isDefault: false,
      });
      await deleteIntegration(it.id);
      migrated += 1;
    } catch (err) {
      console.warn(`[integrations] llm-api migration skipped for ${it.id}:`, err);
    }
  }
  return migrated;
}
