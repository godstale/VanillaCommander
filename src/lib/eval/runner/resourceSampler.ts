import { getRunningModels, getSystemGpuInfo } from '@/lib/llm/ollamaClient';

export interface ResourceSample {
  vramUsedMb: number | null;
  gpuUtilPct: number | null;
  gpuTempC: number | null;
  offloadRatio: number | null;
}

export interface ResourceSummary {
  vramPeakMb: number | null;
  gpuUtilAvg: number | null;
  gpuTempMax: number | null;
  offloadRatio: number | null;
}

export class ResourceSampler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private samples: ResourceSample[] = [];
  private intervalMs: number;
  private baseUrl: string | null;
  private model: string | null;
  private isOllama: boolean;

  constructor(opts: { intervalMs?: number; baseUrl?: string; model?: string; isOllama?: boolean } = {}) {
    this.intervalMs = opts.intervalMs ?? 1000;
    this.baseUrl = opts.baseUrl ?? null;
    this.model = opts.model ?? null;
    this.isOllama = opts.isOllama ?? true;
  }

  start(): void {
    if (this.timer) return;
    void this.collect();
    this.timer = setInterval(() => {
      void this.collect();
    }, this.intervalMs);
  }

  stop(): ResourceSummary {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return summarize(this.samples);
  }

  latest(): ResourceSample | null {
    return this.samples.length > 0 ? this.samples[this.samples.length - 1] : null;
  }

  private async collect(): Promise<void> {
    const sample: ResourceSample = { vramUsedMb: null, gpuUtilPct: null, gpuTempC: null, offloadRatio: null };
    try {
      const info = await getSystemGpuInfo();
      sample.vramUsedMb = info.vramUsedMb;
      sample.gpuUtilPct = info.gpuUtilizationPct;
      sample.gpuTempC = info.gpuTemperatureC;
    } catch {
      // non-NVIDIA or headless — leave nulls
    }
    if (this.isOllama && this.baseUrl && this.model) {
      try {
        const running = await getRunningModels(this.baseUrl);
        const entry = running.find(
          (m) => m.name === this.model || m.model === this.model,
        );
        if (entry && entry.size > 0) {
          sample.offloadRatio = entry.size_vram / entry.size;
        }
      } catch {
        // ignore
      }
    }
    this.samples.push(sample);
  }
}

export function summarize(samples: ResourceSample[]): ResourceSummary {
  const vram = samples.map((s) => s.vramUsedMb).filter((v): v is number => v !== null);
  const util = samples.map((s) => s.gpuUtilPct).filter((v): v is number => v !== null);
  const temp = samples.map((s) => s.gpuTempC).filter((v): v is number => v !== null);
  const offload = samples.map((s) => s.offloadRatio).filter((v): v is number => v !== null);
  const median = (xs: number[]): number | null => {
    if (xs.length === 0) return null;
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  return {
    vramPeakMb: vram.length > 0 ? Math.max(...vram) : null,
    gpuUtilAvg: util.length > 0 ? util.reduce((a, b) => a + b, 0) / util.length : null,
    gpuTempMax: temp.length > 0 ? Math.max(...temp) : null,
    offloadRatio: median(offload),
  };
}
