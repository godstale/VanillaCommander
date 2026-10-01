import { registerHooks } from '@/lib/agent/hookRegistry';
import type { ApprovalMode } from '@/lib/types/agent';
import { needsApproval } from './policy';
import { approvalBus } from './approvalBus';

let currentApprovalMode: ApprovalMode = 'dangerous-only';

/**
 * Updates the active approval mode for the running agent session.
 */
export function setActiveApprovalMode(mode: ApprovalMode): void {
  currentApprovalMode = mode;
}

export function getActiveApprovalMode(): ApprovalMode {
  return currentApprovalMode;
}

// Register HITL approval hook
registerHooks('approval', {
  async beforeToolCall(ctx, signal) {
    const required = needsApproval({
      toolName: ctx.toolName,
      approvalMode: currentApprovalMode,
      sessionOverrides: approvalBus.getSessionOverrides(),
      risk: ctx.risk,
    });

    if (!required) {
      return undefined;
    }

    const reqId = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const decision = await approvalBus.request(
      {
        id: reqId,
        toolCallId: ctx.toolCallId,
        toolName: ctx.toolName,
        arguments: ctx.arguments,
        risk: ctx.risk,
      },
      signal,
    );

    if (!decision.approved) {
      return {
        block: true,
        reason:
          decision.reason?.trim() ||
          `Tool execution of '${ctx.toolName}' was declined by user.`,
      };
    }

    return undefined;
  },
});
