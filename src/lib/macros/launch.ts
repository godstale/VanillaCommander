// P11-40: 매크로 수동 실행. 매크로 전용 숨은 세션(origin='macro')을 만들고
// 프롬프트를 대기 큐에 넣은 뒤 채팅 탭을 연다 (큐 처리는 ChatTab이 담당).
import * as sessionsRepo from '@/lib/db/repositories/sessionsRepo';
import { chatQueueManager } from '@/lib/agent/chatQueueManager';
import { parseSkillCommand } from '@/lib/skills/invokeSkill';
import type { Macro } from './types';

export interface OpenTabFn {
  (tab: { id: string; type: 'chat'; title: string; meta?: Record<string, unknown> }): void;
}

function toQueueItems(prompts: string[]): Array<{
  text: string;
  type: 'message' | 'slash_command' | 'skill';
  commandName?: string;
  commandArgs?: string;
}> {
  return prompts
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((text) => {
      const slashMatch = text.match(/^\/(\w+)(?:\s+([\s\S]*))?$/);
      if (slashMatch) {
        return {
          text,
          type: 'slash_command' as const,
          commandName: slashMatch[1].toLowerCase(),
          commandArgs: slashMatch[2]?.trim(),
        };
      }
      if (parseSkillCommand(text)) {
        return { text, type: 'skill' as const };
      }
      return { text, type: 'message' as const };
    });
}

/** 매크로 실행 세션을 준비하고 프롬프트를 큐에 넣는다. 탭 열기는 호출자가 한다. */
export async function launchMacroRun(
  macro: Macro,
  agentId: string,
  openTab: OpenTabFn,
  opts: { refreshSessions?: () => Promise<void>; updateSessionTitle?: (id: string, title: string) => Promise<void> } = {},
): Promise<string> {
  const sessionId = `macro:${macro.id}`;
  const existing = await sessionsRepo.getSession(sessionId);
  if (!existing) {
    await sessionsRepo.createSession({
      id: sessionId,
      agentId,
      workspaceRoot: null,
      origin: 'macro',
      title: macro.name,
    });
    await opts.refreshSessions?.();
  } else if (existing.agentId !== agentId) {
    // 실행 에이전트가 바뀌면 세션 귀속을 갱신한다.
    await sessionsRepo.updateSession(sessionId, { agentId });
  }
  for (const item of toQueueItems(macro.prompts)) {
    chatQueueManager.enqueue(sessionId, item);
  }
  openTab({
    id: `chat:${sessionId}`,
    type: 'chat',
    title: macro.name,
    meta: { sessionId, agentId },
  });
  return sessionId;
}
