import { chatQueueManager } from '@/lib/agent/chatQueueManager';
import { getProviderPreset } from '@/lib/llm/providers';
import {
  calculateEstimatedKvCacheBytes,
  getModelArchitectureInfo,
  getSystemGpuInfo,
  listModels as listOllamaModels,
  showModel,
} from '@/lib/llm/ollamaClient';
import { checkProviderModel, listProviderModels } from '@/lib/llm/providerRuntime';
import { resolveAgentLlmRuntime } from '@/lib/llm/providers';
import { evalDetectRuntimes } from '../ipc';
import { checkPermission } from '../integrations/gateway';
import { getIntegrationSettings, listIntegrations } from '@/lib/db/repositories/integrationsRepo';
import type {
  CandidateSnapshot,
  EvalRunConfig,
  ExternalTransferPlan,
} from '../types';
import type { EvalPackManifest } from '../types';

export interface PackSkipped {
  packId: string;
  reason: string;
}

export interface CandidatePreflight {
  candidateIndex: number;
  modelStatus: 'ok' | 'blocked' | 'unknown';
  modelReason?: string;
  toolSupport: 'yes' | 'no' | 'unknown';
  logprobs: 'yes' | 'no' | 'unknown';
  hasJsRuntime: boolean;
  hasPythonRuntime: boolean;
  vram: 'fits' | 'partial-offload-likely' | 'unknown';
  externalPermission: 'ok' | 'blocked' | 'not-applicable';
  externalReason?: string;
  skippedPacks: PackSkipped[];
}

export interface PreflightReport {
  candidates: CandidatePreflight[];
  transfers: ExternalTransferPlan[];
  chatBusy: boolean;
}

function isOllamaProvider(candidate: CandidateSnapshot): boolean {
  return candidate.provider === 'ollama';
}

async function ollamaVersionAt(baseUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/version`);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

function versionAtLeast(version: string, major: number, minor: number, patch: number): boolean {
  const parts = version.split('.').map((p) => Number(p.split('-')[0]));
  if (parts.some((p) => !Number.isFinite(p))) return false;
  const [ma = 0, mi = 0, pa = 0] = parts;
  if (ma !== major) return ma > major;
  if (mi !== minor) return mi > minor;
  return pa >= patch;
}

export async function preflight(
  config: EvalRunConfig,
  manifests: Map<string, EvalPackManifest>,
  opts: { checkModels?: boolean } = {},
): Promise<PreflightReport> {
  const checkModels = opts.checkModels ?? true;
  const chatBusy = chatQueueManager.getBusySessionId() !== null;
  const transfers: ExternalTransferPlan[] = [];

  let jsRuntime: boolean;
  let pythonRuntime: boolean;
  try {
    const runtimes = await evalDetectRuntimes();
    jsRuntime = typeof window !== 'undefined';
    pythonRuntime = runtimes.python?.path != null;
  } catch {
    jsRuntime = typeof window !== 'undefined';
    pythonRuntime = false;
  }

  let gpuTotalMb: number;
  try {
    const gpu = await getSystemGpuInfo();
    gpuTotalMb = gpu.vramTotalMb;
  } catch {
    gpuTotalMb = 0;
  }

  const settings = await getIntegrationSettings().catch(() => null);
  const integrations = await listIntegrations().catch(() => []);

  const candidates: CandidatePreflight[] = [];
  for (let i = 0; i < config.candidates.length; i++) {
    const candidate = config.candidates[i];
    const preset = getProviderPreset(candidate.provider);
    const runtime = resolveAgentLlmRuntime(
      { llmProvider: candidate.provider, llmBaseUrl: candidate.baseUrl },
      undefined,
    );

    let modelStatus: CandidatePreflight['modelStatus'] = 'unknown';
    let modelReason: string | undefined;
    let toolSupport: CandidatePreflight['toolSupport'] = 'unknown';
    if (checkModels) {
      try {
        const models = preset.openAiCompatible
          ? await listProviderModels(runtime)
          : await listOllamaModels(runtime.baseUrl);
        const found = models.some(
          (m) => m.name === candidate.model || m.name.toLowerCase() === candidate.model.toLowerCase(),
        );
        if (found) {
          modelStatus = 'ok';
        } else {
          const check = await checkProviderModel(runtime, candidate.model).catch(() => 'model-missing' as const);
          if (check === 'connected') modelStatus = 'ok';
          else {
            modelStatus = 'blocked';
            modelReason = 'model-missing';
          }
        }
      } catch {
        modelStatus = 'unknown';
        modelReason = 'connection-failed';
      }
    }

    if (isOllamaProvider(candidate)) {
      try {
        const info = await showModel(runtime.baseUrl, candidate.model);
        toolSupport = info.supportsTools ? 'yes' : 'no';
      } catch {
        toolSupport = 'unknown';
      }
    }

    let logprobs: CandidatePreflight['logprobs'];
    if (isOllamaProvider(candidate)) {
      const version = await ollamaVersionAt(runtime.baseUrl);
      logprobs = version && versionAtLeast(version, 0, 12, 11) ? 'yes' : 'no';
    } else {
      logprobs = 'no';
    }

    // VRAM fit estimate (Ollama only, best effort)
    let vram: CandidatePreflight['vram'] = 'unknown';
    if (isOllamaProvider(candidate) && gpuTotalMb > 0) {
      try {
        const models = await listOllamaModels(runtime.baseUrl);
        const entry = models.find((m) => m.name === candidate.model);
        const arch = await getModelArchitectureInfo(runtime.baseUrl, candidate.model).catch(() => null);
        const weightBytes = entry?.size ?? 0;
        const kvBytes = arch
          ? calculateEstimatedKvCacheBytes(
              arch.blockCount,
              arch.headCountKv,
              arch.feedForwardLength,
              arch.headCount,
              candidate.contextSize,
            )
          : 0;
        const needMb = (weightBytes + kvBytes) / (1024 * 1024);
        vram = needMb <= gpuTotalMb ? 'fits' : 'partial-offload-likely';
      } catch {
        vram = 'unknown';
      }
    }

    // External permission for non-local endpoints
    let externalPermission: CandidatePreflight['externalPermission'] = 'not-applicable';
    let externalReason: string | undefined;
    if (candidate.endpointClass !== 'local' && candidate.endpointClass !== 'lan-trusted') {
      const match = integrations.find(
        (it) =>
          it.enabled &&
          it.kind === 'llm-api' &&
          it.llm?.provider === candidate.provider &&
          it.llm?.baseUrl === candidate.baseUrl,
      );
      if (!match || !settings) {
        externalPermission = 'blocked';
        externalReason = 'no-consented-integration';
      } else {
        const perm = checkPermission(match, settings, 'candidate', ['public-bundled']);
        if (perm.ok) {
          externalPermission = 'ok';
          transfers.push({
            integrationId: match.id,
            purpose: 'candidate',
            dataClasses: ['public-bundled'],
            estimatedRequests: config.packs.reduce((a, p) => a + p.sampleIds.length * p.epochs, 0),
            estimatedInputTokens: config.packs.reduce((a, p) => a + p.sampleIds.length * 800, 0),
          });
        } else {
          externalPermission = 'blocked';
          externalReason = perm.reasonKey;
        }
      }
    }

    // Per-pack skip analysis
    const skippedPacks: PackSkipped[] = [];
    for (const packRef of config.packs) {
      const manifest = manifests.get(`${packRef.scope}:${packRef.packId}`);
      if (!manifest) continue;
      if (manifest.requires.toolCalling && toolSupport === 'no') {
        skippedPacks.push({ packId: packRef.packId, reason: 'tools-unsupported' });
        continue;
      }
      if (manifest.requires.logprobs && logprobs !== 'yes') {
        skippedPacks.push({ packId: packRef.packId, reason: 'logprobs-unsupported' });
        continue;
      }
      if (manifest.requires.codeRuntime === 'python' && !pythonRuntime) {
        skippedPacks.push({ packId: packRef.packId, reason: 'python-missing' });
        continue;
      }
      if (
        manifest.requires.minContextTokens !== undefined &&
        candidate.contextSize > 0 &&
        candidate.contextSize < manifest.requires.minContextTokens
      ) {
        skippedPacks.push({ packId: packRef.packId, reason: 'context-too-small' });
        continue;
      }
    }

    candidates.push({
      candidateIndex: i,
      modelStatus,
      modelReason,
      toolSupport,
      logprobs,
      hasJsRuntime: jsRuntime,
      hasPythonRuntime: pythonRuntime,
      vram,
      externalPermission,
      externalReason,
      skippedPacks,
    });
  }

  return { candidates, transfers, chatBusy };
}
