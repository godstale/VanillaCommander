import { getSystemGpuInfo } from '@/lib/llm/ollamaClient';
import type { HardwareFingerprint } from '../types';

const APP_VERSION = '0.1.0';

async function ollamaVersion(baseUrl: string): Promise<string> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/version`);
    if (!res.ok) return 'unknown';
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === 'string' ? data.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function collectHardware(baseUrl?: string): Promise<HardwareFingerprint> {
  let gpuName = 'unknown';
  let vramTotalMb = 0;
  let isNvidia = false;
  let ramTotalMb = 0;
  try {
    const info = await getSystemGpuInfo();
    gpuName = info.gpuName ?? 'unknown';
    vramTotalMb = info.vramTotalMb ?? 0;
    isNvidia = info.isNvidia;
    ramTotalMb = info.systemMemoryTotalMb ?? 0;
  } catch {
    // headless / test environments
  }
  const os =
    typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? navigator.userAgent
      : 'unknown';
  const providerVersions: Record<string, string> = {};
  if (baseUrl) {
    providerVersions.ollama = await ollamaVersion(baseUrl);
  }
  return {
    gpuName,
    vramTotalMb,
    isNvidia,
    ramTotalMb,
    os,
    appVersion: APP_VERSION,
    providerVersions,
  };
}
