Ollama를 대체하거나 병행 지원할 수 있는 대표적인 로컬 LLM 런타임들과 각 도구의 특징, 그리고 본 프로젝트로의 도입
가능성을 정리해 드립니다.
──────
### 1. Ollama 주요 대체재 및 특징

 구분         │ LM Studio        │ llama.cpp (llam… │ vLLM              │ Jan.ai            │ LocalAI
──────────────┼──────────────────┼──────────────────┼───────────────────┼───────────────────┼───────────────────
 성격         │ GUI 기반 로컬    │ 초경량 C++       │ 고처리량 프로덕션 │ 일렉트론/타우리   │ 멀티 백엔드
              │ 모델 관리 & 로컬 │ 네이티브 서버    │ 서빙 엔진         │ 기반 오픈소스 GUI │ 셀프호스팅 올인원
              │ 서버             │ (CLI)            │                   │                   │ 서버
 지원 OS      │ Windows / macOS  │ Windows / macOS  │ Linux (Windows는  │ Windows / macOS / │ Linux / macOS /
              │ / Linux          │ / Linux          │ WSL2 필요)        │ Linux             │ Docker (Windows는
              │                  │                  │                   │                   │ WSL2)
 제공 API     │ OpenAI 호환      │ OpenAI 호환      │ OpenAI 호환 (/v1) │ OpenAI 호환 (/v1) │ OpenAI 호환 (/v1)
              │ (/v1)            │ (/v1)            │                   │                   │
 Tool Calling │ 지원 (0.3+ 버전  │ 지원 (Jinja      │ 지원 (--tool-     │ 제한적 지원       │ 지원 (백엔드
              │ 및 GGUF 모델)    │ 템플릿 /         │ call-parser)      │                   │ 모델에 따라 상이)
              │                  │ grammar)         │                   │                   │
 모델 포맷    │ GGUF (Hugging    │ GGUF             │ Hugging Face      │ GGUF              │ GGUF, GGML 등
              │ Face 검색 내장)  │                  │ SafeTensors, AWQ, │                   │ 다양
              │                  │                  │ GPTQ              │                   │

#### (1) LM Studio

• 특징: 현재 데스크탑 환경에서 일반 사용자 및 개발자에게 가장 인기 있는 로컬 GUI 도구입니다. Hugging Face에서
GGUF 모델을 원클릭으로 다운로드하고, GPU 레이어 오프로드 및 컨텍스트 길이를 시각적으로 쉽게 조절할 수 있습니다.
• 로컬 서버: Local Server 탭에서 포트(기본 1234)를 열면 OpenAI 호환 엔드포인트(http://localhost:1234/v1)가
실행됩니다.
• 장점: 모델 탐색/다운로드/GPU 설정이 매우 직관적이고 안정적입니다.
• 단점: 헤드리스(CLI만으로 자동 시작) 운영보다는 데스크탑 앱 실행 중심입니다.

#### (2) llama.cpp (llama-server)

• 특징: Ollama, LM Studio 등 수많은 로컬 LLM 도구의 근간이 되는 C++ 엔진입니다. 독립 실행형 바이너리(llama-
server.exe)를 통해 최소한의 리소스로 구동됩니다.
• 로컬 서버: 기본 8080 포트로 OpenAI 호환 API(http://localhost:8080/v1) 및 자체 슬롯 관리 API를 제공합니다.
• 장점: 불필요한 레이어가 없어 오버헤드가 제로에 가깝고, GPU 가속(CUDA/Vulkan) 효율이 극대화됩니다.
• 단점: 모델 다운로드, 실행 스크립트 작성, 파라미터 튜닝을 사용자가 CLI로 직접 다루어야 합니다.

#### (3) vLLM

• 특징: PagedAttention 기반으로 GPU 메모리 활용률과 처리량(throughput)이 가장 뛰어난 프로덕션 서빙 엔진입니다.
• 장점: 대량 배치 처리와 빠른 추론 속도, 정교한 Tool Calling 파서 내장.
• 단점: 네이티브 Windows를 공식 지원하지 않아 Windows 환경에서는 WSL2(Ubuntu) 또는 Docker 환경이 필요하며,
고사양 NVIDIA GPU 환경에 최적화되어 있습니다.

#### (4) Jan.ai

• 특징: 오픈소스 로컬 AI 클라이언트 앱(Tauri/Electron 기반)으로, LM Studio와 유사하게 로컬
서버(http://localhost:1337/v1)를 켤 수 있습니다.
• 장점: 100% 오픈소스이며 로컬 우선 저장 구조.
• 단점: Tool Calling 파싱 및 스트리밍 처리 안정성이 LM Studio나 Ollama에 비해 상대적으로 아쉬운 편입니다.
──────
### 2. 현재 Fortress 프로젝트에서의 제공 가능 여부 분석

결론: "제공 가능하며, 매우 높은 확장성으로 구현 가능"합니다.

현재 Fortress는 Ollama의 전용 규격(NDJSON 기반 /api/chat)을 직접 파싱하고 있지만, **대체재들의 공통 표준은
OpenAI 호환 API (/v1/chat/completions)**입니다. 심지어 Ollama 자체도 /v1/chat/completions 엔드포인트를
제공합니다.

따라서 앱별로 개별 클라이언트를 만드는 대신, "OpenAI-Compatible Local Provider" 하나를 추가하면 위의 모든
대체재를 한 번에 수용할 수 있습니다.

#### 세부 기술 검토 항목:

1. Tool Calling (Function Calling) 호환성
    • 가능 여부: 가능 (모델 의존적)
    • Fortress의 에이전트는 파일 읽기/쓰기/셸 실행 등 도구 호출이 필수적입니다.
    • Ollama 외 대체재(LM Studio 0.3+, llama-server 등)도 OpenAI 규격의 tools, tool_choice, delta.tool_calls
    스트리밍을 지원합니다. (단, Qwen 2.5, Llama 3.1/3.3 등 Tool Calling 파인튜닝이 된 모델을 로드해야 정상
    작동합니다.)
2. 스트리밍 프로토콜 차이 (NDJSON vs SSE)
    • Ollama (/api/chat): 개별 라인이 JSON인 NDJSON 스트림.
    • OpenAI 규격 (/v1/chat/completions): data: {...}\n\n 형태의 Server-Sent Events (SSE) 스트림 (data:
    [DONE]으로 종료).
    • 영향: Fortress 원칙(Docs/Architecture.md §2, §5.0)상 외부 라이브러리(openai SDK 등)를 설치할 필요 없이,
    기존 ollamaClient.ts와 유사하게 순수 브라우저 fetch + ReadableStream으로 가볍게 OpenAI 호환 클라이언트를
    작성할 수 있습니다.
3. Thinking / Reasoning 처리
    • DeepSeek-R1, Qwen-QwQ 등의 생각 과정(thinking)은 대체재에서도 <think>...</think> 블록으로 내려오거나
    delta.reasoning_content 필드로 전달됩니다. Fortress에는 이미 cleanThinkingText 유틸리티가 구현되어 있어
    문제없이 분리 표시 가능합니다.
4. 모델 목록 및 컨텍스트 길이 탐색
    • Ollama: /api/tags로 모델 목록, /api/show로 모델 컨텍스트 윈도우 크기를 정밀하게 자동 조회 가능.
    • OpenAI 규격 (/v1/models): 모델 ID 목록만 반환되고, 컨텍스트 윈도우 크기나 파라미터 정보는 표준 응답에
    포함되지 않는 경우가 많습니다.
    • 대응: OpenAI 호환 모드에서는 사용자가 모델을 선택한 후 기본 컨텍스트 크기(예: 8,192 / 32,768)를 설정
    화면에서 수동 지정할 수 있도록 폴백을 두면 해결됩니다.

──────
### 3. 권장 구현 로드맵 (단계별 접근)

1. LLM Provider 인터페이스 추상화
    • streamChat 함수 시그니처를 Provider 중립적인 인터페이스로 정의
2. OpenAiCompatibleClient 추가
    • SSE 기반 스트리밍, tools 및 tool_calls 매핑
    • LM Studio(http://127.0.0.1:1234/v1), llama-server(http://127.0.0.1:8080/v1) 테스트
3. 설정 UI 확장 (SettingsModel.tsx)
    • Provider 종류 선택 드롭다운: Ollama | LM Studio / OpenAI-Compatible
    • Base URL 입력 필드 (예: http://127.0.0.1:11434 vs http://127.0.0.1:1234/v1)
    • 모델 새로고침 및 컨텍스트 크기 수동 입력 옵션


가장 추천하는 대체재 조합은 데스크탑 환경에서의 편리함과 도구 호출 안정성을 고려할 때 LM Studio이며,
서버/헤드리스 환경에서는 llama-server 또는 vLLM입니다.

──────
### 4. 추가 자료조사 보완 (2026-09-25, 웹 리서치)

공식 문서에서 확인한 기본 엔드포인트 (구현 프리셋 기본값으로 반영):

| Provider | 기본 Base URL | 근거 |
|---|---|---|
| Ollama | `http://127.0.0.1:11434` | `/api/chat` 네이티브 + `/v1` 호환도 제공 |
| LM Studio | `http://localhost:1234/v1` | Developer/Server 탭, `/v1/chat/completions`·`/v1/models`·`/v1/responses` 지원. 인증 OFF가 기본, 설정 시 `Authorization: Bearer` |
| llama.cpp llama-server | `http://127.0.0.1:8080/v1` | 독립 바이너리 기본 8080 포트, OpenAI 호환 + `--jinja` 시 tool calling |
| vLLM | `http://localhost:8000/v1` | `vllm serve` 기본 8000 포트. Tool calling은 `--enable-auto-tool-choice` + `--tool-call-parser {hermes,llama3_json,mistral,...}` 필요, `--api-key` 선택 |
| Jan.ai | `http://127.0.0.1:1337/v1` | Settings > Local API Server, 기본 포트 1337·prefix `/v1`. API 키는 임의 문자열 가능 (요청 헤더에 필요) |
| OpenAI 클라우드 | `https://api.openai.com/v1` | API 키 필수 |

스트리밍 규격 확인:
- OpenAI 호환 서버는 SSE (`data: {...}\n\n`, `data: [DONE]` 종료). `choices[0].delta.content` 누적,
  `delta.tool_calls[]`는 `{index, id, function:{name, arguments(부분 JSON 문자열)}}` 형태로 쪼개져 오므로
  index별 arguments 문자열을 이어붙인 뒤 JSON 파싱해야 한다. `stream_options: {include_usage: true}`로 usage 수신.
- Thinking/reasoning은 서버마다 `delta.reasoning_content` / `<think>` 블록 혼재 → 둘 다 수집하고
  기존 `cleanThinkingText`로 후처리한다.
- `think` ↔ `reasoning_effort` 매핑: `true` → `'medium'`, 문자열은 그대로 전달, `false`/미지정은 생략.
- OpenAI 규격에 Ollama 전용 필드(`num_ctx`, `think`)를 섞으면 400이 나올 수 있으므로 제거한다.

### 5. Fortress 구현 반영 (2026-09-25, P9-03)

- `Agent`에 `llmProvider`(`ollama`|기본) + `llmBaseUrl` + `llmApiKey` 추가. 구 DB 행은 Ollama로 해석되어 기존 동작 유지.
  DB 마이그레이션: `agents` 테이블에 `llm_provider`/`llm_base_url`/`llm_api_key` 컬럼 추가 (ALTER TABLE, 기본값 `ollama`).
- `src/lib/llm/providers.ts`: 7종 프리셋 + `resolveAgentLlmRuntime()` (Agent 고유값 > 전역 Ollama URL > 프리셋 기본).
- `src/lib/llm/openAiCompatibleClient.ts`: fetch+SSE 순수 구현 (외부 SDK 없음, Architecture §5.0 원칙 유지).
- `src/lib/llm/providerRuntime.ts`: 스트리밍 함수 선택·모델 목록·연결 확인의 Provider별 분기점.
- 턴 루프(`loop.ts`)는 Provider에 따라 메시지/도구 매퍼(Ollama ↔ OpenAI)와 스트리밍 클라이언트를 교체하고,
  컨텍스트 초과 오류(Ollama/OpenAI 양쪽)를 동일하게 압축 훅으로 복구한다. Tool call은 id 우선 매칭.
- 압축 요약 호출(`compact.ts`/`register.ts`)도 Agent의 Provider로 수행된다.
- 에이전트 편집 화면: 기본 정보 카드 아래에 "LLM Provider" 섹션 (종류 선택·Base URL·API 키·연결 테스트·모델 새로고침).
  OpenAI 호환 모드에서는 `/v1/models`가 ID 목록만 주므로 컨텍스트 크기를 수동 지정하도록 안내한다.
- 클라우드(API 키 방식)는 `openai` 프리셋 또는 `openai-compatible` + Base URL/API 키로 연동
  (OpenAI·OpenRouter·Azure·Together 등 OpenAI 호환 게이트웨이 전부 수용).
- 제한 사항: 모니터링의 모델 아키텍처/VRAM 세부 지표는 Ollama 전용 API(`/api/show`, `/api/ps`) 기반이므로
  비-Ollama Provider에서는 GPU 공통 지표만 표시되고 아키텍처 상세는 생략된다.