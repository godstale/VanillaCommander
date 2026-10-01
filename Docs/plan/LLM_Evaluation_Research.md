# 로컬 LLM 자동 평가 — 조사 자료 (Research)

> 작성일: 2026-09-25 · 목적: Fortress "자동화 테스트 및 평가" 기능 기획([`LLM_Evaluation_Plan.md`](./LLM_Evaluation_Plan.md))의 근거 자료.
> 이 문서는 **외부 평가 도구·벤치마크·방법론을 조사한 결과**이고, Fortress 설계 결정은 기획서에 있습니다.
> 라이선스·버전 등 시점 의존 정보는 구현 착수 시 원문에서 다시 확인하십시오(특히 §4.9 데이터셋 라이선스).

---

## 0. 요약 (TL;DR)

1. **평가는 "데이터셋 + 실행기(solver) + 채점기(scorer) + 집계(metric)"의 4요소로 분해된다.** 조사한 거의 모든 도구(Inspect AI, lm-eval-harness, promptfoo, DeepEval, OpenAI Evals)가 같은 구조이며, Fortress도 이 분해를 그대로 따르는 것이 좋다.
2. **로컬 LLM 평가는 "품질"만으로는 부족하다.** 같은 PC에서 돌렸을 때의 **속도(TTFT, prefill/decode tok/s), 메모리(VRAM 피크, 오프로드 비율), 안정성(OOM·타임아웃·형식 오류율)**이 품질과 같은 비중으로 중요하다(llama-bench, LocalScore, vLLM/GuideLLM의 지표 체계).
3. **채점은 결정적 채점을 최우선으로 한다.** 정답 대조·정규식·JSON 스키마·코드 실행·파일 상태 비교처럼 객관적인 채점을 먼저 쓰고, LLM Judge는 주관 영역에만 제한적으로 쓴다. Judge에는 위치·장황함·자기선호 편향이 있다(MT-Bench 논문, AlpacaEval LC).
4. **정규화는 "무작위 기준선 보정 + 0~100 스케일"이 사실상 표준이다(Open LLM Leaderboard v2).** 여러 모델을 비교할 때는 Bradley-Terry 방식(Chatbot Arena)이나 평균 승률(HELM)을 쓴다. 불확실성은 표준오차, 부트스트랩 신뢰구간, 쌍대차 분석으로 표기한다(Anthropic 권고).
5. **결과 저장 스키마는 Every Eval Ever(EEE, 2026)를 참고한다.** 집계 결과 JSON과 샘플 단위 JSONL을 분리하는 구조이며, lm-eval-harness·HELM·Inspect 변환기가 이미 있다. Fortress 결과를 EEE로 내보낼 수 있으면 외부 리더보드 점수와 나란히 비교할 수 있다.
6. **"내 작업에 맞는 모델"을 찾으려면 공개 벤치마크만으로는 부족하다.** 공개셋은 오염(contamination)과 포화 문제가 있고 사용자 업무를 대표하지도 못한다(LiveBench의 문제의식). 그래서 **사용자 채팅 이력에서 만든 개인 평가셋**과 **블라인드 A/B 투표**가 차별화 포인트다.

---

## 1. 평가 프로세스 전체 구조 (조사 종합)

조사한 도구들의 공통 흐름을 하나의 파이프라인으로 정리하면 다음과 같다.

```
[1 목적/프로파일 정의] → [2 후보 구성(모델×설정 매트릭스)] → [3 평가셋 선택/생성]
      → [4 사전점검·워밍업] → [5 실행(반복·시드·타임아웃·체크포인트)] → [6 원시 로그 수집]
      → [7 채점(결정적→실행형→상태비교→Judge→사람)] → [8 집계·정규화·불확실성]
      → [9 리포트·추천(파레토/제약필터)] → [10 회귀 추적·재평가]
```

| 단계 | 핵심 질문 | 참고 도구의 대응 |
| --- | --- | --- |
| 1 목적 정의 | 무엇을 잘하는 모델이 필요한가? | HELM의 시나리오 분류(taxonomy), promptfoo의 `metric` 라벨 |
| 2 후보 구성 | 어떤 모델·양자화·파라미터 조합을 비교하나? | llama-bench의 파라미터 스윕(`-ngl`, `-fa`, `-ctk` 등을 콤마로 나열), promptfoo `providers[]` |
| 3 평가셋 | 무엇으로 측정하나? | lm-eval-harness task YAML, Inspect `Sample`, OpenAI Evals JSONL registry |
| 4 사전점검 | 모델이 로드되나? VRAM에 들어가나? | LocalScore(하드웨어 정보 수집), Ollama `load_duration` |
| 5 실행 | 공정하고 재현 가능한 조건인가? | HELM의 "동일 조건 표준화", lm-eval `repeats`, Inspect `epochs` |
| 6 수집 | 무엇을 남기나? | EEE의 instance-level JSONL, lm-eval `--log_samples` |
| 7 채점 | 맞았나? | Inspect scorers, promptfoo assertions, DeepEval metrics, BFCL AST checker |
| 8 집계 | 모델 간에 공정하게 비교할 수 있나? | Open LLM LB 정규화, Chatbot Arena BT, HELM mean win rate, Anthropic 통계 권고 |
| 9 리포트 | 결국 무엇을 쓰면 되나? | Aider LB(정답률+형식 준수율+비용), LocalScore 단일 점수 |
| 10 회귀 | 모델이 업데이트되면? | promptfoo CI 통합, LiveBench 월간 갱신 |

---

## 2. 로컬 LLM 평가에 중요한 항목 (평가 차원)

### 2.1 시스템 성능 / 효율 (Efficiency)

| 지표 | 정의 | 출처/비고 |
| --- | --- | --- |
| **Load time** | 모델을 메모리에 올리는 시간(콜드 스타트) | Ollama `load_duration`. 첫 요청에만 포함되므로 반드시 분리 측정 |
| **TTFT** (Time To First Token) | 요청 시작 ~ 첫 토큰 수신 | 체감 대기시간. prefill 길이에 비례한다 |
| **Prefill 속도** (pp, tok/s) | 입력 토큰 처리 속도 | llama-bench `pp512`. Ollama `prompt_eval_count / prompt_eval_duration`. 프롬프트 캐시가 적중하면 비정상적으로 높게 나온다(Fortress 분석 문서에서 30만 tok/s 관측) → 캐시 적중 여부를 따로 기록해야 함 |
| **Decode 속도** (tg, tok/s) | 출력 토큰 생성 속도 | llama-bench `tg128`. Ollama `eval_count / eval_duration` |
| **TPOT / ITL** | 출력 토큰당 평균 시간 / 토큰 간 개별 간격 | vLLM `benchmark_serving`, GuideLLM. ITL의 p95·p99는 스트리밍 끊김(jitter)을 드러낸다 |
| **E2E latency** | 요청 ~ 완료까지 전체 시간 | 에이전트는 여러 턴의 합으로 계산한다 |
| **Goodput** | SLO(예: TTFT<2s, TPOT<50ms)를 만족한 요청 비율·처리량 | 서버용 개념이지만 "체감 합격률"로 변형해 쓸 수 있다 |
| **컨텍스트 깊이별 속도 저하** | 컨텍스트가 채워질수록 decode 속도가 떨어지는 곡선 | llama-bench `-d`(depth) 옵션. 로컬 모델 선택에 매우 중요 |
| **VRAM 피크 / 오프로드 비율** | 가중치 + KV 캐시 + 버퍼. CPU로 넘어간 레이어 비율 | Ollama `/api/ps` (`size_vram`), NVML. Fortress 모니터링에 이미 있음 |
| **RAM / 전력 / 온도** | 시스템 부하 | LocalScore는 OS·CPU·RAM·GPU 정보를 함께 수집 |
| **KV 캐시 타입·Flash Attention** | 속도·메모리 트레이드오프 | llama-bench `type_k/type_v`, `flash_attn` |

**LocalScore의 시사점**: 속도 지표 3개(PP, TG, TTFT)를 **8개의 입출력 길이 시나리오**(짧은 프롬프트+긴 생성=창작형, 1~2k 입력+중간 생성=요약형, 4k 입력+긴 생성=문서 QA형)로 측정해 하나의 점수로 합친다. 해석 기준은 "1000=훌륭함, 250=쓸 만함, 100 미만=나쁜 경험"이다. 이렇게 **사용 시나리오별로 측정하고 절대 기준에 맞춰 해석**하는 방식은 Fortress 성능 점수 정규화에도 쓸 수 있다(기획서 §7.3).

### 2.2 모델 품질 (Capability)

| 영역 | 대표 벤치마크 | 채점 방식 | 로컬 적용 메모 |
| --- | --- | --- | --- |
| 지식 | MMLU, **MMLU-Pro**(10지선다, 추론 비중↑) | 객관식 정답 | 원본은 수천~만 문항 → 층화 샘플링 필요 |
| 한국어 지식 | **KMMLU**(35,030문항·45과목, 한국 전문 자격시험 원문), KMMLU-Redux/Pro, **HAE-RAE Bench**(약 1.5k, 어휘·역사·상식·독해), **CLIcK**(1,995문항, 문화·언어), **KoBEST** | 객관식 | 번역 벤치마크가 아닌 원문 한국어 데이터라서 가치가 높다 |
| 추론/수학 | GSM8K, MATH(Lvl5/500), BBH, MuSR, GPQA | 숫자·수식 정답 추출(`math()` 동치 비교) | 사고(reasoning) 모델은 출력 토큰이 폭증함 → 토큰 효율도 같이 측정 |
| 지시 따르기 | **IFEval**(약 500 프롬프트, 25종 검증 가능 지시), **Ko-IFEval** | 프로그램 검증(단어 수, 키워드 빈도, 형식 등). prompt-level/instruction-level × strict/loose | Judge 없이 결정적으로 채점 가능 → 로컬 평가에 이상적 |
| 코딩 | HumanEval(+), MBPP(+), LiveCodeBench, **Aider Polyglot**(225문제·6개 언어, 2회 시도) | 코드 실행 + 테스트 통과(pass@k) | 실행 샌드박스가 필요하다. Aider는 **편집 형식 준수율**을 따로 집계 |
| 대화 품질 | MT-Bench, **LogicKor**(MT-Bench 한국어판 + 문법 카테고리), Arena-Hard, AlpacaEval 2 LC | LLM Judge | 판정자 편향에 주의(§5) |
| 긴 컨텍스트 | NIAH, **RULER**(NIAH 변형, 멀티홉 추적, 집계, QA) | 정답 대조 | 광고된 컨텍스트 크기 ≠ 실효 길이. 32k 이상을 광고한 모델 중 약 절반만 32k에서 만족스러운 성능 |
| 사실성/환각 | TruthfulQA, SimpleQA | 정답 대조 / Judge | — |

### 2.3 에이전트 / 도구 사용 능력 (Agentic)

| 벤치마크 | 측정 내용 | 채점 |
| --- | --- | --- |
| **BFCL** (Berkeley Function Calling LB) | simple / multiple(2~4개 함수 중 선택) / parallel / parallel-multiple / **관련성 탐지**(적절한 함수가 없을 때 호출하지 않기) / v3 멀티턴 / v4 에이전트형 | **AST 채점**: ① 함수명 일치 ② 필수 파라미터 존재·환각 파라미터 없음 ③ 타입·값 검증(bool 정확 일치, 문자열은 대소문자·공백 정규화, 리스트는 순서 일치) ④ 허용 정답 목록 매칭. 실행형 채점도 병행 |
| **τ-bench** | 사용자 시뮬레이터 + 도메인 도구 + 정책 문서 | **대화 종료 후 DB 상태를 목표 상태와 비교**. 신뢰성 지표 **pass^k** 도입(GPT-4o도 retail에서 pass^8 < 25%) |
| Aider Polyglot | 실제 코드 편집 | 테스트 통과 + 편집 형식 준수율 + malformed 응답 수 |
| DeepEval 에이전트 지표 | Task Completion, Step Efficiency, Plan Adherence, Tool Correctness, Argument Correctness | Judge + 규칙 |
| promptfoo | `is-valid-openai-tools-call`, `tool-call-f1`, `trajectory:*` | 규칙 + Judge |

**시사점**: 에이전트 평가는 "정답 텍스트"가 아니라 **최종 상태(파일시스템/DB)**와 **도구 호출 궤적(trajectory)**을 채점한다. Fortress는 파일 도구(read/write/edit/ls/grep/find)를 가진 에이전트이므로 **임시 워크스페이스 픽스처 + 최종 파일 상태 비교**가 가장 자연스러운 채점 방식이다.

### 2.4 신뢰성 / 일관성 (Reliability)

- **pass@k**(Chen et al., 2021, HumanEval): n번 생성해 c번 맞았을 때 "k번 중 한 번이라도 성공"할 확률. 불편추정량은 `pass@k = 1 − C(n−c, k) / C(n, k)`.
- **pass^k**(τ-bench): "k번 모두 성공"할 확률. `pass^k = C(c, k) / C(n, k)`. **운영 신뢰성**을 보는 지표이며, 로컬 에이전트 선택에서는 pass@k보다 중요하다.
- **형식 오류율**: 도구 호출 JSON 파싱 실패, 정답 추출 실패(NOANSWER), 편집 형식 위반(Aider의 "percent well formed").
- **시드·온도 분산**: 같은 설정으로 반복했을 때 점수의 표준편차.
- **루프/정체**: 최대 턴 초과, 같은 도구 호출 반복.

### 2.5 양자화 품질 (Quantization fidelity)

- **Perplexity만으로는 부족하다**: PPL에는 모델 고유의 불확실성과 양자화 손상이 섞여 있다(llama.cpp Discussion #4110).
- **KL divergence**: 같은 입력에서 BF16 기준 모델과 양자화 모델의 토큰 분포 차이를 잰다. 양자화 손상만 분리해서 볼 수 있다. LocalBench는 약 30k 토큰까지의 실제 입력 6개 카테고리로 측정한다.
- **Top-token agreement**: 두 모델의 1순위(또는 top-5) 토큰이 일치하는 비율. 체감 품질 저하와 상관이 높다.
- 참고 수치: Q4_K_M은 7B 기준 PPL이 약 +0.05 늘어나며 "medium, balanced quality, recommended"로 분류된다.
- **제약**: logprobs가 필요하다. Ollama/OpenAI 호환 서버마다 지원 편차가 크고, 기준(BF16) 모델을 로컬에 올리기 어려운 경우가 많다 → Fortress에서는 **선택 기능**으로 둔다.

### 2.6 안전성 (Safety) — 참고

HELM의 7개 지표(정확도·보정·강건성·공정성·편향·독성·효율), DeepEval Safety(Bias, Toxicity, PII Leakage…), promptfoo `is-refusal`·`moderation`. Fortress의 주 목적(개인 작업용 모델 선택)에서는 **과잉 거절률**과 **프롬프트 인젝션 저항**(웹 검색 결과 속 지시를 따르는지)만 우선순위가 높다.

---

## 3. 평가 데이터셋 포맷 조사

### 3.1 Inspect AI (UK AISI)

- `Task = dataset + solver + scorer`
- `Sample` 필드: `input`(문자열 또는 채팅 메시지 목록, 필수), `target`(정답 또는 채점자용 서술), `choices`, `id`, `metadata`, `sandbox`, `files`, `setup`(샌드박스 내 bash, 5분 타임아웃)
- CSV/JSON/JSONL/HF Datasets 지원. `FieldSpec(input="question", target="answer", id=..., metadata=[...])`로 필드 매핑
- 선택지 셔플(정답 매핑 유지), 필터/슬라이스, Pydantic 타입 메타데이터

### 3.2 lm-evaluation-harness (EleutherAI)

- task YAML: `task`, `dataset_path`/`dataset_name`, `*_split`, `fewshot_split`, `doc_to_text`/`doc_to_target`/`doc_to_choice`(Jinja 템플릿), `description`, `num_fewshot`, `repeats`
- `output_type`: `generate_until` | `loglikelihood` | `loglikelihood_rolling` | `multiple_choice`
- `filter_list`: 후처리 파이프라인(`regex` 추출 → `take_first` / `majority_vote`)
- `metric_list`: `metric`, `aggregation`, `higher_is_better`
- `metadata.version`: 태스크 버전(점수 비교 가능성 보장)
- decontamination 옵션

### 3.3 OpenAI Evals

- registry YAML(평가 클래스·데이터 경로) + JSONL 샘플(`{"input": [messages], "ideal": "..."}`)
- 기본 평가 클래스: `Match`, `Includes`, `FuzzyMatch`, `ModelBasedClassify`(Judge)

### 3.4 promptfoo

```yaml
providers: [ollama:chat:qwen3:8b, openai:chat:...]
prompts: [file://prompt.txt]
tests:
  - description: ...
    vars: { question: "..." }
    assert:
      - type: icontains     # not- 접두사로 부정 가능
        value: "..."
        weight: 2
        metric: accuracy
      - type: llm-rubric
        value: "간결하고 정확해야 함"
        threshold: 0.7
      - type: assert-set    # 묶음, threshold=통과 비율
        assert: [ {type: latency, threshold: 2000}, {type: cost, threshold: 0.001} ]
    threshold: 0.7          # 테스트 케이스 합격선(가중 평균)
```

- 결정적 assertion: `equals`, `contains(-any/-all)`, `icontains`, `regex`, `starts-with`, `is-json`, `contains-json`, `is-sql`, `is-xml`, `javascript`, `python`, `levenshtein`, `rouge-n`, `bleu`, `latency`, `cost`, `perplexity`, `is-refusal`, `is-valid-openai-tools-call`, `tool-call-f1`
- 모델 채점 assertion: `llm-rubric`, `g-eval`, `factuality`, `answer-relevance`, `context-faithfulness`, `select-best`, `similar`(임베딩), `classifier`, `moderation`
- **가중치(weight) + 임계값(threshold) + 지표 라벨(metric)** 구조는 Fortress의 채점 스펙에 그대로 쓸 만하다

### 3.5 DeepEval

- `LLMTestCase(input, actual_output, expected_output, context, retrieval_context, tools_called, expected_tools)`
- 모든 지표는 0~1 점수 + 판정 이유(`reason`)를 낸다. 기본 `threshold` 0.5, `strict_mode`면 이진 판정
- G-Eval(자연어 기준) + **DAG 지표**(결정 트리로 객관·주관 혼합 채점)

### 3.6 BFCL 샘플 구조 (요지)

`question`(메시지), `function`(JSON Schema 함수 문서 목록), `ground_truth`(함수명 → 파라미터별 **허용값 목록**). 허용값 목록 방식은 "정답이 여러 형태일 수 있는 도구 인자"를 결정적으로 채점하는 핵심 기법이다.

### 3.7 비교 요약

| 항목 | Inspect | lm-eval | promptfoo | DeepEval | OpenAI Evals |
| --- | --- | --- | --- | --- | --- |
| 샘플 기본 필드 | input/target/choices/metadata | doc 템플릿 | vars | input/actual/expected | input/ideal |
| 멀티턴/에이전트 | ◎(solver, sandbox) | △ | ○(trajectory) | ○ | △ |
| 채점 조합 | 다중 scorer | filter+metric | assert 가중합 | 다중 metric | 클래스 |
| 반복/신뢰도 | epochs + reducer | repeats | repeat | — | — |
| 결과 포맷 | .eval 로그 | JSON + samples | JSON/HTML | JSON | JSONL |
| 언어 | Python | Python | Node | Python | Python |

→ **Fortress는 Tauri/TS 앱이라 Python 프레임워크를 내장할 수 없다.** 개념(Sample/Scorer/Metric/Epoch)과 포맷 호환(가져오기/내보내기)만 취하고, 실행기는 기존 `providerRuntime`·`runAgentLoop` 위에 TS로 직접 구현하는 것이 맞다.

---

## 4. 자동화 테스트 실행 방법 조사

### 4.1 공정성 · 재현성 원칙

- **동일 조건 표준화**(HELM): 모든 후보 모델을 같은 시나리오·같은 프롬프트·같은 지표로 평가한다. HELM 이전에는 모델 간 공통 시나리오 커버리지가 17.9%에 불과했다.
- **생성 설정 기록**(EEE `generation_config`): temperature, top_p, max_tokens 등은 점수에 큰 영향을 준다 → 결과와 함께 반드시 저장한다.
- **태스크 버전 고정**(lm-eval `metadata.version`): 데이터셋이나 프롬프트가 바뀌면 점수를 비교할 수 없다 → 팩 해시·버전을 기록한다.
- **프롬프트 형식 민감도**: 선택지 순서, 정답 표기 방식에 따라 점수가 달라진다 → OpenCompass의 **CircularEval**(선택지를 회전시켜 N번 모두 맞혀야 정답)이나 Inspect의 선택지 셔플을 쓴다.

### 4.2 반복과 분산 관리

- Inspect `epochs` + reducer(mean, mode, max, pass@k 계열), lm-eval `repeats`, llama-bench `-r 5`(평균 ± 표준편차)
- 성능 측정은 **워밍업 1회를 버리고** N회 측정한다. 첫 요청에는 로드 시간과 캐시 미적중이 섞여 있기 때문이다.
- 품질 측정 기본값은 temperature 0(또는 고정 seed)으로 결정성을 높이고, 신뢰성(pass^k) 측정에서는 사용자 설정 temperature로 k회 반복한다.

### 4.3 실행 순서와 리소스 격리 (로컬 특화)

- 로컬에서는 **GPU 하나를 여러 후보가 공유**한다. 모델을 번갈아 실행하면 재로딩 비용과 VRAM 경합 때문에 측정이 오염된다 → **후보(모델)별로 묶어 순차 실행**한다.
- 후보를 전환할 때는 이전 모델을 언로드(Ollama `keep_alive: 0`)해야 VRAM 피크를 깨끗하게 측정할 수 있다.
- 평가 중에 사용자가 채팅을 하면 측정이 오염된다 → 평가 실행과 채팅을 상호 배제하거나, 오염된 샘플에 표시를 남긴다.

### 4.4 에이전트형 태스크 실행

- **샌드박스 픽스처**: Inspect의 `sandbox`/`files`/`setup`, τ-bench의 도메인 DB. 태스크마다 초기 상태를 만들고, 끝나면 상태를 비교한 뒤 폐기한다.
- **사용자 시뮬레이터**(τ-bench): 멀티턴 에이전트 평가용. 비용이 커서 로컬에서는 후순위.
- **최대 턴 / 타임아웃**: 무한 루프를 막고 "정체"를 실패로 기록한다.

### 4.5 체크포인트 / 재개

로컬 평가는 몇 시간씩 걸릴 수 있다. 샘플 단위 결과를 즉시 영속화하면(lm-eval `--log_samples`, Inspect 로그) 중단 후 이어서 실행할 수 있다.

### 4.6 소요 시간 추정

`예상 시간 ≈ Σ샘플 (입력토큰/prefill속도 + 출력토큰/decode속도) × 반복 수 + 모델 로드 × 후보 수`
예: 200샘플 × 평균 출력 400토큰 ÷ 40 tok/s ≈ 2,000초(약 33분)/후보. 사고 모델은 출력이 3~10배로 늘어난다 → **실행 전 추정치 표시와 샘플 수 단계(Smoke/Standard/Full)**가 필수다.

### 4.7 오염(Contamination) 대응

- 공개 벤치마크는 학습 데이터에 섞여 있을 수 있다 → LiveBench는 매월 새 문제를 추가하고, 객관적 정답으로만 채점한다.
- 로컬 앱에서 쓸 수 있는 대안: ① **변형(perturbation)** — 숫자·이름을 바꾼 GSM 변형 문제, ② **개인 평가셋**(사용자 작업 이력), ③ 팩 버전에 공개일을 기록.

### 4.8 성능 벤치마크 도구의 측정 방식

- **llama-bench**: pp512/tg128/pg 테스트, `-r` 반복, 출력 CSV/JSON/JSONL/MD/SQL. 필드 `model_type`, `n_gpu_layers`, `avg_ts`, `stddev_ts`, `n_batch`, `n_threads`, `type_k`, `type_v`, `flash_attn`, `split_mode`. 파라미터를 콤마로 스윕한다.
- **vLLM benchmark_serving / GuideLLM**: TTFT, TPOT, ITL, E2E, 출력/요청 처리량, 백분위(p50/p90/p99), SLO 기반 goodput.
- **Ollama 응답 필드**: `total_duration`, `load_duration`, `prompt_eval_count`, `prompt_eval_duration`, `eval_count`, `eval_duration`(ns). Fortress 모니터링은 이미 이 필드를 수집한다.

### 4.9 데이터셋 라이선스 (2026-09-25 HF 데이터셋 카드 원문 확인)

| 데이터셋 | 라이선스(원문) | Fortress 처리(D4 "앱에 포함" 적용) |
| --- | --- | --- |
| GSM8K (openai/gsm8k, test 1,319) | MIT | 번들 |
| MMLU-Pro (TIGER-Lab, 12,032문항·14과목, 필드 question/options/answer/answer_index/category/src) | MIT | 부분집합 번들 |
| IFEval (google/IFEval, 541 프롬프트, 필드 key/prompt/instruction_id_list/kwargs) | Apache-2.0 | 번들 |
| IFEval-Ko (allganize) | Apache-2.0 | 번들 |
| HumanEval+ (evalplus/humanevalplus, 164, 필드 task_id/prompt/canonical_solution/entry_point/test) | Apache-2.0 | 번들(실행은 Python 옵트인) |
| BFCL (gorilla-llm) | Apache-2.0 | 부분집합 번들(HF `load_dataset` 비호환, 원본 JSON 직접 변환) |
| KMMLU (HAERAE-HUB, 과목별 `data/{Subject}-{dev,test,train}.csv`, test 파일당 수십 KB) | **CC-BY-ND-4.0** | 원본 test CSV **무수정** 번들 + 런타임 변환 |
| KoBEST (skt/kobest_v1) | **CC-BY-SA-4.0** | 부분집합 번들(파생 파일은 같은 라이선스로 배포) |
| HAE-RAE Bench 1.1 | **CC-BY-NC-ND-4.0** | 번들 불가(비상업) → 임포터 |
| GPQA | CC-BY-4.0 + "평문·이미지로 온라인 공개 금지" 요청 | 번들 불가(공개 리포) → 임포터 |
| CLIcK | 데이터셋 카드·GitHub에 라이선스 표기 확인 불가 | 번들 불가 → 임포터 |
| LogicKor (instructkr, 2024-10 아카이브) | 확인 불가 | 번들 불가 → 임포터 |

참고: Ollama는 v0.12.11부터 `/api/chat`에서 `logprobs`/`top_logprobs`(출력 토큰)를 지원한다 → 객관식 확률 모드·양자화 충실도(출력 공통 접두 KL) 설계의 근거(Phase10 P10-14).

---

## 5. 채점(평가) 방법 조사

### 5.1 채점기 계층 (객관 → 주관)

| 계층 | 방법 | 예 | 신뢰도 | 비용 |
| --- | --- | --- | --- | --- |
| L1 결정적 문자열 | exact / includes / regex / 정규화 비교 / 숫자 동치 / 선택지 | Inspect `match`·`pattern`·`answer`·`choice`, promptfoo `equals`·`regex` | 매우 높음 | 0 |
| L2 구조 검증 | JSON 파싱·JSON Schema, 도구 호출 AST, Mermaid 문법 | BFCL AST, promptfoo `is-json`·`is-valid-openai-tools-call` | 매우 높음 | 0 |
| L3 프로그램 검증 | 지시 준수 검사 함수 | IFEval 25종 체커 | 높음 | 0 |
| L4 실행형 | 코드 실행 + 테스트 | HumanEval pass@k, Aider | 높음 | 샌드박스 필요 |
| L5 상태 비교 | 최종 파일/DB 상태 대조 | τ-bench | 높음 | 픽스처 필요 |
| L6 유사도 | ROUGE/BLEU/Levenshtein/임베딩 | promptfoo `rouge-n`·`similar` | 낮음~중간 | 낮음 |
| L7 LLM Judge | 루브릭 단일 채점, 쌍대 비교, 참조 기반 | MT-Bench, G-Eval, Prometheus 2, `llm-rubric` | 중간(편향) | 높음 |
| L8 사람 | 블라인드 A/B, 좋아요/싫어요 | Chatbot Arena | 기준점(gold) | 사람 시간 |

### 5.2 정답 추출

- 생성형 응답에서 정답을 뽑는 단계가 점수를 크게 좌우한다: lm-eval `filter_list(regex → take_first)`, Inspect `answer()`("ANSWER: X" 형식 강제).
- 사고 모델: `<think>…</think>`나 reasoning 필드를 제거한 뒤 추출한다.
- 추출에 실패하면 오답이 아니라 **NOANSWER**로 따로 집계한다(형식 준수율 지표로 쓸 수 있음).
- logprobs 기반 MCQ 채점(lm-eval `multiple_choice`)은 Provider마다 지원이 달라서, **생성형 + 추출**을 기본으로 하고 logprobs는 가능할 때만 선택적으로 쓴다.

### 5.3 LLM-as-a-Judge (MT-Bench 논문, 2306.05685)

- 방식: **쌍대 비교**, **단일 점수**(1~10), **참조 기반**(정답을 함께 제공)
- 편향: **위치 편향**(첫/마지막 선호), **장황함 편향**(긴 답 선호), **자기선호 편향**(자기 계열 모델 선호), 수학 채점에 약함
- 완화: **순서를 바꿔 2회 판정**(불일치하면 무승부), few-shot, CoT, 참조 기반 채점
- GPT-4 Judge와 인간의 일치도는 80% 이상(인간끼리의 일치 수준)
- **G-Eval**: CoT로 평가 단계를 자동 생성 → 양식 채우기 → 점수 토큰 확률의 가중합으로 연속 점수를 만든다. 요약 과제에서 인간과 Spearman 0.514. LLM이 생성한 텍스트를 선호하는 편향이 있다.
- **AlpacaEval LC**: GLM 회귀로 길이 차이를 조정해 "길이가 같았다면" 승률을 추정한다. Arena와의 Spearman 상관이 0.94에서 0.98로 올랐다.
- **Prometheus 2**(7B, 8x7B): 오픈소스 Judge 전용 모델. 직접 평가(1~5 루브릭)와 쌍대 순위를 모두 지원하고, 공개 Judge 중 인간·GPT-4와의 상관이 가장 높았다 → **로컬 Judge 후보**.
- 로컬 환경에서의 함의: Judge 모델도 VRAM을 쓴다 → 후보 실행을 모두 마친 뒤 **Judge 패스를 따로 몰아서** 실행한다. 외부 API Judge는 데이터를 외부로 보내므로 명시적인 동의가 필요하다.

### 5.4 사람 평가 / Arena

- Chatbot Arena: 블라인드 쌍대 투표 → **Bradley-Terry MLE**(온라인 Elo를 대체). 모델 가중치는 고정되어 있으므로 순서 무관 추정이 더 안정적이다. 신뢰구간은 **MLE 부트스트랩**, 무승부는 0.5승으로 처리한다.
- 개인 규모(수십~수백 표)에서도 BT와 부트스트랩 신뢰구간을 쓰면 "아직 구분할 수 없음"을 정직하게 표시할 수 있다.

---

## 6. 정규화 · 집계 · 통계 조사

### 6.1 무작위 기준선 보정 (Open LLM Leaderboard v2)

```
norm = max(0, (raw − lower) / (upper − lower)) × 100
lower = 1 / num_choices   (객관식), 0 (생성형: MATH, IFEval)
```

- 하위 태스크가 있으면(MuSR, BBH) 하위 태스크별로 정규화한 뒤 평균한다. 예: MuSR (0.7, 0.4, 0.6) → (40, 25, 40) → 35.0
- GPQA(4지선다) raw 0.6 → 46.67
- 리더보드 평균 = 정규화 점수의 단순 평균(IFEval, BBH, MATH Lvl5, GPQA, MuSR, MMLU-Pro)

### 6.2 다중 모델 집계

- **HELM mean win rate**: 시나리오마다 "다른 모델보다 높은 비율"을 구해 평균한다. 척도가 다른 지표를 합칠 때 강건하지만, 비교 대상 집합에 따라 값이 달라진다.
- **Bradley-Terry**: 쌍대 결과로 잠재 강도를 추정한다. 사람 투표와 Judge 쌍대 비교 모두에 쓸 수 있다.
- **절대 앵커 방식**(LocalScore 형): "1000=훌륭함"처럼 고정 기준에 맞춰 점수를 낸다 → 시간이 지나도, 비교 대상이 바뀌어도 값이 유지된다.

### 6.3 불확실성 · 통계 (Anthropic, "A statistical approach to model evaluations")

1. **표준오차 보고**: 95% CI = 평균 ± 1.96 × SEM. 정답률 p, 표본 n이면 SEM = √(p(1−p)/n). 예: p=0.7, n=100 → ±9.0%p, n=400 → ±4.5%p.
2. **군집 표준오차**: 같은 지문·픽스처를 공유하는 문항은 독립이 아니다. 군집 SE가 일반 SE의 3배를 넘기도 한다.
3. **문항 내 분산 축소**: CoT 모델은 재샘플링한 평균을, 비CoT 모델은 정답 토큰 확률을 점수로 쓴다.
4. **쌍대 차이 분석**: 같은 문항에서 두 모델의 점수 차를 분석한다. 문항 난이도의 상관(0.3~0.7)을 이용해 분산을 줄인다.
5. **검정력 분석**: 원하는 차이를 검출하는 데 필요한 문항 수를 사전에 계산한다.

### 6.4 결과 스키마 — Every Eval Ever (EEE, arXiv 2606.14516)

- 집계 JSON(`eval.schema.json`, `schema_version` 예 "0.3.0")
  - `evaluation_id`, `retrieved_timestamp`
  - `source_metadata`: `source_name`, `source_type`, `source_organization_name`, `evaluator_relationship`
  - `model_info`
  - `generation_config`(temperature, top_p, max_tokens…)
  - `evaluation_results[]`: `metric_config`(`evaluation_description`, `lower_is_better`, `score_type`: continuous|level-based, `min_score`, `max_score`), `score_details.score`, 불확실성(CI, SE)
  - `detailed_evaluation_results` → `{uuid}_samples.jsonl`
- 샘플 JSONL(`InstanceLevelEvaluationLog`): 상호작용 유형 `single_turn`(output) / `multi_turn`(messages) / `agentic`(tool_calls), 각 항목은 `input`, `answer_attribution`, `evaluation`, `token_usage`, `performance`
- HELM·lm-eval·Inspect 변환기가 있고, 커뮤니티 DB에 22,235개 모델·2,273개 벤치마크가 있다
- **Fortress 시사점**: 내부 스키마를 EEE와 **필드 대응이 가능하게** 설계하면 내보내기만으로 외부 비교가 가능하다. `lower_is_better`, `min/max_score`, `score_type`를 지표 정의에 넣는 것은 그대로 채택할 만하다.

---

## 7. 다른 평가 앱/도구 비교 요약

| 도구 | 유형 | 강점 | Fortress가 가져올 것 |
| --- | --- | --- | --- |
| lm-evaluation-harness | Python 라이브러리 | 방대한 표준 태스크, 필터 파이프라인 | 태스크 버전 관리, regex→take_first 추출, repeats |
| HELM | 프레임워크+LB | 다차원 지표, 표준화 | 시나리오×지표 매트릭스, 효율 지표 포함, win rate |
| Open LLM LB v2 / lighteval | LB | 정규화 방식 | 기준선 보정 공식 |
| OpenCompass | 프레임워크 | CircularEval, 주관 평가 | 선택지 회전으로 위치 편향 제거 |
| Inspect AI | 프레임워크 | Sample/Solver/Scorer, 샌드박스, epochs | 샘플 스키마, 채점기 분류, NOANSWER |
| promptfoo | CLI/앱 | assertion 가중합, 매트릭스 비교 UI | assert 스펙(weight/threshold/metric), `not-` 부정 |
| DeepEval | 라이브러리 | 에이전트·대화 지표, 0~1+reason | 점수+이유 저장, 에이전트 궤적 지표 |
| OpenAI Evals | 레지스트리 | 단순 JSONL | input/ideal 포맷 가져오기 |
| llama-bench | CLI | 하드웨어 성능 스윕 | pp/tg/depth 측정, avg±std |
| LocalScore | 앱 | 시나리오 기반 속도 점수, 하드웨어 수집 | 절대 앵커 점수, 하드웨어 지문 |
| vLLM bench / GuideLLM | CLI | TTFT/TPOT/ITL 백분위, goodput | 백분위 지표, SLO 합격률 |
| Chatbot Arena | 서비스 | 블라인드 투표, BT | 로컬 블라인드 A/B + BT |
| AlpacaEval LC / Arena-Hard / MT-Bench | Judge 벤치 | Judge 편향 연구 | 순서 교체, 길이 보정 |
| BFCL | LB | 도구 호출 AST 채점 | 허용값 목록 기반 인자 채점, 관련성 탐지 |
| τ-bench | 벤치 | 상태 비교, pass^k | 픽스처 상태 비교, pass^k |
| Aider Polyglot | LB | 실전 코드 편집, 형식 준수율 | 편집 형식 준수율, 2회 시도 |
| RULER | 벤치 | 실효 컨텍스트 길이 | 길이별 NIAH·멀티홉 합성 과제 |
| LiveBench | 벤치 | 오염 방지, 객관 채점 | 변형 문제, 버전·공개일 기록 |
| EEE | 스키마 | 통합 결과 포맷 | 결과 내보내기 스키마 |

---

## 출처

- Inspect AI — Datasets: https://inspect.aisi.org.uk/datasets.html · Scorers: https://inspect.aisi.org.uk/scorers.html
- lm-evaluation-harness Task Guide: https://github.com/EleutherAI/lm-evaluation-harness/blob/main/docs/task_guide.md
- Open LLM Leaderboard 정규화: https://huggingface.co/docs/leaderboards/open_llm_leaderboard/normalization
- Anthropic, A statistical approach to model evaluations: https://www.anthropic.com/research/statistical-approach-to-model-evals
- llama-bench: https://github.com/ggml-org/llama.cpp/blob/master/tools/llama-bench/README.md
- LocalScore: https://www.localscore.ai/about
- BFCL: https://gorilla.cs.berkeley.edu/blogs/8_berkeley_function_calling_leaderboard.html
- Judging LLM-as-a-Judge (MT-Bench/Arena): https://arxiv.org/abs/2306.05685
- promptfoo assertions: https://www.promptfoo.dev/docs/configuration/expected-outputs/
- τ-bench: https://arxiv.org/abs/2406.12045
- IFEval: https://arxiv.org/abs/2311.07911
- AlpacaEval LC: https://arxiv.org/abs/2404.04475
- RULER: https://arxiv.org/abs/2404.06654
- DeepEval metrics: https://deepeval.com/docs/metrics-introduction
- Aider leaderboards: https://aider.chat/docs/leaderboards/
- G-Eval: https://arxiv.org/abs/2303.16634
- Chatbot Arena BT 전환: https://lmsys.org/blog/2023-12-07-leaderboard/
- Prometheus 2: https://arxiv.org/abs/2405.01535
- LiveBench: https://arxiv.org/abs/2406.19314
- HELM: https://arxiv.org/abs/2211.09110
- Every Eval Ever: https://github.com/evaleval/every_eval_ever · https://arxiv.org/abs/2606.14516
- 한국어 벤치마크: KMMLU https://arxiv.org/pdf/2402.11548 · HAE-RAE https://arxiv.org/pdf/2309.02706 · CLIcK https://arxiv.org/pdf/2403.06412 · Open Ko-LLM LB2 https://arxiv.org/pdf/2410.12445 · KMMLU-Redux/Pro https://arxiv.org/pdf/2507.08924 · 한국어 평가 도구 개관 https://huggingface.co/blog/amphora/navigating-ko-llm-research-2
- 추론 지표: https://docs.anyscale.com/llm/serving/benchmarking/metrics · https://www.hivenet.com/post/llm-inference-metrics-ttft-tps
- 양자화 KLD: https://github.com/ggml-org/llama.cpp/discussions/4110 · https://localbench.substack.com/p/gguf-benchmark-methodology · https://smcleod.net/2026/04/measuring-model-quantisation-quality-with-kl-divergence/
- pass@k 불편추정량: Chen et al., "Evaluating Large Language Models Trained on Code"(2021, HumanEval) — 원문 공식 인용, 이번 세션에서 원문 재조회는 하지 않음
- OpenCompass CircularEval, OpenAI Evals 클래스 구성 — 사전 지식 기반, 이번 세션에서 원문 재조회는 하지 않음(착수 시 확인)
