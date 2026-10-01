# Phase 10 — Automated Evaluation (자동 평가)

**목표**: 같은 평가셋을 같은 조건으로 여러 후보(모델×설정)에 자동 실행하고, 품질·에이전트·성능·자원·신뢰성을 정규화된 0~100 척도로 비교해 "이 PC와 이 사용자의 작업"에 가장 맞는 후보를 추천한다.

**선행 조건**: Phase 0~9 완료(현재 `[x]`).

**필독 문서 (작업 착수 전 반드시 읽을 것)**
1. `Docs/Architecture.md` 전체, 특히 **§14 자동 평가 시스템**(이 Phase의 설계 요약·결정 사항), §5.6 훅, §7·§8 안전 경계(평가 샌드박스 예외 §8.4 포함), §4.5 저장소
2. `Docs/plan/LLM_Evaluation_Plan.md` — 확정 기획서(왜 이렇게 설계했는가)
3. `Docs/plan/LLM_Evaluation_Research.md` — 근거 조사(공식·외부 도구 비교)
4. `Docs/phases/Phase10-Eval-Packs.md` — 평가 팩(데이터셋) 제작 명세. P10-21~24 담당자는 필수
5. `AGENTS.md` — 코딩 규칙(특히 `any` 금지, i18n, 소유 파일, pnpm)

**확정된 사용자 결정 (2026-09-25)** — 구현 중 임의로 바꾸지 말 것

| ID | 결정 | 구현에 미치는 영향 |
| --- | --- | --- |
| D1 | 모든 기능을 지금 확정 기획한다(단계 이연 없음) | 아래 26개 작업 모두 이 Phase에서 구현한다. 순서는 "웨이브"로만 나눈다 |
| D2 | 평가 결과는 **전역 DB**에 저장한다 | `evalRepo`는 항상 `getGlobalDatabase()`를 쓴다. 개인 팩 **파일**만 프로젝트 `.fortress/evals/`에 둔다 |
| D3 | 외부 API·외부 에이전트는 **사용자가 허락한 경우에만** 사용한다 | 설정 > "외부 연동" 페이지, 연동별 동의·용도·데이터 분류 범위, 실행별 재확인, 전송 감사 로그(P10-09) |
| D4 | 데이터셋을 **앱에 포함**한다 | Tauri 리소스로 번들한다. 단, 라이선스상 번들이 불가능한 셋은 예외로 임포터만 제공한다(§라이선스 예외) |
| D5 | 평가 중 **채팅 금지** | 전역 평가 잠금 `evalLock` + 채팅 전송·큐잉 차단(P10-03) |
| D6 | 기본 가중치·기준값을 **사용자가 확인한 뒤 수동으로 시작**한다 | 실행 마법사에 "가중치·기준값 확인" 단계와 확인 체크를 필수로 둔다. 자동/예약 실행 기능을 만들지 않는다 |

**라이선스 예외 (D4의 예외, 2026-09-25 원문 확인)**

| 데이터셋 | 라이선스 | 처리 |
| --- | --- | --- |
| HAE-RAE Bench 1.1 | CC-BY-NC-ND-4.0 | 번들 금지(비상업 조건) → HF 임포터 프리셋만 |
| GPQA | CC-BY-4.0 + "평문 공개 금지" 요청 | 번들 금지(공개 리포에 평문으로 올라감) → 임포터만 |
| CLIcK, LogicKor | 라이선스 표기 미확인 | 번들 금지 → 임포터만(확인되면 이슈 로그에 기록하고 번들 검토) |
| KMMLU | CC-BY-ND-4.0 | **원본 test CSV 파일을 수정 없이** 번들, 변환·샘플링은 런타임에 수행 |
| KoBEST | CC-BY-SA-4.0 | 변환한 부분집합 파일을 **CC-BY-SA-4.0으로** 번들(파일별 LICENSE·출처) |

---

## 0. 공통 규칙 (모든 P10 작업)

### 0.1 소유 파일과 공유 파일

- 각 작업은 **"소유 파일"만** 만들거나 수정한다. 아래 "공유 파일 규칙"에 있는 파일은 명시된 한두 줄만 추가한다.
- 공유 파일 규칙:

| 파일 | 누가 | 무엇만 |
| --- | --- | --- |
| `src-tauri/src/lib.rs` | P10-08, P10-09 | `invoke_handler` 목록에 자기 커맨드 이름 추가 |
| `src-tauri/src/commands/mod.rs` | P10-08, P10-09 | `pub mod ...;` 한 줄 |
| `src-tauri/tauri.conf.json` | P10-08 | `bundle.resources`에 `resources/evals/**/*` 추가 |
| `src/lib/i18n/dictionaries/ko.ts`·`en.ts` | P10-01 | `...evalKo` / `...evalEn` 스프레드 1줄씩(이후 아무도 수정하지 않음) |
| `src/lib/i18n/dictionaries/eval/<area>.{ko,en}.ts` | 아래 표의 영역 소유 작업 | 자기 영역 파일만 |
| `src/App.tsx` | P10-09 | `/settings/integrations` 라우트 1줄 |
| `src/pages/Settings/SettingsLayout.tsx` | P10-09 | `NAV_ITEMS`에 1개 항목 |
| `Docs/TODO.md` | 전원 | 자기 작업 ID 상태와 이슈 로그 행 |

- i18n 영역 파일 소유: `common`(P10-01), `lock`(P10-03), `packs`(P10-19), `wizard`(P10-16), `progress`(P10-17), `report`(P10-18), `judge`(P10-12), `integrations`(P10-09), `personal`(P10-19), `arena`(P10-20), `interop`(P10-25), `runner`(P10-10: 오류/결과 사유 문구). **키 접두사는 `eval.<area>.`로 통일**한다(예: `eval.wizard.stepProfile`).

### 0.2 코딩 규칙 요약

- `src/lib/eval/**`는 **UI를 import하지 않는 순수 로직**으로 유지한다(테스트 가능성). UI는 `src/components/eval/**`, 상태는 `EvalContext`.
- 모든 외부 입력(팩 JSON, 가져온 파일, Judge 응답, DB JSON 컬럼)은 `types.ts`의 zod 스키마로 **파싱한 뒤** 사용한다. `as` 캐스팅으로 우회하지 않는다.
- 난수는 모두 `stats/random.ts`의 시드 PRNG를 쓴다(`Math.random` 금지 — 재현성). UUID 생성만 예외(`crypto.randomUUID`).
- 시간 측정은 `performance.now()`, 저장 시각은 ISO 문자열.
- 신규 npm/crate 의존성 추가 금지. 필요하다고 판단되면 `Docs/TODO.md` 이슈 로그에 사유를 남기고 멈춘다.
- 새 Rust 커맨드는 경로 인자를 **반드시** canonicalize 후 허용 루트(평가 리소스 루트/앱데이터 evals 루트/프로젝트 `.fortress/evals`/샌드박스 루트) 하위인지 검증한다.

### 0.3 완료 기준 (모든 작업 공통)

`pnpm lint`, `pnpm typecheck`, `pnpm test` 통과 + 작업별 "확인 방법" 수행 + `Docs/TODO.md` 갱신. UI 작업은 `pnpm tauri dev`로 실제 동작을 확인한다. Rust 변경은 `cargo check`(src-tauri)와 가능하면 `cargo test`.

### 0.4 웨이브(착수 순서)와 의존 관계

```
W0  P10-01 타입·상수·i18n 골격 ──┬─▶ P10-02 DB·Repo
                                  └─▶ P10-03 평가 잠금·채팅 차단
W1  (P10-01 이후 병렬)  P10-04 팩 로더(←P10-08 IO)   P10-05 결정적 채점기   P10-06 IFEval 체커
                        P10-07 통계·정규화·추천       P10-08 Rust 평가 커맨드 P10-09 외부 연동(←P10-02)
    (콘텐츠, P10-01 이후 언제든) P10-21 FAB-A  P10-22 FAB-B  P10-23 FAB-C  P10-24 공개셋
W2  P10-10 러너 코어(←01,02,03,04,05,07)
    ├─▶ P10-11 에이전트형 솔버·샌드박스 채점(←08)
    ├─▶ P10-12 Judge·사람 채점(←09)
    ├─▶ P10-13 코드 실행 채점(←08)
    └─▶ P10-14 logprobs 기능(MCQ 확률·양자화 충실도)
W3  P10-15 UI 골격·EvalContext ─┬─▶ P10-16 실행 마법사(←07,09,10)
                                 ├─▶ P10-17 진행 화면(←10)
                                 ├─▶ P10-18 리포트(←07,12)
                                 ├─▶ P10-19 팩 관리·개인 평가셋(←04)
                                 ├─▶ P10-20 로컬 Arena(←03,07)
                                 └─▶ P10-25 가져오기·내보내기(←04,18)
W4  P10-26 통합 QA·문서
```

---

## P10-01. 평가 타입·상수·i18n 골격

- **선행**: 없음
- **소유 파일**: `src/lib/eval/types.ts`, `src/lib/eval/constants.ts`, `src/lib/eval/types.test.ts`, `src/lib/i18n/dictionaries/eval/*`(전 영역 빈 파일 + `index.ts`), `ko.ts`·`en.ts`(스프레드 1줄씩)
- **목표**: 모든 P10 작업이 공유하는 **데이터 계약**을 zod 스키마 + 추론 타입으로 확정한다. 이후 작업은 이 파일을 수정하지 않는다(변경이 필요하면 이슈 로그 → 합의 후 P10-01 담당 파일로 수정).

### 작업 내용

1. `types.ts` — 아래 스키마를 zod로 정의하고 `export type X = z.infer<typeof XSchema>`로 타입을 내보낸다. 필드명·열거값은 **이 문서와 정확히 일치**시킨다.

```ts
// ---- 분류 ----
export const EVAL_DIMENSIONS = ['Q', 'A', 'P', 'R', 'S'] as const;       // 품질/에이전트/성능/자원/신뢰성
export const EVAL_CATEGORIES = [
  'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9',
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6',
  'P1', 'P2',
  'R1',
  'S1',
] as const;
// Q1 지식(한/영) · Q2 추론·수학 · Q3 지시 따르기 · Q4 한국어 작문 · Q5 코딩 · Q6 긴 컨텍스트
// Q7 개인 선호(Arena) · Q8 양자화 충실도(보조, 종합 점수 제외) · Q9 개인 업무(개인 팩)
// A1 도구 선택·인자 · A2 도구 불필요 판단 · A3 파일 작업 과제 · A4 시각화 형식 · A5 스킬 활용 · A6 압축 후 기억
// P1 응답성 · P2 처리 속도 · R1 메모리 · S1 안정성·일관성

// ---- 팩 ----
export const PACK_KINDS = [
  'single_turn', 'multi_turn', 'tool_call', 'agentic', 'perf_probe',
  'long_context', 'compaction_recall', 'logprob_trace',
] as const;
export const PACK_SCOPES = ['builtin', 'user', 'project'] as const;

I18nTextSchema = z.object({ ko: z.string(), en: z.string() });

EvalMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

EvalPackManifestSchema = z.object({
  schemaVersion: z.literal('1.0'),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  version: z.string(),                          // semver
  title: I18nTextSchema,
  description: I18nTextSchema,
  category: z.enum(EVAL_CATEGORIES),
  lang: z.array(z.enum(['ko', 'en'])).min(1),
  license: z.object({ id: z.string(), source: z.string().optional(), attribution: z.string().optional() }),
  kind: z.enum(PACK_KINDS),
  source: z.discriminatedUnion('type', [
    z.object({ type: z.literal('jsonl'), file: z.string().default('samples.jsonl') }),
    z.object({ type: z.literal('kmmlu-csv'), files: z.array(z.string()).min(1) }),   // 원본 CSV 무수정 사용
    z.object({ type: z.literal('generator'), generator: z.enum(['long-context-v1', 'perf-probe-v1']),
               params: z.record(z.unknown()) }),
  ]),
  systemPrompt: z.string().optional(),
  useAgentSystemPrompt: z.boolean().default(false),   // true면 후보 에이전트의 systemPrompt를 앞에 붙임
  fewshot: z.array(EvalMessageSchema).optional(),
  tools: z.union([z.literal('fortress-default'), z.array(ToolSchemaJson)]).optional(),
  scorers: z.array(ScorerSpecSchema).min(0),
  metrics: z.array(MetricSpecSchema).min(1),
  tiers: z.object({ smoke: z.number().int().positive(), standard: z.number().int().positive(),
                    full: z.union([z.number().int().positive(), z.literal('all')]) }),
  stratifyBy: z.string().optional(),
  defaults: z.object({
    timeoutSec: z.number().positive().default(180),
    maxTurns: z.number().int().positive().default(12),
    epochs: z.number().int().positive().default(1),
    circular: z.boolean().default(false),
  }).default({}),
  requires: z.object({
    toolCalling: z.boolean().default(false),
    logprobs: z.boolean().default(false),
    codeRuntime: z.enum(['js', 'python']).optional(),
    minContextTokens: z.number().int().optional(),
  }).default({}),
  trusted: z.boolean().default(false),   // 픽스처 스킬/AGENTS.md 로드 허용(builtin은 로더가 true 강제)
  publishedAt: z.string().optional(),
});

ExpectedToolCallSchema = z.object({
  name: z.string(),
  args: z.record(z.array(z.unknown())),   // 파라미터별 허용값 목록. [] = 존재만 요구
  optionalArgs: z.array(z.string()).optional(),
});

FsExpectationSchema = z.union([
  z.object({ path: z.string(), exists: z.boolean() }),
  z.object({ path: z.string(), contains: z.array(z.string()).optional(), notContains: z.array(z.string()).optional(),
             regex: z.string().optional(), equals: z.string().optional(), caseSensitive: z.boolean().optional() }),
  z.object({ glob: z.string(), unchanged: z.literal(true) }),
  z.object({ glob: z.string(), maxFiles: z.number().int() }),       // 불필요한 파일 생성 방지
]);

EvalSampleSchema = z.object({
  id: z.string(),
  input: z.union([z.string(), z.array(EvalMessageSchema).min(1)]),
  choices: z.array(z.string()).optional(),
  target: z.union([z.string(), z.array(z.string()), z.number()]).optional(),
  reference: z.string().optional(),
  rubric: z.string().optional(),
  expectedToolCalls: z.array(ExpectedToolCallSchema).optional(),
  tools: z.array(ToolSchemaJson).optional(),                 // 샘플별 도구 세트(bfcl). 있으면 매니페스트 tools보다 우선
  fixture: z.object({ dir: z.string() }).optional(),         // 팩 폴더 기준 상대 경로
  expectState: z.array(FsExpectationSchema).optional(),
  trajectory: z.object({ mustCall: z.array(z.string()).optional(), mustNotCall: z.array(z.string()).optional(),
                         maxCalls: z.number().int().optional(), mustReadPaths: z.array(z.string()).optional() }).optional(),
  ifeval: z.array(z.object({ id: z.string(), kwargs: z.record(z.unknown()).default({}) })).optional(),
  code: z.object({ entryPoint: z.string(), tests: z.string(), language: z.enum(['js', 'python']) }).optional(),
  perf: z.object({ inputTokens: z.number().int(), outputTokens: z.number().int(),
                   depthRatio: z.number().min(0).max(1).optional(), repeats: z.number().int().optional() }).optional(),
  scorers: z.array(ScorerSpecSchema).optional(),              // 지정 시 팩 기본 scorers를 대체
  clusterId: z.string().optional(),
  tags: z.array(z.string()).optional(),                       // 'reliability' → epochs 확장 대상
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

// ---- 채점 ----
export const SCORER_TYPES = [
  'exact', 'includes', 'regex', 'choice', 'numeric', 'json_schema',
  'tool_call_ast', 'no_tool_call', 'viz_block', 'ifeval',
  'fs_state', 'trajectory', 'code_exec',
  'llm_judge_rubric', 'llm_judge_pairwise', 'human', 'choice_logprob',
] as const;

ScorerSpecSchema = z.object({
  type: z.enum(SCORER_TYPES),
  key: z.string().optional(),                 // 동일 타입 다중 사용 시 구분(기본 = type)
  weight: z.number().positive().default(1),
  gate: z.boolean().default(false),           // 실패 시 샘플 점수 0
  threshold: z.number().min(0).max(1).optional(),
  options: z.record(z.unknown()).default({}), // 타입별 옵션은 각 채점기가 자체 zod로 재검증
});

export const VERDICTS = ['correct', 'incorrect', 'partial', 'no_answer', 'error', 'skipped'] as const;

MetricSpecSchema = z.object({
  id: z.string(),
  description: I18nTextSchema,
  source: z.enum(['score', 'trial_field', 'derived']),
  field: z.string().optional(),
  aggregation: z.enum(['mean', 'median', 'p95', 'pass_at_k', 'pass_hat_k', 'rate']),
  k: z.number().int().positive().optional(),
  lowerIsBetter: z.boolean(),
  scoreType: z.enum(['binary', 'continuous', 'ordinal']),
  range: z.object({ min: z.number(), max: z.number() }),
  normalization: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('baseline'), baseline: z.union([z.number(), z.literal('auto_choices')]),
               ceiling: z.number().default(1) }),
    z.object({ kind: z.literal('anchor'), anchorId: z.string() }),   // constants.ANCHORS_V1 키
    z.object({ kind: z.literal('identity') }),
  ]),
  countsTowardComposite: z.boolean().default(true),
});

// ---- 후보 ----
CandidateSnapshotSchema = z.object({
  label: z.string(),
  sourceAgentId: z.string().nullable(),       // API 키를 여기서 런타임 해석(키는 저장하지 않음)
  provider: LlmProviderKindSchema,
  baseUrl: z.string(),
  endpointClass: z.enum(['local', 'lan-trusted', 'external']),
  model: z.string(),
  systemPrompt: z.string(),
  temperature: z.number(),
  topP: z.number().optional(), topK: z.number().optional(), repeatPenalty: z.number().optional(),
  frequencyPenalty: z.number().optional(), presencePenalty: z.number().optional(),
  seed: z.number().optional(), stopSequences: z.array(z.string()).optional(),
  maxOutputTokens: z.number().optional(),
  reasoning: z.enum(['default', 'off', 'on']),
  reasoningEffort: z.enum(['low', 'medium', 'high']),
  contextSize: z.number().int(),
  reserveTokens: z.number().int(),
  keepRecentTokens: z.number().int(),
  enabledBuiltinTools: z.array(BuiltinToolIdSchema),   // 평가 필터(§P10-10) 적용 후 값
  enabledSkills: z.array(z.string()),
  sweep: z.record(z.union([z.string(), z.number()])).optional(),   // 매트릭스 축 값
});

HardwareFingerprintSchema = z.object({
  gpuName: z.string(), vramTotalMb: z.number(), isNvidia: z.boolean(),
  ramTotalMb: z.number(), os: z.string(), appVersion: z.string(),
  providerVersions: z.record(z.string()),     // { ollama: '0.12.11', ... } 조회 실패 시 'unknown'
});

// ---- 프로파일 ----
EvalProfileSchema = z.object({
  id: z.string(), name: I18nTextSchema, builtIn: z.boolean(),
  description: I18nTextSchema,
  dimensionWeights: z.object({ Q: z.number().min(0), A: z.number().min(0), P: z.number().min(0),
                               R: z.number().min(0), S: z.number().min(0) }),
  categoryWeights: z.record(z.number().min(0)),       // 누락 카테고리 = 1
  anchorsVersion: z.string(),
  anchorOverrides: z.record(z.object({ zero: z.number(), full: z.number() })).default({}),
  constraints: z.array(z.object({
    metric: z.string(), op: z.enum(['>=', '<=']), value: z.number(), label: I18nTextSchema })),
  arena: z.object({ enabled: z.boolean(), minVotes: z.number().int().default(30) }).default({ enabled: false, minVotes: 30 }),
});

// ---- 외부 연동 (D3) ----
export const INTEGRATION_PURPOSES = ['judge', 'reference-generation', 'pack-drafting', 'candidate'] as const;
export const DATA_CLASSES = ['public-bundled', 'personal', 'fixture-files'] as const;

ExternalIntegrationSchema = z.object({
  id: z.string(), name: z.string(),
  kind: z.enum(['llm-api', 'agent-cli']),
  enabled: z.boolean(),
  llm: z.object({ provider: LlmProviderKindSchema, baseUrl: z.string(), model: z.string(),
                  apiKey: z.string().optional() }).optional(),
  cli: z.object({
    executablePath: z.string(),               // 절대 경로만
    args: z.array(z.string()),                // 고정 인자. 프롬프트는 인자로 넣지 않음(주입 방지)
    promptVia: z.enum(['stdin', 'file']),     // file이면 args 안의 {promptFile} 토큰을 임시 파일 경로로 치환
    outputFormat: z.enum(['text', 'json']),
    jsonPath: z.string().optional(),          // 'result' 또는 'content.0.text' 같은 점 경로
    timeoutMs: z.number().int().default(180000),
  }).optional(),
  allowedPurposes: z.array(z.enum(INTEGRATION_PURPOSES)),
  allowedDataClasses: z.array(z.enum(DATA_CLASSES)),
  consent: z.object({ version: z.string(), grantedAt: z.string(),
                      purposes: z.array(z.enum(INTEGRATION_PURPOSES)),
                      dataClasses: z.array(z.enum(DATA_CLASSES)) }).nullable(),
  createdAt: z.string(), updatedAt: z.string(),
});
IntegrationSettingsSchema = z.object({
  masterEnabled: z.boolean().default(false),
  trustedLanHosts: z.array(z.string()).default([]),
  allowLocalCodeExecution: z.boolean().default(false),   // Python 코드 실행 채점(P10-13)
});

// ---- 실행 ----
JudgeConfigSchema = z.object({
  target: z.discriminatedUnion('type', [
    z.object({ type: z.literal('local'), provider: LlmProviderKindSchema, baseUrl: z.string(), model: z.string(),
               sourceAgentId: z.string().nullable() }),
    z.object({ type: z.literal('integration'), integrationId: z.string() }),
  ]),
  scale: z.enum(['1-5', '1-10']).default('1-5'),
  pairwise: z.enum(['none', 'vs-reference', 'round-robin']).default('none'),
  promptVersion: z.string(),
});

ExternalTransferPlanSchema = z.object({
  integrationId: z.string(), purpose: z.enum(INTEGRATION_PURPOSES),
  dataClasses: z.array(z.enum(DATA_CLASSES)), estimatedRequests: z.number().int(),
  estimatedInputTokens: z.number().int(),
});

EvalRunConfigSchema = z.object({
  name: z.string(),
  profile: EvalProfileSchema,                 // 사용자가 확인한 사본(D6)
  packs: z.array(z.object({
    scope: z.enum(PACK_SCOPES), packId: z.string(), version: z.string(), contentHash: z.string(),
    tier: z.enum(['smoke', 'standard', 'full']), epochs: z.number().int().positive(),
    circular: z.boolean(), sampleIds: z.array(z.string()),      // 시작 시점에 확정
  })).min(1),
  candidates: z.array(CandidateSnapshotSchema).min(1).max(24),
  judge: JudgeConfigSchema.nullable(),
  options: z.object({
    deterministicMode: z.boolean(),           // temperature 0 강제
    reliabilityEpochs: z.number().int().min(2).max(10),
    timeoutMultiplier: z.number().min(0.5).max(5),
    perfRepeats: z.number().int().min(1).max(10),
    unloadBetweenCandidates: z.boolean(),
    sampleOrderSeed: z.number().int(),
  }),
  confirmations: z.object({
    weightsConfirmedAt: z.string(),           // D6: 없으면 실행 불가
    externalTransfers: z.array(ExternalTransferPlanSchema),
    externalConfirmedAt: z.string().nullable(),
    codeExecution: z.object({ runtime: z.enum(['js', 'python']), snippetCount: z.number().int(),
                              confirmedAt: z.string() }).nullable(),
  }),
});

export const TRIAL_OUTCOMES = ['ok', 'timeout', 'oom', 'provider_error', 'parse_error',
  'no_answer', 'max_turns', 'cancelled', 'skipped_unsupported'] as const;
export const RUN_STATUSES = ['pending', 'running', 'paused', 'judging', 'completed',
  'cancelled', 'failed', 'interrupted'] as const;
```

   - `ToolSchemaJson`은 `{ name: string, description: string, parameters: Record<string, unknown> }`(JSON Schema 객체)로 정의한다.
   - `LlmProviderKindSchema`/`BuiltinToolIdSchema`는 `src/lib/types/agent.ts`의 유니온과 **동일한 값 목록**으로 만들고, 테스트에서 두 목록이 일치하는지 검사한다(타입 수준: `satisfies`).
2. `constants.ts`
   - `CATEGORY_META: Record<EvalCategoryId, { dimension: EvalDimension; labelKey: string; countsTowardComposite: boolean }>` — Q8만 `false`.
   - `ANCHORS_V1`(anchorsVersion `'anchors-v1'`): 기획서 §7.3 표를 그대로 옮긴다.
     ```ts
     decode_tps:      { curve: 'log',    dir: 'up',   zero: 3,     full: 60 }
     prefill_tps:     { curve: 'log',    dir: 'up',   zero: 50,    full: 3000 }
     ttft_p50_ms:     { curve: 'log',    dir: 'down', zero: 15000, full: 500 }
     load_ms:         { curve: 'log',    dir: 'down', zero: 60000, full: 3000 }
     depth_retention: { curve: 'linear', dir: 'up',   zero: 0.3,   full: 0.9 }
     vram_headroom:   { curve: 'linear', dir: 'up',   zero: 0,     full: 0.15 }
     gpu_offload:     { curve: 'linear', dir: 'up',   zero: 0.5,   full: 1.0 }
     ```
   - `BUILTIN_PROFILES`(5종). 차원 가중치(Q/A/P/R/S)와 제약:
     | id | Q | A | P | R | S | categoryWeights(명시분, 나머지 1) | constraints |
     | --- | --- | --- | --- | --- | --- | --- | --- |
     | `balanced` | 30 | 25 | 20 | 10 | 15 | `Q9:2` | `vram_headroom>=0.05`, `failure_rate<=0.10` |
     | `coding-agent` | 25 | 40 | 15 | 5 | 15 | `Q5:3, A1:2, A3:3, Q9:2` | `A1>=70`, `format_error_rate<=0.10` |
     | `ko-writing` | 45 | 10 | 20 | 10 | 15 | `Q1:1.5, Q3:2, Q4:3, Q9:3, Q2:0.5, Q5:0` | `decode_tps>=10` |
     | `fast-response` | 25 | 15 | 40 | 10 | 10 | `P1:2` | `ttft_p50_ms<=2000` |
     | `long-docs` | 30 | 15 | 20 | 20 | 15 | `Q6:4, A6:2` | `effective_context_tokens>=32768` |
     제약의 `metric` 키 목록은 P10-07의 `METRIC_KEYS`와 같다(이 파일에 `CONSTRAINT_METRICS` 상수로 정의): `vram_headroom`, `failure_rate`, `format_error_rate`, `decode_tps`, `ttft_p50_ms`, `effective_context_tokens`, 그리고 카테고리 ID(정규화 점수).
   - `DEFAULT_RUN_OPTIONS`: `deterministicMode=false, reliabilityEpochs=3, timeoutMultiplier=1, perfRepeats=3, unloadBetweenCandidates=true`.
   - `EVAL_TOOLS_ALLOWED: BuiltinToolId[] = ['read','ls','grep','find','write','edit']` (P10-10 필터 기준, `shell`·`web_search`·`web_fetch` 제외).
   - `CONSENT_TEXT_VERSION = 'consent-v1'`, `JUDGE_PROMPT_VERSION = 'judge-v1'`.
3. i18n 골격: `src/lib/i18n/dictionaries/eval/{common,lock,packs,wizard,progress,report,judge,integrations,personal,arena,interop,runner}.{ko,en}.ts`(각각 `export const x: Dict = {}`), `eval/index.ts`에서 `evalKo`/`evalEn`으로 병합, `ko.ts`/`en.ts`에 스프레드 1줄. `common`에는 카테고리·차원 라벨(`eval.common.cat.Q1` 등 19개 + 차원 5개)과 판정(verdict)·결과(outcome) 라벨을 채운다.

### 테스트 (`types.test.ts`)

- 샘플 매니페스트/샘플/프로파일 JSON이 파싱되는지, 잘못된 id/열거값이 거부되는지
- `BUILTIN_PROFILES` 전부가 `EvalProfileSchema`를 통과하는지
- Provider·도구 유니온 동기화 검사

### 완료 조건

다른 작업이 `import { ... } from '@/lib/eval/types'`로 모든 계약을 가져다 쓸 수 있고, i18n 영역 파일이 모두 존재한다.

---

## P10-02. DB 마이그레이션 + Repository

- **선행**: P10-01
- **소유 파일**: `src/lib/db/migrations/0001_init.sql`(평가 테이블 블록 추가), `src/lib/db/client.ts`(평가 테이블 메모리 폴백 + `runMigrations`의 CREATE 블록), `src/lib/db/repositories/evalRepo.ts`, `evalRepo.test.ts`, `integrationsRepo.ts`, `integrationsRepo.test.ts`, `repositories.test.ts`(목 동기화가 필요한 부분만)
- **원칙**: 평가·연동 테이블은 **전역 DB 전용**(D2). 모든 repo 함수는 내부에서 `getGlobalDatabase()`를 호출하며 `workspaceRoot` 인자를 받지 않는다. 기존 P9 작업과 같은 방식으로 `CREATE TABLE IF NOT EXISTS`를 추가하고(`0001_init.sql`과 `runMigrations`를 동기화), 메모리 폴백을 구현한다.

### 스키마

```sql
CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,          -- EvalRunConfig 전체(확정 sampleIds 포함)
  hardware_json TEXT NOT NULL,
  status TEXT NOT NULL,               -- RUN_STATUSES
  error TEXT,
  progress_done INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  started_at TEXT, finished_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_candidates (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  model_meta_json TEXT,               -- 파라미터 수·양자화·크기(/api/show·/api/ps)
  load_ms REAL,
  status TEXT NOT NULL,               -- pending|running|done|failed|skipped
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_eval_candidates_run ON eval_candidates(run_id, position);
CREATE TABLE IF NOT EXISTS eval_trials (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES eval_candidates(id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL, sample_id TEXT NOT NULL, epoch INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  output_text TEXT, reasoning_text TEXT,
  transcript_json TEXT,               -- AgentMessage[] (에이전트/멀티턴)
  final_state_json TEXT,              -- 샌드박스 최종 상태 요약
  extra_json TEXT,                    -- 솔버별 부가(perf 반복값, logprobs 요약, 추출 로그)
  input_tokens INTEGER, output_tokens INTEGER, thinking_tokens INTEGER,
  ttft_ms REAL, prefill_tps REAL, decode_tps REAL, total_ms REAL,
  timing_source TEXT,                 -- 'server'|'client'
  cache_hit INTEGER,                  -- 0/1/NULL(판정 불가)
  vram_peak_mb INTEGER, gpu_util_avg REAL, gpu_temp_max REAL, offload_ratio REAL,
  turns INTEGER, tool_calls INTEGER,
  started_at TEXT NOT NULL, finished_at TEXT,
  UNIQUE(candidate_id, pack_id, sample_id, epoch)
);
CREATE INDEX IF NOT EXISTS idx_eval_trials_run ON eval_trials(run_id, candidate_id, pack_id);
CREATE TABLE IF NOT EXISTS eval_scores (
  id TEXT PRIMARY KEY,
  trial_id TEXT NOT NULL REFERENCES eval_trials(id) ON DELETE CASCADE,
  scorer_key TEXT NOT NULL,
  scorer_type TEXT NOT NULL,
  value REAL NOT NULL,                -- 0~1
  verdict TEXT NOT NULL,
  reason TEXT, extracted TEXT,
  judge_raw TEXT,
  source TEXT NOT NULL DEFAULT 'auto', -- auto|judge|human
  created_at TEXT NOT NULL,
  UNIQUE(trial_id, scorer_key, source)
);
CREATE TABLE IF NOT EXISTS eval_aggregates (
  run_id TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL,
  level TEXT NOT NULL,                -- metric|pack|category|dimension|composite
  key TEXT NOT NULL,
  raw REAL, normalized REAL, ci_low REAL, ci_high REAL, n INTEGER,
  anchors_version TEXT, computed_at TEXT NOT NULL,
  PRIMARY KEY (run_id, candidate_id, level, key)
);
CREATE TABLE IF NOT EXISTS eval_profiles (      -- 사용자 정의 프로파일(내장 5종은 코드 상수)
  id TEXT PRIMARY KEY, profile_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS arena_votes (
  id TEXT PRIMARY KEY,
  prompt_hash TEXT NOT NULL,
  prompt_preview TEXT,                -- 앞 200자(목록 표시용)
  a_snapshot_json TEXT NOT NULL, b_snapshot_json TEXT NOT NULL,
  a_label TEXT NOT NULL, b_label TEXT NOT NULL,
  winner TEXT NOT NULL,               -- a|b|tie|both_bad
  workspace_root TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS external_integrations (
  id TEXT PRIMARY KEY, integration_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS integration_settings (
  id TEXT PRIMARY KEY DEFAULT 'singleton', settings_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS integration_audit_log (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  data_classes TEXT NOT NULL,         -- JSON array
  run_id TEXT,
  request_count INTEGER NOT NULL,
  bytes_sent INTEGER NOT NULL,
  status TEXT NOT NULL,               -- ok|error
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_integration_audit_created ON integration_audit_log(created_at);
```

- JSON 컬럼(`*_json`)은 읽을 때 반드시 P10-01 스키마로 `safeParse`한다. 실패한 행은 건너뛰고 `appLogger.warn`으로 남긴다(앱을 죽이지 않음).
- API 키: `external_integrations.integration_json`의 `llm.apiKey`는 기존 `agents.llm_api_key`와 같은 수준(평문 로컬 DB)으로 저장한다. UI에 "키는 이 PC의 앱 DB에 저장됩니다" 문구를 표시한다(P10-09). 후보 스냅샷에는 키를 **절대 저장하지 않는다**.

### Repository API (`evalRepo.ts`)

```ts
createRun(config: EvalRunConfig, hardware: HardwareFingerprint): Promise<string>
updateRunStatus(runId, status: RunStatus, patch?: { error?: string; startedAt?: string; finishedAt?: string }): Promise<void>
updateRunProgress(runId, done: number, total: number): Promise<void>
getRun(runId): Promise<EvalRunRow | null>
listRuns(opts?: { limit?: number; status?: RunStatus[] }): Promise<EvalRunRow[]>
deleteRun(runId): Promise<void>
insertCandidates(runId, candidates: CandidateSnapshot[]): Promise<EvalCandidateRow[]>
updateCandidate(candidateId, patch: Partial<Pick<EvalCandidateRow,'status'|'error'|'loadMs'|'modelMeta'>>): Promise<void>
listCandidates(runId): Promise<EvalCandidateRow[]>
upsertTrial(trial: EvalTrialRow): Promise<void>            // UNIQUE 키로 upsert(재개 시 덮어쓰기)
listTrials(runId, filter?: { candidateId?: string; packId?: string }): Promise<EvalTrialRow[]>
listCompletedTrialKeys(runId): Promise<Set<string>>          // `${candidateId}|${packId}|${sampleId}|${epoch}`, outcome!=='cancelled'
upsertScores(scores: EvalScoreRow[]): Promise<void>
listScores(runId): Promise<EvalScoreRow[]>                   // trial join
replaceAggregates(runId, rows: EvalAggregateRow[]): Promise<void>  // 트랜잭션: run 단위 삭제 후 삽입
listAggregates(runId): Promise<EvalAggregateRow[]>
pruneRunOutputs(olderThanIso: string): Promise<number>       // output/reasoning/transcript/final_state만 NULL
markInterruptedRuns(): Promise<number>                        // 앱 시작 시 running/judging/paused → interrupted
listProfiles / saveProfile / deleteProfile
insertArenaVote / listArenaVotes(opts?) / deleteArenaVote
```

### Repository API (`integrationsRepo.ts`)

```ts
listIntegrations(): Promise<ExternalIntegration[]>
saveIntegration(i: ExternalIntegration): Promise<void>
deleteIntegration(id): Promise<void>
getIntegrationSettings(): Promise<IntegrationSettings>      // 없으면 기본값
saveIntegrationSettings(s: IntegrationSettings): Promise<void>
appendAudit(entry: Omit<IntegrationAuditRow,'id'|'createdAt'>): Promise<void>
listAudit(opts?: { limit?: number; integrationId?: string }): Promise<IntegrationAuditRow[]>
clearAudit(): Promise<void>
```

### 테스트

기존 `repositories.test.ts` 방식(메모리 폴백)으로: run→candidate→trial→score 삽입·조회, UNIQUE upsert, CASCADE 삭제, `listCompletedTrialKeys`, `markInterruptedRuns`, `pruneRunOutputs`, 손상 JSON 행 스킵, 연동 설정 기본값.

### 확인 방법

`pnpm tauri dev`로 앱을 시작해 전역 DB에 테이블이 생성되는지(SQLite 브라우저 또는 로그) 확인하고, 기존 데이터가 유지되는지 확인한다.

---

## P10-03. 전역 평가 잠금 + 채팅 차단 (D5)

- **선행**: P10-01
- **소유 파일**: `src/lib/eval/evalLock.ts`, `evalLock.test.ts`, `src/components/chat/ChatInput.tsx`, `ChatInput.test.tsx`(잠금 테스트 추가), `src/components/workspace/ChatTab.tsx`(배너만), `src/hooks/useChat.ts`(전송 가드만), `src/components/eval/EvalLockBanner.tsx`, i18n `eval/lock.*`
- **목표**: 평가가 실행되는 동안 **어떤 채팅도 LLM으로 전송·큐잉되지 않게** 한다. 폴더 전환·에이전트 편집 잠금은 기존 전역 busy 경로로 자동 적용되게 한다.

### 작업 내용

1. `evalLock.ts` (외부 스토어 패턴, `chatQueueManager`와 같은 방식)
   ```ts
   export interface EvalLockState { runId: string; runName: string; startedAt: number }
   export const evalLock = {
     acquire(runId: string, runName: string): boolean,  // 이미 잠겨 있거나 채팅이 busy면 false
     release(runId: string): void,                      // runId가 일치할 때만 해제
     get(): EvalLockState | null,
     subscribe(listener: () => void): () => void,
   };
   export function useEvalLock(): EvalLockState | null;   // useSyncExternalStore
   export const EVAL_PSEUDO_SESSION_PREFIX = 'eval:';
   ```
   - `acquire`는 `chatQueueManager.getBusySessionId() !== null`이면 실패한다(진행 중 채팅·대기 큐가 있으면 평가를 시작할 수 없음).
   - 성공하면 `chatQueueManager.setSessionRunning('eval:' + runId, true)`를 호출해 기존 전역 busy 소비자(폴더 전환 가드 P9-02, 에이전트 편집 잠금 P9-05, FileTree)가 자동으로 잠기게 한다. `release`는 `setSessionRunning(..., false)`.
   - 앱 창을 닫으면 잠금은 메모리와 함께 사라진다. 다음 실행 시 `markInterruptedRuns()`(P10-02)가 실행 상태를 `interrupted`로 바꾸고, 이어하기는 사용자가 수동으로 시작한다(D6).
2. `useChat.ts`: `sendMessage`와 큐 적재 경로의 맨 앞에 `if (evalLock.get()) { return; }`를 추가하고, 호출자에게 알릴 수 있도록 기존 오류 알림 경로가 있으면 `eval.lock.chatBlocked` 문구로 알린다. **메시지를 큐에 넣지 않는다**(평가 종료 후 자동 전송되는 것을 막기 위함).
3. `ChatInput.tsx`: `useEvalLock()`이 값을 가지면 입력창·전송·큐 버튼·슬래시 명령·reasoning 셀렉터를 모두 비활성화하고 placeholder를 `eval.lock.inputPlaceholder`로 바꾼다.
4. `ChatTab.tsx`: 상단에 `EvalLockBanner`("평가 실행 중: {runName} — 채팅은 평가가 끝나면 다시 사용할 수 있습니다" + [진행 상황 보기] 버튼 → 평가 진행 탭 열기. 탭 열기는 P10-15의 `openEvalTab` 헬퍼가 생기기 전까지 버튼을 숨긴다).
5. 새 채팅 탭 생성은 막지 않는다(열람은 허용하고 전송만 금지).

### 테스트

- `evalLock`: 채팅 busy 상태에서 acquire 실패, 성공 시 가상 세션이 busy로 보이는지, runId가 다르면 release가 무시되는지
- `ChatInput`: 잠금 상태에서 전송 버튼 비활성화·Enter 무시

### 확인 방법

개발자 콘솔에서 `evalLock.acquire('t','test')`를 호출(임시 디버그 훅은 커밋하지 않음)해 입력 차단·폴더 전환 비활성화·에이전트 편집 잠금을 확인하고, `release` 후 원상 복구되는지 확인한다.

---

## P10-04. 팩 로더 (3계층·해시·층화 샘플링·소스 어댑터)

- **선행**: P10-01, (실제 IO는 P10-08 커맨드. 먼저 `PackFs` 인터페이스와 목으로 개발하고 P10-08 완료 후 연결)
- **소유 파일**: `src/lib/eval/packs/{packFs.ts, packLoader.ts, sampling.ts, hash.ts, sources/jsonl.ts, sources/kmmluCsv.ts, sources/csv.ts, generators/index.ts}` + 각 `*.test.ts`
- **목표**: builtin/user/project 3계층에서 팩을 찾아 검증하고, 샘플을 로드하고, tier별로 **재현 가능한** 샘플 ID 목록을 확정한다.

### 작업 내용

1. `packFs.ts` — Rust 커맨드 래퍼(P10-08의 `eval_list_packs`, `eval_read_pack_file`, `eval_write_pack_files`, `eval_delete_pack`)를 감싼 인터페이스:
   ```ts
   export interface PackFs {
     list(scope: PackScope, workspaceRoot?: string): Promise<Array<{ packId: string; manifestText: string }>>;
     read(scope: PackScope, packId: string, relPath: string, workspaceRoot?: string): Promise<string>;
     write(scope: Exclude<PackScope,'builtin'>, packId: string, files: Array<{ relPath: string; content: string }>, workspaceRoot?: string): Promise<void>;
     remove(scope: Exclude<PackScope,'builtin'>, packId: string, workspaceRoot?: string): Promise<void>;
   }
   export const tauriPackFs: PackFs;          // 실제 구현
   export function createMemoryPackFs(seed: ...): PackFs;  // 테스트용
   ```
2. `packLoader.ts`
   ```ts
   export interface LoadedPackRef { scope: PackScope; manifest: EvalPackManifest; contentHash: string; diagnostics: PackDiagnostic[] }
   export interface LoadedPack extends LoadedPackRef { samples: EvalSample[] }
   listPacks(fs, workspaceRoot?): Promise<LoadedPackRef[]>   // 매니페스트만(빠름). 같은 id가 여러 계층에 있으면 project > user > builtin 우선, 가려진 것은 diagnostics에 기록
   loadPack(fs, ref, workspaceRoot?): Promise<LoadedPack>    // 소스 어댑터로 샘플 로드 + 검증
   ```
   - 검증 실패 샘플은 제외하고 `diagnostics`에 `{ sampleId, message }`로 남긴다(팩 전체를 실패시키지 않음). 매니페스트가 실패하면 그 팩만 목록에서 "오류" 상태로 표시한다.
   - builtin 팩은 `trusted=true`를 강제한다. user/project 팩은 매니페스트 값을 따른다.
   - 샘플 id 중복은 오류 처리한다.
3. `hash.ts` — `contentHash = sha256(canonicalJson(manifest) + '\n' + 원본 샘플 소스 바이트)`. Web Crypto `crypto.subtle.digest('SHA-256')`를 사용한다. canonicalJson은 키를 정렬한 JSON이다.
4. 소스 어댑터
   - `jsonl.ts`: 줄 단위 파싱, 빈 줄 무시, 줄 번호를 진단에 포함
   - `kmmluCsv.ts`: KMMLU 원본 CSV(헤더 `question,answer,A,B,C,D,Category,Human Accuracy` — **착수 시 실제 파일 헤더를 확인**하고 다르면 이슈 로그 기록) → `EvalSample{ id: `${file}#${row}`, input: question, choices: [A,B,C,D], target: 'ABCD'[answer-1], metadata: { subject: 파일명에서 추출, category: Category } }`. **원본 파일은 수정하지 않는다**(ND 라이선스).
   - `csv.ts`: RFC 4180 파서(따옴표·개행 포함 필드) — 임포터와 공용. 외부 라이브러리 없이 구현한다.
   - `generators/index.ts`: `generator` 소스의 레지스트리. `long-context-v1`(P10-23 구현), `perf-probe-v1`(P10-23 구현)이 `registerGenerator(name, fn)`으로 등록한다. 이 작업은 레지스트리와 타입만 만든다:
     ```ts
     export type SampleGenerator = (params: Record<string, unknown>, ctx: { candidateContextSize?: number }) => Promise<EvalSample[]>;
     ```
     생성형 팩은 후보마다 샘플이 달라질 수 있다(컨텍스트 크기 상한). 그래서 `sampleIds`는 **파라미터 조합 id**(예: `len8192-depth50-niah1-#3`)로 고정하고, 후보 ctx를 넘는 샘플은 러너가 `skipped_unsupported`로 처리한다.
5. `sampling.ts`
   ```ts
   selectSampleIds(samples: EvalSample[], tier: Tier, manifest: EvalPackManifest, seed: number): string[]
   ```
   - `n = tiers[tier]`(`'all'`이면 전부). `stratifyBy`가 있으면 각 층에서 `round(n × 층비율)`개를 뽑고(최소 1), 합계가 n과 다르면 큰 층부터 조정한다.
   - 시드 셔플은 `stats/random.ts`의 `mulberry32`를 사용한다(P10-07과 순서가 꼬이면 이 작업에서 `random.ts`를 먼저 만들고 P10-07이 이어받는다 — TODO 이슈 로그에 기록).
   - **같은 (팩 해시, tier, seed)면 항상 같은 결과**여야 한다(테스트).

### 테스트

계층 우선순위, 진단 수집, 해시 안정성(키 순서가 달라도 같은 해시), 층화 비율, 시드 재현성, KMMLU 어댑터(샘플 CSV 3행 픽스처), CSV 파서 엣지케이스(따옴표 안 쉼표·개행·BOM).

---

## P10-05. 결정적 채점기 (L1~L2) + 채점 조합

- **선행**: P10-01
- **소유 파일**: `src/lib/eval/scorers/{index.ts, types.ts, normalizeText.ts, extract.ts, exact.ts, includes.ts, regex.ts, choice.ts, numeric.ts, jsonSchema.ts, toolCallAst.ts, noToolCall.ts, vizBlock.ts, combine.ts}` + 각 `*.test.ts`
- **목표**: 채점기 인터페이스와 레지스트리를 만들고, 외부 호출이 필요 없는 채점기를 구현한다. 다른 작업(P10-06/11/12/13/14)은 같은 인터페이스로 채점기를 **등록**만 한다.

### 인터페이스 (`scorers/types.ts`)

```ts
export interface ScorerInput {
  sample: EvalSample;
  pack: EvalPackManifest;
  outputText: string;                 // 최종 assistant 본문(사고 제외)
  reasoningText?: string;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;  // 첫 턴(tool_call) 또는 전체 궤적(agentic)
  transcript?: AgentMessage[];
  finalState?: SandboxSnapshot;       // P10-08 타입
  extra?: Record<string, unknown>;    // 솔버 부가 데이터(logprobs 등)
}
export interface ScorerResult {
  value: number;                      // 0~1
  verdict: Verdict;
  reason: string;                     // 사람이 읽는 사유(영문 고정 키 + 값). UI에서 i18n 매핑하지 않음
  extracted?: string;
}
export interface Scorer {
  type: ScorerType;
  optionsSchema: z.ZodTypeAny;
  requiresAsync?: boolean;            // Judge/코드실행 등
  score(input: ScorerInput, options: unknown, ctx: ScorerContext): Promise<ScorerResult>;
}
export interface ScorerContext { signal: AbortSignal }
```

- `index.ts`: `registerScorer(s)`, `getScorer(type)`, 그리고 이 작업의 채점기를 기본 등록한다.
- 채점 사유(`reason`)는 짧은 영문 요약(`"expected C, got B"`)으로 통일한다. 리포트 UI가 그대로 보여준다.

### 채점기 명세

| 채점기 | options(zod) | 동작 |
| --- | --- | --- |
| `exact` | `{ normalize?: ('trim'|'case'|'whitespace'|'punct'|'width')[] }` 기본 `['trim','whitespace','width']` | 정규화 후 target(복수면 하나라도) 완전 일치 |
| `includes` | `{ mode: 'any'|'all' = 'any', caseSensitive = false, values?: string[] }` | `values` 또는 target 문자열 포함 |
| `regex` | `{ pattern: string, flags?: string, group?: number, compareTo?: 'target'|'none' = 'target' }` | 매치(없으면 incorrect). `compareTo='target'`이면 캡처 그룹을 정규화 비교 |
| `choice` | `{ extract?: ('answer_line'|'paren'|'last_letter'|'first_letter')[] = ['answer_line','paren','last_letter'], letters?: string }` | `extract.ts` 규칙 체인으로 선택지 문자를 추출. 실패 시 `no_answer`. `circular` 모드는 러너가 회전 결과를 모아 `combine`에서 처리 |
| `numeric` | `{ tolerance = 1e-6, relative = false, extract?: ('boxed'|'answer_line'|'hash4'|'last_number')[] = ['boxed','answer_line','hash4','last_number'] }` | 쉼표·통화·단위를 제거하고 숫자를 비교. 분수(`3/4`)·퍼센트 지원 |
| `json_schema` | `{ schema: JSONSchema, extract: 'fence'|'first_object'|'whole' = 'fence' }` | JSON Schema(object/array/string/number/integer/boolean/enum/required/properties/items/minItems/maxItems/pattern 부분집합)를 zod로 변환해 검증. 지원하지 않는 키워드는 무시하고 사유에 기록 |
| `tool_call_ast` | `{ orderSensitive = false, allowExtraCalls = false }` | BFCL 규칙: ① 호출 수 일치(`allowExtraCalls`면 ≥) ② 함수명 일치 ③ 필수 인자(=`args` 키 − `optionalArgs`) 존재 ④ 정의되지 않은 인자 금지 ⑤ 값이 허용값 목록 중 하나와 "동치". 동치 규칙: bool 정확, 숫자 int↔float 허용, 문자열은 소문자·앞뒤 공백·구두점 제거 후 비교, 경로 문자열은 `\`→`/` 치환·선행 `./` 제거, 배열은 순서 포함 정확, 객체는 재귀. 병렬 호출은 `orderSensitive=false`면 헝가리안 대신 **탐욕적 최선 매칭**(호출 수 ≤ 8 가정, 초과면 순열 탐색 생략하고 순서 매칭). 부분 점수 = 맞은 호출 수 / 기대 호출 수(verdict는 전부 맞아야 correct) |
| `no_tool_call` | `{ requireText?: boolean = true }` | 도구 호출이 0개이고 (옵션) 본문이 비어 있지 않으면 correct |
| `viz_block` | `{ kind: 'mermaid'|'recharts'|'any', minBlocks = 1 }` | `parseVisualBlocks`로 블록 추출 → mermaid는 `mermaid.parse(code)`(동적 import, 실패 = incorrect, 사유에 첫 줄 오류), recharts는 기존 DSL zod 스키마(`src/lib/markdown` 또는 `RechartsViewer`가 쓰는 스키마를 import — **새로 정의하지 말 것**)로 검증 |

- `extract.ts`: 사고 블록 제거(`<think>...</think>`, `<thinking>`), 정답 줄 추출(`/(?:정답|답|answer|ANSWER)\s*[:：]\s*(.+)$/im`), 괄호 선택지(`\(([A-J])\)`), 마지막 단독 대문자, `\boxed{...}`, `####` 뒤 값, 마지막 숫자. 각 함수는 `{ value, rule } | null`을 반환한다.
- `combine.ts`
  ```ts
  combineSampleScore(results: Array<{ spec: ScorerSpec; result: ScorerResult }>): { value: number; verdict: Verdict }
  ```
  - `gate=true`인 결과가 correct가 아니면 → value 0, verdict는 그 결과의 verdict
  - 그 밖에는 가중 평균. verdict: 모두 correct → correct, 모두 0 → incorrect(단, 하나라도 `no_answer`면 `no_answer`), 나머지 → partial
  - `threshold`가 있는 연속 점수는 threshold 이상을 correct로 판정한다
  ```ts
  combineCircular(rotations: ScorerResult[]): ScorerResult    // 전부 correct일 때만 correct
  ```

### 테스트

채점기별 정상·경계·실패 사례를 최소 5개씩(특히 한국어 "정답: ③", 전각 문자, `1,234.5`, `3/4`, 병렬 도구 호출 순서 무관, 환각 인자, 경로 정규화). mermaid 파서는 vitest에서 모킹한다.

---

## P10-06. IFEval 체커 TS 포팅 (영문 + 한국어)

- **선행**: P10-01, P10-05(인터페이스)
- **소유 파일**: `src/lib/eval/scorers/ifeval/{index.ts, registry.ts, checkers/*.ts, koCheckers.ts, textUtils.ts}` + 테스트
- **목표**: IFEval 원본(Apache-2.0)의 **검증 가능 지시 체커**를 TS로 재구현하고, `ifeval` 채점기(`options: { mode: 'strict'|'loose' }`)로 등록한다. 원본 코드를 참고하되 복사하지 않고 명세를 재구현한다.

### 작업 내용

1. 원본 `instructions_registry`의 체커 ID 전부(`keywords:existence`, `keywords:frequency`, `keywords:forbidden_words`, `keywords:letter_frequency`, `language:response_language`, `length_constraints:number_sentences`, `length_constraints:number_paragraphs`, `length_constraints:number_words`, `length_constraints:nth_paragraph_first_word`, `detectable_content:number_placeholders`, `detectable_content:postscript`, `detectable_format:number_bullet_lists`, `detectable_format:constrained_response`, `detectable_format:number_highlighted_sections`, `detectable_format:multiple_sections`, `detectable_format:json_format`, `detectable_format:title`, `combination:two_responses`, `combination:repeat_prompt`, `startend:end_checker`, `change_case:capital_word_frequency`, `change_case:english_capital`, `change_case:english_lowercase`, `punctuation:no_comma`, `startend:quotation`)를 구현한다. **착수 시 IFEval 원본 저장소에서 체커 목록과 kwargs를 다시 확인**하고, 목록 차이는 이슈 로그에 기록한다.
2. `language:response_language`: 외부 언어 감지 라이브러리 없이 **문자 범위 비율**로 판정한다(한글 U+AC00–D7A3, 라틴, CJK 등 주요 스크립트 비율 ≥ 0.6). 원본과 판정이 다를 수 있으므로 사유에 "script-ratio heuristic"을 남긴다.
3. 단어 수: 영문은 공백 분리, 한국어는 **어절(공백) 기준**. 문장 수는 `.!?。` + 한국어 종결(`다.`, `요.`) 기준.
4. loose 모드: 원본처럼 응답 변형 8종(첫 줄 제거, 마지막 줄 제거, 둘 다 제거, `*` 제거 × 각각)에 대해 하나라도 통과하면 통과.
5. 결과: 샘플 점수 = 통과한 지시 비율(instruction-level). `extra`에 `promptLevelPass: boolean`을 남긴다. P10-07 집계에서 `ifeval_prompt_strict`(prompt-level)과 `ifeval_inst_strict`(instruction-level) 두 지표로 산출한다.
6. `koCheckers.ts`(Ko-IFEval 대응): IFEval-Ko 데이터셋이 사용하는 체커 ID를 확인해 한국어 변형을 추가한다(예: 글자 수 제한, 존댓말/반말 — 존댓말 판정은 종결어미 `습니다|니다|세요|요` 비율 ≥ 0.7 휴리스틱). 데이터셋에 없는 체커는 만들지 않는다.

### 테스트

체커마다 통과/실패 쌍 최소 2개, strict vs loose 차이 사례, 한국어 단어·문장 수.

---

## P10-07. 통계·정규화·집계·추천 (순수 함수)

- **선행**: P10-01
- **소유 파일**: `src/lib/eval/stats/{random.ts, wilson.ts, bootstrap.ts, passk.ts, bradleyTerry.ts, descriptive.ts}`, `src/lib/eval/scoring/{metrics.ts, normalize.ts, aggregate.ts, recommend.ts, explain.ts, power.ts}` + 각 테스트
- **목표**: DB 행(Trial·Score)을 받아 지표 → 정규화 → 카테고리/차원/종합 점수 + 신뢰구간 → 제약·파레토·추천까지 계산하는 **순수 함수** 계층. UI와 러너는 이 함수만 호출한다.

### 통계 (`stats/`)

- `random.ts`: `mulberry32(seed)`, `shuffleInPlace(arr, rng)`, `sampleWithReplacement(n, rng)`
- `wilson.ts`: `wilsonInterval(successes, n, z=1.96) → { low, high }`
- `bootstrap.ts`
  ```ts
  bootstrapCI(values: number[], stat: (xs: number[]) => number, opts: { iterations=1000, seed, alpha=0.05, clusters?: string[] }): { low, high, estimate }
  pairedBootstrapDiff(a: Map<string, number>, b: Map<string, number>, opts): { low, high, estimate, n }  // 공통 키만 사용
  ```
  `clusters`가 있으면 군집 단위로 재표집한다(같은 clusterId의 샘플을 통째로 뽑음).
- `passk.ts`: `passAtK(n, c, k)` = `1 − C(n−c,k)/C(n,k)`, `passHatK(n, c, k)` = `C(c,k)/C(n,k)`. 조합은 곱셈 누적으로 계산해 오버플로를 피한다. `n<k`면 `NaN`(호출자가 N/A 처리).
- `bradleyTerry.ts`: MM 알고리즘(Hunter 2004). 입력 `{ a, b, winner: 'a'|'b'|'tie' }[]`(`both_bad`는 tie로 계산), 무승부는 각 0.5승. 최대 200회 반복, 수렴 기준 1e-6. 강도는 로그 스케일로 정규화하고, 표시 점수는 `400·log10(strength) + 1000`(Elo형). 부트스트랩 CI(투표 재표집)도 제공한다. 연결되지 않은 그래프(한 번도 비교되지 않은 후보)는 `null`.
- `descriptive.ts`: `mean`, `median`, `percentile(xs, p)`(선형 보간), `stddev`

### 지표 계산 (`scoring/metrics.ts`)

`computeMetrics(trials, scores, packs) → MetricValue[]` (후보×팩 단위)

| 지표 key | 정의 |
| --- | --- |
| 팩 `MetricSpec.id` | 팩 매니페스트가 정의한 지표. `source='score'` → 샘플 점수(`combineSampleScore`; epochs가 여러 개면 평균), aggregation 적용 |

| `ttft_p50_ms`, `ttft_p95_ms` | `perf_probe` 팩 + 일반 single_turn trial의 `ttft_ms`(워밍업 제외) |
| `decode_tps` | `perf_probe` 트라이얼 decode_tps 중앙값 |
| `prefill_tps` | `cache_hit=0`인 트라이얼의 prefill_tps 중앙값 |
| `load_ms` | `eval_candidates.load_ms` |
| `depth_retention` | perf_probe 중 depthRatio 0.9 샘플 decode_tps ÷ depth 없는 1k 입력 샘플 decode_tps |
| `vram_headroom` | `1 − max(vram_peak_mb)/vramTotalMb` |
| `gpu_offload` | `offload_ratio` 중앙값(Ollama만, 그 외 N/A) |
| `format_error_rate` | (`parse_error` + `no_answer`) / 전체 trial (perf_probe 제외) |
| `failure_rate` | (`timeout`+`oom`+`provider_error`+`max_turns`) / 전체 |
| `pass_hat_k` | `reliability` 태그 샘플의 pass^k 평균(k = reliabilityEpochs) |
| `score_stddev` | reliability 샘플의 epoch 간 점수 표준편차 평균 |
| `effective_context_tokens` | long_context 팩: 길이별 정확도에서 "정확도 ≥ 0.85 × (최단 길이 정확도)"를 만족하는 최대 길이 |
| `tokens_per_correct`, `seconds_per_correct` | 보조(종합 점수 제외) |

- `pickEffectiveScore(scores)`: 같은 `(trial_id, scorer_key)`에 여러 source가 있으면 **human > judge > auto** 순으로 하나만 쓴다(사람 채점이 Judge·자동 채점을 덮어씀). `metrics.ts`에 구현하고 export한다.

### 정규화 (`scoring/normalize.ts`)

```ts
normalizeBaseline(raw, baseline, ceiling=1) = clamp((raw-baseline)/(ceiling-baseline), 0, 1) * 100
// baseline 'auto_choices' = 1/k, circular면 (1/k)^rotations
normalizeAnchor(raw, anchor) =
  curve log,  dir up:   clamp(ln(raw/zero)/ln(full/zero), 0, 1)*100   (raw<=0 → 0)
  curve log,  dir down: clamp(ln(zero/raw)/ln(zero/full), 0, 1)*100
  curve linear, dir up: clamp((raw-zero)/(full-zero), 0, 1)*100
  curve linear, dir down: clamp((zero-raw)/(zero-full), 0, 1)*100
// S 차원 매핑
failure_rate → (1-rate)*100, format_error_rate → (1-rate)*100, pass_hat_k → *100,
score_stddev → clamp(1-2σ,0,1)*100
```
- 프로파일의 `anchorOverrides`가 있으면 앵커를 덮어쓴다.
- 카테고리 매핑: P1 = mean(norm(ttft_p50_ms), norm(load_ms)), P2 = mean(norm(decode_tps), norm(prefill_tps), norm(depth_retention)), R1 = mean(norm(vram_headroom), norm(gpu_offload)), S1 = mean(format·failure·pass^k·stddev 정규화값). N/A 항목은 평균에서 제외한다.

### 집계 (`scoring/aggregate.ts`)

```ts
aggregateRun(input: { config: EvalRunConfig; candidates; trials; scores; packs: LoadedPackRef[]; hardware; arena?: ArenaRatings }): {
  rows: EvalAggregateRow[];          // metric/pack/category/dimension/composite
  coverage: Record<candidateId, number>;   // 가중치 기준 평가된 비율
}
```
- 계층: 팩 정규화 점수 → 카테고리(같은 카테고리 팩들의 **샘플 수 가중 평균**) → 차원(프로파일 categoryWeights 가중 평균, N/A 제외 재정규화) → 종합(dimensionWeights 가중 산술평균, N/A 차원 제외 재정규화). Q8은 종합에서 제외한다.
- **CI 전파**: 팩 점수는 샘플 부트스트랩(군집 반영). 종합 점수 CI는 "모든 팩의 샘플 인덱스를 동시에 재표집 → 전 계층 재계산"을 1000회 반복한다(성능 지표는 반복값이 있으면 그 반복값을 재표집, 없으면 고정). 계산량이 크므로 Web Worker 없이도 1초 이내가 되도록 샘플 점수 배열을 미리 평탄화한다(목표: 후보 12개 × 샘플 2,000개에서 3초 이내 — 넘으면 iterations를 500으로 낮추고 리포트에 표시).
- Arena(Q7): `profile.arena.enabled`이고 투표 수 ≥ `minVotes`인 후보만, BT 점수를 후보 간 min-max로 0~100 변환한다(투표 기반이라 상대 척도임을 리포트에 명시).

### 추천 (`scoring/recommend.ts`, `explain.ts`)

```ts
recommend(aggregates, candidates, profile): {
  eligible: string[]; violations: Record<candidateId, ConstraintViolation[]>;
  pareto: string[];                         // (Q+A 평균, P) 2축 파레토
  picks: { best?: string; fast?: string; quality?: string };
  groups: string[][];                       // 쌍대 부트스트랩으로 "구분 불가" 묶음(순위 순)
}
```
- best: 적격 후보 중 종합 1위
- fast: 파레토 후보 중 종합 점수가 best와 **구분 불가**(쌍대 차이 CI가 0 포함)이면서 P가 가장 높은 후보(best와 같으면 생략)
- quality: 파레토 후보 중 (Q+A) 최고(best와 같으면 생략)
- `explain.ts`: 추천 사유를 템플릿 문장으로 만든다(i18n 키 + 파라미터 반환: `{ key: 'eval.report.reason.fastAlt', params: {...} }`). LLM을 사용하지 않는다.

### 검정력 (`scoring/power.ts`)

`detectableDiff(n, p=0.5) = 1.96·√(p(1−p)/n)`. 실행 마법사가 "구분 가능한 최소 차이 ≈ ±x%p"로 표시한다.

### 테스트

공식별 수치 검증(조사 문서의 예: GPQA 0.6→46.67, MuSR 예시 35.0, Wilson, pass@k 알려진 값, BT 3자 순환 사례, 부트스트랩 시드 재현성), N/A 재정규화, 제약 위반, 파레토, 구분 불가 그룹.

---

## P10-08. Rust 평가 커맨드 (팩 IO·샌드박스·다운로드·런타임 감지·코드 실행)

- **선행**: 없음(P10-01과 병렬 가능)
- **소유 파일**: `src-tauri/src/commands/eval_commands.rs`, `src-tauri/resources/evals/.keep`, 공유 규칙에 따른 `lib.rs`·`mod.rs`·`tauri.conf.json`, `src/lib/eval/runner/sandbox.ts`(TS 래퍼), `src/lib/eval/ipc.ts`(TS invoke 래퍼)
- **목표**: 평가에 필요한 파일시스템·프로세스 작업을 **허용 루트 검증과 함께** 제공한다.

### 허용 루트

| 루트 ID | 경로 | 쓰기 |
| --- | --- | --- |
| `builtin` | `app.path().resource_dir()/resources/evals` | 금지 |
| `user` | `app_data_dir/evals/packs` | 허용 |
| `project` | `{workspaceRoot}/.fortress/evals/packs` (workspaceRoot는 `get_active_workspace_internal()`과 일치해야 함) | 허용 |
| `sandbox` | `std::env::temp_dir()/fortress-eval/<uuid>` | 허용(샌드박스 커맨드만) |
| `exports` | 사용자가 저장 대화상자로 고른 경로 | `eval_export_write`만 |

모든 경로 인자는 루트와 결합 → canonicalize → 루트 하위인지 확인한다. `..`·절대 경로·심링크 탈출은 거부한다. packId는 `^[a-z0-9][a-z0-9-]{1,63}$`만 허용한다.

### 커맨드

```rust
eval_list_packs(scope: String, workspace_root: Option<String>) -> Result<Vec<PackListItem{ pack_id, manifest_text }>, String>
eval_read_pack_file(scope, pack_id, rel_path, workspace_root) -> Result<String, String>     // 파일당 32MB 상한
eval_write_pack_files(scope, pack_id, files: Vec<{rel_path, content}>, workspace_root) -> Result<(), String>  // builtin 거부
eval_delete_pack(scope, pack_id, workspace_root) -> Result<(), String>                        // builtin 거부
eval_sandbox_create(scope, pack_id, fixture_rel_dir, workspace_root) -> Result<String, String>  // 픽스처 복사 → 샌드박스 절대경로
eval_sandbox_create_from_files(files: Vec<{rel_path, content}>) -> Result<String, String>      // 개인 팩(인라인 픽스처)용
eval_sandbox_snapshot(sandbox_root, max_text_bytes: u64) -> Result<Vec<SnapshotEntry{ path, size, is_text, content: Option<String>, modified_ms }>, String>
eval_sandbox_destroy(sandbox_root) -> Result<(), String>
eval_sandbox_cleanup_all() -> Result<u32, String>          // 앱 시작 시 fortress-eval 하위 전부 삭제
eval_detect_runtimes() -> Result<RuntimeInfo{ python: Option<{path, version}>, node: Option<{path, version}> }, String>
eval_run_python(code: String, timeout_ms: u64) -> Result<CodeRunResult{ exit_code, stdout, stderr, timed_out, duration_ms }, String>
eval_download_file(url: String, dest_scope: String, pack_id: String, rel_path: String) -> Result<u64, String>   // 허용 호스트: huggingface.co, raw.githubusercontent.com. 크기 상한 200MB
eval_export_write(path: String, content: String) -> Result<(), String>
eval_read_import_file(path: String) -> Result<String, String>   // 파일 열기 대화상자로 고른 파일만(프런트에서 dialog 결과만 전달), 64MB 상한
```

- 샌드박스 경로 문자열은 기존 파일 도구(`read_text_file` 등)의 `workspace_root` 인자로 그대로 쓰인다. 기존 `resolve_and_verify_workspace_path`가 샌드박스 밖 접근을 막는다(추가 수정 불필요 — **확인만** 하고, 막지 못하면 이슈 로그에 기록).
- `eval_sandbox_snapshot`: 텍스트 판정은 첫 8KB에 NUL이 없고 UTF-8로 디코딩되는지로 한다. `max_text_bytes`를 넘는 텍스트는 content 없이 크기만 반환한다. 해시는 TS에서 계산한다(새 crate 추가 금지).
- `eval_run_python`: 임시 디렉터리를 만들고 `solution.py`를 쓴 뒤 `Command::new(python_path).arg("-I").arg("solution.py")`로 실행한다(셸 경유 금지, `-I` 격리 모드, cwd=임시 디렉터리, 환경변수 최소화: `PATH`만 유지). 타임아웃이 지나면 프로세스를 kill한다. stdout/stderr는 각 64KB까지만 보존한다. **네트워크 차단은 불가능**하다는 점을 P10-13 UI에서 고지한다. 이 커맨드는 프런트가 `integration_settings.allowLocalCodeExecution=true`와 실행별 확인을 검증한 뒤에만 호출한다(P10-13 책임).
- `sandbox.ts`(TS): `createSandbox`, `snapshotSandbox`(sha256을 계산해 `SandboxSnapshot{ files: Array<{path, size, hash, content?}> }` 반환), `destroySandbox`, `cleanupAllSandboxes`.
- 앱 시작 시 `cleanupAllSandboxes()` 호출 위치: P10-15가 `EvalContext` 초기화 때 호출한다.

### 테스트

Rust 단위 테스트: 경로 탈출 거부(`../`, 절대 경로, 심링크), packId 검증, 스냅샷 텍스트 판정, 다운로드 호스트 허용 목록. TS 래퍼는 invoke 모킹 테스트.

---

## P10-09. 외부 연동 설정·동의·게이트웨이·감사 로그 (D3)

- **선행**: P10-01, P10-02
- **소유 파일**: `src/pages/Settings/SettingsIntegrations.tsx`(+테스트), `src/components/eval/integrations/{IntegrationEditorDialog.tsx, ConsentDialog.tsx, AuditLogTable.tsx}`, `src/lib/eval/integrations/{endpointClass.ts, consent.ts, gateway.ts, cliRunner.ts}` + 테스트, `src-tauri/src/commands/integration_commands.rs`, 공유 규칙 파일(`App.tsx` 라우트, `SettingsLayout.tsx` NAV, `lib.rs`, `mod.rs`), i18n `eval/integrations.*`
- **목표**: 앱 밖으로 데이터를 보내는 **모든** 평가 기능이 단일 게이트웨이를 통과하도록 하고, 사용자의 명시적 동의·범위·실행별 확인·감사 로그를 구현한다.

### 1) 엔드포인트 분류 (`endpointClass.ts`)

```ts
classifyEndpoint(baseUrl: string, settings: IntegrationSettings): 'local' | 'lan-trusted' | 'external'
```
- `local`: 호스트가 `localhost`, `127.0.0.0/8`, `::1`
- `lan-trusted`: `settings.trustedLanHosts`에 포함된 호스트(사용자가 명시 등록)
- 그 밖에는 모두 `external`(사설 IP라도 등록하지 않았으면 external)
- 후보(Candidate)의 `endpointClass`도 이 함수로 계산한다(P10-10). **external 후보는 purpose `candidate`로 동의된 연동 없이는 실행할 수 없다** — 해당 에이전트의 Provider/Base URL과 일치하는 `llm-api` 연동이 등록·동의되어 있어야 한다.

### 2) 설정 페이지 `/settings/integrations`

구성(위에서 아래로):
1. **마스터 스위치** "외부 연동 허용"(기본 꺼짐). 끄면 모든 연동이 비활성화되고, 외부 후보·외부 Judge·외부 참조 생성 옵션이 마법사에서 숨겨진다.
2. **데이터 반출 안내**(고정 문구): 어떤 데이터가 어디로 가는지, 공급자의 보관·학습 정책은 공급자 약관을 따른다는 점, API 키 저장 위치.
3. **연동 목록**: 카드마다 이름·종류(LLM API/에이전트 CLI)·엔드포인트·허용 용도·허용 데이터 분류·동의 상태(동의일)·[연결 테스트]·[편집]·[삭제]·[활성화 토글].
4. **연동 추가/편집 다이얼로그**(`IntegrationEditorDialog`)
   - LLM API: Provider 선택(기존 `LLM_PROVIDER_PRESETS` 재사용 — openai/anthropic/gemini/xai/openai-compatible 등), Base URL, 모델(목록 조회 버튼 = `listProviderModels`), API 키(비밀번호 입력)
   - 에이전트 CLI: 실행 파일 절대 경로(파일 선택 대화상자), 고정 인자 목록(줄 단위), 프롬프트 전달 방식(stdin/file — file이면 인자에 `{promptFile}` 토큰 필수), 출력 형식(text/json + jsonPath), 타임아웃. 예시 프리셋 버튼 2개를 제공하되 **사용자가 경로를 직접 지정**해야 한다:
     - Claude Code: args `["-p", "--output-format", "json"]`, promptVia `stdin`, outputFormat `json`, jsonPath `result`
     - Codex CLI: args `["exec", "--skip-git-repo-check", "-"]`, promptVia `stdin`, outputFormat `text`
     (착수 시 각 CLI의 현재 비대화형 옵션을 공식 문서에서 확인하고 프리셋을 맞출 것. 확인 불가하면 프리셋을 빼고 이슈 로그에 기록)
   - 허용 용도 체크박스: 평가 Judge / 참조 답변 생성 / 개인 팩 초안 작성 / 평가 후보로 사용
   - 허용 데이터 분류 체크박스: 공개 번들 데이터 / 개인 데이터(채팅에서 만든 평가셋) / 픽스처 파일 내용
5. **동의 다이얼로그**(`ConsentDialog`): 저장할 때, 그리고 용도·데이터 분류 범위를 **넓힐 때마다** 표시한다. 선택한 용도·분류·엔드포인트를 요약하고 "위 내용을 이해했으며 전송에 동의합니다" 체크 후 [동의하고 저장]. `consent = { version: CONSENT_TEXT_VERSION, grantedAt, purposes, dataClasses }`. 동의 문구 버전이 바뀌면 기존 동의는 무효(재동의 필요)이다.
6. **신뢰 LAN 호스트** 목록 편집(호스트명/IP 문자열).
7. **로컬 코드 실행 허용**(P10-13용, 기본 꺼짐) + 위험 고지.
8. **감사 로그**(`AuditLogTable`): 최근 200건(시각·연동·용도·데이터 분류·요청 수·전송 바이트·상태) + [로그 비우기](확인 팝업).

### 3) 게이트웨이 (`gateway.ts`) — 외부 전송의 유일한 경로

```ts
export interface ExternalRequest {
  purpose: IntegrationPurpose;
  dataClasses: DataClass[];
  runId?: string;
  messages: Array<{ role: 'system'|'user'|'assistant'; content: string }>;
  responseFormat?: 'text' | 'json';
  maxTokens?: number;
  temperature?: number;
}
export async function callIntegration(integrationId: string, req: ExternalRequest, signal: AbortSignal): Promise<{ text: string; usage?: TokenUsage }>;
export function checkPermission(integration, settings, purpose, dataClasses): { ok: true } | { ok: false; reasonKey: string };
```
- 순서: ① 마스터 스위치 ② 연동 enabled ③ consent 존재·버전 일치 ④ purpose ∈ consent.purposes ∩ allowedPurposes ⑤ dataClasses ⊆ consent.dataClasses ∩ allowedDataClasses. 하나라도 실패하면 **전송하지 않고** 예외를 던진다.
- `llm-api`: 기존 `getStreamChatFn`(OpenAI 호환 경로)을 재사용해 스트림을 모아 텍스트를 반환한다(새 HTTP 클라이언트를 만들지 않음).
- `agent-cli`: `cliRunner.ts` → Rust `integration_run_cli`.
- 성공·실패 모두 `appendAudit`(bytes_sent = 메시지 UTF-8 바이트 합). 실행 단위로 모아서 쓰면 DB 부하가 줄어들므로 `runId`가 있으면 1초 디바운스 배치로 기록한다.
- 평가 후보(purpose `candidate`)는 LLM 호출이 러너의 스트리밍 경로를 타므로, 러너는 후보 시작 전에 `checkPermission`을 호출하고 후보 단위로 감사 행 1건(요청 수·바이트 누적)을 남긴다(P10-10).

### 4) Rust `integration_run_cli`

```rust
integration_run_cli(executable_path: String, args: Vec<String>, stdin_text: Option<String>, prompt_file_text: Option<String>, timeout_ms: u64) -> Result<CliRunResult{ exit_code, stdout, stderr, timed_out }, String>
```
- `executable_path`는 절대 경로이고 실제로 존재하는 파일이어야 한다. `Command::new`로 직접 실행한다(**셸 경유 금지**). cwd는 새 임시 디렉터리. `{promptFile}` 토큰은 임시 디렉터리의 `prompt.txt` 절대 경로로 치환한다. 종료 후 임시 디렉터리를 삭제한다.
- stdout은 2MB까지만 보존한다.

### 테스트

`classifyEndpoint` 표 테스트, `checkPermission` 5단계 각각의 거부, 동의 범위 확대 감지(`needsReconsent(prev, next)`), 게이트웨이가 권한 실패 시 fetch/invoke를 호출하지 않는지(모킹), 감사 기록 바이트 계산, CLI json 경로 추출.

### 확인 방법

설정 페이지에서 로컬 Ollama를 openai-compatible 연동으로 등록 → 동의 → 연결 테스트 성공, 감사 로그 1건 확인. 범위를 넓히면 동의 다이얼로그가 다시 뜨는지 확인한다.

---

## P10-10. 러너 코어 (후보·사전점검·솔버 3종·자원 샘플러·체크포인트)

- **선행**: P10-01~05, P10-07, (P10-09는 external 후보 권한 확인용 — 없으면 external 후보를 비활성 처리하고 진행)
- **소유 파일**: `src/lib/eval/runner/{runner.ts, candidates.ts, preflight.ts, estimate.ts, hardware.ts, resourceSampler.ts, timing.ts, outcome.ts, promptBuild.ts, events.ts, solvers/index.ts, solvers/singleTurn.ts, solvers/toolCall.ts, solvers/perfProbe.ts}` + 테스트, i18n `eval/runner.*`
- **목표**: 확정된 `EvalRunConfig`를 받아 Trial을 실행·영속화하고, 이벤트로 진행 상황을 알린다. 다른 솔버(P10-11/14/23)는 `registerSolver`로 붙는다.

### 1) 후보 생성 (`candidates.ts`)

```ts
candidateFromAgent(agent: Agent, settings, integrationSettings): CandidateSnapshot
expandMatrix(base: Agent, axes: MatrixAxes, settings, integrationSettings): CandidateSnapshot[]
// MatrixAxes = { model?: string[]; contextSize?: number[]; temperature?: number[];
//                reasoning?: Array<'off'|'on:low'|'on:medium'|'on:high'|'default'>; topP?: number[]; maxOutputTokens?: number[] }
```
- `enabledBuiltinTools`를 `EVAL_TOOLS_ALLOWED`와 교집합한다(`shell`·`web_search`·`web_fetch` 제거 — Architecture §8.4).
- `contextSize`가 0이면 전역 기본값 또는 `/api/show` 값으로 해석해 고정 숫자로 저장한다(재현성).
- 라벨: 에이전트명 + 스윕 값(`qwen3:8b · ctx32k · T0.2`).
- 조합이 24개를 넘으면 예외를 던진다(마법사에서 사전 차단).

### 2) 사전점검 (`preflight.ts`) → `PreflightReport`

| 항목 | 방법 | 결과 |
| --- | --- | --- |
| 모델 존재·서버 연결 | `checkProviderModel` | 실패 후보 `blocked` |
| 권한 | external 후보는 `checkPermission(..., 'candidate', dataClassesOfSelectedPacks)` | 실패 `blocked` |
| 도구 지원 | Ollama `/api/show` capabilities에 `tools`가 있는지, 그 외 Provider는 `unknown` | `tool_call`/`agentic` 팩은 `skipped_unsupported` 예정 표시 |
| logprobs | Ollama 버전 ≥ 0.12.11(`/api/version`), 그 외 Provider는 미지원으로 간주 | `requires.logprobs` 팩 skip 예정 |
| 코드 런타임 | P10-13 `detectRuntimes` | 없으면 skip 예정 |
| ctx 요구 | `requires.minContextTokens` vs 후보 ctx | skip 예정 |
| VRAM 적합성 | 모델 파일 크기 + `calculateEstimatedKvCacheBytes`(기존) vs GPU 총 VRAM | `fits` / `partial-offload-likely` / `unknown`(비 NVIDIA 등) — **경고만**, 실행은 허용 |
| 채팅 상태 | `chatQueueManager.getBusySessionId()` | busy면 시작 불가 |
| 외부 전송 계획 | external 후보·외부 Judge의 요청 수·토큰 추정 | `ExternalTransferPlan[]` 생성(마법사 확인 단계에서 표시) |

### 3) 시간 추정 (`estimate.ts`)

`estimateRun(config, speedHints) → { perCandidateSec: Record<string, number>; totalSec: number }`
- 샘플당 입력 토큰 ≈ `문자수/3.2`(한국어 포함 보수 계수), 출력 토큰 = 팩 `defaults`의 예상치(솔버별 기본: single_turn 300, tool_call 120, agentic 턴당 250×평균 4턴, perf_probe = 지정값) × (reasoning on이면 3)
- 속도: 해당 모델의 최근 `agent_monitoring_snapshots`(있으면 `decoding_speed`/`prefill_speed` 중앙값), 없으면 decode 20 tok/s·prefill 500 tok/s 가정
- 로드 시간 20초/후보 가정. 실행 중에는 실측값으로 남은 시간을 재추정한다(`runner` 이벤트).

### 4) 하드웨어 지문 (`hardware.ts`)

`collectHardware(): Promise<HardwareFingerprint>` — `getSystemGpuInfo()`(기존), `navigator.userAgent`/Tauri OS 정보, 앱 버전, Ollama `/api/version`(가능하면).

### 5) 프롬프트 구성 (`promptBuild.ts`)

- system 메시지 = (`useAgentSystemPrompt`이면 후보 systemPrompt + `\n\n`) + 팩 `systemPrompt`. 팩 systemPrompt가 없고 useAgentSystemPrompt가 false면 system 메시지를 생략한다.
- few-shot → sample.input(문자열이면 user 1개).
- 객관식: `choices`가 있으면 사용자 메시지 끝에 `A. ...\nB. ...` 목록을 붙인다(팩 systemPrompt가 정답 표기 형식을 지시). circular 회전 r: 선택지를 r칸 회전하고 target 문자도 같이 변환한다.
- 결정성 모드면 temperature 0, seed = `config.options.sampleOrderSeed`(Provider가 지원하는 경우).

### 6) 솔버 인터페이스와 3종 구현

```ts
export interface SolverContext {
  runId: string; candidate: CandidateSnapshot; runtime: ResolvedLlmRuntime; apiKey?: string;
  pack: LoadedPack; sample: EvalSample; epoch: number; rotation?: number;
  streamChat: LlmStreamChatFn; signal: AbortSignal; timeoutMs: number;
  sampler: ResourceSampler; emit: (e: RunnerEvent) => void;
}
export interface SolverResult {
  outcome: TrialOutcome; outputText: string; reasoningText?: string;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
  transcript?: AgentMessage[]; finalState?: SandboxSnapshot; extra?: Record<string, unknown>;
  usage: { input?: number; output?: number; thinking?: number };
  timing: TrialTiming; turns?: number;
}
export type Solver = (ctx: SolverContext) => Promise<SolverResult>;
export function registerSolver(kind: PackKind, solver: Solver): void;
```

- `singleTurn.ts`(`single_turn`, `multi_turn`, `long_context` 공용): `streamChat`을 직접 호출(도구 없음). 첫 청크(content/thinking/toolCalls 중 무엇이든) 도착 시각으로 TTFT를 잰다. 마지막 청크의 `metrics`(Ollama)가 있으면 서버 값, 없으면 클라이언트 근사(`timing_source='client'`, decode_tps = output_tokens/(end−firstToken)).
- `toolCall.ts`(`tool_call`): `sample.tools`가 있으면 그것을, 없으면 팩 `tools`(`'fortress-default'`면 `getBuiltinTools(EVAL_TOOLS_ALLOWED + ['web_search'])`의 스키마만 사용 — **실행하지 않음**)를 전달하고 **1턴만** 생성한다. `runAgentLoop`가 아니라 `streamChat`을 직접 호출해 첫 응답의 toolCalls를 수집한다(도구 실행 경로 자체를 타지 않게 하기 위함). 도구 스키마 변환은 기존 루프가 쓰는 변환 함수를 재사용한다(`messageMapper`/도구 정의 변환부를 확인해 import, 중복 구현 금지).
- `perfProbe.ts`(`perf_probe`): 생성기(P10-23)가 만든 샘플을 `perf.repeats`(기본 `config.options.perfRepeats`)회 반복한다. **반복마다 입력 첫 줄에 다른 nonce**(`[run-{uuid}]`)를 넣어 프롬프트 캐시를 피한다. `maxOutputTokens = perf.outputTokens`, `stop` 없음. 반복값 배열을 `extra.repeats`에 저장하고 대표값은 중앙값으로 한다. 채점 없음.

### 7) 자원 샘플러 (`resourceSampler.ts`)

- **기존 `monitoringCollector`/`agent_monitoring_snapshots`를 사용하지 않는다.** 그 테이블은 `agents(id)` FK가 있어서 저장되지 않은 매트릭스 후보를 기록할 수 없고, 에이전트별 타이머 구조가 평가 Trial 경계와 맞지 않기 때문이다(Architecture §14 D7).
- Trial 시작~종료 동안 1초 간격(설정 `monitoring_interval_ms` 재사용)으로 `getSystemGpuInfo()`와(Ollama면) `getRunningModels()`를 호출해 `{ vramPeakMb, gpuUtilAvg, gpuTempMax, offloadRatio(size_vram/size) }`를 계산한다. 비 NVIDIA면 VRAM 관련 필드는 null.

### 8) 결과 분류 (`outcome.ts`)

예외 → outcome 매핑: `AbortError` → `cancelled`, 타임아웃 → `timeout`, 오류 메시지에 `out of memory`/`CUDA error`/`insufficient memory` → `oom`, 연결/5xx/404 → `provider_error`, 도구 호출 JSON 파싱 실패 → `parse_error`, 에이전트 턴 초과 → `max_turns`. 채점 단계의 추출 실패는 Trial outcome은 `ok`로 두고 Score verdict를 `no_answer`로 남긴다. S1 지표의 `format_error_rate`는 두 가지를 합산한다(P10-07).

### 9) 오케스트레이터 (`runner.ts`)

```ts
export class EvalRunner {
  constructor(deps: { repo; packFs; streamChatFactory; now?; });
  start(runId: string): Promise<void>;       // DB에 저장된 config로 실행(새 실행·이어하기 공용)
  pause(): void; resume(): void; cancel(): void; skipCurrentCandidate(): void;
  on(listener: (e: RunnerEvent) => void): () => void;
}
```

실행 절차:
1. `evalLock.acquire(runId)` 실패 시 즉시 종료(상태 변경 없음, 이벤트로 사유 전달).
2. 팩 로드(`loadPack`) + 해시 검증: config의 `contentHash`와 다르면 **실행 중단**(`failed`, 사유 "pack changed since run was configured"). 이어하기 시에도 동일하다.
3. `listCompletedTrialKeys`로 완료분을 건너뛴다.
4. 후보 순서대로(`position`):
   1. (옵션) 이전 모델 언로드: Ollama면 `POST /api/generate {model, keep_alive: 0}`(ollamaClient에 헬퍼가 없으면 **이 작업의 소유 파일 `timing.ts`에 로컬 헬퍼로 구현** — ollamaClient는 수정하지 않음). 그 외 Provider는 생략.
   2. 콜드 로드 측정: 짧은 요청 1회(`"ping"`, maxOutputTokens 1) → `load_ms`(Ollama `load_duration`, 그 외는 첫 요청 TTFT). 이 요청을 워밍업으로 겸하고 결과에서 제외한다.
   3. 팩 순서: perf_probe → single/multi → tool_call → long_context → compaction_recall → agentic → logprob_trace(자원 상태가 가장 깨끗할 때 성능을 먼저 잰다).
   4. 샘플 순서: `sampleOrderSeed`로 셔플(모든 후보 동일 순서).
   5. epochs: 팩 `defaults.epochs`. `reliability` 태그 샘플은 `max(epochs, reliabilityEpochs)`.
   6. circular: 회전 수 = 선택지 수(최대 4, 초과면 4회 회전).
   7. 각 Trial: 솔버 실행(타임아웃 = 팩 timeoutSec × timeoutMultiplier × (reasoning on이면 3)) → 결정적 채점기 실행(`requiresAsync`가 아닌 것 + 코드 실행 채점기는 P10-13 규칙) → `upsertTrial` + `upsertScores` → 진행률 갱신 → 이벤트 발행.
   8. 후보 단위 external 감사 기록(P10-09).
5. 모든 후보 완료 → Judge가 설정돼 있으면 상태 `judging`으로 바꾸고 P10-12 `runJudgePass(runId)` 호출.
6. 집계: `aggregateRun` → `replaceAggregates`.
7. 상태 `completed` → `evalLock.release`.
- 일시정지: 현재 Trial이 끝난 뒤 멈춘다(`paused`). 취소: 현재 Trial을 abort하고 `cancelled` 저장. 오류로 멈추면 `failed`. **어느 경우든 `finally`에서 잠금을 해제**한다.
- `RunnerEvent`: `run_status`, `candidate_start`(label), `candidate_end`, `trial_start`(packId, sampleId, epoch), `trial_delta`(스트리밍 미리보기 텍스트, 200ms 스로틀), `trial_end`(outcome, 대표 점수), `resource`(최신 샘플러 값), `eta`(남은 초), `log`(경고).

### 테스트

가짜 `streamChat`(결정적 응답)과 메모리 repo로: 전체 실행 → 트라이얼 수 = Σ(샘플×epoch×회전), 이어하기 시 완료분 스킵, 팩 해시 불일치 중단, 취소 시 잠금 해제, 타임아웃 분류, 샘플 순서 동일성, external 후보 권한 거부.

---

## P10-11. 에이전트형 솔버 + 샌드박스 정책 + 상태·궤적 채점 (A3·A5 파일 작업 평가)

> **"파일 작업 평가(A3)"란**: 에이전트에게 작은 가짜 프로젝트 폴더(픽스처)를 주고 "X가 정의된 파일을 찾아 Y로 고쳐라", "README를 요약해 SUMMARY.md로 저장해라" 같은 실제 업무를 시킨 뒤, **작업이 끝난 폴더의 파일 상태**를 정답과 비교해 채점하는 평가다. Fortress가 실제로 하는 일(파일을 읽고·찾고·고치는 에이전트 작업)을 가장 직접적으로 재는 항목이다. 사용자의 실제 프로젝트는 건드리지 않고, 매 Trial마다 임시 폴더에 복사본을 만들어 실행한 뒤 삭제한다.

- **선행**: P10-08, P10-10
- **소유 파일**: `src/lib/eval/runner/solvers/agentic.ts`, `src/lib/eval/runner/sandboxPolicy.ts`, `src/lib/eval/scorers/{fsState.ts, trajectory.ts}` + 테스트
- **목표**: 실제 도구를 실행하는 멀티턴 에이전트 과제를 격리 실행하고 결과 상태로 채점한다.

### 작업 내용

1. `agentic.ts`
   1. `createSandbox(scope, packId, sample.fixture.dir)` → `sandboxRoot`
   2. 도구: `getBuiltinTools(candidate.enabledBuiltinTools ∩ EVAL_TOOLS_ALLOWED, { workspaceRoot: sandboxRoot })`
   3. 스킬·컨텍스트 파일: 팩 `trusted`일 때만 `scanSkills`/컨텍스트 파일 수집을 `sandboxRoot` 기준으로 수행하고 후보의 `enabledSkills`와 무관하게 **샌드박스에서 발견된 스킬 전부**를 노출한다(A5는 스킬 발견 자체를 평가). trusted가 아니면 스킬·AGENTS.md를 로드하지 않는다.
   4. 시스템 프롬프트: `buildSystemPromptSections({ agent: 후보(systemPrompt 포함 여부는 팩 설정), tools, contextFiles, skills, cwd: sandboxRoot })` + `formatSystemPrompt`
   5. `runAgentLoop({ agent: LoopAgentConfig(후보), messages, tools, hooks: composeHooks(sandboxPolicyHooks(sandboxRoot), truncationHooks), signal, steeringQueue: 빈 큐, followUpQueue: 빈 큐, emit, baseUrl, apiKey, streamChatFn })`
      - 압축 훅은 붙이지 않는다(A3는 짧은 과제, 압축은 A6에서 따로 측정). 컨텍스트 초과 시 `provider_error`로 기록.
      - `shouldStopAfterTurn`: 턴 수가 `maxTurns`에 도달하면 true → outcome `max_turns`.
      - 전역 `getRegisteredHooks()`는 **사용하지 않는다**(승인 다이얼로그 훅이 포함되어 있음). 절단은 `truncateOutput`을 직접 호출하는 `afterToolCall` 훅으로 동일하게 적용한다.
   6. 종료 후 `snapshotSandbox` → `finalState`, 이벤트에서 도구 궤적 수집 → `toolCalls`(전체), `transcript`
   7. `finally`에서 `destroySandbox`
2. `sandboxPolicy.ts` — 평가 전용 `beforeToolCall` 정책(Architecture §8.4의 예외 규정 그대로):
   - 허용 도구: `read`, `ls`, `grep`, `find`, `write`, `edit`. 그 밖의 도구(특히 `shell`)는 `{ block: true, reason: 'blocked by evaluation sandbox policy' }`.
   - 경로 인자(`path`, `file_path` 등 도구 스키마의 경로 필드 전부)가 있으면 샌드박스 루트 기준으로 해석해 루트 밖이면 차단한다(Rust 검증과 이중 방어).
   - 차단은 사용자 대화상자를 띄우지 않는다. 차단 횟수를 `extra.blockedToolCalls`로 남긴다.
3. `fsState.ts`(`fs_state` 채점기): `sample.expectState` 항목별 판정 → 통과 비율을 점수로, 전부 통과면 correct. `glob` 매칭은 간단한 glob(`*`, `**`, `?`) 구현. `unchanged`는 픽스처 원본 해시와 비교한다(원본 해시는 샌드박스 생성 직후 스냅샷으로 저장해 `extra.initialState`에 둔다 — 솔버 책임).
4. `trajectory.ts`(`trajectory` 채점기): `mustCall`(모두 호출), `mustNotCall`(하나도 호출 안 함), `maxCalls`(총 호출 수 ≤), `mustReadPaths`(`read` 호출의 경로 인자에 포함). 조건별 통과 비율.

### 테스트

가짜 스트림으로 "ls → read → write" 시나리오 실행 후 상태 채점, 샌드박스 밖 경로 차단, shell 차단, maxTurns, 스냅샷 unchanged 판정.

### 확인 방법

`fab-fs-tasks`(P10-22) 샘플 1개로 실제 Ollama 모델을 실행해 임시 폴더 생성·삭제와 채점 결과를 확인한다. 실행 도중과 이후에 사용자 워크스페이스 파일이 바뀌지 않았는지 확인한다.

---

## P10-12. LLM Judge 패스 + 사람 채점

- **선행**: P10-09, P10-10
- **소유 파일**: `src/lib/eval/judge/{judgePass.ts, prompts.ts, parse.ts, agreement.ts}`, `src/lib/eval/scorers/{llmJudge.ts, human.ts}` + 테스트, i18n `eval/judge.*`
- **목표**: 모든 후보 실행이 끝난 뒤 Judge 채점기를 일괄 실행하고, 사람 채점을 저장·우선 적용한다.

### 작업 내용

1. Judge 대상: 팩/샘플 scorer에 `llm_judge_rubric` 또는 `llm_judge_pairwise`가 있는 Trial 중 해당 source='judge' 점수가 아직 없는 것.
2. Judge 호출 경로
   - `local`: 러너와 같은 스트리밍 경로(`getStreamChatFn`). 호출 전에 후보 모델을 언로드하고 Judge 모델을 로드한다.
   - `integration`: `gateway.callIntegration(id, { purpose: 'judge', dataClasses: 팩 분류 })`. 팩의 데이터 분류는 scope로 정한다: builtin → `public-bundled`, project/user 개인 팩(카테고리 Q9 또는 매니페스트 `personal: true` 메타) → `personal`, 픽스처 내용이 포함되면 `fixture-files` 추가.
3. 자기 채점 방지: Judge 모델 태그가 후보 모델 태그와 같으면 그 후보의 Judge 채점을 건너뛰고 verdict `skipped`, 사유 "self-judging prevented". 같은 계열(`family`가 같음, `/api/show` 기준)이면 리포트 경고 플래그만 남긴다.
4. 프롬프트(`prompts.ts`, 버전 `judge-v1`, 영어 지시 + 한국어 루브릭 허용):
   - 단일 채점: 질문, (참조 답변), 루브릭 항목, 채점 척도 설명, **"길이 자체로 가점하지 말 것"**, 출력 JSON `{"criteria":[{"name":"...","score":n,"reason":"..."}],"overall":n}`
   - 쌍대 비교: 질문, 답변 A/B, 출력 JSON `{"winner":"A"|"B"|"tie","reason":"..."}`. **순서를 바꿔 2회** 호출하고 불일치하면 tie.
5. `parse.ts`: 코드펜스·앞뒤 텍스트를 제거한 뒤 첫 JSON 객체를 zod로 파싱한다. 실패하면 "JSON만 출력하라"는 재요청을 1회 하고, 그래도 실패하면 verdict `error`.
6. 점수 변환: 1–5 → `(s−1)/4`, 1–10 → `(s−1)/9`. 쌍대 `vs-reference`: 승 1, 무 0.5, 패 0. `round-robin`: 같은 샘플의 후보 쌍별 결과 → P10-07 BT로 샘플별 점수 대신 **팩 단위 BT 점수**를 계산해 `extra`에 저장한다(리포트 표시 전용, 종합 점수에는 `vs-reference`/rubric만 사용).
7. Judge 설정 기록: `eval_scores.judge_raw`에 원문, `reason`에 요약. 리포트에서 Judge 모델·프롬프트 버전을 표시한다.
8. 길이 편향 점검(`agreement.ts`): 팩별 (Judge 점수, 출력 길이) Spearman 상관을 계산해 |ρ| ≥ 0.5이면 리포트 경고.
9. 사람 채점(`human.ts`): `saveHumanScore(trialId, scorerKey, value, verdict, note)` → `eval_scores` source='human'. 집계 우선순위(human > judge > auto)는 P10-07의 `pickEffectiveScore`가 이미 적용하므로 이 작업은 저장만 한다.
10. Judge–사람 일치도(`agreement.ts`): 같은 Trial에 judge와 human 점수가 모두 있는 건이 20개 이상이면 이진화(≥0.5)한 일치율과 Cohen's κ를 계산한다. κ < 0.4면 리포트에 "Judge 신뢰 낮음" 표시.

### 테스트

JSON 파싱 복구, 순서 교체 불일치 → tie, 자기 채점 방지, human 우선순위, κ 계산 수치.

---

## P10-13. 코드 실행 채점 (JS Worker 기본 + Python 옵트인)

- **선행**: P10-08, P10-10
- **소유 파일**: `src/lib/eval/scorers/{codeExec.ts, codeExtract.ts}`, `src/lib/eval/runtimes/{jsWorker.ts, jsWorkerHost.ts, python.ts, detect.ts}` + 테스트
- **목표**: 모델이 생성한 코드를 격리 실행해 테스트 통과 여부로 채점한다(Q5).

### 작업 내용

1. `codeExtract.ts`: 응답에서 언어 태그가 일치하는 마지막 코드펜스(없으면 첫 코드펜스, 그래도 없으면 전체)를 추출한다. `entryPoint` 함수 정의가 없으면 `no_answer`.
2. JS 런타임(기본, 추가 의존성 없음)
   - `jsWorkerHost.ts`: `new Worker(new URL('./jsWorker.ts', import.meta.url), { type: 'module' })`. 샘플마다 **새 Worker**를 만들고 타임아웃(기본 5초) 시 `terminate()`한다.
   - `jsWorker.ts`: 실행 전에 `fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `indexedDB`, `caches`를 `undefined`로 덮는다. 코드 + 테스트를 `new Function`으로 실행하고 `{ passed, failed, error }`를 postMessage한다. 테스트 포맷은 `assertEqual(actual, expected)` 헬퍼 호출 목록(P10-23 `fab-code-js` 명세 참조).
   - CSP가 Worker의 `new Function`을 막는지 확인하고, 막히면 `worker-src`/`script-src` 조정이 필요하다는 이슈를 기록한 뒤 **CSP 변경은 사용자 승인 후** 진행한다(보안 설정 변경이므로).
3. Python 런타임(옵트인)
   - `detect.ts`: `eval_detect_runtimes` 결과를 캐시한다.
   - `python.ts`: 코드 + 테스트(HumanEval+ `test` + `check(entry_point)` 호출)를 하나의 스크립트로 합쳐 `eval_run_python`(타임아웃 10초)을 호출한다. exit 0이면 통과.
   - **실행 조건**(모두 충족해야 호출): `integration_settings.allowLocalCodeExecution === true`, 해당 실행의 `config.confirmations.codeExecution`이 존재(마법사에서 "모델이 생성한 코드 N개를 이 PC의 임시 폴더에서 실행합니다. 네트워크는 차단되지 않습니다" 확인), Python 감지 성공. 하나라도 아니면 Trial은 `skipped_unsupported`.
4. `codeExec.ts`(`code_exec` 채점기, `requiresAsync: true`): `sample.code.language`로 런타임을 선택한다. 결과 점수 1/0, 사유에 실패 테스트 수와 첫 오류 줄. pass@k는 epochs가 k 이상일 때 P10-07에서 계산한다.

### 테스트

Worker 격리(네트워크 API 접근 시 실패), 무한 루프 타임아웃, 코드 추출 규칙, Python 실행 조건 게이트(모킹).

---

## P10-14. logprobs 기능: 객관식 확률 모드 + 양자화 충실도 (Q8)

- **선행**: P10-10
- **소유 파일**: `src/lib/eval/logprobs/{client.ts, choiceProb.ts, quantFidelity.ts}`, `src/lib/eval/scorers/choiceLogprob.ts`, `src/lib/eval/runner/solvers/logprobTrace.ts` + 테스트
- **전제**: Ollama ≥ 0.12.11의 `/api/chat` `logprobs: true`, `top_logprobs: N`(출력 토큰에 대한 로그확률). 다른 Provider는 이 기능을 N/A로 처리한다. **착수 시 Ollama API 문서에서 응답 필드 구조를 다시 확인**할 것(조사 시점 정보).
- **목표**: ① 객관식 문항의 정답 확률을 연속 점수로 기록해 분산을 줄인다(Anthropic 권고 3) ② 같은 기반 모델의 양자화 버전 간 출력 분포 차이를 잰다.

### 작업 내용

1. `client.ts`: logprobs 요청 전용 비스트리밍 호출 헬퍼(`stream: false`, `logprobs: true`, `top_logprobs: 20`, `options.num_predict` 지정). ollamaClient를 수정하지 않고 이 파일에서 `fetch`로 구현한다(요청 형식은 ollamaClient와 동일한 baseUrl 규칙).
2. `choice_logprob` 채점기: 객관식 팩에서 옵션 `mode: 'prob'`일 때 사용한다. 프롬프트 끝에 "정답 문자 하나만 출력"을 붙여 `num_predict: 3`으로 요청 → 첫 비공백 출력 토큰 위치의 top_logprobs에서 각 선택지 문자(`A`, ` A`, `(A` 변형 포함)의 확률을 합산·정규화 → 정답 확률을 value로, argmax가 정답이면 correct. 선택지 문자가 top_logprobs에 하나도 없으면 `no_answer`.
   - 이 모드는 reasoning off 후보에서만 의미가 있으므로 reasoning on 후보는 일반 `choice` 채점으로 대체한다(러너가 판단, 리포트에 표시).
3. `logprob_trace` 솔버 + `quantFidelity.ts`(Q8, 종합 점수 제외):
   - 대상: 같은 실행 안에서 사용자가 "기준 모델"로 지정한 후보 R(예: `qwen3:8b-q8_0` 또는 fp16)과, 같은 기반 모델의 다른 양자화 후보 Q들. 마법사(P10-16)에서 "양자화 비교" 옵션을 켜고 R을 고른다. 기반 모델 동일성은 `/api/show`의 `family`와 `parameter_size`가 같은지로 판정한다.
   - 각 프롬프트(팩 `fab-quant-probe`, P10-23)에 대해 R과 Q 모두 temperature 0으로 `num_predict: 256`, `top_logprobs: 20`을 생성한다.
   - **공통 접두 구간**: 두 출력 토큰열이 처음 달라지는 위치 d 전까지는 두 모델이 같은 문맥에서 다음 토큰 분포를 낸 것이므로 비교할 수 있다. 이 구간에서 위치별로 top-20 합집합 토큰에 대해 KL(P_R‖P_Q)를 계산한다(합집합 밖 확률은 잔여 질량 1−Σ로 한 버킷에 모으고, 한쪽에 없는 토큰은 ε=1e-6으로 처리).
   - 지표: `mean_kld`(공통 접두 평균 KL), `top1_agreement`(공통 접두에서 top-1 일치율 = d / min(len) 근사가 아니라 위치별 top-1 일치 비율), `divergence_pos_median`(첫 분기 위치 중앙값). 리포트에 표로만 표시한다(정규화 앵커 없음).
   - 한계(리포트 고지): 출력 토큰 기준이며 입력 토큰 KLD(LocalBench 방식)가 아니다. 분기 이후는 비교하지 않는다.

### 테스트

KL 계산 수치(수작업 분포), 공통 접두 계산, 선택지 토큰 변형 합산, logprobs 미지원 시 N/A.

---

## P10-15. UI 골격: 탭·패널·EvalContext

- **선행**: P10-01, P10-02, P10-03, P10-08
- **소유 파일**: `src/lib/types/workspaceTab.ts`(`'eval'` 탭, `'evaluation'` 패널 추가), `src/components/layout/ActivityBar.tsx`(항목 1개), `src/components/layout/TopMenuBar.tsx`(메뉴 "평가" 1개 — 새 평가/평가 목록), `src/components/sidepanel/SidePanel.tsx`(라우팅 1줄), `src/components/workspace/CenterWorkspace.tsx`(탭 라우팅·아이콘 1줄씩), `src/components/workspace/EvalTab.tsx`, `src/components/eval/EvalListPanel.tsx`, `src/lib/context/EvalContext.tsx`, `src/lib/eval/ui/openEvalTab.ts`, i18n `eval/common.*`(패널·탭 문구 추가분)
- **목표**: 평가 UI가 들어갈 자리와 상태 컨테이너를 만든다.

### 작업 내용

1. 탭 모델: `type: 'eval'`, `id` 규칙 — `eval:wizard`(단일), `eval:run:{runId}`(진행/리포트 공용, 상태에 따라 뷰 전환), `eval:packs`(팩 관리), `eval:pack:{scope}:{packId}`(팩 편집), `eval:arena`(Arena 목록). `meta.view: 'wizard'|'run'|'packs'|'pack'|'arena'`. 아이콘 `FlaskConical`.
2. `openEvalTab.ts`: `openEvalWizard()`, `openEvalRun(runId)`, `openEvalPacks()`, `openEvalPack(scope, packId)`, `openArenaList()` — `WorkspaceTabsContext`의 멱등 `openTab` 사용. P10-03 배너의 [진행 상황 보기]가 이것을 쓴다(P10-03 배너 버튼 활성화는 이 작업에서 한 줄 연결 — `EvalLockBanner.tsx` 수정 허용, 이슈 로그에 기록).
3. `EvalContext.tsx`(관심사별 Context 원칙):
   - 상태: `runs`(목록), `activeRunner`(실행 중 러너 인스턴스와 최신 이벤트 요약), `packs`(LoadedPackRef 목록 캐시), `profiles`(내장+사용자), `integrationSettings`.
   - 동작: `refreshRuns()`, `refreshPacks()`, `createRun(config)`(DB 저장만, 시작 안 함), `startRun(runId)`(D6: 사용자 버튼으로만 호출), `pause/resume/cancel/skipCandidate`, `deleteRun`.
   - 초기화 시: `markInterruptedRuns()`, `cleanupAllSandboxes()`.
   - **자동 시작·예약 실행 코드를 만들지 않는다**(D6).
4. `EvalListPanel.tsx`(사이드 패널):
   - 상단 [새 평가] 버튼(잠금 중 비활성) + [평가셋 관리]
   - 실행 중 카드(진행률 바, 현재 후보, ETA, [열기])
   - 최근 실행 목록(이름·날짜·상태 배지·후보 수·추천 1위 라벨), `interrupted` 행에는 [이어하기] 버튼(확인 팝업 후 `startRun`)
   - 행 메뉴: 열기 / 이름 변경 / 복제(설정 그대로 새 마법사로) / 삭제(확인 팝업)
5. `EvalTab.tsx`: `meta.view`로 P10-16~20 컴포넌트를 라우팅한다. 해당 컴포넌트가 아직 없으면 i18n placeholder를 표시한다(웨이브 병렬 진행용).

### 확인 방법

ActivityBar에서 평가 패널을 열고 탭을 열고 닫기, 앱 재시작 후 탭이 복원되는지(`eval` 탭도 기존 탭 영속화 대상) 확인한다.

---

## P10-16. 실행 마법사 (가중치·기준값 확인 필수 — D6)

- **선행**: P10-07, P10-09, P10-10, P10-15
- **소유 파일**: `src/components/eval/wizard/{EvalRunWizard.tsx, StepProfile.tsx, StepPacks.tsx, StepCandidates.tsx, MatrixBuilder.tsx, StepReview.tsx, WeightsAnchorsEditor.tsx, ExternalTransferSummary.tsx, ProfileEditorDialog.tsx}` + 테스트, i18n `eval/wizard.*`
- **목표**: 사용자가 모든 설정을 **직접 확인한 뒤** 실행을 만들고 시작하는 UI.

### 단계

1. **목적(프로파일)**: 내장 5종 + 사용자 프로파일 카드. 카드에 차원 가중치 막대와 제약 요약. [복제해서 편집] → `ProfileEditorDialog`(차원·카테고리 가중치 슬라이더, 제약 추가/삭제, 앵커 덮어쓰기) → `saveProfile`.
2. **평가셋**: 팩 목록(카테고리별 그룹, 계층 배지 builtin/user/project, 라이선스 표시, 진단 오류 표시). 프로파일 가중치가 0인 카테고리의 팩은 흐리게 표시한다. **크기 선택(Quick / Standard / Full)** 으로 팩 조합·분량을 자동조합하고(`sizePresets.ts`, P10-27), 팩별 tier(Smoke/Standard/Full)·epochs·circular는 **고급(팩별 세부)** 폴드에서 바꾼다. (旧 스위트 프리셋 버튼 "빠른 점검(Smoke 전체)" / "표준" / "전체"는 P10-27에서 삭제됨.)
   - 요구사항 불충족(도구 미지원·logprobs·코드 런타임) 예정 표시는 3단계 이후 사전점검 결과로 갱신한다.
3. **후보**: 탭 2개
   - "에이전트 선택": 에이전트 다중 선택(Provider·모델·ctx 표시, external이면 배지 + 권한 상태)
   - "매트릭스": 기준 에이전트 + 축 입력(모델은 `listProviderModels` 드롭다운 다중 선택, 수치 축은 콤마 입력) → 조합 미리보기 표, 24개 초과 시 오류
   - "양자화 비교(Q8)" 토글: 기준 후보 선택(P10-14). 켜면 `fab-quant-probe` 팩이 자동 포함된다(P10-27).
   - 평가 모델 설정(모델 채점이 필요한 팩이 선택된 경우만, 旧 "Judge 설정" — 키 유지, 표시명 변경, P10-27): 로컬 모델 선택 또는 외부 연동 선택(권한 있는 `judge` 용도 연동만 목록에 표시), 척도, 쌍대 모드
   - 실행 옵션: 결정성 모드, reliability epochs, 타임아웃 배수, perf 반복, 후보 간 언로드
4. **검토·생성(StepReview)** — 여기서만 [실행 생성]이 가능하다 (旧 "확인", 표시명 변경, P10-27)
   - 사전점검 결과 표(후보×항목, 차단/경고)
   - 예상 시간(후보별, 합계)과 검정력 안내("팩 X: 구분 가능한 최소 차이 ≈ ±9.8%p")
   - **가중치·기준값 확인 패널**(`WeightsAnchorsEditor`, D6): 이번 실행에 쓸 차원·카테고리 가중치와 성능 앵커(`ANCHORS_V1` + 덮어쓰기)를 표로 모두 보여주고, 이 자리에서 수정할 수 있다(수정분은 이번 실행의 프로파일 사본에만 반영, [프로파일로 저장] 선택 가능). 각 앵커 옆에 의미 설명(예: "decode 3 tok/s = 0점, 60 tok/s = 100점, 로그 곡선")을 표시한다. 하단 체크박스 **"가중치를 확인했습니다"** — 체크해야 다음 버튼이 활성화된다. 체크 시각이 `confirmations.weightsConfirmedAt`이 된다.
   - **외부 전송 요약**(`ExternalTransferSummary`, 해당 시): 연동별 용도·데이터 분류·예상 요청 수·토큰 + 체크박스 "외부 전송에 동의합니다". 체크하지 않으면 외부 요소를 제외하고 진행할지 묻는다.
   - **코드 실행 확인**(Python 사용 시): P10-13 문구 + 체크박스
   - 버튼: [실행 생성] → `createRun`(config 확정, `sampleIds`를 이 시점에 `selectSampleIds`로 고정) → "평가가 등록되었습니다" 완료 팝업에서 **[즉시 실행] / [나중에 실행]** 선택(EVAL-RUNUX-A). [즉시 실행]은 실행 탭을 먼저 열고 `startRun`을 비동기로 띄운다. [나중에 실행]은 목록에 `pending`으로 남기고, 사용자가 패널에서 [시작]을 눌러야 실행된다.
5. 평가 잠금 중에는 마법사를 열 수 있지만 완료 팝업의 [즉시 실행]은 비활성화한다.

### 테스트

확인 체크 전 버튼 비활성, 외부 전송 미동의 시 외부 후보 제외, 매트릭스 조합 수, 확정 config 스냅샷(가중치 수정분 반영).

---

## P10-17. 진행 화면

- **선행**: P10-10, P10-15
- **소유 파일**: `src/components/eval/progress/{EvalRunProgress.tsx, CandidatePackMatrix.tsx, LiveSamplePreview.tsx, ResourceMiniChart.tsx, RunLog.tsx}` + 테스트, i18n `eval/progress.*`
- **내용**
  - 헤더: 실행 이름, 상태 배지, 전체 진행률, 경과·남은 시간, [일시정지]/[재개]/[후보 건너뛰기]/[취소](확인 팝업)
  - 후보×팩 매트릭스: 셀마다 진행률과 현재까지의 정답률(대표 지표), 실행 중 셀 강조
  - 현재 샘플 미리보기: 입력 앞 300자, 스트리밍 출력(스로틀), 도구 호출 목록(agentic)
  - 자원 미니 차트: 최근 120초 decode tok/s·VRAM·GPU 사용률(기존 Recharts, 토큰 색 규칙 준수)
  - 로그: 경고·skip 사유·오류(최근 200줄)
  - 상태가 `completed`가 되면 같은 탭이 리포트 뷰로 전환된다.

---

## P10-18. 리포트

- **선행**: P10-07, P10-12, P10-15
- **소유 파일**: `src/components/eval/report/{EvalReport.tsx, RecommendationCards.tsx, RankingTable.tsx, DimensionRadar.tsx, ParetoScatter.tsx, CategoryHeatmap.tsx, ContextCurveChart.tsx, PackDrilldown.tsx, SampleDetail.tsx, HumanScoreEditor.tsx, CompareRunsDialog.tsx, QuantFidelityTable.tsx}` + 테스트, i18n `eval/report.*`
- **내용**
  1. 추천 카드 3종(최적/빠른 대안/고품질 대안) + 사유 문장(`explain.ts`) + [이 설정으로 에이전트 만들기](매트릭스 후보면 새 에이전트 생성 → `AgentEditorTab` 열기, 기존 에이전트와 동일하면 [이 에이전트 열기])
  2. 순위표: 종합 점수(±CI), 차원 점수 5개, 커버리지 %, 제약 위반 배지(툴팁에 위반 내용), "구분 불가" 그룹은 같은 순위 번호 + 음영, 원시값 보기 토글(정규화 전 값)
  3. 차트: 차원 레이더(후보 최대 6개 선택), 파레토 산점도(x=P, y=(Q+A)/2, 버블=VRAM 피크, 파레토 선), 카테고리 히트맵, 컨텍스트 길이별 정확도·decode 곡선(Q6·P2 데이터가 있을 때)
  4. 드릴다운: 팩 → 샘플 목록(후보별 ✓/✗/△/—) → `SampleDetail`(입력, 후보별 출력 나란히 보기, 사고 내용 접기, 도구 궤적, 최종 파일 상태 diff(픽스처 대비), 채점기별 점수·사유, Judge 원문, `HumanScoreEditor`)
  5. 사람 채점 저장 시 집계를 다시 계산해 `replaceAggregates`하고 화면을 갱신한다.
  6. 경고 영역: Judge 신뢰 낮음, 길이 편향, 자기 계열 Judge, 결정성 모드, client 타이밍 근사, 다른 하드웨어 지문(비교 시), 샘플 수 부족(검정력)
  7. 실행 비교(`CompareRunsDialog`): 같은 팩 해시를 가진 이전 실행을 골라 후보별 점수 변화(회귀 ↓ 강조). 하드웨어 지문이 다르면 성능·자원 비교를 막고 사유를 표시한다.
  8. Q8 표(양자화 비교를 켠 경우)
  9. 내보내기 버튼(P10-25 기능 호출, 없으면 숨김)

---

## P10-19. 팩 관리·편집 + 개인 평가셋 (Q9)

- **선행**: P10-04, P10-08, P10-15
- **소유 파일**: `src/components/eval/packs/{PackManager.tsx, PackEditor.tsx, SampleEditor.tsx, FixtureEditor.tsx, PersonalCaseDialog.tsx, BulkDraftDialog.tsx}`, `src/lib/eval/personal/{fromChat.ts, redact.ts, draft.ts}` + 테스트, `src/components/chat/MessageBubble.tsx`(메뉴 항목 1개), i18n `eval/packs.*`, `eval/personal.*`
- **내용**
  1. 팩 관리: 계층별 목록, 진단, 라이선스·출처 표시, builtin [복제해서 편집](user로 복사), user/project [편집]/[삭제], [새 팩]
  2. 팩 편집기: 매니페스트 폼(카테고리·kind·채점기·지표·tier·systemPrompt), 샘플 표(추가·삭제·복제·순서), 샘플 편집기(kind별 필드: 객관식 choices/target, tool_call 기대 호출·허용값, agentic 픽스처·기대 상태·궤적, 루브릭·참조 답변), 저장 시 zod 검증 → `packFs.write`. 버전은 저장할 때 patch를 자동으로 올린다.
  3. **개인 평가 케이스 만들기**(`MessageBubble` 사용자 말풍선 [⋯] → "평가 케이스로 저장"): `PersonalCaseDialog`
     - 입력: 해당 사용자 메시지 + 직전 대화 N개(기본 4, 조정 가능)를 `EvalMessage[]`로 변환(도구 결과 메시지는 요약 문자열로 치환)
     - 기준 선택(복수 가능): 참조 답변(현재 어시스턴트 응답 또는 편집한 답), 결정적 체크(포함 키워드, JSON, Mermaid/Recharts 블록, 정규식), 루브릭
     - 픽스처 캡처(도구를 쓴 대화일 때 선택): 대화에서 read/write/edit한 파일 경로를 모아 체크리스트로 보여주고, 선택한 파일 내용을 픽스처로 복사(파일당 256KB, 합계 1MB 상한). `redact.ts`가 `.env*`, `*.pem`, `*.key`, `id_rsa*`, `credentials*` 경로와 `(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*\S+` 패턴 값을 제외·마스킹하고 미리보기에서 강조
     - 저장 대상: 프로젝트 개인 팩(기본 `personal-<프로젝트폴더명>`, 없으면 생성, 카테고리 Q9, kind는 픽스처가 있으면 agentic 아니면 multi_turn, 매니페스트 `metadata.personal = true` 대신 `lang`/`license: { id: 'personal' }`로 표시) 또는 사용자(전역) 개인 팩
  4. **일괄 초안**(`BulkDraftDialog`): 최근 세션 목록 다중 선택 → 세션마다 마지막 사용자 요청과 응답으로 초안 케이스 생성 → 표에서 검토·수정·체크한 것만 저장. 자동 저장 없음.
     - (선택) "외부 모델로 참조 답변/루브릭 초안 만들기": `gateway`의 `reference-generation`/`pack-drafting` 용도 + `personal` 데이터 분류 권한이 있을 때만 버튼을 표시하고, 실행 전에 전송 요약 확인을 받는다.
  5. 개인 팩은 전역으로 승격(복사)할 수 있다.

---

## P10-20. 로컬 Arena (블라인드 A/B) (Q7)

- **선행**: P10-02, P10-03, P10-07, P10-15
- **소유 파일**: `src/components/eval/arena/{ArenaCompareView.tsx, ArenaVoteBar.tsx, ArenaLeaderboard.tsx}`, `src/lib/eval/arena/{arenaSession.ts, ratings.ts}` + 테스트, `src/components/workspace/ChatTab.tsx`(비교 모드 진입 버튼 1개), i18n `eval/arena.*`
- **내용**
  1. 채팅 탭 헤더에 [비교 모드] 버튼 → Arena 뷰(같은 탭 안 오버레이 또는 `eval:arena` 탭). 에이전트 2개 선택(같은 에이전트 불가).
  2. 사용자가 입력하면 두 후보에 **순차** 전송한다(VRAM 경합 방지, 순서는 무작위). 도구는 사용하지 않는다(단일 턴, 도구 없음). 응답은 좌/우 무작위 배치, 모델명을 숨긴다.
  3. 투표: A가 낫다 / B가 낫다 / 무승부 / 둘 다 나쁨 → `insertArenaVote` → 투표 후 모델명 공개.
  4. Arena 전송도 LLM 사용이므로 평가 잠금 중에는 불가(P10-03 가드 재사용), 실행 중에는 `chatQueueManager`에 가상 세션 `arena:{id}`로 busy 표시.
  5. 리더보드(`ArenaLeaderboard`): 전체 투표로 BT 점수 + 95% CI(P10-07), 후보별 투표 수, 최소 30표 미만이면 "표본 부족". 투표 목록·삭제.
  6. 투표한 입력을 [평가 케이스로 저장](P10-19 다이얼로그 재사용)할 수 있다.
  7. 후보 식별: 투표 레코드에 스냅샷 전체를 저장하고, 리더보드는 `(provider, model, temperature, reasoning, contextSize)` 서명으로 묶는다.

---

## P10-21. 콘텐츠: FAB-A (도구 선택·관련성·시각화)

- **선행**: P10-01(스키마). 검증은 P10-04 로더 테스트로
- **소유 파일**: `src-tauri/resources/evals/fab-tools-select/**`, `fab-tools-relevance/**`, `fab-viz/**`, `src/lib/eval/packs/builtinPacks.test.ts`(이 팩들의 스키마 검증 케이스)
- **명세**: `Docs/phases/Phase10-Eval-Packs.md` §2.1~2.3을 그대로 따른다(샘플 수·분포·예시·채점 규칙).

## P10-22. 콘텐츠: FAB-B (파일 작업·스킬·압축)

- **선행**: P10-01
- **소유 파일**: `src-tauri/resources/evals/fab-fs-tasks/**`(픽스처 포함), `fab-skill/**`, `fab-compaction/**`, `src/lib/eval/runner/solvers/compactionRecall.ts`(+테스트)
- **명세**: Packs 문서 §2.4~2.6. `compactionRecall.ts`는 샘플의 긴 대화를 입력으로 기존 `prepareCompaction`/`executeCompact`를 후보 런타임으로 실행 → 요약 + 최근 메시지로 컨텍스트 재구성 → 회상 질문을 보내는 솔버다(`registerSolver('compaction_recall', ...)`). 압축 소요 시간·요약 토큰을 `extra`에 기록한다.

## P10-23. 콘텐츠: FAB-C (긴 컨텍스트·성능 프로브·한국어 작문·JS 코드·양자화 프로브) + 생성기

- **선행**: P10-01, P10-04(생성기 레지스트리)
- **소유 파일**: `src-tauri/resources/evals/{fab-longctx, fab-perf-probe, fab-ko-writing, fab-code-js, fab-quant-probe}/**`, `src/lib/eval/packs/generators/{longContext.ts, perfProbe.ts, fillerCorpus.ts}` + 테스트
- **명세**: Packs 문서 §2.7~2.11. 생성기는 결정적이어야 한다(같은 params·seed → 같은 샘플).

## P10-24. 콘텐츠: 공개 데이터셋 번들 + 라이선스 고지

- **선행**: P10-01
- **소유 파일**: `src-tauri/resources/evals/{gsm8k, gsm8k-perturb, mmlu-pro, ifeval, ko-ifeval, kmmlu, kobest, humaneval-plus, bfcl}/**`, `src-tauri/resources/evals/THIRD_PARTY_NOTICES.md`, `scripts/evals/build-public-packs.mjs`(변환 스크립트, Node 표준 라이브러리만), `src/lib/eval/interop/importPresets.ts`(번들 불가 셋의 임포터 프리셋 정의)
- **명세**: Packs 문서 §3. 변환 스크립트는 원본 파일 경로를 인자로 받아 팩 폴더를 생성하고, 원본 URL·커밋/리비전·다운로드 일시를 매니페스트 `license.source`와 NOTICE에 기록한다. **원본 데이터 파일은 리포지토리에 커밋하지 않는다**(변환 결과만 커밋. 단 KMMLU는 원본 CSV 그대로가 결과물).

---

## P10-25. 상호운용: 가져오기·내보내기

- **선행**: P10-04, P10-08, P10-18
- **소유 파일**: `src/lib/eval/interop/{importers/jsonl.ts, importers/csv.ts, importers/promptfoo.ts, importers/hfPresets.ts, fieldMapping.ts, exportEee.ts, exportCsv.ts}`, `src/components/eval/interop/{ImportWizard.tsx, ExportDialog.tsx}` + 테스트, i18n `eval/interop.*`
- **내용**
  1. 가져오기 마법사: 파일 선택(`plugin-dialog` open → `eval_read_import_file`) 또는 HF 프리셋 다운로드(`eval_download_file`, 사용자 클릭 시에만, 다운로드 전에 URL·크기·라이선스 표시) → 형식 감지(JSONL/JSON 배열/CSV) → 필드 매핑(FieldSpec 방식: input/target/choices/id/metadata 열 선택, Inspect·OpenAI Evals·promptfoo 프리셋 자동 매핑) → 채점기·카테고리·kind 선택 → 미리보기 5행 → user 또는 project 팩으로 저장
     - promptfoo 변환: `equals→exact`, `contains/icontains→includes`, `contains-any/all→includes(mode)`, `regex→regex`, `is-json→json_schema({})`, `llm-rubric→llm_judge_rubric`, `javascript/python/기타→미지원 목록으로 보고`
     - HF 프리셋(`importPresets.ts`의 정의 사용): HAE-RAE 1.1, GPQA(다운로드 전 "평문 공개 금지 요청" 고지 + 로컬 전용 저장), CLIcK, LogicKor(Judge 필요), KMMLU-Redux 등. 프리셋은 URL·파일 형식·필드 매핑·라이선스 문구를 담는다. **착수 시 각 URL과 파일 구조를 확인**하고 틀린 프리셋은 제외한다.
     - 다운로드한 원본은 user 계층 팩 폴더에 저장한다(ND 라이선스 데이터는 원본을 수정하지 않고 어댑터로 읽는다 — `source.type` 확장이 필요하면 P10-01 담당에게 이슈).
  2. 내보내기(`ExportDialog`)
     - EEE JSON(실행 1건 → 후보별 aggregate JSON + `{uuid}_samples.jsonl`): `schema_version`은 **착수 시 EEE 저장소의 최신 버전을 확인**해 맞춘다. 필드 대응은 Architecture §14.6 표를 따른다. 하드웨어 지문 등 EEE에 없는 필드는 EEE가 허용하는 확장 필드에 넣는다(없으면 생략하고 `source_metadata` 설명에 요약).
     - CSV(순위표·샘플 결과)
     - 개인 팩 포함 여부 확인(기본 제외, 포함 시 경고)
     - 저장: `plugin-dialog` save → `eval_export_write`

---

## P10-26. 통합 QA·문서

- **선행**: 전 작업
- **소유 파일**: `Docs/QA-Checklist.md`(평가 섹션), `Docs/UserGuide.md`(평가 장), `README.md`(기능 목록 1줄), `Docs/TODO.md`
- **QA 시나리오**(수동, `pnpm tauri dev`)
  1. 에이전트 3개 + "표준" 스위트 실행 → 중간에 앱 종료 → 재시작 후 `interrupted` 확인 → [이어하기] → 완료
  2. 평가 중 채팅 입력·새 메시지 전송·폴더 전환·에이전트 편집이 모두 막히는지
  3. 가중치 확인 체크 없이 시작할 수 없는지, [나중에 시작] 후 수동 시작
  4. 외부 연동 마스터 스위치 OFF 상태에서 외부 후보·외부 Judge 옵션이 보이지 않는지, ON + 동의 후 감사 로그 기록
  5. `fab-fs-tasks` 실행 전후 사용자 워크스페이스 파일 무변경, 임시 폴더 정리
  6. 매트릭스 6개 조합 실행 → 리포트 추천·파레토·구분 불가 그룹 표시
  7. 개인 케이스 저장(비밀 패턴 마스킹 확인) → 개인 팩 평가
  8. Arena 30표 → 리더보드 CI
  9. EEE 내보내기 파일 JSON 검증(스키마 버전 필드 확인)
  10. Python 미설치 PC에서 HumanEval+ skip 처리, JS 코드 팩 정상 실행
- 결과를 QA 체크리스트에 기록하고, 발견한 문제는 이슈 로그에 남긴다.
