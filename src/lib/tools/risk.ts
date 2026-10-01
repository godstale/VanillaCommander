import type { BuiltinToolId } from '@/lib/types/agent';
import type { RiskLevel } from '@/lib/agent/types';

export const TOOL_RISK_MAP: Record<BuiltinToolId, RiskLevel> = {
  read: 'low',
  ls: 'low',
  grep: 'low',
  find: 'low',
  web_search: 'low',
  web_fetch: 'low',
  wiki: 'low',
  write: 'high',
  edit: 'high',
  shell: 'critical',
};

export function getToolRisk(toolName: string): RiskLevel {
  return (TOOL_RISK_MAP as Record<string, RiskLevel>)[toolName] ?? 'high';
}
