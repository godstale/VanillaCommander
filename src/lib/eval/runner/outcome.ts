import type { TrialOutcome } from '../types';

export function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  const message = err instanceof Error ? err.message : String(err);
  return message.toLowerCase().includes('abort');
}

export function classifyOutcome(err: unknown, timedOut: boolean): TrialOutcome {
  if (timedOut) return 'timeout';
  if (isAbortError(err)) return 'cancelled';
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (
    lower.includes('out of memory') ||
    lower.includes('cuda error') ||
    lower.includes('insufficient memory') ||
    lower.includes('vram')
  ) {
    return 'oom';
  }
  if (lower.includes('max turns') || lower.includes('max_turns')) return 'max_turns';
  if (lower.includes('tool') && lower.includes('pars')) return 'parse_error';
  return 'provider_error';
}
