# Phase 2 — Agent Runtime & Chat

**목표**: Phase 1에서 만든 Chat 탭 placeholder를 실제로 동작하는 채팅으로 만든다. 이 Phase가 끝나면 사용자가 Ollama 로컬 모델과 스트리밍으로 대화할 수 있고, 내장 도구 8종을 LLM이 호출할 수 있으며, 스트리밍 중 취소·steering이 동작한다. 세션 영속화는 Phase 4, 시각화/승인 UI는 Phase 5, 에이전트 페르소나 전환 UI는 Phase 6에서 다룬다 — 이 Phase에서는 **하드코딩된 단일 기본 Agent 설정**으로 동작을 검증한다.

**선행 조건**: Phase 1 완료. P0-08(에이전트 루프 스파이크)에서 사용할 모델의 tool-calling 동작이 확인되어 있어야 한다.

**공통 참고**: `Docs/Architecture.md` §4.2(Agent 타입), §5(에이전트 런타임 설계 — **전체 필독**), §7(안전 경계), §12(IPC 목록).

**pi 참고**: `..\pi\packages\agent\src\types.ts`(루프 설정/훅/도구/이벤트), `..\pi\packages\agent\src\agent.ts`(공개 표면), `..\pi\packages\coding-agent\src\core\tools\`(도구 구현·절단), `..\pi\packages\coding-agent\src\core\system-prompt.ts`(섹션 프롬프트). **코드를 복사하지 말고 설계만 재구현할 것.**

> 이 Phase는 이후 모든 Phase의 토대이며, §5.6의 **확장점 규약**을 여기서 확정합니다. `hooks.ts` / `hookRegistry.ts`는 이 Phase 이후 수정되지 않아야 합니다.

---

## P2-01. Ollama 클라이언트

- **소유 파일**: `src/lib/llm/ollamaClient.ts`, `src/lib/llm/messageMapper.ts`
- **작업 내용**:
  1. 의존성은 `zod`만 추가한다(`pnpm add zod`). **`@langchain/*`을 설치하지 않는다** — `Docs/Architecture.md` §5.0.
  2. `streamChat(req, signal): AsyncIterable<OllamaChunk>` — `POST {baseUrl}/api/chat`을 `fetch`로 호출하고(`stream: true`), 응답 본문을 NDJSON 라인 단위로 파싱해 청크를 yield. `signal`로 중단 가능. 마지막 청크의 `prompt_eval_count`/`eval_count`를 `TokenUsage{input, output, total}`로 매핑한다(§5.8 — **압축이 이 값을 쓰므로 반드시 보존**).
  3. `listModels(baseUrl): Promise<OllamaModel[]>` — `GET /api/tags`.
  4. `showModel(baseUrl, model): Promise<{contextLength: number; supportsTools: boolean}>` — `POST /api/show`. `model_info`에서 `*.context_length`를 찾고, `capabilities`에 `tools`가 있는지 확인.
  5. 에러 타입 구분: `OllamaConnectionError`(서버 미기동), `OllamaModelNotFoundError`(404), `OllamaContextOverflowError`(컨텍스트 초과 — Phase 4의 오버플로우 복구가 이걸 잡는다), `OllamaRequestError`(기타).
  6. `messageMapper.ts`: `AgentMessage[]`(§5.2) ↔ Ollama `messages[]` 변환. assistant의 `toolCalls`는 Ollama `tool_calls` 형식으로, `toolResult`는 `{role: "tool", content}`로. zod 스키마 → JSON Schema 변환도 여기서 담당(간단한 변환기 자체 구현 또는 `zod-to-json-schema` 사용).
- **확인 방법**: fetch를 모킹한 Vitest로 NDJSON 파싱·usage 매핑·에러 분류를 검증. 수동으로는 `pnpm check:ollama`(P0-07)로 서버 확인 후 실제 스트리밍 1회.

## P2-02. 런타임 타입 + 훅 레지스트리 + 도구 레지스트리

- **소유 파일**: `src/lib/agent/types.ts`, `src/lib/agent/hooks.ts`, `src/lib/agent/hookRegistry.ts`, `src/lib/agent/bootstrap.ts`, `src/lib/tools/registry.ts`, `src/lib/tools/risk.ts`
- **작업 내용**:
  1. `types.ts`: `Docs/Architecture.md` §5.2의 `AgentMessage`/`AgentToolCall`/`TokenUsage`/`AgentToolResult`/`AgentTool`과 §5.4의 `AgentEvent`를 그대로 정의.
  2. `hooks.ts`: §5.6의 `AgentHooks` 인터페이스 + `composeHooks(...)`. 합성 규칙(단축 평가/체이닝/덮어쓰기)을 정확히 구현하고 각 규칙에 대한 단위 테스트를 남길 것.
  3. `hookRegistry.ts`: `registerHooks(id, hooks)` / `getRegisteredHooks()`. 같은 `id`로 재등록하면 교체(HMR 대응).
  4. `bootstrap.ts`: 지금은 `src/lib/tools/registry.ts`의 절단 훅만 등록하는 빈 껍데기. **Phase 4/5가 여기에 한 줄씩 import를 추가한다**(유일한 공유 지점).
  5. `risk.ts`: `Docs/Architecture.md` §8.1 표를 `RiskLevel = "low" | "high" | "critical"` 매핑으로 구현.
  6. `registry.ts`: `BuiltinToolId` → `AgentTool` 매핑, `getBuiltinTools(ids, ctx): AgentTool[]`. 또한 **출력 절단 `afterToolCall` 훅을 여기서 등록**한다.
- **확인 방법**: `composeHooks`의 합성 규칙(하나가 block하면 차단, transformContext 순차 체이닝)을 Vitest로 검증.

## P2-03. FortressAgent 루프

- **소유 파일**: `src/lib/agent/agent.ts`, `src/lib/agent/loop.ts`, `src/lib/agent/queue.ts`, `src/lib/agent/retry.ts`
- **작업 내용**:
  1. `retry.ts`: §5.7의 `RetryPolicy`(기본 `maxRetries: 2`, 지수 백오프). 재시도 대상은 네트워크/5xx/타임아웃만. `AbortSignal` 발화 시 즉시 중단.
  2. `queue.ts`: steering / follow-up 큐 (`enqueue`/`drain`/`clear`/`hasItems`, 모드 `"all" | "one-at-a-time"`, 기본 `"one-at-a-time"`).
  3. `loop.ts`: §5.3의 루프를 구현. 반드시 지킬 것 —
     - 도구 결과 메시지를 **assistant가 호출한 순서대로** 컨텍스트에 추가(병렬 실행이어도).
     - 도구가 throw하면 잡아서 `isError: true` `toolResult`로 변환(대화를 끊지 않음).
     - 인자 스키마 검증 실패도 같은 방식으로 처리.
     - `executionMode: "sequential"`인 도구는 다른 도구와 동시에 실행하지 않음.
     - 모든 결과가 `terminate: true`면 턴 종료.
     - `AbortSignal`을 도구 `execute`에 그대로 전달.
     - **오버플로우 훅 지점을 미리 만들어 둘 것**: LLM 호출이 `OllamaContextOverflowError`로 실패하면 `hooks.onContextOverflow?.(messages)`를 호출하고, 반환값이 있으면 그 컨텍스트로 **1회 재시도**한다. 없거나 재시도도 실패하면 에러를 올린다. Phase 2에서는 등록된 구현이 없어 그대로 실패하지만, 이 지점이 있어야 Phase 4가 `loop.ts`를 수정하지 않고 오버플로우 복구를 붙일 수 있다(§5.6, §9.5).
  4. `agent.ts`: `FortressAgent` 클래스 — `prompt(text)`, `abort()`, `steer(msg)`, `followUp(msg)`, `subscribe(listener)`, `waitForIdle()`, `state` getter. 훅은 생성자 옵션 + `getRegisteredHooks()` 합성으로 받는다.
- **확인 방법**: 모킹한 `streamChat`으로 (a) 텍스트 전용 응답, (b) 도구 1개 호출 → 결과 → 후속 응답, (c) 도구 2개 병렬 호출 시 결과 순서 보존, (d) 도구 throw 시 대화 지속, (e) `abort()` 시 즉시 종료 — 5가지 시나리오 Vitest.

## P2-04. 시스템 프롬프트 섹션 빌더

- **소유 파일**: `src/lib/prompt/buildSystemPrompt.ts`, `src/lib/prompt/diffSections.ts`
- **작업 내용**: §5.5 구현. `buildSystemPromptSections({agent, tools, contextFiles, skills, cwd})`가 순서 있는 `Record<string, string>`을 반환하고, `preamble`을 제외한 각 섹션은 `<name>…</name>`로 감싼다. **이 Phase에서 `contextFiles`/`skills`/`visualization`은 빈 값으로 들어오지만 슬롯은 미리 만들어 둔다** — Phase 3/5가 이 파일을 수정하지 않고 데이터만 넘길 수 있게 하기 위함(§5.6).
  `diffSections(previous, current)`는 변경/삭제된 섹션만 담은 패치를 반환(삭제는 `null`).
- **확인 방법**: 섹션 순서·태그 래핑·diff 결과(추가/변경/삭제 각각)를 Vitest로 검증.

## P2-05. 읽기 전용 도구: read / ls / grep / find

- **소유 파일**: `src/lib/tools/read.ts`, `ls.ts`, `grep.ts`, `find.ts`, `src/lib/tools/truncate.ts`, `src-tauri/src/commands/search_commands.rs`, `src-tauri/src/commands/mod.rs`(등록 추가), `src-tauri/Cargo.toml`(`ignore`/`regex`/`globset` 의존성 추가), `src-tauri/src/commands/fs_commands.rs`(`list_dir` **추가만**, Phase 1의 기존 함수는 건드리지 않음)
- **작업 내용**:
  1. `truncate.ts`: **줄 수(기본 2000)와 바이트 수(기본 50KB) 이중 상한**, 먼저 걸리는 쪽이 이김. 부분 줄을 반환하지 않음. 절단 시 "총 N줄 중 M줄 표시, X 생략" 마커를 남긴다. (pi `tools/truncate.ts` 참고.)
  2. `read(path, offset?, limit?)`: 줄 번호를 붙여 반환. 도구 `description`에 절단 한도와 "전체가 필요하면 offset을 늘려 이어서 읽으라"를 명시한다. 이미지 파일은 1차 스코프 제외(멀티모달 미지원).
  3. `ls(path)`: `list_dir` 커맨드 사용.
  4. Rust `grep_files(pattern, path, glob, maxResults)`: `ignore::WalkBuilder`(gitignore 존중) + `regex`. 매치 줄은 500자로 자르고 `maxResults` 초과 시 중단. `find_files(pattern, path, maxResults)`: `globset` 기반 파일명 매칭.
  5. 모든 경로 인자는 Rust에서 `workspaceRoot` 하위인지 canonicalize 후 검증(§7 Layer 1). 벗어나면 에러.
  6. 4개 도구 모두 `risk: "low"`.
- **확인 방법**: 절단 로직은 고정 입력 Vitest. Rust 커맨드는 임시 폴더를 만들어 통합 테스트(gitignore가 실제로 존중되는지, 스코프 밖 경로가 거부되는지 반드시 포함).

## P2-06. 변경 도구: write / edit, 그리고 shell / web_search

- **소유 파일**: `src/lib/tools/write.ts`, `edit.ts`, `shell.ts`, `webSearch.ts`, `src-tauri/src/commands/shell_commands.rs`, `src-tauri/src/commands/web_commands.rs`, `src-tauri/src/commands/mod.rs`(등록 추가), `src-tauri/Cargo.toml`(`reqwest`/`scraper` 추가)
- **작업 내용**:
  1. `write(path, content)`: `write_text_file` 래핑. `risk: "high"`, `executionMode: "sequential"`.
  2. `edit(path, oldText, newText)`: read → 문자열 치환 → write. **치환 대상이 0건이거나 2건 이상이면 실패**시키고 "더 긴 고유 문맥을 포함해 다시 시도하라"는 에러를 반환한다(§12). `risk: "high"`, `executionMode: "sequential"`.
  3. Rust `run_shell(command, cwd, timeoutMs)`: Windows는 `powershell -NoProfile -NonInteractive -Command`, 그 외는 `sh -c`. `cwd`는 `workspaceRoot`로 고정. stdout/stderr/exitCode 반환, 타임아웃(기본 120초) 시 강제 종료. 출력은 `truncate`를 거친다. 도구는 `risk: "critical"`.
  4. Rust `web_search(query)`: `reqwest`로 검색 결과 페이지를 가져와 `scraper`로 제목/링크/스니펫 파싱. 일반 브라우저 User-Agent 설정. **파싱 실패·0건이어도 throw하지 않고** "검색 결과를 가져오지 못했습니다"를 반환(§12). `risk: "low"`.
  5. `registry.ts`에 8종을 모두 등록하고, 기본 활성 목록(`read`/`ls`/`grep`/`find`/`write`/`edit`)을 정의(§4.2).
- **확인 방법**: `edit`의 0건/다건 실패 케이스를 Vitest로 검증. `run_shell`은 `echo` 수준 명령으로 수동 확인 + 타임아웃 동작 확인. `web_search`는 HTML 파서 함수만 고정 샘플 HTML로 단위 테스트하고, 실제 네트워크는 수동 1회.

## P2-07. useChat 훅

- **소유 파일**: `src/hooks/useChat.ts`, `src/lib/agent/defaultAgent.ts`
- **작업 내용**:
  1. `defaultAgent.ts`: 이 Phase 전용 하드코딩 Agent 상수(§4.2 타입 준수). 예: `{model: "llama3.1:8b", systemPrompt: "You are Fortress, a helpful local AI assistant.", temperature: 0.7, contextSize: 0, reserveTokens: 0, keepRecentTokens: 0, enabledBuiltinTools: ["read","ls","grep","find","write","edit"], approvalMode: "dangerous-only", …}`. Phase 6에서 저장된 Agent로 교체.
  2. `useChat(sessionId, agent)`가 `FortressAgent`를 만들고 §5.4의 `AgentEvent`만 구독해 React 상태로 옮긴다:
     ```ts
     function useChat(
       sessionId: string,
       agent: Agent,
     ): {
       messages: AgentMessage[];
       isStreaming: boolean;
       contextUsage: { tokens: number; limit: number }; // §9.6 게이지용
       sendMessage: (text: string) => Promise<void>;
       steer: (text: string) => void;
       stop: () => void;
     };
     ```
  3. 이 Phase에서는 `messages`를 메모리 상태로만 관리한다(Phase 4에서 DB 연동으로 교체). **Phase 4가 이 파일을 수정할 수 있도록, 메시지 로드/저장은 `useChat` 안에 인라인하지 말고 주입 가능한 형태(`persistence` 파라미터, 기본값은 인메모리 구현)로 분리해 둘 것.**
- **확인 방법**: Testing Library로 `sendMessage` 호출 시 스트리밍 델타가 누적되고 최종 확정되는지, `stop()`이 즉시 반영되는지 확인(Ollama 모킹).

## P2-08. ChatTab 실동작 연결

- **소유 파일**: `src/components/workspace/ChatTab.tsx`(Phase 1 placeholder 교체), `src/components/chat/MessageList.tsx`, `src/components/chat/MessageBubble.tsx`, `src/components/chat/ChatInput.tsx`, `src/components/chat/ToolCallCard.tsx`, `src/components/chat/ContextGauge.tsx`
- **작업 내용**:
  1. `MessageBubble.tsx`: react-markdown + remark-gfm 렌더링(VivoAcademy `Learn.tsx`의 `ChatMessageContent` 패턴 참고), 역할별 스타일 분기, 복사 버튼.
  2. `ToolCallCard.tsx`: 도구 호출/결과를 접을 수 있는 카드로 표시(도구명, 인자 요약, 실행 상태, 결과 미리보기 + "전체 보기"). `AgentToolResult.details`를 여기서 렌더링한다.
  3. `MessageList.tsx`: `ScrollArea`(shadcn) 안에 목록, 새 메시지 도착 시 자동 스크롤(사용자가 위로 스크롤한 상태면 자동 스크롤 중지 + "맨 아래로" 버튼).
  4. `ChatInput.tsx`: `Textarea` + 전송 버튼. Enter 전송 / Shift+Enter 줄바꿈, **IME 조합 중 전송 방지**(`e.nativeEvent.isComposing` — VivoAcademy 패턴). 스트리밍 중에는 전송 버튼이 "중지"로 바뀌되 **입력창은 비활성화하지 않는다** — 입력 후 Enter는 `steer()`로 주입된다(§5.7).
  5. `ContextGauge.tsx`: 현재 토큰/컨텍스트 한도 게이지(§9.6). 이 Phase에서는 추정치만 표시.
  6. `ChatTab.tsx`가 `useChat`으로 위 컴포넌트를 조립.
- **확인 방법**: 앱에서 스트리밍 응답이 실시간 표시되는지, 중지가 동작하는지, 스트리밍 중 입력한 메시지가 현재 턴 종료 후 주입되는지 수동 확인.

## P2-09. 에러 처리 / 재시도 UI

- **소유 파일**: `src/components/chat/ErrorBanner.tsx`, `src/hooks/useChat.ts`(P2-07 파일에 에러 상태 추가), `src/lib/llm/ollamaClient.ts`(P2-01 파일에 에러 타입 보강)
- **작업 내용**: P2-01의 에러 타입별로 구분된 메시지를 **에러 전용 배너 + "재시도" 버튼**으로 표시한다(어시스턴트 말풍선을 에러 텍스트로 대체하지 않음). 자동 재시도(P2-03 `retry.ts`)가 이미 소진된 뒤의 최종 실패만 배너로 올라온다 — 자동 재시도 중임은 스트리밍 표시기에 "재시도 중 (2/3)"으로 나타낸다. 선택한 모델이 tool-calling을 지원하지 않으면 경고 배지를 표시한다(§5.8).
- **확인 방법**: Ollama를 끈 상태에서 전송 → 자동 재시도 표시 → 최종 배너 → Ollama를 켜고 재시도 성공.

---

## Phase 2 완료 조건

- [ ] Ollama가 켜져 있을 때, 채팅 탭에서 실시간 스트리밍 응답을 받을 수 있다.
- [ ] 중지 버튼이 동작하고, 실행 중인 도구에도 취소가 전달된다.
- [ ] 스트리밍 중 입력한 메시지가 현재 턴 종료 후 주입된다(steering).
- [ ] LLM이 `read`/`ls`/`grep`/`find`/`write`/`edit`를 호출할 수 있고, 도구 카드로 결과가 표시된다(즉시 실행, 승인 없음 — Phase 5에서 승인 추가 예정).
- [ ] 도구 출력이 2000줄/50KB 상한으로 절단되고 절단 사실이 표시된다.
- [ ] 워크스페이스 밖 경로에 대한 도구 호출이 Rust 레이어에서 거부된다.
- [ ] 도구가 실패해도 대화가 이어진다.
- [ ] Ollama 연결 실패 시 자동 재시도 후 명확한 에러 배너와 재시도 버튼이 뜬다.
- [ ] `src/lib/agent/hooks.ts`와 `hookRegistry.ts`가 `Docs/Architecture.md` §5.6대로 구현되어 있고, Phase 4/5가 수정 없이 훅을 등록할 수 있다.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 통과.
- [ ] `Docs/TODO.md`의 Phase 2 항목이 모두 `[x]`다.
