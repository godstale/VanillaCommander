import type { Agent } from '@/lib/types/agent';
import type {
  AgentMonitoringSnapshot,
  AgentOperationalStatus,
  LlmPerformanceMetrics,
  OllamaModelArchitectureInfo,
  OllamaRunningModel,
  SystemGpuInfo,
} from '@/lib/types/monitoring';
import {
  getRunningModels,
  getModelArchitectureInfo,
  getSystemGpuInfo,
  calculateEstimatedKvCacheBytes,
  calculateHybridKvCacheBytes,
  kvBytesPerElementForQuant,
} from '@/lib/llm/ollamaClient';
import { saveMonitoringSnapshot, saveConversationSummary } from '@/lib/db/repositories/monitoringRepo';
import { appLogger } from '@/lib/logger/logger';
import { getAgentPhase, getAgentIdForSession } from '@/lib/monitoring/agentPhaseTracker';
import {
  endConversation,
  getActiveConversationId,
  getActiveConversationSeq,
  getActiveTotals,
  getTotals as getTokenTotals,
} from '@/lib/monitoring/tokenTracker';
import type {
  ConversationTokenSummary,
  TurnTokenContribution,
} from '@/lib/types/monitoring';
import { chatQueueManager } from '@/lib/agent/chatQueueManager';

export type MonitoringListener = (snapshot: AgentMonitoringSnapshot) => void;

export const DEFAULT_MONITORING_INTERVAL_MS = 1000;

class MonitoringCollectorService {
  private activeTimers = new Map<string, NodeJS.Timeout>();
  private listeners = new Map<string, Set<MonitoringListener>>();
  /** 에이전트 구분 없이 모든 스냅샷을 받는 전역 리스너 (기록 패널 실시간 반영용). */
  private globalListeners = new Set<MonitoringListener>();
  private archCache = new Map<string, { info: OllamaModelArchitectureInfo; timestamp: number }>();
  private intervals = new Map<string, number>();
  /** 대화 시작 시 자동으로 시작된 모니터링 에이전트 집합. 수동 시작분과 구분해 자동 중단한다. */
  private autoMonitorIds = new Set<string>();
  private isCollectingMap = new Map<string, boolean>();
  private latestInferenceMetrics = new Map<string, LlmPerformanceMetrics>();
  private lastCompletedMetrics = new Map<string, LlmPerformanceMetrics>();
  /** 턴 종료 시 루프가 보고한 토큰 기여분. 다음 collect() 1회가 소비한다. */
  private pendingTurnTokens = new Map<string, TurnTokenContribution>();
  /** 마지막으로 종료된 대화 요약. 스냅샷의 대화 귀속/최근값 표시에 사용. */
  private lastEndedConversation = new Map<string, ConversationTokenSummary>();
  private lastDbSavedTime = new Map<string, number>();
  private lastSavedStatus = new Map<string, string>();
  private activeAgentContexts = new Map<
    string,
    { agent: Agent; baseUrl: string; workspaceRoot?: string | null }
  >();
  private runningModelsCache = new Map<
    string,
    { models: OllamaRunningModel[]; timestamp: number }
  >();

  public recordInferenceMetrics(agentId: string, metrics: LlmPerformanceMetrics): void {
    this.latestInferenceMetrics.set(agentId, metrics);
    this.lastCompletedMetrics.set(agentId, metrics);

    // Event-driven immediate measurement:
    // If the agent is actively being monitored, trigger an immediate collection right after inference completes.
    // If a periodic tick is currently in flight, retry shortly so the fresh metrics are captured without waiting.
    const ctx = this.activeAgentContexts.get(agentId);
    if (ctx) {
      if (this.isCollectingMap.get(agentId)) {
        setTimeout(() => {
          const freshCtx = this.activeAgentContexts.get(agentId);
          if (freshCtx) {
            void this.collect(freshCtx.agent, freshCtx.baseUrl, freshCtx.workspaceRoot);
          }
        }, 100);
      } else {
        void this.collect(ctx.agent, ctx.baseUrl, ctx.workspaceRoot);
      }
    }
  }

  public getLatestInferenceMetrics(agentId: string): LlmPerformanceMetrics | undefined {
    return this.latestInferenceMetrics.get(agentId);
  }

  /**
   * 턴 종료 시점의 토큰 기여분을 등록한다. 다음 스냅샷 수집 1회가 소비하며,
   * 이를 통해 주기 스냅샷 타임라인의 각 행에 해당 구간의 토큰 실측이 기재된다.
   */
  public recordTurnTokens(agentId: string, contribution: TurnTokenContribution): void {
    const prev = this.pendingTurnTokens.get(agentId);
    if (prev) {
      // 같은 수집 주기 안에 여러 턴이 끝나면 합산 (멀티턴 도구 대화)
      const merged: TurnTokenContribution = {
        inputTokens: prev.inputTokens + contribution.inputTokens,
        outputTokens: prev.outputTokens + contribution.outputTokens,
        thinkingTokens: prev.thinkingTokens + contribution.thinkingTokens,
        contentTokens: prev.contentTokens + contribution.contentTokens,
        statusTokens: { ...prev.statusTokens },
      };
      for (const key of Object.keys(merged.statusTokens) as Array<keyof typeof merged.statusTokens>) {
        merged.statusTokens[key] += contribution.statusTokens[key] ?? 0;
      }
      this.pendingTurnTokens.set(agentId, merged);
    } else {
      this.pendingTurnTokens.set(agentId, contribution);
    }
  }

  /**
   * 대화 종료(agent_end) 처리: 누적분을 요약으로 확정하고 대화 원장에 영속화.
   * 저장 실패는 모니터링 수집에 영향을 주지 않도록 경고만 남긴다.
   */
  public async finishConversation(agentId: string): Promise<ConversationTokenSummary | null> {
    const summary = endConversation(agentId);
    if (!summary) return null;
    this.lastEndedConversation.set(agentId, summary);
    const workspaceRoot = this.activeAgentContexts.get(agentId)?.workspaceRoot;
    try {
      await saveConversationSummary(summary, workspaceRoot);
    } catch (err) {
      console.warn('Failed to save conversation token summary to SQLite:', err);
    }
    return summary;
  }

  public getLastEndedConversation(agentId: string): ConversationTokenSummary | undefined {
    return this.lastEndedConversation.get(agentId);
  }

  public getLastCompletedMetrics(agentId: string): LlmPerformanceMetrics | undefined {
    return this.lastCompletedMetrics.get(agentId);
  }

  public subscribe(agentId: string, listener: MonitoringListener): () => void {
    if (!this.listeners.has(agentId)) {
      this.listeners.set(agentId, new Set());
    }
    this.listeners.get(agentId)!.add(listener);

    return () => {
      const set = this.listeners.get(agentId);
      if (set) {
        set.delete(listener);
        if (set.size === 0) {
          this.listeners.delete(agentId);
        }
      }
    };
  }

  /** 모든 에이전트의 스냅샷을 구독한다. DB 저장 여부와 무관하게 의미 있는 상태 변화 시점에 호출된다. */
  public subscribeAll(listener: MonitoringListener): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  public setInterval(agentId: string, intervalMs: number, agent: Agent, baseUrl: string, workspaceRoot?: string | null): void {
    this.intervals.set(agentId, intervalMs);
    this.activeAgentContexts.set(agentId, { agent, baseUrl, workspaceRoot });
    if (this.activeTimers.has(agentId)) {
      this.stop(agentId);
      this.start(agent, baseUrl, intervalMs, workspaceRoot);
    }
  }

  public getInterval(agentId: string): number {
    return this.intervals.get(agentId) || DEFAULT_MONITORING_INTERVAL_MS;
  }

  public isRunning(agentId: string): boolean {
    return this.activeTimers.has(agentId);
  }

  /** 자동 모니터링으로 시작된 수집인지 여부 (수동 시작분은 자동 중단하지 않는다). */
  public isAuto(agentId: string): boolean {
    return this.autoMonitorIds.has(agentId);
  }

  /**
   * 대화 시작 시 자동 모니터링을 시작한다. 이미 수집 중이면 소유권만 추가로 표시한다.
   * 수집 실패(연결 불가 등)는 호출자가 판단하도록 예외를 전파하지 않고 조용히 무시한다.
   */
  public startAuto(
    agent: Agent,
    baseUrl: string,
    intervalMs = DEFAULT_MONITORING_INTERVAL_MS,
    workspaceRoot?: string | null,
  ): void {
    this.autoMonitorIds.add(agent.id);
    try {
      this.start(agent, baseUrl, intervalMs, workspaceRoot);
    } catch {
      // start()는 타이머 등록 외에 throw하지 않지만, 방어적으로 소유권만 유지한다.
    }
  }

  /** 자동 모니터링으로 시작된 수집만 중단한다. 수동 시작분은 그대로 둔다. */
  public stopAuto(agentId: string): void {
    if (!this.autoMonitorIds.has(agentId)) return;
    this.autoMonitorIds.delete(agentId);
    this.stop(agentId);
  }

  public start(
    agent: Agent,
    baseUrl: string,
    intervalMs = DEFAULT_MONITORING_INTERVAL_MS,
    workspaceRoot?: string | null,
  ): void {
    this.activeAgentContexts.set(agent.id, { agent, baseUrl, workspaceRoot });

    if (this.activeTimers.has(agent.id)) {
      return;
    }

    this.intervals.set(agent.id, intervalMs);

    // Initial immediate collection
    void this.collect(agent, baseUrl, workspaceRoot);

    const timer = setInterval(() => {
      void this.collect(agent, baseUrl, workspaceRoot);
    }, intervalMs);

    this.activeTimers.set(agent.id, timer);
  }

  public stop(agentId: string): void {
    const timer = this.activeTimers.get(agentId);
    if (timer) {
      clearInterval(timer);
      this.activeTimers.delete(agentId);
    }
    this.activeAgentContexts.delete(agentId);
    this.autoMonitorIds.delete(agentId);
  }

  public stopAll(): void {
    for (const timer of this.activeTimers.values()) {
      clearInterval(timer);
    }
    this.activeTimers.clear();
    this.activeAgentContexts.clear();
    this.autoMonitorIds.clear();
  }

  public async collectNow(
    agent: Agent,
    baseUrl: string,
    workspaceRoot?: string | null,
  ): Promise<AgentMonitoringSnapshot | null> {
    return this.collect(agent, baseUrl, workspaceRoot, { forceEmit: true });
  }

  private async getArchitectureCached(
    baseUrl: string,
    model: string,
  ): Promise<OllamaModelArchitectureInfo | null> {
    const cached = this.archCache.get(model);
    const now = Date.now();
    // Cache for 5 minutes
    if (cached && now - cached.timestamp < 300_000) {
      return cached.info;
    }

    try {
      const info = await getModelArchitectureInfo(baseUrl, model);
      this.archCache.set(model, { info, timestamp: now });
      return info;
    } catch (err) {
      console.warn(`Failed to fetch model architecture for ${model}:`, err);
      return null;
    }
  }

  private detectAgentOperationalStatus(agentId: string): {
    status: AgentOperationalStatus;
    task: string;
  } {
    // 0. Live phase tracker has highest priority (updated on every chunk/tool event)
    const livePhase = getAgentPhase(agentId);
    if (livePhase && livePhase.phase !== 'idle') {
      return { status: livePhase.phase as AgentOperationalStatus, task: livePhase.task };
    }

    // 0b. Pending inference metrics mean Ollama just finished prefill/decoding
    const pending = this.latestInferenceMetrics.get(agentId);
    if (pending) {
      if ((pending.evalCount ?? 0) > 0) {
        return {
          status: 'decoding',
          task: `Decoding — ${pending.evalCount} 토큰 생성 (${pending.evalDurationMs}ms, ${pending.decodingSpeed} t/s)`,
        };
      }
      if ((pending.promptEvalCount ?? 0) > 0) {
        return {
          status: 'prefill',
          task: `Prefill — ${pending.promptEvalCount} 토큰 평가 (${pending.promptEvalDurationMs}ms, ${pending.prefillSpeed} t/s)`,
        };
      }
    }

    // 0c. If any chat session bound to this agent is currently running LLM, never report idle
    try {
      const busySession = chatQueueManager.getBusySessionId();
      if (busySession) {
        const busyAgent = getAgentIdForSession(busySession);
        if (busyAgent === agentId) {
          if (livePhase) {
            return { status: livePhase.phase as AgentOperationalStatus, task: livePhase.task };
          }
          return { status: 'generating', task: 'LLM 응답 생성/추론 중 (세션 실행 잠금 활성)' };
        }
      }
    } catch {
      // ignore — chatQueueManager may be unavailable in tests
    }

    const logs = appLogger.getAgentLogs(agentId);
    if (!logs || logs.length === 0) {
      if (livePhase) {
        return { status: livePhase.phase as AgentOperationalStatus, task: livePhase.task };
      }
      return { status: 'idle', task: '대기 중 (유휴 상태)' };
    }

    const now = Date.now();
    const recentLogs = logs.filter((l) => now - new Date(l.timestamp).getTime() < 30_000);
    if (recentLogs.length === 0) {
      if (livePhase) {
        return { status: livePhase.phase as AgentOperationalStatus, task: livePhase.task };
      }
      return { status: 'idle', task: '대기 중 (유휴 상태)' };
    }

    const latest = recentLogs[recentLogs.length - 1];

    if (latest.category === 'approval') {
      return { status: 'waiting_approval', task: `사용자 승인 대기 중: ${latest.message}` };
    }

    if (latest.category === 'tools') {
      return { status: 'executing_tool', task: `도구 실행 중: ${latest.message}` };
    }

    if (latest.category === 'ollama' || latest.category === 'chat') {
      const msg = latest.message || '';
      if (msg.includes('사고 과정') || msg.includes('Thinking')) {
        return { status: 'thinking', task: `Thinking: ${latest.message}` };
      }
      if (msg.includes('Prefill') || msg.includes('입력') || msg.includes('평가')) {
        return { status: 'prefill', task: `Prefill: ${latest.message}` };
      }
      if (msg.includes('디코딩') || msg.includes('Decoding') || msg.includes('토큰')) {
        return { status: 'decoding', task: `Decoding: ${latest.message}` };
      }
      return { status: 'generating', task: `Generating: ${latest.message}` };
    }

    if (latest.category === 'agent') {
      const msg = latest.message || '';
      if (msg.includes('Thinking') || msg.includes('사고')) {
        return { status: 'thinking', task: `Thinking: ${latest.message}` };
      }
      if (msg.includes('도구')) {
        return { status: 'executing_tool', task: `Executing_Tool: ${latest.message}` };
      }
      if (msg.includes('루프 시작') || msg.includes('턴 시작')) {
        return { status: 'thinking', task: `Thinking: ${latest.message}` };
      }
      return { status: 'generating', task: `Generating: ${latest.message}` };
    }

    return { status: 'generating', task: `작업 중: ${latest.message}` };
  }

  private async collect(
    agent: Agent,
    baseUrl: string,
    workspaceRoot?: string | null,
    opts?: { forceEmit?: boolean },
  ): Promise<AgentMonitoringSnapshot | null> {
    if (this.isCollectingMap.get(agent.id)) {
      return null;
    }
    this.isCollectingMap.set(agent.id, true);

    try {
      const timestamp = new Date().toISOString();

      // 1. Detect Current Operational Task first
      const opState = this.detectAgentOperationalStatus(agent.id);
      const isAgentActive = opState.status !== 'idle';
      const hasPendingInference = this.latestInferenceMetrics.has(agent.id);

      // 2. Query Hardware GPU & System Memory
      let gpuInfo: SystemGpuInfo;
      try {
        gpuInfo = await getSystemGpuInfo();
      } catch {
        gpuInfo = {
          gpuName: 'Default Video Controller',
          vramTotalMb: 0,
          vramUsedMb: 0,
          vramFreeMb: 0,
          gpuUtilizationPct: 0,
          gpuTemperatureC: 0,
          isNvidia: false,
          systemMemoryTotalMb: 0,
          systemMemoryFreeMb: 0,
        };
      }

      // 3. Query Running Models in Ollama memory (Throttled/cached when idle to save overhead)
      let runningModels: OllamaRunningModel[] = [];
      const cachedRunning = this.runningModelsCache.get(baseUrl);
      const nowMs = Date.now();
      const shouldQueryRunningModels =
        isAgentActive ||
        hasPendingInference ||
        !cachedRunning ||
        nowMs - cachedRunning.timestamp >= 10_000;

      if (shouldQueryRunningModels) {
        try {
          runningModels = await getRunningModels(baseUrl);
          this.runningModelsCache.set(baseUrl, { models: runningModels, timestamp: nowMs });
        } catch (err) {
          console.warn('Failed to query running models from Ollama:', err);
          if (cachedRunning) {
            runningModels = cachedRunning.models;
          }
        }
      } else {
        runningModels = cachedRunning.models;
      }

      // Match current agent model: exact first, then tag-insensitive exact.
      // Prefix startsWith caused qwen3.5:35b-mlx to match a wrong qwen3.5:*
      // resident when several tags share a base name.
      const agentModelName = agent.model.trim();
      const stripTag = (s: string) => s.split(':')[0].toLowerCase();
      const exact = runningModels.find(
        (m) => m.name === agentModelName || m.model === agentModelName,
      );
      const baseExact = runningModels.find(
        (m) =>
          stripTag(m.name) === stripTag(agentModelName) &&
          stripTag(m.model || '') !== '' &&
          (m.name.toLowerCase() === agentModelName.toLowerCase() ||
            stripTag(m.name) === stripTag(agentModelName)),
      );
      const matchedRunning =
        exact ??
        runningModels.find(
          (m) =>
            m.name.toLowerCase() === agentModelName.toLowerCase() ||
            (m.model || '').toLowerCase() === agentModelName.toLowerCase(),
        ) ??
        baseExact ??
        (runningModels.length === 1 ? runningModels[0] : undefined);

      // 4. Query or use cached architecture
      const arch = await this.getArchitectureCached(baseUrl, agent.model);

      // Apple unified memory (Rust mirrors the whole pool as VRAM): every
      // resident byte counts as VRAM. size_vram==0 on some Metal builds, so
      // attribute the full weight + KV estimate to VRAM in that case.
      const isUnifiedMemory =
        /apple/i.test(gpuInfo.gpuName || '') ||
        (!gpuInfo.isNvidia &&
          gpuInfo.vramTotalMb > 0 &&
          gpuInfo.vramTotalMb === gpuInfo.systemMemoryTotalMb);

      // 5. Memory breakdown & CPU/GPU Offloading
      const modelWeightBytes = matchedRunning ? matchedRunning.size : 0;
      const reportedVramBytes = matchedRunning ? matchedRunning.size_vram : 0;
      const vramAllocatedBytes = isUnifiedMemory
        ? modelWeightBytes
        : reportedVramBytes;
      const gpuOffloadPct =
        modelWeightBytes > 0
          ? isUnifiedMemory
            ? 100
            : Math.min(100, Number(((vramAllocatedBytes / modelWeightBytes) * 100).toFixed(1)))
          : 0;

      // 5. Calculate KV cache size (GQA-aware actual + MHA reference for comparison)
      // 5. Calculate KV cache size (GQA-aware actual + MHA reference for comparison)
      // Clamp to the model's own context limit so an 8K agent default never
      // inflates a 4K model's estimate; quant-aware element size.
      // Hybrid (SSM+attention, e.g. qwen3.5:9b) models use attention on a
      // subset of layers only, so estimate from summed per-layer KV heads
      // (about 2.1GB at 64k) instead of the full-layer formula.
      const agentCtx = agent.contextSize > 0 ? agent.contextSize : 8192;
      const targetContextSize = arch?.contextLimit
        ? Math.min(agentCtx, arch.contextLimit)
        : agentCtx;
      const kvBytesPerElement = kvBytesPerElementForQuant(
        arch?.quantizationLevel || '',
      );
      const explicitHeadDim = arch?.headDim ?? 0;
      const derivedHeadDim =
        arch && arch.headCount > 0 && arch.embeddingLength > 0
          ? Math.round(arch.embeddingLength / arch.headCount)
          : 0;
      const headDim = explicitHeadDim > 0 ? explicitHeadDim : derivedHeadDim;
      const kvCacheGqaBytes = arch
        ? arch.attentionLayers > 0 && arch.kvHeadsTotal > 0 && headDim > 0
          ? calculateHybridKvCacheBytes(
              arch.kvHeadsTotal,
              headDim,
              targetContextSize,
              kvBytesPerElement,
            )
          : calculateEstimatedKvCacheBytes(
              arch.blockCount,
              arch.headCountKv,
              arch.embeddingLength,
              arch.headCount,
              targetContextSize,
              kvBytesPerElement,
              headDim,
            )
        : 0;
      const kvCacheMhaBytes = arch
        ? calculateEstimatedKvCacheBytes(
            arch.blockCount,
            arch.headCount,
            arch.embeddingLength,
            arch.headCount,
            targetContextSize,
            kvBytesPerElement,
            headDim,
          )
        : 0;
      const kvCacheBytes = kvCacheGqaBytes;
      const offloadRatio = gpuOffloadPct / 100;
      const kvVramBytes = isUnifiedMemory
        ? kvCacheGqaBytes
        : Math.round(kvCacheGqaBytes * offloadRatio);
      const kvRamBytes = kvCacheGqaBytes - kvVramBytes;
      const modelVramBytes = vramAllocatedBytes;
      const modelRamBytes = Math.max(0, modelWeightBytes - vramAllocatedBytes);

      // 6. Get pending inference performance metrics and last completed inference
      const pendingPerf = this.latestInferenceMetrics.get(agent.id);
      const lastCompleted = this.lastCompletedMetrics.get(agent.id);

      // Consume pending metrics so idle snapshots return to 0 (flat horizontal lines removed)
      if (pendingPerf) {
        this.latestInferenceMetrics.delete(agent.id);
      }

      // 턴 토큰 기여분도 1회성으로 소비한다. 주기 스냅샷 타임라인의 각 행에
      // 해당 구간의 입력/출력/사고 토큰 실측이 기재되는 경로다.
      const turnTokens = this.pendingTurnTokens.get(agent.id);
      if (turnTokens) {
        this.pendingTurnTokens.delete(agent.id);
      }
      const activeConvId = getActiveConversationId(agent.id);
      const activeConvSeq = getActiveConversationSeq(agent.id);
      const lastEnded = this.lastEndedConversation.get(agent.id);

      const snapshot: AgentMonitoringSnapshot = {
        id: `mon-${agent.id}-${Date.now()}`,
        agentId: agent.id,
        timestamp,
        gpuName: gpuInfo.gpuName || 'GPU / Accelerated Device',
        gpuVramTotalMb: gpuInfo.vramTotalMb,
        gpuVramUsedMb: gpuInfo.vramUsedMb,
        gpuVramFreeMb: gpuInfo.vramFreeMb,
        gpuUtilizationPct: gpuInfo.gpuUtilizationPct,
        gpuTemperatureC: gpuInfo.gpuTemperatureC,
        systemMemoryTotalMb: gpuInfo.systemMemoryTotalMb,
        systemMemoryFreeMb: gpuInfo.systemMemoryFreeMb,
        llmModel: agent.model,
        llmArchitecture: arch?.architecture || 'unknown',
        llmParameterSize: arch?.parameterSize || '',
        contextSize: agentCtx,
        contextLimit: arch?.contextLimit || 8192,
        modelWeightBytes,
        vramAllocatedBytes,
        kvCacheBytes,
        gpuOffloadPct,
        agentStatus: opState.status,
        currentTask: opState.task,
        prefillTokens: pendingPerf ? pendingPerf.promptEvalCount : 0,
        prefillDurationMs: pendingPerf ? pendingPerf.promptEvalDurationMs : 0,
        prefillSpeed: pendingPerf ? pendingPerf.prefillSpeed : 0,
        decodingTokens: pendingPerf ? pendingPerf.evalCount : 0,
        decodingDurationMs: pendingPerf ? pendingPerf.evalDurationMs : 0,
        decodingSpeed: pendingPerf ? pendingPerf.decodingSpeed : 0,
        totalDurationMs: pendingPerf ? pendingPerf.totalDurationMs : 0,
        thinkingTokens: turnTokens ? turnTokens.thinkingTokens : 0,
        // 진행 중 대화에 귀속. 종료 직후 아직 소비되지 않은 턴 기여분이
        // 이번 수집에 담기면 막 끝난 대화에 귀속시키고, 그 외에는 비워둔다
        // (유휴 스냅샷이 과거 대화 id를 달고 다니지 않도록).
        conversationId: activeConvId ?? (turnTokens ? lastEnded?.id : undefined),
        conversationSeq: activeConvSeq ?? (turnTokens ? lastEnded?.seq : undefined),
        details: {
          blockCount: arch?.blockCount ?? 0,
          headCount: arch?.headCount ?? 0,
          headCountKv: arch?.headCountKv ?? 0,
          embeddingLength: arch?.embeddingLength ?? 0,
          feedForwardLength: arch?.feedForwardLength ?? 0,
          attentionKind: arch?.attentionKind ?? 'unknown',
          attentionLayers: arch?.attentionLayers ?? 0,
          kvHeadsTotal: arch?.kvHeadsTotal ?? 0,
          headDim: arch?.headDim ?? 0,
          kvContextTokens: targetContextSize,
          kvBytesPerElement,
          isUnifiedMemory,
          quantizationLevel: arch?.quantizationLevel ?? '',
          format: arch?.format ?? 'gguf',
          parameterCount: arch?.parameterCount ?? 0,
          isModelLoadedInMemory: Boolean(matchedRunning),
          runningExpiresAt: matchedRunning?.expires_at,
          kvCacheMhaBytes,
          kvCacheGqaBytes,
          kvVramBytes,
          kvRamBytes,
          modelVramBytes,
          modelRamBytes,
          tokenTurn: turnTokens
            ? {
                inputTokens: turnTokens.inputTokens,
                outputTokens: turnTokens.outputTokens,
                thinkingTokens: turnTokens.thinkingTokens,
                contentTokens: turnTokens.contentTokens,
                statusTokens: turnTokens.statusTokens,
              }
            : null,
          tokenTotals: getTokenTotals(agent.id),
          tokenActive: getActiveTotals(agent.id),
          lastCompletedInference: lastCompleted
            ? {
                prefillSpeed: lastCompleted.prefillSpeed,
                decodingSpeed: lastCompleted.decodingSpeed,
                prefillDurationMs: lastCompleted.promptEvalDurationMs,
                decodingDurationMs: lastCompleted.evalDurationMs,
                prefillTokens: lastCompleted.promptEvalCount,
                decodingTokens: lastCompleted.evalCount,
                totalDurationMs: lastCompleted.totalDurationMs,
                completedAt: lastCompleted.completedAt,
              }
            : null,
          allRunningModels: runningModels.map((r) => ({
            name: r.name,
            size_vram_mb: Math.round(r.size_vram / 1024 / 1024),
          })),
        },
        createdAt: timestamp,
      };

      // Intelligent DB persistence:
      // Active states are always persisted. IDLE is persisted only once when
      // entering IDLE from another state (or when it carries fresh inference
      // metrics) — pure CPU/GPU fluctuations while staying IDLE are skipped
      // to prevent DB bloat and timeline noise.
      const currentMs = Date.now();
      const prevStatus = this.lastSavedStatus.get(agent.id);
      const isStatusChanged = prevStatus !== snapshot.agentStatus;
      const isIdle = snapshot.agentStatus === 'idle';
      const hasRecentInference = (snapshot.prefillTokens ?? 0) > 0 || (snapshot.decodingTokens ?? 0) > 0 || (snapshot.thinkingTokens ?? 0) > 0;
      const shouldSaveToDb = isIdle
        ? isStatusChanged || hasRecentInference
        : true;

      if (shouldSaveToDb) {
        try {
          await saveMonitoringSnapshot(snapshot, workspaceRoot);
          this.lastDbSavedTime.set(agent.id, currentMs);
          this.lastSavedStatus.set(agent.id, snapshot.agentStatus);
        } catch (err) {
          console.warn('Failed to save monitoring snapshot to SQLite:', err);
        }
      }

      // Notify active listeners, except for consecutive IDLE ticks with no
      // state change (CPU/GPU-only fluctuations). The transition snapshot
      // into IDLE is still emitted once. Manual refresh forces emission.
      const shouldNotify =
        opts?.forceEmit === true || !isIdle || isStatusChanged || hasRecentInference;
      if (!shouldNotify) {
        return snapshot;
      }
      const listenersSet = this.listeners.get(agent.id);
      if (listenersSet) {
        for (const listener of listenersSet) {
          try {
            listener(snapshot);
          } catch (e) {
            console.error('Error in monitoring listener:', e);
          }
        }
      }
      for (const listener of this.globalListeners) {
        try {
          listener(snapshot);
        } catch (e) {
          console.error('Error in global monitoring listener:', e);
        }
      }

      return snapshot;
    } finally {
      this.isCollectingMap.set(agent.id, false);
    }
  }
}

export const monitoringCollector = new MonitoringCollectorService();
