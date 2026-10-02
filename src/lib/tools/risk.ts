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
  fs_info: 'low',
  fs_search: 'low',
  explorer: 'low',
  doc_read: 'low',
  write: 'high',
  edit: 'high',
  fs_copy: 'high',
  fs_move: 'high',
  fs_rename: 'high',
  fs_mkdir: 'high',
  fs_trash: 'high',
  fs_zip: 'high',
  fs_unzip: 'high',
  shell: 'critical',
};

export function getToolRisk(toolName: string): RiskLevel {
  return (TOOL_RISK_MAP as Record<string, RiskLevel>)[toolName] ?? 'high';
}
