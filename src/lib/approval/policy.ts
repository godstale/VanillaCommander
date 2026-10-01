import type { ApprovalMode } from '@/lib/types/agent';
import type { RiskLevel } from '@/lib/agent/types';
import { getToolRisk } from '@/lib/tools/risk';

export interface NeedsApprovalOptions {
  toolName: string;
  approvalMode: ApprovalMode;
  sessionOverrides?: Set<string>;
  risk?: RiskLevel;
}

/**
 * Checks whether a tool call requires human approval according to approvalMode and risk level.
 *
 * Truth Table (§8.1):
 * - "always": all tools require approval.
 * - "dangerous-only" (default): "high" or "critical" tools require approval.
 * - "never": "high" is auto-approved, but "critical" (shell) STILL requires approval.
 * - Session overrides ("always approve this tool for this session") skip approval.
 */
export function needsApproval(
  toolNameOrOptions: string | NeedsApprovalOptions,
  mode?: ApprovalMode,
  sessionOverrides?: Set<string>,
): boolean {
  let toolName: string;
  let approvalMode: ApprovalMode = 'dangerous-only';
  let overrides = sessionOverrides;
  let customRisk: RiskLevel | undefined;

  if (typeof toolNameOrOptions === 'object') {
    toolName = toolNameOrOptions.toolName;
    approvalMode = toolNameOrOptions.approvalMode;
    overrides = toolNameOrOptions.sessionOverrides ?? sessionOverrides;
    customRisk = toolNameOrOptions.risk;
  } else {
    toolName = toolNameOrOptions;
    if (mode) approvalMode = mode;
  }

  // If user previously selected "always approve this tool in this session"
  if (overrides && overrides.has(toolName)) {
    return false;
  }

  const risk = customRisk ?? getToolRisk(toolName);

  switch (approvalMode) {
    case 'always':
      return true;

    case 'dangerous-only':
      return risk === 'high' || risk === 'critical';

    case 'never':
      // shell (critical) must still require approval even in 'never' mode (§8.1)
      return risk === 'critical';

    default:
      return risk === 'high' || risk === 'critical';
  }
}
