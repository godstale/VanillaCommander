import type { AgentHooks } from '@/lib/agent/hooks';

export const EVAL_SANDBOX_BLOCK_REASON = 'blocked by evaluation sandbox policy';

const ALLOWED_TOOL_NAMES = new Set(['read', 'ls', 'grep', 'find', 'write', 'edit']);

const PATH_ARG_KEYS = [
  'path',
  'filePath',
  'file_path',
  'filename',
  'file',
  'dir',
  'directory',
  'dirPath',
  'dir_path',
  'folder',
  'pwd',
  'cwd',
  'root',
];

export interface SandboxPolicyCounter {
  count: number;
}

export interface SandboxPolicyHooks extends AgentHooks {
  blockedToolCalls: SandboxPolicyCounter;
}

function normalizeForCompare(p: string): string {
  let s = p.replace(/\\/g, '/');
  s = s.replace(/^([/]{2}\?[/]|[/]{2}\.[^/]*[/]|[/]{2})/, '');
  s = s.replace(/^[A-Za-z]:/, (m) => m.toLowerCase());
  return s;
}

function splitRoot(s: string): { prefix: string; rest: string } {
  const drive = s.match(/^[a-z]:/);
  if (drive) {
    return { prefix: `${drive[0]}/`, rest: s.slice(2).replace(/^\/+/, '') };
  }
  if (s.startsWith('/')) {
    return { prefix: '/', rest: s.replace(/^\/+/, '') };
  }
  return { prefix: '', rest: s };
}

function collapseSegments(rest: string): string[] {
  const out: string[] = [];
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out;
}

export function isPathInSandbox(sandboxRoot: string, rawPath: string): boolean {
  const trimmed = rawPath.trim();
  if (!trimmed) return true;
  const rootN = normalizeForCompare(sandboxRoot).replace(/\/+$/, '');
  const rawN = normalizeForCompare(trimmed);
  const root = splitRoot(rootN);
  const raw = splitRoot(rawN);
  const combined = raw.prefix
    ? `${raw.prefix}${raw.rest}`
    : `${root.prefix}${root.rest ? `${root.rest}/` : ''}${raw.rest}`;
  const resolved = splitRoot(combined);
  if (resolved.prefix.toLowerCase() !== root.prefix.toLowerCase()) return false;
  const resolvedSegs = collapseSegments(resolved.rest);
  const rootSegs = collapseSegments(root.rest);
  if (resolvedSegs.length < rootSegs.length) return false;
  for (let i = 0; i < rootSegs.length; i++) {
    if (resolvedSegs[i] !== rootSegs[i]) return false;
  }
  return true;
}

export function sandboxPolicyHooks(sandboxRoot: string): SandboxPolicyHooks {
  const blockedToolCalls: SandboxPolicyCounter = { count: 0 };
  return {
    blockedToolCalls,
    async beforeToolCall(ctx) {
      if (!ALLOWED_TOOL_NAMES.has(ctx.toolName)) {
        blockedToolCalls.count += 1;
        return { block: true, reason: EVAL_SANDBOX_BLOCK_REASON };
      }
      const args =
        ctx.arguments !== null && typeof ctx.arguments === 'object' && !Array.isArray(ctx.arguments)
          ? (ctx.arguments as Record<string, unknown>)
          : {};
      for (const key of PATH_ARG_KEYS) {
        const value = args[key];
        if (typeof value === 'string' && value.trim() !== '' && !isPathInSandbox(sandboxRoot, value)) {
          blockedToolCalls.count += 1;
          return { block: true, reason: `${EVAL_SANDBOX_BLOCK_REASON}: path outside sandbox` };
        }
      }
      return undefined;
    },
  };
}
