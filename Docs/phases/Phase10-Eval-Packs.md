# Phase 10 부록 — 평가 팩(데이터셋) 제작 명세

> 대상 작업: P10-21 ~ P10-24(콘텐츠), P10-04(로더 검증), P10-22·23(생성기·솔버).
> 스키마는 `src/lib/eval/types.ts`(P10-01)가 정답입니다. 이 문서와 스키마가 다르면 스키마를 따르고 이슈 로그에 기록하십시오.

---

## 1. 공통 규칙

### 1.1 팩 폴더 구조

```
src-tauri/resources/evals/<pack-id>/
├── manifest.json          # EvalPackManifest
├── samples.jsonl          # source.type === 'jsonl'일 때
├── fixtures/<name>/...    # agentic 팩의 픽스처(샘플 fixture.dir가 가리킴)
├── data/...               # kmmlu-csv 등 원본 파일
└── LICENSE.md             # 팩 라이선스·출처·변경 사항(공개셋은 필수, 자체 제작은 "Fortress 자체 제작, 앱과 동일 라이선스")
```

- 팩 ID는 폴더명과 같아야 한다(`^[a-z0-9][a-z0-9-]{1,63}$`).
- `version`은 `1.0.0`부터 시작한다. 샘플·채점 규칙이 바뀌면 minor 이상을 올린다(해시가 바뀌어 이전 실행과의 비교가 막히므로 신중하게).
- 모든 문자열은 UTF-8(BOM 없음), 줄바꿈 LF.
- 샘플 `id`는 팩 안에서 유일하고 **절대 재사용하지 않는다**(삭제한 id를 다른 문항에 쓰지 않음).

### 1.2 자체 제작 팩 작성 원칙

1. **정답이 하나로 정해지거나 결정적으로 검증 가능한 문항만** 만든다(Judge 팩 `fab-ko-writing` 제외).
2. 한국어·영어 비율: 팩별 표에 따른다. 특별히 적지 않은 팩은 한국어 70% / 영어 30%.
3. 실존 인물·실제 회사의 민감 정보, 개인정보, 저작권 있는 긴 원문을 넣지 않는다(짧은 일반 지식은 허용).
4. 작성자는 각 샘플을 **직접 검증**한다: 정답을 두 번 계산하거나, 픽스처에 대해 기대 상태가 실제로 달성 가능한지 확인한다. P10-21~23은 "참조 풀이" 테스트(아래 1.4)를 반드시 포함한다.
5. 난이도: `metadata.difficulty`에 `easy|medium|hard`를 달고, 팩마다 대략 4:4:2로 맞춘다. 로컬 7~14B 모델이 easy는 대부분, hard는 일부만 맞히는 수준이 목표다.
6. `metadata.lang`에 `ko|en`을 단다. `stratifyBy`는 팩마다 표에 적은 키를 쓴다.

### 1.3 tier 규칙

- smoke: 팩당 3~5분 안에 끝나는 크기(대략 10~30 샘플)
- standard: 통계적으로 쓸 만한 크기(대략 50~150)
- full: 전체

### 1.4 참조 풀이 테스트 (콘텐츠 품질 보증)

`src/lib/eval/packs/builtinPacks.test.ts`(P10-21이 생성, P10-22~24가 케이스 추가)에서 팩마다 다음을 검사한다.
- 매니페스트·샘플 zod 검증 통과, id 유일
- **참조 응답**으로 채점하면 만점이 나오는지: 팩 폴더에 `reference.jsonl`(`{ id, output?, toolCalls? }`)을 두고, 해당 채점기로 채점해 100% correct인지 검사한다. `reference.jsonl`은 런타임에 로드하지 않는다(테스트 전용, 번들에서 제외해도 되지만 제외하지 않아도 무방).
- agentic 팩: 참조 도구 시퀀스(`reference.jsonl`의 `toolCalls`)를 가짜 모델로 재생해 `fs_state`·`trajectory`가 만점인지(P10-11 솔버 사용).

---

## 2. Fortress 자체 제작 팩 (FAB)

### 2.1 `fab-tools-select` (A1, kind `tool_call`)

- **목적**: Fortress 실제 도구 스키마로 올바른 도구와 인자를 고르는지 측정(BFCL AST 방식)
- **tools**: `'fortress-default'` (read, ls, grep, find, write, edit, web_search 스키마 — 실행하지 않음)
- **systemPrompt**: "You are Fortress, an agent working inside the user's project folder. Use tools when needed. The project root is `/project`." (경로 예시를 고정해 인자 비교를 쉽게 함)
- **샘플 수**: 60 (tiers 15 / 60 / 60), `stratifyBy: "subtype"`
- **분포**

| subtype | 수 | 설명 | 예 |
| --- | --- | --- | --- |
| `simple` | 24 | 도구 1개, 인자 1~3개 | "src/utils/date.ts 파일 내용을 보여줘" → `read{path:["src/utils/date.ts","./src/utils/date.ts","/project/src/utils/date.ts"]}` |
| `choose` | 16 | 비슷한 도구 중 선택(grep vs find, read vs ls, write vs edit) | "TODO 주석이 있는 파일을 모두 찾아줘" → `grep{pattern:[...], path:[".","/project",""] }` |
| `parallel` | 12 | 한 번에 2~3개 호출 | "README.md와 package.json을 둘 다 읽어줘" → read×2(순서 무관) |
| `edit-args` | 8 | edit의 old/new 문자열 정확성 | "config.json에서 \"debug\": false를 true로 바꿔줘"(입력에 파일 내용 포함) → `edit{path, oldText:["\"debug\": false"], newText:["\"debug\": true"]}` |

- **인자 허용값 작성 규칙**: 경로는 상대/`./`/절대(`/project/...`) 변형을 모두 나열한다. 정규식 패턴은 의미가 같은 흔한 변형을 2~4개 나열한다(`TODO`, `TODO:`, `\bTODO\b`). 선택 인자(예: `limit`)는 `optionalArgs`에 넣는다. 실제 도구 스키마의 인자 이름을 `src/lib/tools/*.ts`에서 확인해 **정확히** 쓴다.
- **scorers**: `[{ type: 'tool_call_ast', options: { orderSensitive: false } }]`
- **metrics**: `accuracy`(score mean, binary, baseline 0)
- **reliability 태그**: simple 중 8개에 `tags: ["reliability"]`

### 2.2 `fab-tools-relevance` (A2, kind `tool_call`)

- **목적**: 도구가 필요 없거나 불가능한 요청에서 도구를 **호출하지 않는지**
- **샘플 수**: 40 (10 / 40 / 40), `stratifyBy: "subtype"`

| subtype | 수 | 예 | 채점 |
| --- | --- | --- | --- |
| `no-tool-needed` | 24 | 인사, 일반 지식("HTTP 404의 의미는?"), 대화 중 이미 제공된 내용 요약, 간단한 산수 | `no_tool_call` |
| `impossible` | 16 | "팀장에게 이메일 보내줘", "내일 회의를 캘린더에 등록해줘", "이 파일을 GitHub에 푸시해줘"(shell 없음) | `no_tool_call` + `includes`(불가 표현 키워드 any: "할 수 없", "불가", "cannot", "can't", "not able", "지원하지", "도구가 없") weight 0.3 |

- **metrics**: `accuracy`(baseline **0.5** — 이진 판단)

### 2.3 `fab-viz` (A4, kind `single_turn`)

- **목적**: Fortress 시각화 규약(```mermaid / ```recharts 코드펜스)을 유효하게 출력하는지
- **systemPrompt**: 앱의 `visualizationSection.ts` 지침 문자열을 그대로 쓰지 말고, **작성 시점에 그 파일의 지침을 참조해** 같은 규약을 요약한 문장을 넣는다(앱 지침이 바뀌어도 팩 해시가 흔들리지 않게 하기 위함)
- **샘플 수**: 30 (10 / 30 / 30), `stratifyBy: "kind"`

| kind | 수 | 요청 예 | 채점 |
| --- | --- | --- | --- |
| mermaid | 15 | flowchart 5, sequenceDiagram 4, stateDiagram 2, classDiagram 2, gantt 2 — "로그인 절차를 순서도로 그려줘" | `viz_block{kind:'mermaid'}`(gate) + `includes`(핵심 노드 라벨 1~2개, weight 0.3) |
| recharts | 15 | bar 6, line 5, pie 2, area 2 — 입력에 표 데이터 제공 | `viz_block{kind:'recharts'}`(gate) + `regex`(데이터 값 하나 포함, weight 0.3) |

- **metrics**: `accuracy`

### 2.4 `fab-fs-tasks` (A3, kind `agentic`) — "파일 작업 평가"

- **목적**: 픽스처 폴더에서 실제 도구로 과제를 수행하고 최종 파일 상태로 채점
- **픽스처 4종**(`fixtures/`, 각 10~30개 파일, 합계 200KB 이하, 모두 자체 작성 텍스트)

| 픽스처 | 내용 |
| --- | --- |
| `notes-ko` | 한국어 회의록·메모 마크다운 12개, `index.md` |
| `ts-lib` | 작은 TypeScript 유틸 라이브러리(src/*.ts 8개, package.json, README.md, tests/*.test.ts 3개) |
| `config-set` | JSON/YAML/INI 설정 파일 10개(일부 중첩) |
| `docs-mixed` | 영문·한글 혼합 기술 문서 15개 + `CHANGELOG.md` |

- **샘플 수**: 30 (8 / 30 / 30), `stratifyBy: "task"`, `defaults.maxTurns: 12`, `timeoutSec: 300`

| task | 수 | 예 | expectState / trajectory |
| --- | --- | --- | --- |
| `locate-answer` | 6 | "`parseDate` 함수가 정의된 파일 경로를 알려줘" | 상태 변화 없음(`{glob:"**", unchanged:true}` gate) + `includes`(정답 경로) + trajectory `mustNotCall:["write","edit"]` |
| `edit-single` | 8 | "config-set/app.json의 timeout을 30에서 60으로 바꿔줘" | 대상 파일 `contains:["\"timeout\": 60"]`, `notContains:["\"timeout\": 30"]` + 나머지 `unchanged` |
| `create-summary` | 6 | "notes-ko의 9월 회의록 3개를 요약해 SUMMARY.md로 저장해줘" | `SUMMARY.md exists` + `contains`(각 회의 핵심 키워드) + `{glob:"*.md", maxFiles: 원래+1}` |
| `multi-file-refactor` | 5 | "`formatKRW` 함수 이름을 `formatWon`으로 바꾸고 사용처도 모두 고쳐줘" | 정의 파일·사용처 `contains`/`notContains` + 테스트 파일 반영 |
| `search-aggregate` | 5 | "CHANGELOG에서 1.x 버전 중 'fix'가 들어간 항목 수를 세서 알려줘" | 상태 불변 + `numeric`/`includes`(정답 수) |

- **공통 scorers**: `fs_state`(gate, 상태 과제) + `trajectory`(weight 0.3, 예: `maxCalls: 20`) + `includes`(최종 답변 키워드, 해당 과제만 weight 0.2)
- **reference.jsonl**: 과제마다 최소 도구 시퀀스(예: `find → read → edit`)와 최종 답변
- **reliability 태그**: 과제 유형별 1개씩(총 5개)

### 2.5 `fab-skill` (A5, kind `agentic`)

- **픽스처**: `fixtures/skill-ws/` 안에 `.agents/skills/` 스킬 3개(Agent Skills 표준 SKILL.md, frontmatter `name`·`description`)
  - `release-notes`: "릴리스 노트는 반드시 `## Added / ## Fixed / ## Changed` 세 섹션으로 쓰고 파일명은 `RELEASE_NOTES_<버전>.md`"
  - `meeting-minutes`: "회의록은 `참석자:` 줄로 시작하고 마지막에 `## 결정 사항` 섹션"
  - `commit-message`: "커밋 메시지는 Conventional Commits, 제목 50자 이내"(답변만 평가)
- **샘플 수**: 10 (5 / 10 / 10). 스킬을 쓰라고 직접 말하지 않고 과제만 준다(발견 능력 측정). 예: "CHANGELOG.md를 바탕으로 1.4.0 릴리스 노트를 만들어줘"
- **채점**: `trajectory{mustReadPaths:[".agents/skills/release-notes/SKILL.md"]}`(weight 0.4) + `fs_state`(파일명·섹션, gate) 또는 `regex`(답변 형식)
- 매니페스트 `trusted: true`(builtin이라 로더가 강제)

### 2.6 `fab-compaction` (A6, kind `compaction_recall`)

- **목적**: 긴 대화가 압축된 뒤에도 앞부분의 핵심 사실을 기억하는지
- **샘플 구조**: `input`에 사용자·어시스턴트 교대 메시지 40~60개(약 12k~20k 토큰). 앞쪽 25% 구간에 "사실 카드" 3~5개(예: "배포 서버 포트는 8443", "담당자는 박서연", "마감일은 11월 14일")를 대화 속에 자연스럽게 넣는다. 마지막 user 메시지가 회상 질문("아까 정한 배포 포트가 몇 번이었지?")이다.
- **솔버 동작**(P10-22 `compactionRecall.ts`): 후보 `contextSize`와 무관하게 `compactionContextSize = 8192`로 압축을 강제 → 요약 + `keepRecentTokens=2048` 최근 메시지 + 질문 → 응답
- **샘플 수**: 10 (3 / 10 / 10)
- **채점**: `includes`(정답 값, 변형 포함: "8443", "8,443")
- **metrics**: `accuracy`, 보조 `extra.compactionMs`

### 2.7 `fab-longctx` (Q6, kind `long_context`, source `generator: long-context-v1`)

- **생성기**(`generators/longContext.ts`, 결정적):
  - `fillerCorpus.ts`: 자체 작성한 중립 문단(한국어 120개, 영어 80개, 각 80~200단어; 주제: 가상의 도시·공정·자연 묘사 — 사실 질문이 생기지 않는 내용)
  - params: `{ lengths: [2048, 4096, 8192, 16384, 32768, 65536, 131072], depths: [0.1, 0.5, 0.9], tasks: ['niah-single','niah-multikey','niah-multivalue','var-trace'], perCell: 2, lang: ['ko','en'], seed: 20260925 }`
  - 과제:
    - `niah-single`: "비밀 코드 {6자리 숫자}" 1개 삽입 → "비밀 코드는?"
    - `niah-multikey`: 키-값 4쌍 삽입(`{동물명}의 번호는 {숫자}`), 그중 하나를 질문
    - `niah-multivalue`: 같은 키에 값 3개 → "모두 나열"(`includes mode:all`)
    - `var-trace`: `X1 = 48213`, `X2 = X1`, ..., `X5 = X4`를 서로 떨어진 위치에 삽입 → "X5의 값은?"
  - 길이 맞추기: 토큰 수는 **문자 수 ÷ 토큰 추정 비율**로 맞춘다. 비율은 러너가 후보별로 1회 보정한다(짧은 보정 요청의 `prompt_eval_count`로 계산해 생성기 ctx에 `tokensPerChar` 전달). 보정할 수 없으면 한국어 1.6자/토큰, 영어 4자/토큰을 가정한다.
  - 후보 `contextSize − 1024`보다 긴 셀은 생성하되 러너가 `skipped_unsupported` 처리한다.
  - 샘플 id: `L{len}-D{depth*100}-{task}-{lang}-{n}`
- **tiers**: smoke = 길이 {2k, 8k, 32k} × depth 0.5 × niah-single × ko 1개 = 3, standard = 전 길이 × 3 depth × 4 task × perCell 1(언어 번갈아), full = perCell 2 × 양 언어
- **채점**: `includes`(정답 값)
- **metrics**: `accuracy`, `effective_context_tokens`(P10-07 정의)

### 2.8 `fab-perf-probe` (P1·P2, kind `perf_probe`, source `generator: perf-probe-v1`)

- **시나리오 8개**(생성기가 filler로 입력을 만들고, 지시문은 "위 글을 바탕으로 가능한 한 자세히 계속 써라" 형태로 고정 → `maxOutputTokens`로 출력 길이 제어)

| id | 입력 토큰 | 출력 토큰 | depthRatio | 의미 |
| --- | --- | --- | --- | --- |
| `S1-chat` | 64 | 128 | — | 짧은 대화 |
| `S2-mid` | 512 | 512 | — | 일반 |
| `S3-sum` | 1024 | 256 | — | 요약형(TTFT·decode 기준값) |
| `S4-long-in` | 2048 | 512 | — | |
| `S5-docqa` | 4096 | 256 | — | 문서 QA |
| `S6-long-out` | 4096 | 1024 | — | 긴 생성 |
| `S7-depth50` | ctx×0.5 | 128 | 0.5 | 깊이 50% decode |
| `S8-depth90` | ctx×0.9 | 128 | 0.9 | 깊이 90% decode(`depth_retention` 분자) |

- `repeats`: 샘플 값 없음 → 러너 `perfRepeats`(기본 3) 사용, nonce로 캐시 회피
- **scorers**: 없음. **metrics**(`source: 'trial_field'`): `ttft_ms`(median, S3 기준 `ttft_p50_ms`), `decode_tps`(median), `prefill_tps`(median, cache_hit=0), 모두 `normalization: anchor`
- tiers: smoke = S1·S3·S5, standard = S1~S6, full = 전체

### 2.9 `fab-ko-writing` (Q4, kind `single_turn`, Judge)

- **샘플 수**: 20 (5 / 20 / 20), `stratifyBy: "genre"`
- genre 5종 × 4: 업무 이메일, 회의 요약(입력에 회의록 제공), 기술 문서 단락(입력에 사양 제공), 공지문, 보고서 요약(입력에 긴 보고서 제공)
- 각 샘플: `rubric`(아래 기본 루브릭 + 샘플별 요구사항 1~2줄), `reference`(작성자가 쓴 모범 답안 — Judge 참조용, 정답이 아님을 루브릭에 명시)
- **기본 루브릭**(1~5점 × 5항목): 정확성(입력 사실 왜곡 없음) / 요구사항 충족 / 구성·가독성 / 한국어 자연스러움(어색한 번역투·오탈자) / 간결성(불필요한 반복 없음)
- **scorers**: `llm_judge_rubric`(value = 항목 평균 정규화) + `ifeval`형 결정 체크 1개(예: "300자 이내" → `regex` 또는 길이 검사, weight 0.2)
- Judge가 설정되지 않은 실행에서는 이 팩을 선택할 수 없다(마법사에서 안내).

### 2.10 `fab-code-js` (Q5, kind `single_turn`, 코드 실행)

- **샘플 수**: 40 (10 / 40 / 40), 모두 자체 작성 JavaScript 함수 문제(문자열 처리 12, 배열·객체 12, 날짜·수치 8, 간단 알고리즘 8)
- 샘플 필드: `input`(함수 시그니처·설명·예시), `code: { language: 'js', entryPoint: 'solve', tests: "assertEqual(solve('a'), 'A');\n..." }`(테스트 6~12개, 경계값 포함)
- **systemPrompt**: "Return only one ```js code block that defines the function. Do not use external modules, network, or DOM."
- **scorers**: `code_exec`
- **metrics**: `pass_at_1`(mean), epochs ≥ 5인 실행에서는 `pass_at_k(k=5)` 추가
- **reference.jsonl**: 모범 풀이(테스트 전부 통과해야 함 — 1.4 검사)

### 2.11 `fab-quant-probe` (Q8, kind `logprob_trace`)

- **샘플 수**: 30 (10 / 30 / 30), 다양한 주제의 짧은 지시(한국어 15, 영어 15): 설명·요약·목록·코드 한 줄·번역
- 채점 없음. P10-14가 후보 쌍 분석으로 `mean_kld`, `top1_agreement`, `divergence_pos_median`을 산출한다.

---

## 3. 공개 데이터셋 번들 (P10-24)

### 3.1 번들 목록

| 팩 ID | 원본 | 라이선스 | 번들 형태 | kind / 카테고리 | tiers (smoke/std/full) | stratifyBy | 채점 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `gsm8k` | openai/gsm8k test 1,319 | MIT | JSONL 변환(`answer`의 `####` 뒤 값 → target 숫자, 풀이는 `metadata.solution`에 보존하지 않음) | single_turn / Q2 | 20 / 100 / all | — | `numeric` |
| `gsm8k-perturb` | gsm8k에서 무작위 100문항(seed 고정)의 숫자·이름을 바꾼 변형 | MIT(파생, 원본 표기) | 자체 생성 JSONL. **정답은 변환 스크립트가 원본 풀이의 계산식을 다시 계산해 산출**하고, 계산식 파싱이 안 되는 문항은 제외 | single_turn / Q2 | 20 / 100 / 100 | — | `numeric` |
| `mmlu-pro` | TIGER-Lab/MMLU-Pro test | MIT | 14과목 × 100 = 1,400문항 층화 부분집합(seed 20260925), `cot_content` 제외 | single_turn / Q1 | 28 / 140 / all | `category` | `choice` (10지선다, baseline auto) |
| `ifeval` | google/IFEval 541 | Apache-2.0 | JSONL 변환(`instruction_id_list`+`kwargs` → `ifeval[]`) | single_turn / Q3 | 20 / 100 / all | — | `ifeval` strict + loose(두 metric) |
| `ko-ifeval` | allganize/IFEval-Ko | Apache-2.0 | 동일 변환 | single_turn / Q3 | 20 / 100 / all | — | `ifeval`(한국어 체커) |
| `kmmlu` | HAERAE-HUB/KMMLU `data/*-test.csv` 45과목 | CC-BY-ND-4.0 | **원본 CSV 무수정**(`data/` 폴더), `source.type: 'kmmlu-csv'` | single_turn / Q1 | 45 / 450 / 2,250 | `subject` | `choice` (4지선다) |
| `kobest` | skt/kobest_v1 (boolq, copa, wic, hellaswag, sentineg) test | CC-BY-SA-4.0 | 과목별 200문항 부분집합 JSONL(파일 LICENSE에 CC-BY-SA-4.0 명시) | single_turn / Q1 | 25 / 250 / all | `task` | `choice` (task별 선택지 수 → baseline auto) |
| `humaneval-plus` | evalplus/humanevalplus 164 | Apache-2.0 | JSONL(`code.language: 'python'`, tests = `test` + `check(entry_point)`) | single_turn / Q5 | 10 / 50 / all | — | `code_exec` (Python 옵트인) |
| `bfcl` | gorilla BFCL v3 Python 카테고리 simple/multiple/parallel/parallel_multiple/irrelevance | Apache-2.0 | 카테고리별 100문항 JSONL 변환. BFCL `function` 문서 → 샘플별 `tools`(§3.3), `possible_answer` → `expectedToolCalls`(허용값 목록 그대로), irrelevance → `no_tool_call` 채점 | tool_call / A1 | 20 / 100 / 500 | `subtype` | `tool_call_ast` / `no_tool_call` |

- 공통: 원본 다운로드 URL·리비전(HF 커밋 해시)·다운로드 일시·변환 스크립트 버전을 `LICENSE.md`와 `THIRD_PARTY_NOTICES.md`에 기록한다.
- 객관식 system 프롬프트(공통 문구): 한국어 팩 "문제를 풀고 마지막 줄에 `정답: X` 형식으로 선택지 문자 하나만 쓰시오.", 영어 팩 "Solve the problem, then write the final line as `ANSWER: X` with a single choice letter."
- 수학 system 프롬프트: "마지막 줄에 `정답: <숫자>`만 쓰시오." / "End with `ANSWER: <number>`."
- `reliability` 태그: 각 팩 standard 표본 중 10개(시드 고정 선택)를 변환 스크립트가 표시한다.

### 3.2 번들하지 않는 셋 (임포터 프리셋만, `importPresets.ts`)

| 프리셋 | 이유 | 가져오기 방식 |
| --- | --- | --- |
| HAE-RAE Bench 1.1 | CC-BY-NC-ND | HF 다운로드(사용자 클릭) → user 팩, 원본 무수정 + 어댑터 |
| GPQA | 평문 공개 금지 요청 | HF 다운로드(게이트 데이터셋이라 실패 가능 → 파일 가져오기 안내), 내보내기 시 샘플 원문 제외 |
| CLIcK | 라이선스 미확인 | HF 다운로드 + 라이선스 확인 안내 문구 |
| LogicKor | 라이선스 미확인, Judge 필요 | GitHub raw `questions.jsonl` 다운로드 → Q4 Judge 팩(1~10 척도, 멀티턴 2턴) |
| KMMLU-Redux / KMMLU-Pro | 크기·라이선스 별도 확인 필요 | HF 다운로드 |

### 3.3 스키마 확장 요청(P10-01에 반영)

`bfcl`처럼 **샘플마다 다른 도구 세트**가 필요한 경우를 위해 `EvalSampleSchema`에 `tools?: ToolSchemaJson[]`가 있다(있으면 매니페스트 `tools`보다 우선). P10-01 스키마와 P10-10 `toolCall` 솔버 명세에 반영되어 있다.

---

## 4. 사용자 제작 팩 (개인 팩) 규칙

- 위치: 전역 `app_data/evals/packs/<id>/`, 프로젝트 `{ws}/.fortress/evals/packs/<id>/`
- 개인 팩 기본값: `category: 'Q9'`, `license: { id: 'personal' }`, `trusted: false`, `lang`은 내용 기준 자동
- 픽스처 파일은 `fixtures/<sampleId>/`에 저장(P10-19)
- 개인 팩은 내보내기·외부 전송에서 데이터 분류 `personal`(픽스처가 있으면 `fixture-files` 추가)로 취급한다(P10-09 게이트)
