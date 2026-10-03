# Vanilla Commander 아키텍처 설계서

> 이 문서는 [ImplementationPlan.md](./ImplementationPlan.md)의 모든 Phase 작업이 공통으로 참조하는 **단일 진실 공급원(Source of Truth)**입니다.
> 어떤 Phase/작업을 담당하는 에이전트든, 구현을 시작하기 전에 이 문서 전체를 읽어야 합니다.
> 이 문서와 개별 Phase 문서가 충돌하면 **이 문서가 우선**합니다. (충돌을 발견하면 작업을 멈추고 `Docs/TODO.md`의 "이슈" 섹션에 기록하십시오.)

## 0. 한눈에 보는 요약

- **앱 이름**: Vanilla Commander (구 Fortress — 로컬 LLM 워크벤치에서 파일 커맨더로 전환, Phase 11)
- **형태**: Tauri 2 기반 데스크탑 앱 (Windows 우선, macOS/Linux는 추후 고려)
- **프런트엔드**: React 19 + TypeScript(strict) + Vite 7
- **UI 시스템**: shadcn/ui("new-york") + Radix UI + Tailwind CSS 3 + lucide-react 아이콘
- **레이아웃 참고**: `VivoStudio` (좌측 아이콘 사이드바 + 좌측 리사이저블 패널 + 우측 탭 콘텐츠 영역 + 파일 뷰어 + 하단 StatusBar)
- **에이전트 관리/채팅 참고**: `VivoAcademy`의 "에이전트 관리" 메뉴 및 강좌 화면 채팅 UI (단, Vanilla Commander는 **파일 탐색기 탭이 기본**이며 채팅·에이전트·위키·매크로가 이를 보조)
- **에이전트 런타임 참고**: `pi`([earendil-works/pi](https://github.com/earendil-works/pi), 로컬 체크아웃 `..\pi`) — 루프/도구/압축/스킬/세션 설계의 기준 (§1.3)
- **LLM 실행**: Ollama(로컬) + OpenAI 호환 런타임 + 외부 에이전트 CLI + **자체 에이전트 루프**(TypeScript, 렌더러 프로세스에서 직접 실행). LangGraph.js 그래프 모델은 채택하지 않음 (§5.0)
- **저장소**: SQLite (`tauri-plugin-sql`) — append-only 엔트리 기반 세션/에이전트/설정 + 위키·매크로 테이블 (§4.3, §4.5)
- **패키지 매니저**: pnpm
- **Git**: `https://github.com/godstale/VanillaCommander.git` (origin)

---

## 1. 참고 프로젝트에서 가져오는 것 / 가져오지 않는 것

### 1.1 VivoStudio에서 가져오는 패턴 (UI 레이아웃)

리서치 결과(에이전트 조사 완료, 2026-09-18) 기준으로 아래 패턴을 **동일한 방식으로 재사용**합니다.

| 영역                                        | VivoStudio 참고 파일                                                                                                          | 대응 위치                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 좌측 아이콘 사이드바                        | `src/components/layout/ActivityBar.tsx`                                                                                       | `src/components/layout/ActivityBar.tsx`                                                                                |
| 좌측 리사이저블 패널 + 접기/펼치기          | `src/components/layout/WorkspaceLayout.tsx` (react-resizable-panels, `ImperativePanelHandle`)                                 | `src/components/layout/WorkspaceLayout.tsx`                                                                            |
| 좌측 패널 콘텐츠 라우팅                     | `src/components/explorer/ExplorerPanel.tsx`                                                                                   | `src/components/sidepanel/SidePanel.tsx`                                                                               |
| 우측 탭 바 + 탭 콘텐츠 라우팅               | `src/components/workspace/CenterWorkspace.tsx`                                                                                | `src/components/workspace/CenterWorkspace.tsx`                                                                         |
| 탭 상태 관리(Context, 멱등 openTab, 영속화) | `src/lib/context/WorkspaceTabsContext.tsx`                                                                                    | `src/lib/context/WorkspaceTabsContext.tsx`                                                                             |
| 파일 트리 탐색기                            | `src/components/explorer/FileTree.tsx`                                                                                        | 프로젝트 트리 개념 폐지(D2). 대신 `FileExplorerTab`(커맨더 탭) + `ExplorerPanel`(탭 목록·즐겨찾기·시스템 폴더) |
| 이미지 뷰어 탭                              | `src/components/workspace/ImageViewerTab.tsx` (`convertFileSrc` + 줌)                                                         | `src/components/workspace/ImageViewerTab.tsx`                                                                          |
| 텍스트 파일 편집 탭                         | `src/components/workspace/EditorTab.tsx` (textarea 기반, autosave)                                                            | `src/components/workspace/EditorTab.tsx` (단, **CodeMirror 6로 실제 문법 강조 추가** — VivoStudio는 없었음, 개선 사항) |
| Context per concern 상태관리                | `src/lib/context/*`                                                                                                           | `src/lib/context/*`                                                                                                    |
| 다크 우선 테마(CSS 변수)                    | `src/index.css`, `ThemeContext.tsx`                                                                                           | 동일 + **Midnight Rampart 디자인 시스템**(`design/` 토큰·프리셋, 규칙은 `DESIGN.md`)                                   |
| Tauri IPC 파일 커맨드 네이밍                | `read_text_file`, `write_text_file`, `read_project_folder_tree`, `create_file`, `create_folder`, `rename_path`, `delete_path` | 동일한 커맨드명 재사용 (일관성 유지)                                                                                   |

**가져오지 않는 것**: VivoStudio의 "fake Supabase" DB 클라이언트, 강좌(Course) 관련 기능, TTS, 3D/애니메이션 카드 렌더러. 스플릿 탭·CLI 에이전트 연동은 Phase 11에서 도입했으므로 제외 목록에서 빠진다.

### 1.2 VivoAcademy에서 가져오는 패턴 (에이전트 관리 UI + 채팅)

| 영역                                            | VivoAcademy 참고 파일                                                                         | 가져오는 것                                                                                                                          | 가져오지 않는 것                                                                                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 에이전트 목록/생성/수정/삭제 UI 구조            | `src/pages/Agents.tsx`, `AddAgentModal.tsx`, `AgentDetail.tsx`, `AgentSettingsTab.tsx`        | 카드 그리드 목록, 생성 다이얼로그의 단계형 폼 UX, 상세 페이지의 탭(통계/대화/설정) 구조, 삭제 확인 다이얼로그, 빈 상태 CTA           | "연결 프로필"(endpoint/apiKey/harness) 데이터 모델 자체는 미사용 — Fortress의 Agent는 **로컬 LLM 페르소나/프리셋**이므로 데이터 모델은 새로 정의 (§4.2)   |
| 채팅 UI 골격                                    | `src/pages/Learn.tsx`의 AI 튜터 탭                                                            | 메시지 리스트+입력창 레이아웃, react-markdown+remark-gfm 렌더링, 복사 버튼, 스트리밍 델타 반영 방식, 컨텍스트 압축 트리거 개념       | 강좌/체크포인트/카드 컨텍스트 주입 로직, 페이지-로컬 구현 방식(대신 공용 `useChat` 훅으로 재구성 — VivoAcademy 자체에도 없던 것을 Fortress에서 새로 만듦) |
| 스트리밍 아키텍처                               | `src/lib/agent/client.ts`의 `sendAgentChat` (요청-스코프 이벤트 리스너 → 최종 메시지 resolve) | **인터페이스 형태**만 참고. Fortress는 Ollama `/api/chat`을 프런트엔드에서 직접 스트리밍하고, UI는 §5.4의 `AgentEvent` 스트림만 구독 | Rust SSE 파서 자체는 불필요(로컬 LLM 호출은 JS에서 직접)                                                                                                  |
| 히든 메시지 시그널링(`<!-- HIDDEN_MESSAGE -->`) | 두 채팅 화면 모두                                                                             | **가져오지 않음.** Fortress는 Ollama의 정식 tool-calling과 §5.4의 구조화된 이벤트를 사용                                             |

**중요한 설계 차이 (사용자 확정 사항)**: VivoAcademy의 "Agent"는 외부 서버 연결 프로필이지만, Vanilla Commander의 "Agent"는 **단일 공용 에이전트 런타임에 주입되는 설정값(페르소나/프리셋)**입니다. 즉 Agent마다 별도의 런타임을 만들지 않고, 하나의 `VanillaAgent` 인스턴스가 `systemPrompt`, `model`, `enabledSkills`, `enabledBuiltinTools`, `temperature`, `contextSize` 등의 설정을 파라미터로 받아 동작합니다. (§4.2, §5). 외부 에이전트(`llmProvider: 'external-agent'`, Phase 11)만 예외로, 우리 루프 대신 CLI 1회 실행으로 동작합니다 (§5.9).

### 1.3 pi에서 가져오는 패턴 (에이전트 런타임)

`pi`는 프로덕션에서 쓰이는 TypeScript 에이전트 하네스이며, 만들려는 것과 구조가 가장 가깝습니다. **코드를 복사하지 않고 설계만 재구현**합니다(라이선스는 MIT이나 의존성 스택이 다름 — `AGENTS.md` 참고).

| 영역                    | pi 참고 위치                                                                                      | 가져오는 것                                                                                                                                                                                                                      | 가져오지 않는 것                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 에이전트 루프 + 확장 훅 | `packages/agent/src/types.ts`(`AgentLoopConfig`), `src/agent.ts`(`Agent`)                         | `beforeToolCall`/`afterToolCall`/`transformContext`/`shouldStopAfterTurn`/`prepareNextTurn` 콜백 구조, steering/follow-up 큐, `abort()`, 이벤트 스트림 이름                                                                                 | `Context`/telemetry 전파, 멀티 프로바이더 추상화(`packages/ai`)                                                             |
| 내구성 런타임           | `packages/agent/docs/harness.md` (operation state machine, 3-store)                               | **개념만** — "턴 경계에서만 영속화한다"는 원칙                                                                                                                                                                                              | 트랜잭션 단위 재시작점, intent/settlement 2-commit, 크래시 복구, 브랜치 트리. 단일 사용자 데스크탑 앱이므로 과잉 |
| 컨텍스트 압축           | `packages/agent/src/harness/compaction/compaction.ts`, `packages/coding-agent/docs/compaction.md` | 트리거식(`reserveTokens`), usage 기반 토큰 추정, `keepRecentTokens` 컷 포인트 탐색, toolResult 분리 금지, 구조화 요약 포맷, 증분(previousSummary) 업데이트, 파일 조작 누적 추적, overflow 복구                                              | 브랜치 요약(`/tree`), split-turn 2단 요약(1차 스코프 제외, §13)                                                             |
| 스킬                    | `packages/coding-agent/src/core/skills.ts`, `docs/skills.md`                                      | [Agent Skills 표준](https://agentskills.io/specification) 준수 — SKILL.md 스캔, frontmatter 검증, 이름 충돌 처리, `<available_skills>` XML 프롬프트 노출, **프로그레시브 디스클로저**(도구가 아니라 `read`로 로드), `/skill:name` 명시 호출 | 패키지(`pi.skills`) 소스, 확장(extension) 시스템                                                                            |
| AGENTS.md               | `packages/coding-agent/src/core/resource-loader.ts` (`loadProjectContextFiles`)                   | 후보 파일명 순서, **조상 디렉터리 계층 수집**, 루트→cwd 병합 순서                                                                                                                                                                           | git worktree 그림자 처리(워크스페이스 1개만 염두)                                                                  |
| 시스템 프롬프트         | `packages/coding-agent/src/core/system-prompt.ts`                                                 | 순서 있는 **섹션 맵** + `diffSystemPromptSections()` 부분 갱신                                                                                                                                                                              | pi 자체 문서 섹션                                                                                                           |
| 도구 세트               | `packages/coding-agent/src/core/tools/`                                                           | `read`(offset/limit + 줄번호) / `write` / `edit`(부분 치환) / `ls` / `grep` / `find` / 셸, 출력 이중 상한 절단(`truncate.ts`)                                                                                                               | `powershell`/`bash` 이원화(단일 `shell` 도구로 OS별 분기), 파일 변경 큐                                          |
| 세션 저장               | `packages/coding-agent/docs/session-format.md`, `harness.md` Part 1–2                             | append-only **엔트리**(`message`/`compaction`/`custom`) + `parent_id` + JSON payload, `firstKeptEntryId`로 압축 경계 표현                                                                                                                   | JSONL 백엔드, 값/리스트 스토어, usage ledger, 브랜치 인덱스                                                                 |

**pi에서 의도적으로 가져오지 않는 가장 큰 것**: pi의 harness는 "프로세스가 임의 시점에 죽어도 정착된 부수효과를 반복하지 않는" 내구성을 위해 스토리지 트랜잭션 단위의 상태 기계를 갖습니다. 단일 사용자 로컬 데스크탑 앱이므로 이 비용을 지불하지 않고, **턴 경계에서만 엔트리를 영속화**합니다. 그 대가로 "스트리밍/도구 실행/승인 대기 중 앱이 강제 종료되면 해당 턴은 폐기되고 마지막 완료 턴까지만 복원된다"는 한계를 받아들입니다 (§4.3, §8.3에 명시).

---

## 2. 전체 디렉터리 구조 (목표 상태)

Phase 0에서 골격을 만들고, 이후 Phase에서 하위 폴더를 채워 나갑니다. **각 Phase 문서는 자신이 새로 만드는 파일/폴더만 명시하며, 아래 트리는 최종 완성 모습입니다.**

```
VanillaCommander/
├── AGENTS.md
├── CLAUDE.md
├── .gitignore
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts             # design/tailwind.preset.ts 를 preset으로 사용
├── DESIGN.md                      # 디자인 시스템(색·타이포·포팅 가이드)
├── design/                        # tokens.json(단일 진실 공급원), build-theme.mjs, theme.css, tailwind.preset.ts
│   └── brand/                     # 로고 SVG 패밀리 + build-brand.mjs (DESIGN.md §9)
├── public/favicon.svg
├── postcss.config.mjs
├── components.json                # shadcn/ui 설정
├── index.html
├── Docs/
│   ├── FortressPlan.txt           # 최초 리서치 메모 (수정 금지, 읽기 전용 이력)
│   ├── Architecture.md            # 본 문서
│   ├── ImplementationPlan.md      # 마스터 로드맵
│   ├── TODO.md                    # 진행상황 체크리스트 (전 Phase 공용)
│   └── phases/
│       ├── Phase0-Foundation.md
│       ├── Phase1-Shell-UI.md
│       ├── Phase2-Agent-Runtime.md
│       ├── Phase3-Skills-Agents-Loader.md
│       ├── Phase4-Session-Storage.md
│       ├── Phase5-Visualization-HITL.md
│       ├── Phase6-Agent-Management-UI.md
│       ├── Phase7-Polish-QA.md
│       ├── Phase10-Evaluation.md      # 자동 평가 — 폐기됨(Vanilla 전환, P11-03)
│       ├── Phase10-Eval-Packs.md      # 평가 팩 — 폐기됨(P11-03)
│       └── Phase11-VanillaCommander.md # 파일 커맨더 전환 계획 (유효)
│   └── plan/
│       ├── LLM_Evaluation_Plan.md     # 자동 평가 기획서 — 폐기됨(P11-03)
│       ├── LLM_Evaluation_Research.md # 평가 방법론 조사 — 참고용 보존
│       └── Multiple_LLM_Providers.md  # 멀티 프로바이더 리서치
├── src/
│   ├── main.tsx
│   ├── App.tsx                     # HashRouter, Provider 조합
│   ├── index.css
│   ├── pages/
│   │   └── Settings/                # 전체 화면 라우트 (탭이 아님, VivoStudio Settings 패턴)
│   │       ├── SettingsLayout.tsx
│   │       ├── SettingsGeneral.tsx     # 언어/테마/작업 폴더/허용 폴더/위저드 재실행/감사 로그
│   │       ├── SettingsParsers.tsx     # 문서 파싱 연동 (§17 파서 등록·테스트)
│   │       └── SettingsUpdate.tsx      # 버전 표시 + 준비 중 안내
│   ├── components/
│   │   ├── brand/
│   │   │   └── AppMark.tsx             # 앱 로고(인라인 SVG, currentColor)
│   │   ├── layout/
│   │   │   ├── ActivityBar.tsx          # 좌측 아이콘 사이드바 (탐색기·채팅·에이전트·위키·매크로 + 설정)
│   │   │   ├── WorkspaceLayout.tsx      # 좌/우 리사이저블 스플릿
│   │   │   ├── StatusBar.tsx            # 하단 상태바 (슬롯 publish/clear)
│   │   │   └── TitleBar.tsx             # 커스텀 타이틀바(선택)
│   │   ├── sidepanel/
│   │   │   └── SidePanel.tsx            # activeView에 따라 5개 패널 라우팅
│   │   ├── explorer/
│   │   │   ├── FileExplorerTab.tsx      # 파일 커맨더 탭 컨테이너 (툴바·트리·분할 창·상태바·채팅 도크)
│   │   │   ├── ExplorerPane.tsx         # 분할 창 1개분 (주소창·찾기·목록·정렬·다중 선택·단축키·컨텍스트 메뉴)
│   │   │   ├── FolderTree.tsx           # 좌측 폴더 트리 (즐겨찾기·시스템 폴더 루트, 접기/펼치기)
│   │   │   ├── FileIcon.tsx             # 뷰어 지원 파일 전용 컬러 아이콘
│   │   │   ├── ExplorerStatusBar.tsx    # 탭 하단 상태바 (경로·전체·선택 정보)
│   │   │   ├── ExplorerChatDock.tsx     # 우측 채팅 도크 (ChatTab 재사용, origin='chat' 세션)
│   │   │   ├── ExplorerPanel.tsx        # (미사용) 탐색기 메뉴는 패널 대신 탐색기 탭을 연다 (P12-02)
│   │   │   └── dialogs/                 # ConflictDialog · PropertiesDialog · SearchResultsView
│   │   ├── chatsessions/
│   │   │   └── ChatSessionList.tsx      # 대화 목록 패널
│   │   ├── agents/
│   │   │   ├── AgentListPanel.tsx       # 카드: 모델명·ctx만 + 대화 시작·수정
│   │   │   ├── AgentCard.tsx
│   │   │   ├── AgentEditorForm.tsx      # 기본 정보·프로바이더·비전 + ▸고급 설정
│   │   │   └── AgentFallbackDialog.tsx  # 전송 직전 폴백 선택 (P11-25)
│   │   ├── wiki/
│   │   │   ├── WikiPanel.tsx            # 감시 상태·대기열·최근 처리·페이지 목록 (§16)
│   │   │   └── WikiTab.tsx              # 위키 설정 + 처리 이력 (§16)
│   │   ├── macros/
│   │   │   ├── MacroPanel.tsx           # 매크로 목록·실행·스케줄 (§17)
│   │   │   └── MacroEditorTab.tsx       # 매크로 편집 탭 (§17)
│   │   ├── viewers/
│   │   │   ├── DocumentViewerTab.tsx    # PDF/DOCX/XLSX/PPTX 뷰어
│   │   │   └── ArchiveViewerTab.tsx     # ZIP 목록·해제
│   │   ├── setup/
│   │   │   └── SetupWizard.tsx          # 6단계 셋업 위저드 (§3.5)
│   │   ├── workspace/
│   │   │   ├── CenterWorkspace.tsx      # 탭 바 + 탭 콘텐츠 라우팅
│   │   │   ├── ChatTab.tsx
│   │   │   ├── EditorTab.tsx
│   │   │   ├── ImageViewerTab.tsx
│   │   │   ├── AgentEditorTab.tsx
│   │   │   ├── AgentMonitorTab.tsx      # TopMenuBar 에이전트 메뉴에서만 진입 (V3)
│   │   │   └── SkillViewerTab.tsx
│   │   ├── chat/
│   │   │   ├── MessageList.tsx
│   │   │   ├── MessageBubble.tsx        # 위키 저장 액션 포함
│   │   │   ├── ChatInput.tsx            # 이미지 첨부·`@` 멘션·슬래시·대기 큐
│   │   │   ├── MentionPopup.tsx         # `@` 파일/폴더 참조
│   │   │   ├── ChatMacroDialog.tsx      # 매크로 저장 목록 (DB 저장소 사용)
│   │   │   ├── ChatQueueFloatingDock.tsx
│   │   │   ├── MermaidViewer.tsx
│   │   │   ├── RechartsViewer.tsx
│   │   │   └── ApprovalDialog.tsx        # HITL 승인 팝업
│   │   └── ui/                            # shadcn/ui 프리미티브 (자동 생성)
│   ├── lib/
│   │   ├── context/
│   │   │   ├── WorkspaceTabsContext.tsx
│   │   │   ├── SidePanelContext.tsx
│   │   │   ├── ChatSessionsContext.tsx
│   │   │   ├── AgentsContext.tsx
│   │   │   ├── SkillsContext.tsx
│   │   │   ├── SettingsContext.tsx
│   │   │   └── ThemeContext.tsx
│   │   ├── agent/                          # 에이전트 런타임 (§5)
│   │   │   ├── types.ts                    # AgentTool / AgentToolResult / AgentEvent / AgentMessage
│   │   │   ├── agent.ts                    # VanillaAgent 클래스 (공개 표면 + 이벤트)
│   │   │   ├── loop.ts                     # 턴 루프 (스트림 → 도구 실행 → 반복)
│   │   │   ├── hooks.ts                    # AgentHooks 타입 + composeHooks
│   │   │   ├── hookRegistry.ts             # 확장점: Phase 4/5가 훅을 등록 (§5.6)
│   │   │   ├── queue.ts                    # steering / follow-up 큐
│   │   │   ├── retry.ts                    # RetryPolicy + 지수 백오프
│   │   │   ├── chatQueueManager.ts         # 전역 LLM 실행 잠금 + 세션별 대기 큐
│   │   │   ├── resolveAgent.ts             # 전송 직전 폴백 결정 (P11-25)
│   │   │   └── defaults.ts                 # 앱 기본값 상수 (V4·V6 — 전역 모델/승인 설정 대체)
│   │   │   ├── llm/
│   │   │   │   ├── ollamaClient.ts             # /api/chat 스트리밍, /api/tags, /api/show
│   │   │   │   ├── openAiCompatibleClient.ts   # OpenAI 호환 규격 (SSE)
│   │   │   │   ├── providerRuntime.ts          # Provider 분기 + 외부 에이전트 분기
│   │   │   │   ├── externalAgentClient.ts      # CLI 1회 실행 런타임 (D3)
│   │   │   │   ├── providers.ts                # 프리셋·카테고리·연결 확인
│   │   │   │   ├── agentStatus.ts              # 에이전트 연결 상태 확인
│   │   │   │   ├── vision.ts                   # 비전 판정·이미지 경로 확정
│   │   │   │   └── messageMapper.ts            # AgentMessage ↔ Ollama/OpenAI 메시지 변환
│   │   │   ├── commander/                      # 파일 커맨더 IPC·작업·클립보드 (§3.6)
│   │   │   │   ├── ipc.ts  types.ts  jobs.tsx  clipboard.ts  format.ts  openFile.ts
│   │   │   ├── integrations/                   # 외부 연동 (§15, 구 eval/integrations 이관)
│   │   │   │   ├── gateway.ts  consent.ts  cliRunner.ts  endpointClass.ts  types.ts
│   │   │   ├── wiki/                           # 위키 설정·파이프라인 (§16)
│   │   │   │   ├── settings.ts  pipeline.ts
│   │   │   ├── macros/                         # 매크로 저장소·실행·스케줄러 (§17)
│   │   │   │   ├── types.ts  macrosRepo.ts  migrate.ts  launch.ts  scheduler.ts
│   │   │   │   ├── MacrosProvider.tsx  macrosContext.ts  useMacros.ts
│   │   │   │   └── chatMacros.ts               # 구 localStorage 매크로 (이관용 유지)
│   │   │   ├── parsers/                        # 문서 파서 계층 (§16: 외부→내장→실패)
│   │   │   │   ├── index.ts  external.ts  builtin.ts
│   │   │   ├── chat/
│   │   │   │   └── mentions.ts                 # `@` 파일/폴더 참조 해석
│   │   ├── prompt/
│   │   │   ├── buildSystemPrompt.ts        # 순서 있는 섹션 맵 생성 (§5.5)
│   │   │   └── diffSections.ts             # 변경된 섹션만 패치
│   │   ├── tools/
│   │   │   ├── registry.ts                 # 내장 도구 레지스트리 (BuiltinToolId → AgentTool)
│   │   │   ├── truncate.ts                 # 출력 이중 상한(줄/바이트) 절단
│   │   │   ├── risk.ts                     # 도구 → RiskLevel 매핑 (§8.1)
│   │   │   ├── read.ts  write.ts  edit.ts
│   │   │   ├── ls.ts    grep.ts   find.ts
│   │   │   ├── shell.ts                    # OS별 셸 실행 (항상 승인, §8.1)
│   │   │   ├── wiki.ts                     # 개인 지식 베이스 (ingest/query/list/delete, wiki/ 스코프, risk low)
│   │   │   ├── webSearch.ts
│   │   │   └── commander/                  # 파일 커맨더 도구 (fs_copy/move/rename/mkdir/trash/zip/unzip/info/search/explorer/doc_read)
│   │   ├── skills/                         # §6 (+ bundled/basic-llm-wiki)
│   │   │   ├── contextFiles.ts             # AGENTS.md 계층 수집
│   │   │   ├── scanner.ts                  # SKILL.md 스캔 + frontmatter 검증
│   │   │   ├── frontmatter.ts
│   │   │   └── formatForPrompt.ts          # <available_skills> XML
│   │   ├── compaction/                     # §9
│   │   │   ├── settings.ts                 # reserveTokens / keepRecentTokens 해석
│   │   │   ├── estimate.ts                 # usage 기반 토큰 추정
│   │   │   ├── cutPoint.ts                 # 유효 컷 포인트 탐색
│   │   │   ├── serialize.ts                # 요약 입력용 대화 직렬화
│   │   │   ├── compact.ts                  # prepare + 요약 호출 + 엔트리 생성
│   │   │   └── register.ts                 # transformContext 훅 등록
│   │   ├── approval/                       # §8
│   │   │   ├── approvalBus.ts              # 승인 요청 ↔ UI 응답 브리지
│   │   │   └── register.ts                 # beforeToolCall 훅 등록
│   │   ├── db/
│   │   │   ├── client.ts                   # tauri-plugin-sql 래퍼
│   │   │   ├── migrations/
│   │   │   │   ├── 0001_init.sql
│   │   │   │   ├── 0002_wiki_jobs.sql      # 위키 처리 이력 (§16)
│   │   │   │   └── 0003_macros.sql         # 매크로 저장소 (§17)
│   │   │   ├── buildContext.ts             # 엔트리 → LLM 컨텍스트 재구성 (§4.3)
│   │   │   └── repositories/
│   │   │       ├── sessionsRepo.ts
│   │   │       ├── entriesRepo.ts
│   │   │       ├── agentsRepo.ts
│   │   │       ├── settingsRepo.ts
│   │   │       ├── wikiJobsRepo.ts         # 위키 처리 이력 (§16)
│   │   │       ├── macrosRepo.ts           # 매크로 CRUD — lib/macros에서 호출 (§17)
│   │   │       ├── integrationsRepo.ts     # 외부 연동·감사 로그 (§15)
│   │   │       ├── monitoringRepo.ts       # 모니터 탭용 스냅샷
│   │   │       └── logsRepo.ts
│   │   ├── markdown/
│   │   │   └── parseVisualBlocks.ts       # mermaid/recharts 코드펜스 파서
│   │   ├── eval/                            # 삭제됨 (P11-03, §14 폐기)
│   │   │   └── (구 integrations → lib/integrations로 이관, §15)
│   │   ├── types/
│   │   │   ├── agent.ts
│   │   │   ├── chat.ts
│   │   │   ├── skill.ts
│   │   │   └── workspaceTab.ts
│   │   └── utils/
│   └── hooks/
│       └── useChat.ts                     # 공용 채팅 훅 (VivoAcademy에 없던 것을 신설)
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/
    │   └── default.json
    └── src/
        ├── main.rs
        ├── lib.rs
        └── commands/
            ├── fs_commands.rs             # read_text_file/write_text_file/... + 허용 루트(D1)
            ├── commander_commands.rs      # 파일 커맨더 (fc_* + job 이벤트)
            ├── watch_commands.rs          # 위키 폴더 감시 (wiki://file-event, §16)
            ├── search_commands.rs         # grep_files / find_files (walkdir + regex + ignore)
            ├── shell_commands.rs          # run_shell (OS별 셸, 타임아웃)
            ├── web_commands.rs            # web_search
            ├── system_commands.rs         # GPU·시스템 정보, 폴더 선택
            ├── llm_commands.rs            # Tauri HTTP 우회 (LLM 스트리밍)
            └── integration_commands.rs    # 외부 에이전트 CLI 실행 + 실행 파일 탐지 (§15)
```

> `.agents/skills/`와 `.claude/skills/`는 **Claude Code 자체의 전역 스킬 미러**이며 앱이 런타임에 읽는 작업 폴더 `skills/`·워크스페이스 `.agents/skills/`(신뢰 확인 후 로드)와는 별개입니다. 혼동하지 않도록 §6에서 명확히 구분합니다.

---

## 3. 레이아웃 상세 설계

### 3.1 좌측 아이콘 사이드바 (`ActivityBar.tsx`)

VivoStudio의 `ActivityBar.tsx` 패턴을 그대로 재사용합니다: 데이터 기반 배열, 순수 컨트롤드 컴포넌트, 활성 아이콘에 좌측 accent bar 표시.

```ts
type SidePanelView = 'chat-sessions' | 'explorer' | 'agents' | 'wiki' | 'macros' | null;

const ITEMS: {
  view: Exclude<SidePanelView, null>;
  icon: LucideIcon;
  title: string;
}[] = [
  { view: 'explorer', icon: Files, title: '파일 탐색기' },
  { view: 'chat-sessions', icon: MessageSquare, title: '채팅' },
  { view: 'agents', icon: Bot, title: '에이전트 관리' },
  { view: 'wiki', icon: BookOpen, title: '위키' },
  { view: 'macros', icon: Zap, title: '매크로' },
];
// 하단 고정: Settings (별도 라우트로 이동, 탭/패널 아님 — VivoStudio와 동일 패턴)
```

- 아이콘 클릭 시 좌측 패널이 없으면 펼치고 해당 뷰로 전환, 이미 활성 상태인 아이콘을 다시 클릭하면 패널이 접힘 (VivoStudio의 `handleActivityBarSelect` 로직 그대로 이식).
- Settings는 `react-router-dom` `<Link to="/settings">`로 이동 (사이드패널이 아닌 전체 화면 전환).

### 3.2 좌측 패널 (`WorkspaceLayout.tsx` + `SidePanel.tsx`)

- `react-resizable-panels`의 `PanelGroup`(`direction="horizontal"`, `autoSaveId="fortress-layout-v1"`) 사용.
- 사이드패널: `defaultSize={20} minSize={16} collapsible collapsedSize={0}`, `ImperativePanelHandle` ref로 ActivityBar와 연동.
- 센터 워크스페이스: `minSize={40}`.
- `SidePanel.tsx`는 `activeView`에 따라 5개 컴포넌트 중 하나를 렌더링하는 얇은 라우터(VivoStudio `ExplorerPanel.tsx`와 동일한 패턴):
  - `chat-sessions` → `ChatSessionList.tsx` (세션 목록, 클릭 시 해당 세션의 `chat` 탭을 열거나 포커스. 삭제된 에이전트의 세션도 기억된 이름으로 취소선 표시, 전체 삭제는 확인 팝업 후 일괄 삭제)
  - `agents` → `AgentListPanel.tsx` (Agent 카드 목록: 모델명·컨텍스트만 + "대화 시작"/"수정")
  - `explorer` → `ExplorerPanel.tsx` (P12-02부터 미사용. 탐색기 메뉴는 패널 대신 탐색기 탭을 열고, 즐겨찾기·시스템 폴더는 탭 상단 메뉴바에서 연다)
  - `wiki` → `WikiPanel.tsx` (감시 상태·대기열·최근 처리·페이지 목록 — §16)
  - `macros` → `MacroPanel.tsx` (매크로 목록·실행·스케줄 — §17)
- 스킬 사이드바는 제공하지 않는다. 스킬은 인식되면 자동으로 `AgentEditorForm`의 "활성 스킬 (Agent Skills)" 카드에 표시되며, 여기서 on/off + refresh 버튼으로 재스캔한다.

### 3.3 우측 탭 콘텐츠 영역 (`CenterWorkspace.tsx`)

VivoStudio의 탭 데이터 모델과 `openTab`/`closeTab` 멱등 로직을 그대로 이식하되, 스플릿 페인 드래그앤드롭 기능은 **1차 스코프 제외**(단일 탭 스트립만 구현, Phase 7 이후 확장 여지로 남김 — 구조상 나중에 추가 가능하도록 탭 상태는 Context로 분리).

```ts
type WorkspaceTabType =
  'file-explorer' | 'chat' | 'editor' | 'image-viewer' | 'document-viewer' | 'archive-viewer'
  | 'agent-editor' | 'agent-monitor' | 'skill-viewer' | 'wiki' | 'macro-editor';

interface WorkspaceTab {
  id: string; // 예: "chat:${sessionId}", "editor:${filePath}", "agent-editor:${agentId}"
  type: WorkspaceTabType;
  title: string;
  meta?: Record<string, any>;
}
```

- **앱 시작 시 기본 동작**: 저장된 탭을 복원하고, 탭이 하나도 없으면(최초 실행 또는 복원 실패 시) **파일 탐색기 탭**을 하나 연다(V7). 삭제된 탭 타입(`eval`·`agent-stats`)은 복원 시 조용히 버린다.
- 탭 아이콘 매핑: `file-explorer`→`Files`, `chat`→`MessageSquare`, `editor`→`FileCode`, `image-viewer`→`Image`, `agent-editor`→`Bot`, `agent-monitor`→`Activity`, `skill-viewer`→`Puzzle`, `document-viewer`→`FileText`, `archive-viewer`→`Archive`, `wiki`→`BookOpen`, `macro-editor`→`Zap`.
- 탭 콘텐츠는 VivoStudio처럼 **모두 마운트 유지 + `hidden` 클래스로 숨김 전환**(비활성 채팅 탭도 스트리밍 상태 유지).
- 탭 목록/활성 탭 ID는 SQLite `app_settings` 테이블에 디바운스(500ms) 저장 후 재시작 시 복원(`chat` 탭은 세션 ID만 복원하면 메시지는 DB에서 다시 로드되므로 완전 복원 가능).
- 분할 보기: `CenterWorkspace`의 primary/secondary 분할. F5/F6의 "반대 창" = 다른 pane의 활성 탐색기 탭.

### 3.4 파일 뷰어·커맨더

- `EditorTab.tsx`: VivoStudio와 달리 **CodeMirror 6**을 사용해 실제 문법 강조를 제공합니다. Markdown은 원본/미리보기 토글, 대용량 텍스트는 읽기 전용 앞부분 표시.
- `ImageViewerTab.tsx`: `convertFileSrc` + 25~400% 줌.
- `DocumentViewerTab.tsx`: PDF(pdfjs 렌더)·DOCX(mammoth HTML)·XLSX/CSV(SheetJS 표)·PPTX(슬라이드 아웃라인, D8).
- `ArchiveViewerTab.tsx`: ZIP 목록·선택 해제.
- `openFile.ts` 라우팅: 텍스트/코드/MD/JSON/CSV → 에디터, 이미지 → 이미지 뷰어, 문서 → DocumentViewer, ZIP → ArchiveViewer, HTML → 외부 브라우저, 동영상/음악/실행 파일 → 시스템 기본 앱. 모든 뷰어에 "시스템 기본 앱으로 열기".
- `FileExplorerTab.tsx`: 탭 상단 툴바(뒤/앞/위/새로고침/새 폴더/숨김/트리 토글/즐겨찾기·시스템 폴더 메뉴/1-2-4 분할) + 좌측 접이식 `FolderTree` + 분할 창(`ExplorerPane`: 주소창·창별 찾기·상세 목록·정렬·다중 선택·키보드 탐색·단축키·컨텍스트 메뉴) + 탭 하단 `ExplorerStatusBar`(경로·전체·선택 정보) + 우측 플로팅 `ExplorerChatDock`(`ChatTab` 재사용, `origin='chat'` 세션이라 대화 목록에 등록됨). 찾기(`fc_search`)는 이름 부분 일치 OR 내용 일치이며, 백 버튼·빈 검색어·폴더 이동 시 원래 목록으로 복원된다.
- 파일 작업(복사/이동/압축/해제/검색/정보)은 Rust job + `fc://progress` 이벤트로 진행률·취소·충돌 처리(`ConflictDialog`).

### 3.5 셋업 위저드 + StatusBar

- `SetupWizard.tsx` (6단계: 언어 → 작업 폴더 → 에이전트 안내 → 위키 안내 → 매크로 안내 → 완료). 최초 1회 자동 실행(`setupCompletedAt`), 설정 > 일반에서 재실행(값 프리필). 완료 시 기본 에이전트 편집 탭 자동 오픈(D9).
- `StatusBar.tsx`: 좌측 슬롯(`agent`·`jobs`·`wiki`·`tab`·`clipboard`) + 우측 일시 메시지. 각 기능이 `StatusBarContext`의 `publish(slot, item)`/`clear(slot)`로 자기 슬롯만 갱신.

---

## 4. 데이터 모델

### 4.1 WorkspaceTab / SidePanelView

§3.3, §3.2 참조. `src/lib/types/workspaceTab.ts`에 정의.

### 4.2 Agent (페르소나/프리셋) — `src/lib/types/agent.ts`

```ts
export type ApprovalMode = 'always' | 'dangerous-only' | 'never';

export interface Agent {
  id: string; // uuid
  name: string;
  description?: string;
  systemPrompt: string;
  model: string; // Ollama 모델 태그, 예: "llama3.1:8b"
  temperature: number; // 0.0 ~ 2.0, 기본 0.2
  reasoning?: ReasoningMode; // 사고모드: 'default'(모델 기본값) | 'off' | 'on'
  reasoningEffort?: ReasoningEffort; // reasoning==='on'일 때 think 레벨: 'low'|'medium'|'high'(기본 'medium')
  // 생성 파라미터(샘플링/출력 제어). 전부 선택값이며 미지정(undefined) 시 Provider·모델 기본값("자동")
  topP?: number; // nucleus sampling 0~1. Ollama top_p / OpenAI top_p
  topK?: number; // 상위 K개 제한(1~1000). Ollama 전용(top_k)
  repeatPenalty?: number; // 반복 억제 1~2. Ollama 전용(repeat_penalty)
  frequencyPenalty?: number; // 빈도 억제 -2~2. OpenAI 호환 전용(frequency_penalty)
  presencePenalty?: number; // 주제 억제 -2~2. OpenAI 호환 전용(presence_penalty)
  seed?: number; // 재현용 시드. 양쪽 지원(미지정 시 랜덤)
  stopSequences?: string[]; // 중단 문자열(최대 16개). Ollama stop / OpenAI stop
  maxOutputTokens?: number; // 응답 최대 토큰. Ollama num_predict / OpenAI max_tokens
  contextSize: number; // 토큰 수. 0이면 전역값(app_settings) 상속
  reserveTokens: number; // 압축 트리거 여유분. 0이면 contextSize에서 파생 (§9.1)
  keepRecentTokens: number; // 압축 후 보존할 최근 대화량. 0이면 파생 (§9.1)
  enabledSkills: string[]; // SkillManifest.name 목록 (§4.4)
  enabledBuiltinTools: BuiltinToolId[];
  approvalMode: ApprovalMode; // HITL 세분화, 기본 "dangerous-only"
  autoMonitor: boolean; // 대화 시작 시 모니터링 자동 시작/완료 시 중단, 기본 true(미지정 구 행도 true)
  /** LLM Provider 종류. 미지정(구 DB 행) 시 'ollama' (P9-03, Phase 11 확장) */
  llmProvider?: LlmProviderKind; // 'ollama' | 'lmstudio' | 'llamacpp' | 'vllm' | 'jan' | 'openai-compatible' | 'openai' | 'anthropic' | 'gemini' | 'xai' | 'deepseek' | 'openrouter' | 'mistral' | 'moonshot' | 'together' | 'opencode' | 'external-agent'
  /** 이미지 입력(비전) 지원. 미지정 시 'auto' (P11-26) */
  vision?: VisionSupport; // 'auto' | 'yes' | 'no'
  llmBaseUrl?: string; // 미지정 시 프리셋 기본값 (Ollama는 전역 설정)
  llmApiKey?: string; // 클라우드/인증 서버용. 로컬에는 보통 불필요
  externalAgentId?: string; // llmProvider==='external-agent'일 때 external_integrations 참조 (P11-22)
  isDefault: boolean; // 정확히 하나만 true (VivoAcademy의 is_ai_tutor 불변식과 동일 패턴)
  createdAt: string; // ISO 8601
  updatedAt: string;
}

export type BuiltinToolId =
  'read' | 'write' | 'edit' | 'ls' | 'grep' | 'find' | 'shell' | 'web_search' | 'web_fetch' | 'wiki'
  | 'fs_copy' | 'fs_move' | 'fs_rename' | 'fs_mkdir' | 'fs_trash' | 'fs_zip' | 'fs_unzip'
  | 'fs_info' | 'fs_search' | 'explorer' | 'doc_read'; // 파일 커맨더 도구 (P11-24)
```

- **기본 Agent 불변식**: Agent가 1개 이상 존재하면 정확히 하나는 `isDefault === true`. 최초 생성된 Agent가 자동으로 기본이 되고, 기본 Agent 삭제 시 다음 Agent가 승격됩니다. (VivoAcademy `external-agents.ts`의 `is_ai_tutor` 로직을 참고해 `agentsRepo.ts`에 동일하게 구현.)
- **새 Agent의 기본값** (`src/lib/agent/defaults.ts`, V4·V6): 내장 도구 = 셸 제외 전체, 스킬 = `basic-llm-wiki`, 승인 = `dangerous-only`, temperature = 0.2. 전역 "모델·승인" 설정 화면은 삭제되었고 이 상수가 유일한 기본값이다 (P11-04).
- **`enabledSkills`가 도구 목록이 아닌 이유**: 스킬은 도구로 등록되지 않고 시스템 프롬프트에 이름/설명만 노출됩니다(§6.2). 따라서 `enabledSkills`는 "프롬프트에 노출할 스킬 화이트리스트"이며, 스킬을 실제로 사용하려면 `read` 도구(및 스크립트형 스킬은 `shell`)가 활성화되어 있어야 합니다. `AgentEditorForm`은 스킬을 켜면서 `read`가 꺼져 있으면 경고를 표시합니다.
- **`visualizationTool`을 내장 도구 목록에 넣지 않은 이유**: 로컬 LLM의 함수 호출(tool-calling) 신뢰도가 모델마다 크게 다르므로, 시각화는 "도구 호출"이 아니라 **출력 형식 규약**(시스템 프롬프트에 "필요시 \`\`\`mermaid / \`\`\`recharts 코드펜스로 응답하라"는 지침 포함 + 렌더러가 후처리 파싱)으로 구현합니다. Phase 5에서 상세 설계.

### 4.3 ChatSession / Entry — `src/lib/types/chat.ts`

세션 내용은 "메시지 테이블"이 아니라 **append-only 엔트리 목록**으로 저장합니다. 이유: assistant 메시지의 `toolCalls` 배열·thinking 블록·usage·`stopReason`, 그리고 **압축 경계**를 평면적인 `(role, content)` 스키마로는 표현할 수 없기 때문입니다. pi의 엔트리 모델(§1.3)을 단순화해 가져옵니다.

```ts
export interface ChatSession {
  id: string;
  agentId: string;
  workspaceRoot: string | null; // 이 세션의 cwd (도구/스킬 스코프의 기준)
  origin: ChatSessionOrigin; // 'chat' | 'explorer' | 'macro' | 'wiki' — 목록에는 'chat'만 표시
  title: string; // 최초 사용자 메시지 앞부분으로 자동 생성, 추후 수정 가능
  createdAt: string;
  updatedAt: string;
}

export type EntryType = 'message' | 'compaction' | 'custom';

export interface EntryBase {
  id: string; // UUIDv7 (시간 정렬 가능)
  sessionId: string;
  parentId: string | null; // 선형 체인. 브랜치는 1차 스코프 제외(§13)이나 필드는 유지
  seq: number; // 세션 내 단조 증가
  type: EntryType;
  createdAt: string;
}

export type Entry = MessageEntry | CompactionEntry | CustomEntry;

export interface MessageEntry extends EntryBase {
  type: 'message';
  message: AgentMessage; // §5.2. 전체 메시지를 JSON으로 그대로 보존
}

export interface CompactionEntry extends EntryBase {
  type: 'compaction';
  summary: string;
  firstKeptEntryId: string; // 이 엔트리부터가 "요약되지 않고 남은" 구간
  tokensBefore: number;
  usage?: TokenUsage; // 요약 호출 자체의 비용
  details: { readFiles: string[]; modifiedFiles: string[] };
}

export interface CustomEntry extends EntryBase {
  type: 'custom';
  customType: string; // 예: "compaction_notice", "error_notice"
  payload?: unknown; // UI 전용. LLM 컨텍스트에는 포함되지 않음
}
```

**LLM 컨텍스트 재구성 규칙** (`src/lib/db/buildContext.ts`):

1. 세션의 엔트리를 `seq` 오름차순으로 읽는다.
2. 마지막 `compaction` 엔트리를 찾는다. 없으면 모든 `message` 엔트리가 컨텍스트다.
3. 있으면 → `[요약 메시지] + (firstKeptEntryId 이후의 message 엔트리들)`이 컨텍스트다.
4. `custom` 엔트리는 항상 제외한다(UI 표시 전용).

```
저장된 엔트리 (seq 순):
  1:msg(user)  2:msg(asst)  3:msg(tool)  4:msg(user)  5:msg(asst)  6:msg(tool)  7:cmp
                └──── 요약됨 ────┘        └──────── 유지 ─────────┘    ↑ firstKeptEntryId=4

LLM에 보내는 것:
  [system] [summary(7)] [4] [5] [6]
UI에 보여주는 것:
  [1] [2] [3] [압축 안내 배너] [4] [5] [6]     ← 원본 히스토리는 지우지 않음
```

- **원본은 절대 삭제하지 않습니다.** 압축은 "LLM에 보낼 구간을 바꾸는 것"이지 지우는 것이 아닙니다. 사용자는 스크롤해서 전체 QnA 히스토리를 볼 수 있습니다(원 요구사항).
- VivoAcademy와 달리 **세션 히스토리는 영구 저장**됩니다(카드 이동 시 초기화하는 방식 미채택).
- **영속화 시점**: 사용자 메시지는 전송 즉시, assistant/tool 메시지는 **해당 턴이 끝난 뒤** 한 번에 기록합니다. 스트리밍 중간 상태는 저장하지 않습니다(§1.3 말미의 한계).

### 4.4 SkillManifest — `src/lib/types/skill.ts`

[Agent Skills 표준](https://agentskills.io/specification)을 따릅니다. **스킬 종류(prompt/code) 구분은 없습니다** — 모든 스킬은 `SKILL.md` 하나로 정의되며, 스크립트가 필요하면 스킬 폴더에 넣고 본문에서 상대 경로로 안내합니다(모델이 `shell` 도구로 실행).

```ts
export interface SkillManifest {
  name: string; // frontmatter.name, 없으면 부모 폴더명. 세션 내 유일 (충돌 시 먼저 찾은 것 우선)
  description: string; // frontmatter.description (필수). LLM에게 노출되는 유일한 본문 정보
  filePath: string; // SKILL.md 절대 경로
  baseDir: string; // SKILL.md가 있는 폴더 = 스킬의 상대 경로 기준점
  source: SkillSource; // 어디서 왔는지 (UI 표시 + 충돌 진단용)
  disableModelInvocation: boolean; // true면 프롬프트에서 숨김. /skill:name으로만 호출
}

export type SkillSource = 'global' | 'workspace';

export interface SkillDiagnostic {
  level: 'warning' | 'collision';
  message: string;
  path: string;
}
```

**검증 규칙** (pi `core/skills.ts`와 동일 — 위반해도 경고 후 로드하되, `description`이 없으면 로드하지 않음):

| 필드                       | 규칙                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| `name`                     | 1~64자, `[a-z0-9-]`만, 하이픈으로 시작/끝 불가, 연속 하이픈 불가 |
| `description`              | 필수, 최대 1024자                                                |
| `disable-model-invocation` | 선택, boolean                                                    |

§6에서 스캔 절차와 프롬프트 노출 형식을 정의합니다.

### 4.5 저장소: 작업 폴더 + 전역 DB (D2, Phase 11)

"프로젝트(워크스페이스) 폴더" 개념은 폐지되었다. 세션·탭·매크로는 전역 DB에 두고, 위키·백업·설정 파일은 **작업 폴더(Work Folder)**에 둔다.

```
<WorkFolder>/
  wiki/            # basic-llm-wiki 레이아웃 (index.md, log.md, sources/)
  wiki-inbox/      # 위키 처리 후 이동된 원본 파일
  backup/          # 에이전트 변경 전 스냅샷 (YYYY-MM-DD/<원래 경로 해시>/파일, D10)
  config/          # 사용자 편집 가능한 설정(위키 프롬프트, 파서 설정 export 등)
  skills/          # 사용자 스킬 (신뢰 확인은 이 폴더 로드에만 적용)
  chat-images/     # 채팅 첨부 이미지 복사본 (DB에는 경로만 저장)
```

1. **전역 DB** (운영체제 표준 AppData 디렉터리, `vanilla-commander.db`):
   - `agents`: 등록 에이전트 목록
   - `sessions` + `entries`: 대화 세션·append-only 엔트리 (`origin`으로 chat/explorer/macro 구분)
   - `execution_logs`, `agent_monitoring_snapshots`, `conversation_token_summaries`
   - `external_integrations`, `integration_settings`, `integration_audit_log` (§15)
   - `wiki_jobs`: 위키 처리 이력 (§16)
   - `macros`: 매크로 저장소 (§17)
   - `app_settings`: UI 테마·언어·Ollama 주소·작업 폴더·즐겨찾기·허용 루트·위키/파서 설정·열린 탭
2. **구 `.fortress/` 경로·`fortress:` storage 키**: 첫 실행 시 자동 이관(`legacyStorageMigration`, Rust `rename_legacy_db_files`)으로만 유지한다. 신규 기록은 전부 `vanilla-commander` 이름을 쓴다 (P11-51 결정).
3. 어떤 세션에서든 LLM 추론 또는 대기 큐가 진행 중(`chatQueueManager` busy)일 때는 작업 폴더 변경을 금지한다. 에이전트 설정은 전역이므로 그대로 사용할 수 있다.

---

## 5. 에이전트 런타임 설계

### 5.0 왜 그래프가 아니라 루프인가 (설계 결정, 2026-09-18)

초안은 LangGraph.js `StateGraph` + `interrupt()` + `BaseCheckpointSaver`를 쓰기로 했으나, `pi`의 실제 구현을 검토한 뒤 **자체 루프 + 콜백 훅** 구조로 변경했습니다.

| 초안(LangGraph)                                                                     | 변경 후                                           | 이유                                                                                        |
| ----------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `agentNode` / `toolNode` / `approvalNode` / `summarizerNode` 4개 노드 + 조건부 엣지 | 단일 `loop.ts`의 턴 루프                          | 노드가 4개뿐이고 분기가 선형이라 그래프 추상화가 순이익을 내지 못함                         |
| `approvalNode`에서 `interrupt()` → 체크포인터 저장 → `Command({resume})` 재개       | `beforeToolCall` 훅이 Promise를 await             | 승인은 "같은 프로세스 안에서 사용자 입력을 기다리는 일". 상태를 직렬화해 재개할 이유가 없음 |
| `BaseCheckpointSaver`를 SQLite로 자체 구현 (P4-07)                                  | **삭제**                                          | 체크포인터가 필요했던 유일한 이유가 `interrupt()` 재개였음                                  |
| 그래프 조립 파일(`buildGraph.ts`)을 Phase 2·3·4·5가 모두 수정                       | 훅 레지스트리(§5.6)에 각 Phase가 자기 파일을 등록 | Phase 간 소유 파일 충돌 제거                                                                |

LangChain/LangGraph 의존성은 제거하고, Ollama HTTP API를 직접 호출합니다. 도구 스키마 검증에는 `zod`만 사용합니다.

> 이후 멀티 에이전트 협업(§13)처럼 진짜 그래프가 필요한 요구가 생기면 그때 도입을 재검토합니다. 지금 도입하면 4개 노드를 위해 런타임 하나를 통째로 떠안게 됩니다.

### 5.1 단일 공용 런타임 원칙

Agent(페르소나)마다 별도 런타임을 만들지 않습니다. `VanillaAgent` 인스턴스 하나가 세션 하나를 담당하며, `Agent` 설정값(`systemPrompt`/`model`/`temperature`/도구/스킬)을 생성 시 주입받습니다. 세션이 바뀌면 인스턴스를 새로 만듭니다.

### 5.2 메시지 / 도구 타입 (`src/lib/agent/types.ts`)

```ts
export type AgentMessage =
  | { role: 'system'; content: string; sections?: Record<string, string> }
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      thinking?: string;
      toolCalls?: AgentToolCall[];
      usage?: TokenUsage;
      stopReason: 'stop' | 'toolUse' | 'length' | 'aborted' | 'error';
      errorMessage?: string;
    }
  | {
      role: 'toolResult';
      toolCallId: string;
      toolName: string;
      content: string;
      isError: boolean;
    };

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export interface AgentToolResult {
  content: string; // LLM에게 돌아가는 텍스트 (절단 후)
  details?: unknown; // UI 렌더링/로그용 원본 (컨텍스트에 포함 안 됨)
  isError?: boolean;
  terminate?: boolean; // 이 배치의 모든 결과가 true면 턴 종료
}

export interface AgentTool<S extends ZodTypeAny = ZodTypeAny> {
  name: string; // LLM에게 노출되는 이름
  label: string; // UI 표시용
  description: string;
  parameters: S; // zod 스키마 → JSON Schema 변환해 Ollama에 전달
  risk: RiskLevel; // §8.1
  executionMode?: 'sequential' | 'parallel'; // 기본 parallel, 파일 변경 도구는 sequential
  execute(
    toolCallId: string,
    params: z.infer<S>,
    signal: AbortSignal,
    onUpdate?: (partial: AgentToolResult) => void,
  ): Promise<AgentToolResult>;
}
```

- **도구는 실패 시 throw**합니다. 루프가 잡아서 `isError: true`인 `toolResult` 메시지로 변환해 LLM에게 돌려줍니다 — 도구 실패가 대화를 끊지 않습니다.
- `details`는 **컨텍스트에 포함되지 않습니다**. 예: `grep` 결과 전체는 `details`, LLM에게는 절단된 상위 N건만.

### 5.3 턴 루프 (`src/lib/agent/loop.ts`)

```
prompt(userMessage)
  └─ emit agent_start
     repeat:
       ├─ transformContext(messages)          ← 압축 훅이 여기 (§9)
       ├─ emit turn_start
       ├─ Ollama /api/chat 스트리밍 (retry 정책 적용, §5.7)
       │    └─ 델타마다 emit message_update
       ├─ emit message_end (assistant)
       ├─ toolCalls 없음 → break
       ├─ toolCalls 각각:
       │    ├─ 인자 스키마 검증 (실패 → isError 결과)
       │    ├─ beforeToolCall()  → { block, reason } 이면 실행 없이 에러 결과  ← 승인 훅 (§8)
       │    ├─ execute()  (parallel/sequential, AbortSignal 전달)
       │    ├─ afterToolCall()  → content/isError 덮어쓰기        ← 절단·정규화 훅
       │    └─ emit tool_execution_end + toolResult 메시지 추가
       ├─ emit turn_end
       ├─ 모든 결과가 terminate:true → break
       ├─ shouldStopAfterTurn() → true면 break
       ├─ steering 큐 배출 → 있으면 메시지 주입하고 계속
       └─ 계속
     ├─ follow-up 큐 배출 → 있으면 주입하고 루프 재진입
     └─ emit agent_end
```

- 도구 결과 메시지는 **assistant가 호출한 순서대로** 컨텍스트에 추가합니다(병렬 실행이어도 순서 보존). 순서가 어긋나면 모델이 어떤 결과가 어떤 호출의 것인지 잃습니다.
- `toolCalls`가 있는 assistant 메시지와 그에 대응하는 `toolResult` 메시지는 **항상 붙어 있어야 합니다**. 압축(§9.3)과 컨텍스트 재구성(§4.3)이 이 불변식을 지켜야 합니다.

### 5.4 이벤트 (`AgentEvent`)

```ts
| { type: "agent_start" }
| { type: "turn_start" }
| { type: "message_start";  message: AgentMessage }
| { type: "message_update"; message: AgentMessage; delta: string }
| { type: "message_end";    message: AgentMessage }
| { type: "tool_execution_start";  toolCallId, toolName, args }
| { type: "tool_execution_update"; toolCallId, partial: AgentToolResult }
| { type: "tool_execution_end";    toolCallId, result: AgentToolResult, isError }
| { type: "turn_end";   message: AgentMessage; toolResults: AgentMessage[] }
| { type: "agent_end";  messages: AgentMessage[] }
| { type: "compaction_start" } | { type: "compaction_end"; entry: CompactionEntry }
| { type: "approval_request"; request: ApprovalRequest }
| { type: "error"; error: AgentRunError }
```

`useChat`은 이 이벤트만 구독합니다. UI는 런타임 내부 구조를 알지 못합니다.

### 5.5 시스템 프롬프트 섹션 (`src/lib/prompt/buildSystemPrompt.ts`)

시스템 프롬프트를 한 덩어리 문자열이 아니라 **순서 있는 섹션 맵**으로 만듭니다.

```ts
buildSystemPromptSections({ agent, tools, contextFiles, skills, cwd, commander }): Record<string, string>
// 순서: preamble → tools → rules → addendum → project_context
//       → skills → visualization → cwd → commander
```

- `preamble`을 제외한 각 섹션은 `<section_name>…</section_name>`로 감쌉니다(모델이 나중 갱신을 같은 섹션에 대응시킬 수 있게).
- 세션 도중 스킬 토글·워크스페이스 변경·도구 활성화가 일어나면 프롬프트 전체를 다시 보내지 않고 `diffSections(previous, current)`로 **변경된 섹션만** 새 system 메시지로 주입합니다.
- `visualization` 섹션 내용은 §10.
- `commander` 섹션(P11-24): 현재 탐색기 위치·선택 항목·작업 폴더·허용 루트 + 파일 관리 비서 지침.

### 5.6 확장점(훅) 규약 — Phase 간 파일 충돌 방지

```ts
// src/lib/agent/hooks.ts        (Phase 2가 소유, 이후 수정 없음)
export interface AgentHooks {
  beforeToolCall?(
    ctx: BeforeToolCallContext,
    signal: AbortSignal,
  ): Promise<
    { block?: boolean; reason?: string; terminate?: boolean } | undefined
  >;
  afterToolCall?(
    ctx: AfterToolCallContext,
    signal: AbortSignal,
  ): Promise<Partial<AgentToolResult> | undefined>;
  transformContext?(
    messages: AgentMessage[],
    signal: AbortSignal,
  ): Promise<AgentMessage[]>;
  shouldStopAfterTurn?(
    ctx: ShouldStopAfterTurnContext,
  ): boolean | Promise<boolean>;
  /** 컨텍스트 초과로 요청이 거부됐을 때. 축소된 컨텍스트를 반환하면 루프가 1회 재시도한다 (§9.5). */
  onContextOverflow?(
    messages: AgentMessage[],
    signal: AbortSignal,
  ): Promise<AgentMessage[] | undefined>;
}

// src/lib/agent/hookRegistry.ts (Phase 2가 소유, 이후 수정 없음)
export function registerHooks(id: string, hooks: AgentHooks): void;
export function getRegisteredHooks(): AgentHooks; // 등록 순서대로 합성
```

합성 규칙: `beforeToolCall`은 **하나라도 `block`을 반환하면 차단**(단축 평가), `transformContext`는 등록 순서대로 체이닝, `afterToolCall`은 등록 순서대로 결과를 덮어씀.

각 Phase는 **자기 소유 파일에서** 등록만 합니다:

| 훅                                              | 등록 위치                        | Phase |
| ----------------------------------------------- | -------------------------------- | ----- |
| `afterToolCall` (출력 절단)                     | `src/lib/tools/registry.ts`      | 2     |
| `transformContext` + `onContextOverflow` (압축) | `src/lib/compaction/register.ts` | 4     |
| `beforeToolCall` (승인)                         | `src/lib/approval/register.ts`   | 5     |

등록 함수 호출은 `src/lib/agent/bootstrap.ts`에 **Phase당 import 한 줄씩** 추가합니다. 이것이 Phase 3·4·5가 공유하는 유일한 파일이며, 한 줄 추가라 병렬 작업 시 충돌이 나도 병합이 자명합니다.

### 5.7 재시도 / 취소 / 큐잉

**재시도** (`src/lib/agent/retry.ts`): `{ enabled: true, maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 60000 }`. 지수 백오프. 네트워크 오류·5xx·타임아웃만 재시도하고, 모델 없음(404)·잘못된 요청(400)은 즉시 실패시킵니다. 재시도 중 `AbortSignal`이 발화하면 즉시 중단합니다.

**취소**: `agent.abort()`가 현재 실행의 `AbortController`를 발화시킵니다. 스트림은 즉시 끊기고, **실행 중인 도구에도 같은 signal이 전달됩니다**(도구가 이를 존중할 책임). 중단된 턴의 assistant 메시지는 `stopReason: "aborted"`로 남기되 저장하지 않습니다(§4.3).

**큐잉** (`src/lib/agent/queue.ts`):

| 메서드          | 주입 시점                                         | UI                                   |
| --------------- | ------------------------------------------------- | ------------------------------------ |
| `steer(msg)`    | 현재 턴의 도구 실행이 끝난 직후, 다음 LLM 호출 전 | 스트리밍 중 입력창에 타이핑 후 Enter |
| `followUp(msg)` | 에이전트가 종료하려는 시점                        | 스트리밍 중 `Shift+Enter`로 예약     |

두 큐 모두 기본 배출 모드는 `"one-at-a-time"`입니다. 이것으로 "스트리밍 중에는 입력창 비활성화"라는 열등한 UX를 대체합니다.

### 5.8 Ollama 연동 (`src/lib/llm/ollamaClient.ts`)

- `POST /api/chat` (`stream: true`, `tools: [...]`)를 `fetch`로 직접 호출하고 NDJSON 라인을 파싱합니다. LangChain 래퍼를 쓰지 않습니다.
- 응답 마지막 청크의 `prompt_eval_count` / `eval_count`를 `TokenUsage`로 매핑합니다 — **압축 트리거의 토큰 계산은 이 실측값을 씁니다**(§9.2). 별도 토크나이저 라이브러리가 필요 없습니다.
- `GET /api/tags`로 설치된 모델 목록, `POST /api/show`로 모델의 컨텍스트 길이(`model_info`의 `*.context_length`)를 조회합니다. Agent의 `contextSize`가 0이면 이 값을 씁니다.
- **Reasoning 제어**: `POST /api/chat`의 최상위 `think` 필드에 Agent의 `reasoning`/`reasoningEffort` 해석값(`resolveThinkValue`)을 실어 보냅니다. `default`면 필드 생략(모델 기본값), `off`면 `false`, `on`이면 effort 문자열(`low`/`medium`/`high`). `/api/show` 응답의 `thinking.{values,default}`로 모델별 지원 범위를 확인해 Agent 편집 폼에 힌트로 표시합니다. `think`는 메시지 배열과 무관하므로 채팅 화면에서 세션 단위로 바꿔도 시스템 프롬프트 diff나 prefill 토큰 증가가 없습니다.
- **생성 파라미터**: `src/lib/llm/generationParams.ts`의 지원 매트릭스가 단일 진실 공급원입니다. 양쪽 규격 공통(`top_p`·`seed`·`stop`·`max_tokens`/`num_predict`), Ollama 전용(`top_k`·`repeat_penalty`), OpenAI 호환 전용(`frequency_penalty`·`presence_penalty`)으로 나뉘며, Agent 편집 폼은 미지원 항목을 잠그고(값은 유지) 런타임은 각 클라이언트가 자신의 규격 키로만 변환합니다. `undefined`는 "자동"으로 필드 자체를 생략합니다.
- 기본 baseUrl: `http://127.0.0.1:11434` (Agent 고유값 우선, 없으면 전역 설정, `resolveAgentLlmRuntime`).
- **멀티 프로바이더** (P9-03, Phase 11 확장): `providers.ts` 프리셋(ollama/lmstudio/llamacpp/vllm/jan/openai-compatible/openai/anthropic/gemini/…/external-agent). Ollama 네이티브(`/api/chat`, NDJSON)와 OpenAI 호환(`/v1/chat/completions`, SSE) 클라이언트로 나뉘며 `providerRuntime.ts`가 분기한다. OpenAI 호환 서버는 컨텍스트 길이를 보고하지 않으므로 "컨텍스트 크기"를 수동 설정한다.
- **외부 에이전트** (§5.9): `llmProvider: 'external-agent'`.
- Tauri v2 CSP(`src-tauri/tauri.conf.json`의 `app.security.csp`)는 흰 화면(TAURI-BLANK) 재발 방지 가드(`scripts/check-tauri-blank.mjs`, `pnpm check:tauri-blank`·`pnpm test`에서 감시)가 검증한다. 필수 항목: `connect-src`에 `ipc: http://ipc.localhost`(웹뷰↔Rust IPC 호출용, 누락 시 빈 화면 — Phase 0 TAURI-BLANK 확정 원인), `http://127.0.0.1:11434 http://localhost:11434`(Ollama 직접 호출용), dev 서버 `http://127.0.0.1:14200 http://localhost:14200` + HMR 소켓 `ws://…:14200/14201`(브라우저엔 Tauri CSP가 적용되지 않아 브라우저만 정상이고 앱 창만 흰 화면이 되는 갈림 증상의 원인). `script-src 'self' 'unsafe-inline' 'unsafe-eval'` + dev http 허용(Vite dev 프리앰블/HMR용 — dev/prod 공통 CSP라 prod에도 적용됨을 감수), `font-src`·`worker-src 'self' blob:`(번들 폰트·pdfjs/mermaid 워커용). dev 호스트는 `vite.config.ts server.host`·HMR·`build.devUrl` 모두 `127.0.0.1:14200`(HMR 14201)으로 고정 — `localhost`는 Windows에서 ::1(IPv6)로 해석될 수 있어 리스너와 WebView 해석이 엇갈리면 앱 창만 백지가 된다. CSP를 바꿀 때는 가드 스크립트를 먼저 실행하십시오.
- **모델 호환성**: tool-calling을 지원하지 않는 모델이 선택되면 도구 없이 동작하고 UI에 경고 배지를 표시합니다. 어떤 모델이 멀티턴 tool-calling을 견디는지는 P0-08 스파이크에서 먼저 확인합니다.
- **이미지 입력** (P11-26): 사용자 메시지의 `images`(경로 또는 data URL)를 전송 직전 data URL로 해석해 Ollama `images` / OpenAI `image_url`로 변환합니다. DB에는 경로만 저장합니다(작업 폴더 밖 파일은 `chat-images/`에 복사). `Agent.vision`이 `no`면 전송 시 폴백 다이얼로그로 비전 에이전트를 제안합니다.

### 5.9 외부 에이전트 런타임 (D3, P11-22·P11-23)

`llmProvider: 'external-agent'`인 에이전트는 우리 루프의 도구를 쓰지 않습니다. 매 턴 대화를 프롬프트로 만들어 등록된 CLI(`externalAgentId` 참조)에 1회 실행하고 결과를 단일 청크로 반환합니다 (`externalAgentClient.ts`, `providerRuntime.ts` 분기). `cwd`는 대화가 시작된 탐색기 경로(채팅 탭이면 작업 폴더)이며, 권한 검사·감사 로그는 `callIntegration` 게이트웨이를 거쳐 유지합니다. 외부 에이전트는 우리 승인 훅 밖에서 파일을 바꿀 수 있으므로, 연결 시 "데이터 외부 노출 + 직접 수정 가능" 동의를 받고 카드에 배지로 표시합니다. 편집 화면에서는 해당 에이전트의 도구·스킬 섹션을 비활성화 표시합니다.

---

## 6. AGENTS.md / 스킬 로더 설계 (앱 런타임 기능)

> **주의**: 이것은 앱이 여는 폴더를 스캔하는 기능입니다. *리포지토리 자체*의 루트 `AGENTS.md`(개발 지침 파일)나 `.agents/skills/`(Claude Code 전역 스킬 미러)와는 무관합니다.

### 6.1 AGENTS.md(컨텍스트 파일) 수집 — `src/lib/skills/contextFiles.ts`

pi의 `loadProjectContextFiles`와 동일한 규칙입니다.

1. 한 디렉터리에서의 후보 파일명 **우선순위**: `AGENTS.override.md` → `AGENTS.md` → `AGENTS.MD` → `CLAUDE.md` → `CLAUDE.MD`. 첫 번째로 존재하는 것 하나만 씁니다.
2. **전역** 설정 디렉터리(`%APPDATA%/VanillaCommander/AGENTS.md`)를 먼저 수집합니다.
3. 워크스페이스 루트에서 **파일시스템 루트까지 모든 조상 디렉터리**를 올라가며 수집하되, 최종 순서는 **루트 → 워크스페이스**(바깥쪽이 먼저, 안쪽이 나중에 와서 덮어씀)입니다.
4. 각 파일은 시스템 프롬프트의 `project_context` 섹션에 경로와 함께 들어갑니다:
   ```
   <project_instructions path="C:/work/proj/AGENTS.md">
   …파일 전문…
   </project_instructions>
   ```
5. 같은 경로를 두 번 넣지 않습니다(중복 제거).

### 6.2 스킬 스캔과 노출 — 프로그레시브 디스클로저

**스킬은 도구로 등록하지 않습니다.** (초안의 `promptSkill` → `DynamicTool` 설계는 폐기. 이유: 스킬 N개를 전부 도구 스키마로 만들면 스킬이 늘수록 컨텍스트를 잠식하고, [Agent Skills 표준](https://agentskills.io/integrate-skills)과도 어긋남.)

**스캔 위치** (`src/lib/skills/scanner.ts`):

| 스코프      | 경로                                                     |
| ----------- | -------------------------------------------------------- |
| `global`    | 앱 전역 스킬 폴더 + 작업 폴더 `skills/` (신뢰 확인 후 로드)            |
| `workspace` | 워크스페이스의 `.agents/skills/` (루트 및 조상 디렉터리) |

**앱 기본 제공 스킬** (`src/lib/skills/bundledSkills.ts`): `basic-llm-wiki`(위키 등록/조회/삭제만 남긴 최소 스킬, 원본 `src/lib/skills/bundled/basic-llm-wiki/SKILL.md`, Vite `?raw`로 번들). 워크스페이스에 없어도 에이전트 편집 폼의 "활성 스킬" 목록에 `앱 기본 제공` 배지와 함께 노출되며, 활성화 후 저장하면 현재 워크스페이스의 `.agents/skills/basic-llm-wiki/`로 복사(기존 파일은 덮어쓰지 않음)된 뒤 스캐너가 일반 `workspace` 스킬로 로드합니다.

**탐색 규칙** (pi `loadSkillsFromDir`와 동일):

1. 어떤 디렉터리에 `SKILL.md`가 있으면 그 디렉터리를 **스킬 루트**로 보고 **더 내려가지 않습니다**.
2. 없으면 하위 디렉터리로 재귀합니다. `node_modules`와 `.`으로 시작하는 폴더는 건너뜁니다.
3. `.gitignore`/`.ignore`를 존중합니다.
4. `description`이 없거나 frontmatter가 깨진 `SKILL.md`는 **로드하지 않고 경고**를 남깁니다(§4.4 검증 규칙).
5. 이름이 충돌하면 **먼저 찾은 것을 유지**하고 충돌 진단을 남깁니다. 심링크로 같은 파일이 두 번 잡히면 조용히 건너뜁니다.

**프롬프트 노출** (`formatForPrompt.ts`) — `skills` 섹션에 들어가는 내용:

```xml
The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.
When a skill file references a relative path, resolve it against the skill directory
(the parent of SKILL.md) and use that absolute path in tool commands.

<available_skills>
  <skill>
    <name>pdf-tools</name>
    <description>Extracts text and tables from PDF files…</description>
    <location>C:/work/proj/.agents/skills/pdf-tools/SKILL.md</location>
  </skill>
</available_skills>
```

즉 **항상 컨텍스트에 있는 것은 이름·설명·경로 세 줄뿐**이고, 모델이 필요하다고 판단하면 `read` 도구로 본문을 가져갑니다. 스킬이 스크립트를 제공하면 본문의 안내를 따라 `shell` 도구로 실행합니다.

`disableModelInvocation: true`인 스킬과 `agent.enabledSkills`에 없는 스킬은 이 목록에서 제외됩니다.

### 6.3 SKILL.md 포맷

````markdown
---
name: my-skill
description: 무엇을 하고 언제 쓰는지. 구체적으로 — 이 한 줄이 모델의 로드 여부를 결정합니다.
---

# My Skill

## Setup

```bash
cd <skill dir> && npm install
```

## Usage

```bash
./scripts/process.sh <input>
```

자세한 내용은 [레퍼런스](references/REFERENCE.md) 참고.
````

스킬 폴더 안의 `scripts/`, `references/`, `assets/` 등은 자유 형식이며, 본문에서 **스킬 디렉터리 기준 상대 경로**로 참조합니다.

### 6.4 `/skill:name` 명시 호출

모델이 설명만 보고 스킬을 안 읽는 경우가 흔하므로, 사용자가 채팅 입력창에서 `/skill:<name>`을 입력하면 해당 `SKILL.md` 본문을 즉시 user 메시지로 주입합니다. 뒤에 붙인 인자는 본문 뒤에 `User: <args>`로 덧붙입니다. `disableModelInvocation: true`인 스킬은 이 경로로만 쓸 수 있습니다.

---

## 7. 안전 경계

초안의 "QuickJS 3단계 샌드박스"는 폐기했습니다. 이유: `index.json`/`index.js` 코드 스킬은 Agent Skills 표준에 없는 개념이고, 이를 위해 `rquickjs` 통합과 JSON Schema→zod 변환기를 자체 구현하는 비용이 얻는 것보다 큽니다. 스킬은 마크다운 문서이고, 실행이 필요하면 스킬이 제공하는 스크립트를 `shell` 도구로 돌립니다.

남는 안전 경계는 두 겹이다 (D1, Phase 11 — 사용자 조작과 에이전트 조작을 분리).

| 레이어 | 기술 | 구현 위치 |
| --- | --- | --- |
| Layer 1a: 사용자 파일 작업 | 탐색기 UI의 파일 커맨드는 OS 권한 내 전체 허용. 시스템 폴더 쓰기는 `warning` 플래그로 경고 | `commander_commands.rs` (`resolve_user_path`: canonicalize만) |
| Layer 1b: 에이전트 허용 루트 | 에이전트 도구는 허용 루트(작업 폴더 + 탐색기 탭 경로 + `@` 참조 + 등록 폴더) 안에서만 동작. 심링크는 canonicalize 후 재검사. Tauri 2 Capabilities로 이중 방어 | `fs_commands.rs` (`set_agent_allowed_roots`), `capabilities/default.json` |
| Layer 2: 사람의 승인 | `beforeToolCall` 훅이 위험 도구 실행 전 사용자 확인 | §8, `src/lib/approval/` |

**셸 도구는 스코프로 막을 수 없습니다.** `run_shell`은 `cwd`만 워크스페이스로 고정할 뿐 임의 명령을 실행할 수 있으므로, **`approvalMode`와 무관하게 항상 승인을 요구**합니다(§8.1). 승인 다이얼로그에 실행될 명령 전문을 그대로 보여줍니다. Agent의 `enabledBuiltinTools`에서 `shell`은 기본 비활성이며, Settings에 위험 경고를 함께 표시합니다.

**스킬은 신뢰 경계 밖입니다.** 스킬은 모델에게 임의 행동을 지시할 수 있는 텍스트이므로, 워크스페이스를 처음 열 때 "이 폴더의 `AGENTS.md`/스킬을 신뢰하고 로드할까요?"를 한 번 묻고(폴더 경로 단위로 기억), 거부하면 컨텍스트 파일과 워크스페이스 스킬을 로드하지 않습니다.

---

## 8. Human-in-the-Loop (HITL) 승인 모드

### 8.1 위험도 분류 (`src/lib/tools/risk.ts`)

| 도구                            | 위험도       | `dangerous-only`에서 승인 필요?         |
| ------------------------------- | ------------ | --------------------------------------- |
| `read` / `ls` / `grep` / `find` | low          | 아니오                                  |
| `web_search`                    | low          | 아니오                                  |
| `write` / `edit`                | high         | 예                                      |
| `shell`                         | **critical** | **예 — `approvalMode`와 무관하게 항상** |

- `approvalMode: "always"` — 모든 도구 호출에 승인 요구
- `approvalMode: "dangerous-only"` (기본값) — `high` 이상만
- `approvalMode: "never"` — `high`도 자동 승인. 단 `critical`(셸)은 **여전히 승인 필요**. Settings에서 명확한 경고와 함께 제공

### 8.2 흐름

```
루프 → toolCalls 결정
      → beforeToolCall 훅 (src/lib/approval/register.ts)
          ├─ 승인 불필요 → undefined 반환 → 즉시 실행
          └─ 승인 필요 → approvalBus.request({toolCallId, toolName, args, risk})
                          → emit approval_request → ApprovalDialog 렌더
                          → await (사용자 응답 Promise)
                              ├─ [승인] → undefined 반환 → 실행
                              └─ [거절] → { block: true, reason } 반환
                                          → 루프가 isError:true toolResult 생성
                                          → 거절 사유가 LLM에 전달되어 대안 모색 유도
```

`ApprovalDialog`는 도구명, 인자(JSON pretty-print, 셸은 명령 전문), 위험도 배지를 표시하고 "승인" / "거절(+사유 입력)" / "이 세션에서 이 도구는 항상 승인" 버튼을 제공합니다.

`approvalBus`는 실행 취소(`abort()`)와 창 닫힘도 처리해야 합니다 — 대기 중인 Promise를 거절 처리하고 루프를 정리합니다.

### 8.3 한계 (의도적)

승인 대기 중 앱이 강제 종료되면 해당 턴은 복원되지 않습니다. 재시작 시 마지막으로 완료된 턴까지만 복원되고, 사용자는 직전 질문을 다시 보낼 수 있습니다. pi처럼 내구성 있는 재개를 하려면 연산 상태 기계와 스토리지 트랜잭션이 필요한데(§1.3), 단일 사용자 데스크탑 앱에 그 비용은 과합니다.

### 8.4 평가 샌드박스 정책 — 폐기됨 (P11-03)

자동 평가(§14)가 삭제되면서 이 절의 샌드박스 정책도 함께 폐기되었다. 승인 훅에 예외는 없으며, 백그라운드 작업(위키·매크로)에서 승인이 필요하면 자동 승인하지 않고 일시정지 + 사용자 확인을 요청한다 (§16, §17). 아래는 이력으로만 남긴다.

자동 평가(§14)의 에이전트형 과제는 사람의 승인 없이 수십~수백 번 `write`/`edit`을 실행해야 하므로 §8.2의 승인 다이얼로그를 쓸 수 없습니다. 대신 평가 러너는 전역 훅(`getRegisteredHooks()`)을 쓰지 않고 **평가 전용 정책 훅**(`src/lib/eval/runner/sandboxPolicy.ts`)을 붙입니다. 이 예외는 아래 조건을 **모두** 만족할 때만 성립하며, 조건을 완화하는 변경은 이 절을 먼저 개정해야 합니다.

1. 도구의 `workspaceRoot`는 Rust가 만든 임시 샌드박스(`%TEMP%/fortress-eval/<uuid>`, 픽스처 복사본)입니다. 사용자 워크스페이스는 절대 루트가 되지 않습니다.
2. 허용 도구는 `read`/`ls`/`grep`/`find`/`write`/`edit`뿐입니다. `shell`(critical)·`web_search`·`web_fetch`는 후보 설정에서 제거되고, 정책 훅도 한 번 더 차단합니다. **셸은 평가에서도 실행되지 않습니다**(§8.1 규칙 유지).
3. 경로 인자는 정책 훅(TS)과 Rust `resolve_and_verify_workspace_path`가 이중으로 샌드박스 내부인지 검증합니다.
4. 평가는 사용자가 가중치·기준값을 확인한 뒤 수동으로 시작한 경우에만 실행됩니다(§14.2 D6).
5. Trial이 끝나면 샌드박스를 삭제하고, 앱 시작 시 잔여 샌드박스를 정리합니다.

**모델 생성 코드 실행**(§14, Q5 코딩 평가)도 같은 범주의 예외입니다. JS는 네트워크 API를 제거한 Web Worker에서만 실행하고, Python은 설정 "로컬 코드 실행 허용" + 실행별 확인이 모두 있을 때만 Rust `eval_run_python`(셸 미경유, `-I` 격리, 임시 폴더, 타임아웃)으로 실행합니다. 네트워크 차단은 보장하지 않으며 UI에서 고지합니다.

---

## 9. 컨텍스트 자동 압축

초안의 "전체 토큰 수가 `contextSize`의 75%를 넘으면 `[요약, 최근 2개]`로 치환"은 세 가지 문제가 있어 pi의 알고리즘으로 교체했습니다: ① tiktoken 근사치는 로컬 모델 토크나이저와 맞지 않는데 Ollama가 실측값을 주고 있음, ② "최근 2개"는 assistant의 `toolCalls`와 그 `toolResult`를 분리시켜 요청을 깨뜨림, ③ 요약 형식·반복 압축 전략이 없음.

### 9.1 트리거와 예산 (`src/lib/compaction/settings.ts`)

```
압축 트리거:  contextTokens > contextSize - reserveTokens
```

`reserveTokens`는 "요약 프롬프트와 다음 응답을 위해 비워둘 양"입니다. Agent에 명시값이 없으면(0) 전역 기본값 → 컨텍스트 크기별 단계표 순으로 파생합니다 (`src/lib/compaction/settings.ts`의 `defaultReserveForContext`/`defaultKeepForContext`, 전역값은 앱 설정에 저장):

```
8K 이하 → reserve 2048 / keep 1024
16K 이하 → reserve 4096 / keep 2048
24K 이하 → reserve 6144 / keep 4096
32K 이하·초과 → reserve 8192 / keep 8192
```

> reserve의 25% 비율은 의도적입니다 — `contextSize`가 8192면 트리거가 정확히 **75%**(6144)가 되어 원 요구사항의 "75% 자동 압축"을 그대로 만족합니다. 다만 저장·설정 단위는 비율이 아니라 **절대 토큰 수**입니다. 32K 초과분도 8K/8K로 고정해 두는데, 이는 128K급에서 비율대로 잡으면(32K) 요약 호출 자체가 비대해지기 때문입니다. 작은 컨텍스트의 keep(8K→1K)은 도구형 작업에 빠듯할 수 있어 요약 품질에 의존합니다 — 도구 위주면 전역 또는 Agent별 keep을 상향하십시오.

pi의 기본값(16384/20000)을 그대로 쓰지 않는 이유: pi는 200K급 상용 모델을, Fortress는 8K~128K 로컬 모델을 전제합니다.

### 9.2 토큰 추정 (`src/lib/compaction/estimate.ts`)

`js-tiktoken`을 **쓰지 않습니다**. 대신:

1. 메시지 목록을 뒤에서부터 훑어 **가장 최근 assistant 메시지의 `usage.total`**(Ollama 실측)을 찾습니다.
2. 그 메시지 **이후**의 메시지만 `ceil(chars / 4)` 휴리스틱으로 추정합니다.
3. `contextTokens = usage.total + trailingEstimate`.
4. usage가 하나도 없으면(세션 첫 턴) 전량 휴리스틱 추정.

`stopReason`이 `aborted`/`error`인 assistant 메시지의 usage는 신뢰하지 않고 건너뜁니다.

### 9.3 컷 포인트 (`src/lib/compaction/cutPoint.ts`)

1. 최신 메시지부터 역순으로 토큰을 누적해 `keepRecentTokens`에 도달하는 지점을 찾습니다.
2. 그 지점 **이후의 가장 가까운 유효 컷 포인트**를 고릅니다.
3. **유효 컷 포인트**: `user` 또는 `assistant` 메시지. **`toolResult`에서는 절대 자르지 않습니다** — 자르면 대응하는 `toolCalls`와 분리됩니다.
4. 컷 지점이 `user` 메시지가 아니면 "턴 중간을 자른 것"(split turn)입니다. **1차 스코프에서는 이 경우 컷 지점을 해당 턴의 시작(`user` 메시지)까지 앞당겨** 턴 경계를 유지합니다. pi의 2단 요약(turnPrefixMessages)은 §13으로 미룹니다.
5. 이전 압축이 있으면 요약 대상 구간의 시작은 **이전 압축의 `firstKeptEntryId`**입니다(압축 엔트리 자체가 아님) — 그래야 이전에 살아남은 메시지가 다음 요약에도 반영됩니다.

### 9.4 요약 생성 (`serialize.ts` + `compact.ts`)

**입력 직렬화**: 메시지를 그대로 넘기지 않고 텍스트로 직렬화합니다(모델이 "이어서 대화"하지 않도록):

```
[User]: 질문 내용
[Assistant thinking]: 내부 추론
[Assistant]: 응답 텍스트
[Assistant tool calls]: read(path="foo.ts"); edit(path="bar.ts", …)
[Tool result]: 도구 출력
```

`[Tool result]`는 **2000자로 절단**하고 "N자 생략" 표시를 남깁니다. 도구 결과가 컨텍스트의 최대 소비자이기 때문입니다.

**요약 프롬프트**: 고정 구조를 강제합니다.

```markdown
## Goal

## Constraints & Preferences

## Progress

### Done / ### In Progress / ### Blocked

## Key Decisions

## Next Steps

## Critical Context

<read-files>…</read-files>
<modified-files>…</modified-files>
```

지침에 "대화를 이어가지 말고 요약만 출력하라", "파일 경로·함수명·에러 메시지는 원문 그대로 보존하라"를 포함합니다.

**증분 업데이트**: 이전 압축이 있으면 그 요약을 `<previous-summary>` 태그로 함께 넘기고, "기존 정보를 보존하면서 새 내용을 반영하고, In Progress → Done으로 이동시켜라"는 별도 지침을 씁니다. 매번 처음부터 요약하지 않습니다.

**파일 조작 누적 추적**: 요약 대상 구간의 도구 호출에서 읽은/수정한 파일 경로를 추출하고, **이전 압축의 `details`와 합집합**을 취해 새 `CompactionEntry.details`에 기록합니다. 여러 번 압축해도 파일 목록이 사라지지 않습니다.

요약 호출은 별도 요청이며, 같은 Ollama 모델을 쓰되 도구 바인딩 없이 호출합니다.

### 9.5 오버플로우 복구

트리거 검사를 통과했는데도 Ollama가 컨텍스트 초과로 요청을 거부하는 경우(추정 오차, 긴 도구 결과)가 있습니다. 이때는 에러를 사용자에게 던지지 말고 **`reason: "overflow"`로 즉시 압축한 뒤 그 턴을 1회 재시도**합니다. 재시도도 실패하면 그때 에러 UI를 띄웁니다.

압축 검사 시점은 세 곳입니다: ① 새 사용자 메시지를 보내기 전, ② 턴 중 도구 결과가 추가된 뒤 다음 LLM 호출 전, ③ 오버플로우 에러 발생 시.

### 9.6 UI

- 압축이 일어나면 `custom` 엔트리(`customType: "compaction_notice"`)를 저장하고 메시지 목록에 "대화 기록이 요약되었습니다 (N → M 토큰)" 배너를 표시합니다. 클릭하면 요약 전문을 펼쳐 볼 수 있습니다.
- 채팅 입력창 근처에 **컨텍스트 사용률 게이지**(현재 토큰 / `contextSize`)를 상시 표시합니다.
- 사용자가 `/compact [지시사항]`으로 수동 압축할 수 있습니다. 지시사항은 요약 프롬프트에 덧붙습니다.

---

## 10. 시각화 렌더링

- `src/lib/markdown/parseVisualBlocks.ts`: assistant 메시지 텍스트에서 \`\`\`mermaid, \`\`\`recharts(JSON DSL) 코드펜스를 추출.
- `MessageBubble.tsx`가 react-markdown으로 일반 텍스트를 렌더링하되, 코드펜스 언어가 `mermaid`/`recharts`이면 각각 `MermaidViewer.tsx`(mermaid.js) / `RechartsViewer.tsx`(JSON DSL → Recharts 컴포넌트 매핑)로 치환 렌더링.
- 시스템 프롬프트의 `visualization` 섹션(§5.5, 모든 Agent에 자동 추가)에 "플로우차트/시퀀스 다이어그램이 필요하면 \`\`\`mermaid, 차트/그래프가 필요하면 \`\`\`recharts JSON으로 응답하라"는 지침과 Recharts DSL 스키마 예시를 포함. 로컬 모델이 형식을 잘 안 지키면 few-shot 예시를 이 섹션에 추가합니다.

---

## 11. 상태관리 원칙

VivoStudio와 동일하게 **Redux/Zustand 등 전역 스토어 라이브러리 없이, 관심사별 React Context**를 사용합니다. 새로운 전역 상태가 필요하면 새 Context를 추가하되, 기존 Context에 무분별하게 필드를 추가하지 않습니다. Context 목록은 §2 트리의 `src/lib/context/`를 최종 목록으로 간주하며, 추가가 필요한 경우 `Docs/TODO.md`에 결정 사항을 기록합니다.

---

## 12. IPC 커맨드 목록 (Rust ↔ TypeScript)

사용자 조작 커맨드(`fc_*`·폴더 선택 등)는 경로를 canonicalize만 하고, **에이전트 도구 경로**는 Rust 쪽에서 허용 루트(`set_agent_allowed_roots`) 안인지 canonicalize 후 검증한다. 벗어나면 에러를 반환한다 (§7 Layer 1a/1b).

| 커맨드                                         | 위치                 | 설명                                                                              | 대응 도구          |
| ---------------------------------------------- | -------------------- | --------------------------------------------------------------------------------- | ------------------ |
| `read_text_file(path)`                         | `fs_commands.rs`     | 텍스트 파일 읽기                                                                  | `read`, EditorTab  |
| `write_text_file(path, content)`               | `fs_commands.rs`     | 텍스트 파일 쓰기                                                                  | `write`, EditorTab |
| `read_project_folder_tree(folderPath)`         | `fs_commands.rs`     | 파일 트리 조회 (구 프로젝트 트리용, 유지)                                         | —                  |
| `list_dir(path)`                               | `fs_commands.rs`     | 한 단계 목록(이름/종류/크기)                                                      | `ls`, 스킬 스캐너  |
| `create_file(path)` / `create_folder(path)`    | `fs_commands.rs`     | 생성                                                                              | 탐색기             |
| `rename_path(from, to)`                        | `fs_commands.rs`     | 이름변경/이동                                                                     | 탐색기             |
| `delete_path(path)`                            | `fs_commands.rs`     | 삭제                                                                              | 탐색기             |
| `grep_files(pattern, path, glob?, maxResults)` | `search_commands.rs` | 내용 검색 (`regex` + `ignore` 크레이트, gitignore 존중)                           | `grep`             |
| `find_files(pattern, path, maxResults)`        | `search_commands.rs` | 파일명 glob 검색 (`ignore` 크레이트)                                              | `find`             |
| `run_shell(command, cwd, timeoutMs)`           | `shell_commands.rs`  | OS별 셸 실행(Windows=PowerShell). stdout/stderr/exitCode 반환, 타임아웃 강제 종료 | `shell`            |
| `web_search(query)`                            | `web_commands.rs`    | 웹 검색 결과 파싱(reqwest + scraper)                                              | `web_search`       |
| `fc_list_dir` / `fc_system_folders` / `fc_stat` | `commander_commands.rs` | 탐색기 목록·시스템 폴더·정보(재귀 크기) + job 진행률 | 탐색기, `fs_info` |
| `fc_copy` / `fc_move` (+`fc_cancel`, `fc_resolve_conflict`) | `commander_commands.rs` | job id + `fc://progress` 이벤트, 충돌 정책 ask/overwrite/skip/rename | `fs_copy`, `fs_move`, 위키 이동 |
| `fc_trash` / `fc_delete_permanent` / `fc_rename` / `fc_mkdir` / `fc_create_file` | `commander_commands.rs` | 휴지통(D10)·영구 삭제·이름 변경·생성 | 탐색기, `fs_trash` 등 |
| `fc_search` | `commander_commands.rs` | 이름/내용 검색 스트리밍 (ignore 워커 재사용) | `fs_search`, `@` 팝업 |
| `fc_zip` / `fc_unzip` / `fc_archive_list` | `commander_commands.rs` | 압축/해제/목록 (job 기반) | `fs_zip`, `fs_unzip` |
| `fc_open_default` / `fc_reveal` | `commander_commands.rs` | 기본 앱으로 열기·탐색기에서 보기 | 뷰어, 위키/매크로 |
| `fc_read_file_bytes` / `fc_read_text_head` / `fc_write_bytes` | `commander_commands.rs` | 바이너리/텍스트 앞부분 읽기·쓰기 | 뷰어, 이미지 첨부 |
| `fc_office_text(path)` | `commander_commands.rs` | pptx/docx XML 텍스트 직접 추출 (200K 캡) | `doc_read`, 파서 (§16) |
| `wiki_watch_set(folders)` / `wiki_watch_stop` / `wiki_watch_status` / `wiki_default_watch_folder` | `watch_commands.rs` | notify-debouncer-full(2초) → `wiki://file-event {path, kind}`. 임시 파일 제외·크기 안정화 후 발행 | 위키 감시 (§16) |
| `integration_run_cli(executablePath, args, stdin?, promptFile?, timeoutMs, cwd?)` | `integration_commands.rs` | 등록·동의된 외부 에이전트 CLI 실행(셸 미경유, 임시 cwd) + `find_executable` PATH 탐지 | 외부 연동(§15), 파서 (§16) |

- `edit` 도구는 전용 커맨드 없이 `read_text_file` + 문자열 치환 + `write_text_file` 조합으로 프런트엔드에서 구현합니다. 치환 대상이 0건이거나 2건 이상이면 실패시키고 모델에게 더 긴 컨텍스트를 요구합니다.
- **`web_search`는 유지보수 리스크가 있습니다.** HTML 구조 변경·봇 차단으로 깨지기 쉬우므로, 파싱 실패 시 예외 대신 "검색 결과를 가져오지 못했습니다" 결과를 반환해 대화를 끊지 않습니다. 장기적으로는 내장 도구 대신 검색 스킬(§6)로 대체하는 것을 권장합니다.
- 프런트엔드는 이 커맨드들을 `src/lib/tools/*.ts`에서 `AgentTool`(§5.2)로 감싸 `registry.ts`에 등록합니다.

---

## 13. 미결 사항 / 향후 확장 (1차 스코프 제외)

- 멀티 에이전트 협업(supervisor → sub-agent 호출) — Agent를 "설정값 프리셋"으로 정의했으므로 서브 에이전트를 도구로 노출하는 방식으로 확장 가능하나 1차 스코프 아님. **이 요구가 확정되면 §5.0의 "그래프 대신 루프" 결정을 재검토**합니다.
- **대화 브랜치 / 트리 탐색** — 엔트리에 `parentId`를 남겨 두었으므로 나중에 추가 가능. pi의 브랜치 요약(`/tree`)도 이때 함께 검토.
- **split-turn 2단 요약** — 단일 턴이 `keepRecentTokens`를 초과할 때 pi는 턴 앞부분을 별도 요약해 병합하지만, 컷 지점을 턴 시작까지 앞당기는 방식으로 단순화했습니다 (§9.3).
- **크래시 복원력** — 스트리밍/도구 실행/승인 대기 중 강제 종료 시 해당 턴은 폐기됩니다 (§8.3). pi 수준의 내구성이 필요해지면 harness의 연산 상태 기계를 참고.
- **코드 스킬 / 스크립트 샌드박스** — Agent Skills 표준에 없는 개념이라 1차 스코프에서 제외했습니다 (§7). 신뢰할 수 없는 스킬을 격리 실행할 필요가 생기면 QuickJS 또는 컨테이너화를 재검토.
- 터미널 탭 — VivoStudio에는 있으나 스코프 제외.
- macOS/Linux 패키징 — Windows 우선, 이후 확장. (`run_shell`의 OS 분기는 처음부터 넣어 둡니다.)
- 백그라운드 상주(트레이) — 위키 감시·매크로 스케줄러는 앱 실행 중에만 동작한다. 상주가 필요해지면 후속 과제로 (§16, §17).

이 섹션에 항목을 추가/제거할 때는 반드시 `Docs/TODO.md`와 본 문서를 함께 갱신하십시오.

---

## 14. 자동 평가 시스템 — 폐기됨 (P11-03)

> Phase 10(2026-09-25 확정)으로 구현했던 자동 평가 기능은 Vanilla Commander 전환(P11-03)에서 삭제되었다. 코드는 제거되었고 DB 테이블은 신규 마이그레이션으로 DROP한다. 아래는 이력 요약이며, 상세는 `Docs/phases/Phase10-Evaluation.md`(폐기 헤더付き)를 참고한다.
>
> - 같은 평가셋을 여러 후보에 자동 실행해 5개 차원으로 비교·추천하던 시스템 (EvalRunner·Scorer·Arena·EEE 내보내기).
> - 평가 전용 승인 예외(§8.4 샌드박스 정책)도 함께 폐기 — 승인 훅에 예외는 없다.
> - 살아남은 것: 외부 연동 모듈만 `src/lib/integrations/`로 이관해 §15가 되었다.

---

## 15. 외부 연동 (구 §14.5, P11-02 이관)

- 에이전트 편집 화면의 프로바이더 선택에서 등록·관리한다 (설정 > 외부 연동 화면은 삭제, P11-50). 종류: `agent-cli`(Claude Code·Codex·Gemini CLI 등, PATH 자동 탐지 + 프리셋) — 평가 시절의 `llm-api` 종류는 클라우드 프로바이더 에이전트로 1회 변환 후 폐지.
- 허용 용도: `chat-agent`·`wiki-ingest`·`doc-parse` (평가 전용 목적은 제거). 동의 문구는 "채팅·파일 내용이 외부로 전송될 수 있음"으로 개정 → **동의 버전 상향(consent-v2, 기존 동의 무효화)**.
- **모든 외부 전송은 `src/lib/integrations/gateway.ts` 한 곳을 통과**한다. 마스터 스위치 → 활성화 → 동의·버전 → 용도 → 데이터 분류를 차례로 검사하고, 실패하면 전송하지 않는다. 성공·실패 모두 `integration_audit_log`에 기록하며, 설정 > 일반에서 감사 로그를 볼 수 있다.
- 채팅의 외부 에이전트 실행(P11-23)은 `callIntegration`을 거쳐 권한 검사·감사를 유지한다. 위키 파이프라인은 `wiki-ingest` 목적이 허용된 연동(또는 로컬 에이전트)만 쓴다 (§16).

---

## 16. 위키 (Phase 11 W3)

다운로드 폴더 감시 → 자동 분류·등록 파이프라인.

- **감시** (`watch_commands.rs`, P11-30): `wiki_watch_set(folders)`가 `notify-debouncer-full`(2초)로 묶인 이벤트를 `wiki://file-event {path, kind}`으로 발행. 임시 다운로드 파일(`.crdownload`, `.part`, `.tmp`, `~$*`) 제외, **크기 안정화**(1초 간격 2회 동일) 후 발행. 기본 감시 폴더 = OS 다운로드 폴더.
- **설정** (`settings.wiki`, P11-31): 감시 on/off·폴더 목록·이동 여부·보관 폴더(기본 `<WorkFolder>/wiki-inbox`)·분류 규칙(D6: 자동/날짜/순번/빈도)·필터(확장자 화이트리스트·최대 크기·제외 glob)·처리 프롬프트(기본값 + 초기화)·처리 에이전트(D5: 기본 = 기본 에이전트).
- **파이프라인** (`lib/wiki/pipeline.ts`, P11-32): 이벤트 → 필터 → 직렬 1건씩(채팅 실행 중이면 대기, `chatQueueManager` 조정) → ① 내용 추출(텍스트 직접·문서는 §16 파서·이미지는 비전 에이전트, 없으면 `waiting-vision`) → ② **LLM 1회 호출**로 `{classification, folderName, title, slug, summary, tags}` JSON 생성(zod 검증, 1회 재시도 후 날짜순 폴백; 에이전트 루프를 돌리지 않음) → ③ (옵션) 이동 + 원본 경로 기록 → ④ `wiki` 도구 ingest(출처: 이동 후 경로). 외부 처리 에이전트는 `wiki-ingest` 동의·목적 허용 시에만. StatusBar 위키 슬롯에 진행 표시. 처리 이력은 DB `wiki_jobs`.
- **문서 파서** (`lib/parsers/`, P11-33): `parseDocument(path)` — 우선순위: 사용자 지정 외부 파서(확장자별 CLI 템플릿 `{input}`/`{output}`/`{outputDir}`, stdout 또는 출력 파일; 프리셋 MarkItDown·Docling·Pandoc·LibreOffice; 실행 파일 검증·타임아웃은 `integration_run_cli` 규칙 재사용, 로컬 실행이라 동의 대상 아님) → 내장(pdfjs 텍스트 레이어·DOCX mammoth·XLSX/CSV SheetJS·PPTX Rust zip XML·텍스트) → 실패. 스캔 PDF(텍스트 레이어 없음)는 "외부 파서(OCR) 또는 비전 에이전트 필요"로 실패 사유 반환. `doc_read` 도구와 위키 파이프라인이 재사용. 설정 > 문서 파싱 연동에서 등록·테스트(P11-34).
- **UI**: `WikiPanel`(감시 토글·대기열·최근 처리·페이지 목록 → MD 뷰어), `WikiTab`(설정 편집 + 이력·재처리·원본 열기).

---

## 17. 매크로 (Phase 11 W4)

채팅 프롬프트 묶음의 저장·편의 실행·스케줄 자동 실행.

- **저장소** (P11-40): DB `macros` 테이블(이름·프롬프트 목록·에이전트·실행 위치·스케줄·마지막 실행 결과). localStorage에서 첫 실행 시 1회 이관. `MacrosContext` + `lib/macros/`(types·macrosRepo·migrate·launch·scheduler).
- **실행** (`launch.ts`): 매크로 전용 숨은 세션(`origin='macro'`)을 만들고 프롬프트를 대기 큐에 넣은 뒤 채팅 탭을 연다 (큐 처리는 `ChatTab`이 담당하므로 실행 중 대화 확인·승인 응답이 그대로 동작).
- **스케줄러** (`scheduler.ts`, P11-41, D7): `interval(분)`·`daily(HH:mm)`·`weekly(요일+HH:mm)`, 1분 틱, 동시 실행 1개, 채팅 실행 중이면 대기. 놓친 실행은 `catchUp` 옵션 시 1회 보충, 아니면 소진. 승인이 필요한 도구 호출이 나오면 **자동 승인하지 않고** 일시정지 + StatusBar 알림으로 사용자 확인 요청 (§8 — 승인 우회 금지). 앱 종료 중에는 동작하지 않는다 (OS 스케줄러 미사용, 트레이 상주 없음 — §13).
- **UI**: `MacroPanel`(목록·실행·스케줄 표시·세션 열기·새 매크로), `MacroEditorTab`(프롬프트 순서 편집·`@` 참조·에이전트·위치·스케줄·테스트 실행). 채팅의 매크로 저장 다이얼로그는 같은 저장소를 쓴다.
