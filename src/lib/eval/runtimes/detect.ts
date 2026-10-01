import { evalDetectRuntimes, type EvalRuntimesInfo } from '../ipc';

let cached: Promise<EvalRuntimesInfo> | null = null;

export function detectRuntimesCached(): Promise<EvalRuntimesInfo> {
  if (!cached) {
    cached = evalDetectRuntimes();
  }
  return cached;
}

export function clearRuntimesCache(): void {
  cached = null;
}
