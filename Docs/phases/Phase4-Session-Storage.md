# Phase 4 — Session Storage & Context Compaction

**목표**: 채팅 세션을 SQLite에 append-only 엔트리로 영구 저장하고, 앱 재시작 후에도 대화 기록과 열려 있던 탭이 복원되게 한다. 또한 컨텍스트가 임계값을 넘으면 자동으로 요약·압축한다.

**선행 조건**: Phase 2 완료. (Phase 3, 5와 병렬 진행 가능 — `Docs/ImplementationPlan.md`의 "병렬 진행 조건" 참고)

**공통 참고**: `Docs/Architecture.md` §4.3(ChatSession/Entry — **필독**), §5.6(확장점 규약), §9(컨텍스트 자동 압축 — **전체 필독**).

**pi 참고**: `..\pi\packages\agent\src\harness\compaction\{compaction.ts,utils.ts}`, `..\pi\packages\coding-agent\docs\compaction.md`(산문 설명), `..\pi\packages\coding-agent\docs\session-format.md`. **코드를 복사하지 말고 알고리즘만 재구현할 것.**

> 📌 **초안 대비 변경**: ① `messages(role, content TEXT)` 정규화 테이블 → **엔트리 기반 스키마**(§4.3). ② 압축 트리거가 "75% 비율" → `contextSize - reserveTokens`(§9.1, 기본 파생식이 정확히 75%가 되도록 설계됨). ③ `js-tiktoken` → **Ollama 실측 usage**(§9.2). ④ **P4-07(LangGraph Checkpointer) 삭제** — `interrupt()` 재개가 없어졌으므로 불필요(§5.0).

---

## P4-01. tauri-plugin-sql 통합 + 마이그레이션

- **소유 파일**: `src-tauri/Cargo.toml`(sql 플러그인 의존성 추가), `src-tauri/src/lib.rs`(플러그인 등록 라인만 추가), `src/lib/db/migrations/0001_init.sql`, `package.json`(`@tauri-apps/plugin-sql` 추가만)
- **작업 내용**:
  1. `pnpm add @tauri-apps/plugin-sql`, Rust `tauri-plugin-sql` 크레이트 추가, `sqlite:fortress.db`로 앱 데이터 디렉터리에 DB 생성.
  2. `0001_init.sql`:
     ```sql
     CREATE TABLE agents (
       id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
       system_prompt TEXT NOT NULL, model TEXT NOT NULL,
       temperature REAL NOT NULL DEFAULT 0.7,
       context_size INTEGER NOT NULL DEFAULT 0,        -- 0 = 전역값 상속
       reserve_tokens INTEGER NOT NULL DEFAULT 0,      -- 0 = context_size에서 파생 (§9.1)
       keep_recent_tokens INTEGER NOT NULL DEFAULT 0,  -- 0 = 파생
       enabled_skills TEXT NOT NULL DEFAULT '[]',         -- JSON array
       enabled_builtin_tools TEXT NOT NULL DEFAULT '[]',  -- JSON array
       approval_mode TEXT NOT NULL DEFAULT 'dangerous-only',
       is_default INTEGER NOT NULL DEFAULT 0,
       created_at TEXT NOT NULL, updated_at TEXT NOT NULL
     );

     CREATE TABLE sessions (
       id TEXT PRIMARY KEY,
       agent_id TEXT NOT NULL REFERENCES agents(id),
       workspace_root TEXT,
       title TEXT NOT NULL,
       created_at TEXT NOT NULL, updated_at TEXT NOT NULL
     );

     -- append-only. UPDATE/DELETE 하지 않는다 (세션 삭제 시 CASCADE 제외).
     CREATE TABLE entries (
       id TEXT PRIMARY KEY,                            -- UUIDv7
       session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
       parent_id TEXT,                                 -- 선형 체인 (브랜치는 향후 확장)
       seq INTEGER NOT NULL,                           -- 세션 내 단조 증가
       type TEXT NOT NULL,                             -- 'message' | 'compaction' | 'custom'
       payload TEXT NOT NULL,                          -- JSON (§4.3)
       created_at TEXT NOT NULL
     );
     CREATE UNIQUE INDEX idx_entries_session_seq ON entries(session_id, seq);

     CREATE TABLE app_settings (
       id TEXT PRIMARY KEY DEFAULT 'singleton',
       open_tabs TEXT NOT NULL DEFAULT '[]', active_tab_id TEXT,
       theme TEXT NOT NULL DEFAULT 'dark', language TEXT NOT NULL DEFAULT 'ko',
       ollama_base_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:11434',
       default_context_size INTEGER NOT NULL DEFAULT 8192,
       default_approval_mode TEXT NOT NULL DEFAULT 'dangerous-only',
       trusted_workspaces TEXT NOT NULL DEFAULT '[]',   -- JSON array (Phase 3에서 localStorage로 쓰던 것을 이관)
       last_workspace_root TEXT
     );
     ```
- **확인 방법**: 앱 최초 실행 시 마이그레이션이 자동 적용되고 DB 파일이 생성되는지 확인.

## P4-02. Repository 계층

- **소유 파일**: `src/lib/db/client.ts`, `src/lib/db/repositories/{sessionsRepo,entriesRepo,agentsRepo,settingsRepo}.ts`
- **작업 내용**: `client.ts`는 `Database.load("sqlite:fortress.db")`를 감싼 싱글턴. 각 repo는 CRUD를 제공하며 **SQL 인젝션 방지를 위해 반드시 파라미터 바인딩(`?`)** 사용.
  - `entriesRepo`: `appendEntries(sessionId, entries[])`(하나의 트랜잭션에서 seq를 연속 할당), `getEntries(sessionId)`, `getLastCompaction(sessionId)`. **UPDATE/DELETE 함수를 만들지 않는다**(append-only 불변식을 API로 강제).
  - `agentsRepo`: §4.2의 `isDefault` 불변식 로직 포함(최초 생성 시 자동 기본, 기본 삭제 시 다음 Agent 승격 — VivoAcademy `external-agents.ts`의 `is_ai_tutor` 패턴).
  - `settingsRepo`: 단일 행 upsert.
- **확인 방법**: Vitest로 각 repo의 CRUD와 `isDefault` 불변식(생성/삭제/승격)을 검증(임시 DB 파일 사용). `appendEntries`가 동시 호출돼도 seq가 겹치지 않는지 확인.

## P4-03. 컨텍스트 재구성

- **소유 파일**: `src/lib/db/buildContext.ts`
- **작업 내용**: `Docs/Architecture.md` §4.3의 재구성 규칙 구현.
  ```ts
  buildLlmContext(entries: Entry[]): AgentMessage[]   // LLM에 보낼 것
  buildUiTimeline(entries: Entry[]): TimelineItem[]   // UI에 보여줄 것 (전체 + 압축 배너)
  ```
  1. `seq` 오름차순 정렬.
  2. 마지막 `compaction` 엔트리를 찾고, 없으면 모든 `message` 엔트리가 컨텍스트.
  3. 있으면 `[요약 메시지] + (firstKeptEntryId 이후의 message 엔트리)`.
  4. `custom` 엔트리는 LLM 컨텍스트에서 제외, UI 타임라인에는 포함.
  5. **불변식 검증**: 결과에 `toolCalls`가 있는 assistant 메시지 뒤에 대응하는 `toolResult`가 반드시 따라오는지 확인. 깨져 있으면(데이터 손상) 해당 assistant 메시지의 `toolCalls`를 제거하고 경고 로그를 남긴다 — 요청이 실패하는 것보다 낫다.
- **확인 방법**: 압축 없음 / 압축 1회 / 압축 2회 / toolCall-toolResult 쌍이 깨진 데이터 — 4가지 케이스 Vitest.

## P4-04. ChatSessionsContext + ChatSessionList 실동작

- **소유 파일**: `src/lib/context/ChatSessionsContext.tsx`, `src/components/chatsessions/ChatSessionList.tsx`(Phase 1 placeholder 교체)
- **작업 내용**: 세션 목록 조회/생성/삭제/제목 자동 생성(최초 사용자 메시지 앞 30자). `ChatSessionList`는 세션 카드 목록, 클릭 시 해당 세션의 `chat` 탭을 열거나 이미 열려 있으면 포커스(`openTab({type:"chat", id:`chat:${sessionId}`, meta:{sessionId}})`). 세션 삭제는 확인 다이얼로그 후 엔트리까지 CASCADE 삭제.
- **확인 방법**: 새 세션 생성 → 목록 표시 → 클릭 시 탭 전환 → 삭제 시 목록/탭에서 제거.

## P4-05. useChat ↔ DB 연결 + 탭 상태 영속화

- **소유 파일**: `src/hooks/useChat.ts`(P2-07이 만든 `persistence` 주입점에 SQLite 구현을 연결 — **인터페이스는 이미 있으므로 구현체만 교체**), `src/lib/db/sqlitePersistence.ts`(신규), `src/lib/context/WorkspaceTabsContext.tsx`(Phase 1 파일의 `// TODO(Phase4)` 위치에 영속화 구현)
- **작업 내용**:
  1. `sqlitePersistence.ts`: `load(sessionId)` → `buildContext`로 메시지 복원. `appendTurn(sessionId, messages)` → 턴 종료 시 assistant/toolResult 엔트리를 한 트랜잭션으로 기록. 사용자 메시지는 전송 즉시 별도 기록(§4.3 영속화 시점).
  2. **스트리밍 중간 상태는 저장하지 않는다.** `stopReason`이 `aborted`/`error`인 assistant 메시지도 저장하지 않는다(§8.3의 한계를 그대로 따름).
  3. `WorkspaceTabsContext`: 탭 목록/활성 탭 ID를 `app_settings`에 500ms 디바운스 저장, 앱 시작 시 복원(VivoStudio 패턴 재구현, 단 Fortress는 모든 탭 타입을 복원 대상으로 함 — §3.3).
  4. Phase 3가 `localStorage`에 두었던 신뢰 워크스페이스 목록을 `app_settings.trusted_workspaces`로 이관한다(Phase 3가 완료되어 있지 않으면 이 항목은 건너뛰고 `Docs/TODO.md` 이슈에 기록).
- **확인 방법**: 대화 후 앱을 완전히 종료했다가 다시 실행하면 열려 있던 탭과 대화 내용이 그대로 복원되는지 확인. 스트리밍 도중 강제 종료 시 마지막 완료 턴까지만 복원되는지도 확인(의도된 동작).

## P4-06. 토큰 추정

- **소유 파일**: `src/lib/compaction/estimate.ts`, `src/lib/compaction/settings.ts`
- **작업 내용**:
  1. `settings.ts`: §9.1의 예산 해석. `resolveCompactionSettings(agent, globalDefaults)` → `{contextSize, reserveTokens, keepRecentTokens}`. 0인 값은 파생식 `clamp(contextSize*0.25, 1024, 16384)` / `clamp(contextSize*0.35, 1024, 20000)` 적용. `contextSize`가 0이면 `POST /api/show`(P2-01)로 모델의 컨텍스트 길이를 조회하고, 실패하면 전역 기본값을 쓴다.
  2. `estimate.ts`: §9.2 구현. **`js-tiktoken`을 설치하지 않는다.**
     - 뒤에서부터 훑어 가장 최근 assistant 메시지의 `usage.total`을 찾는다. `stopReason`이 `aborted`/`error`면 건너뛴다.
     - 그 이후 메시지만 `ceil(chars/4)`로 추정해 더한다. 이미지 콘텐츠는 1차 스코프에서 없음.
     - usage가 하나도 없으면 전량 휴리스틱.
     - 반환: `{tokens, usageTokens, trailingTokens, lastUsageIndex}`.
  3. `shouldCompact(contextTokens, contextSize, settings): boolean` → `contextTokens > contextSize - reserveTokens`.
- **확인 방법**: usage 있음/없음/중간에 error 메시지 포함 케이스로 추정값이 기대 범위인지 Vitest. `shouldCompact`의 경계값(정확히 임계값일 때 false)도 확인.

## P4-07. 컷 포인트 + 대화 직렬화

- **소유 파일**: `src/lib/compaction/cutPoint.ts`, `src/lib/compaction/serialize.ts`
- **작업 내용**:
  1. `cutPoint.ts`: §9.3 구현.
     - `findValidCutPoints(messages)`: `user`/`assistant` 메시지의 인덱스만. **`toolResult`는 절대 포함하지 않는다.**
     - `findCutPoint(messages, startIndex, keepRecentTokens)`: 최신부터 역순 누적해 예산 도달 지점을 찾고, 그 이후의 가장 가까운 유효 컷 포인트를 고른다.
     - 컷 지점이 `user`가 아니면 **해당 턴의 시작(`user` 메시지)까지 앞당긴다**(1차 스코프 단순화 — pi의 split-turn 2단 요약은 §13으로 미룸).
     - 이전 압축이 있으면 요약 구간의 시작은 **이전 압축의 `firstKeptEntryId`**(압축 엔트리 자체가 아님).
  2. `serialize.ts`: §9.4의 직렬화 형식(`[User]:` / `[Assistant thinking]:` / `[Assistant]:` / `[Assistant tool calls]:` / `[Tool result]:`). **`[Tool result]`는 2000자로 절단**하고 "N자 생략" 마커를 남긴다. 도구 호출은 `name(arg="value", …)` 형태로 요약.
  3. `extractFileOps(messages, previousDetails)`: 도구 호출에서 읽은/수정한 파일 경로를 뽑고 **이전 압축의 `details`와 합집합**을 취한다(§9.4).
- **확인 방법**: assistant→toolResult 쌍 사이에서 절대 잘리지 않는지, 예산이 아주 작을 때/아주 클 때 경계 동작, 이전 압축이 있을 때 시작점이 `firstKeptEntryId`인지 — Vitest. 직렬화는 고정 입력으로 스냅샷 테스트.

## P4-08. compact() + 훅 등록 + 오버플로우 복구

- **소유 파일**: `src/lib/compaction/compact.ts`, `src/lib/compaction/prompts.ts`, `src/lib/compaction/register.ts`, `src/lib/agent/bootstrap.ts`(**import 한 줄만 추가** — §5.6)
- **작업 내용**:
  1. `prompts.ts`: §9.4의 요약 시스템 프롬프트와 고정 출력 포맷(Goal / Constraints & Preferences / Progress(Done·In Progress·Blocked) / Key Decisions / Next Steps / Critical Context + `<read-files>`·`<modified-files>`), 그리고 **증분 업데이트용 프롬프트**(`<previous-summary>`를 주고 "기존 정보 보존 + In Progress→Done 이동"을 지시). "대화를 이어가지 말고 요약만 출력하라", "파일 경로·함수명·에러 메시지는 원문 그대로 보존하라"를 반드시 포함.
  2. `compact.ts`: `prepareCompaction(entries, settings)` → `{messagesToSummarize, firstKeptEntryId, previousSummary, fileOps, tokensBefore}`. `compact(preparation, model, reason, customInstructions?)` → 요약 LLM 호출(도구 바인딩 없이, 같은 Ollama 모델) 후 `CompactionEntry`를 만들어 `entriesRepo.appendEntries`로 저장. `reason`은 `"manual" | "threshold" | "overflow"`.
  3. `register.ts`: `registerHooks("compaction", { transformContext })`. `transformContext`는 §9.5의 검사 지점 ①②를 담당 — 매 LLM 호출 직전에 `shouldCompact`를 확인하고 필요하면 압축한 뒤 재구성된 컨텍스트를 반환한다.
  4. **오버플로우 복구**(§9.5): P2-03이 만들어 둔 `onContextOverflow` 훅 지점에 구현을 등록한다 — `reason: "overflow"`로 압축한 뒤 재구성된 컨텍스트를 반환하면 루프가 그 턴을 1회 재시도한다. **`loop.ts`를 수정하지 않는다.**
  5. `custom` 엔트리(`customType: "compaction_notice"`)를 함께 저장하고 `compaction_start`/`compaction_end` 이벤트를 발생시킨다.
  6. `bootstrap.ts`에 `import "../compaction/register";` 한 줄 추가.
- **확인 방법**: 모킹한 LLM으로 (a) 임계값 초과 시 압축 트리거, (b) 압축 후 컨텍스트가 `[요약 + 최근 구간]`으로 재구성, (c) 2회 압축 시 증분 프롬프트 사용 및 `details.readFiles` 누적, (d) 오버플로우 에러 시 압축+재시도 — Vitest. 수동으로는 `contextSize`를 작게(예: 2048) 설정한 테스트 Agent로 긴 대화를 진행해 압축이 트리거되고 대화가 이어지는지 확인.

## P4-09. 압축 UI

- **소유 파일**: `src/components/chat/CompactionBanner.tsx`, `src/components/chat/ContextGauge.tsx`(P2-08 파일에 실측값 연결 **추가**), `src/components/chat/ChatInput.tsx`(P2-08/P3-08 파일에 `/compact` 명령 **추가**)
- **작업 내용**: §9.6 구현. 압축 배너("대화 기록이 요약되었습니다 (N → M 토큰)", 클릭 시 요약 전문 펼침), 컨텍스트 게이지에 실측 토큰 반영(임계값 근접 시 색상 경고), `/compact [지시사항]` 수동 압축 명령.
- **확인 방법**: 압축 발생 시 배너가 타임라인의 올바른 위치에 뜨고, 원본 메시지가 위로 스크롤하면 그대로 보이는지 확인. `/compact`가 동작하는지 확인.

---

## Phase 4 완료 조건

- [ ] 대화 내용이 SQLite 엔트리로 저장되고 앱 재시작 후에도 유지된다.
- [ ] assistant 메시지의 `toolCalls`·`usage`·`stopReason`이 손실 없이 저장/복원된다.
- [ ] 열려 있던 탭이 재시작 후 복원된다.
- [ ] 컨텍스트가 `contextSize - reserveTokens`를 넘으면 자동으로 요약되고 대화가 계속된다.
- [ ] 압축 후에도 UI에서는 **원본 대화 전체**를 스크롤해서 볼 수 있다(원본 미삭제).
- [ ] 반복 압축 시 이전 요약을 증분 업데이트하고, 파일 조작 목록이 누적된다.
- [ ] 압축 컷 지점이 `toolCall`과 `toolResult` 사이를 절대 가르지 않는다(단위 테스트로 보장).
- [ ] 컨텍스트 오버플로우 에러 시 자동 압축 후 재시도한다.
- [ ] `/compact`로 수동 압축할 수 있고, 컨텍스트 게이지가 실측값을 표시한다.
- [ ] `js-tiktoken`·`@langchain/*`이 의존성에 없다.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 통과.
- [ ] `Docs/TODO.md`의 Phase 4 항목이 모두 `[x]`다.
