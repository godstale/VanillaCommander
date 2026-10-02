# Fortress 진행상황 체크리스트 (TODO)

이 파일은 전체 프로젝트의 **단일 진행상황 트래커**입니다. 상세 작업 내용은 `Docs/phases/PhaseN-*.md`를 참고하십시오.

## 상태 표기 규칙

- `[ ]` 대기(아직 시작 안 함)
- `[~]` 진행중 (작업을 시작하면 즉시 이 상태로 바꿀 것 — 다른 에이전트와의 충돌 방지)
- `[x]` 완료 (완료 조건까지 확인한 뒤에만 표시)
- `[!]` 블로킹 이슈 있음 (아래 "이슈 로그"에 사유 기록)

각 작업 ID를 시작/완료할 때 **반드시 이 파일을 갱신**하십시오. 이 파일이 최신 상태가 아니면 다른 에이전트가 중복 작업을 하게 됩니다.

---

## Phase 0 — Foundation `[x]`

- [x] P0-01 pnpm+Vite7+React19+TS 스캐폴딩
- [x] P0-02 Tauri 2 통합
- [x] P0-03 Tailwind + shadcn/ui 설정
- [x] P0-04 Lint/Format/스크립트 정비
- [x] P0-05 기본 폴더 구조 생성
- [x] P0-06 .gitignore/README/초기 커밋
- [x] P0-07 Ollama 연결 스모크 테스트 스크립트
- [x] P0-08 에이전트 루프 스파이크 (모델별 tool-calling 검증)

## Phase 1 — Shell & Layout UI `[x]`

- [x] P1-01 타입 정의 + WorkspaceTabsContext + SidePanelContext
- [x] P1-02 ActivityBar
- [x] P1-03 WorkspaceLayout(리사이저블 스플릿)
- [x] P1-04 Workspace 페이지 조립
- [x] P1-05 SidePanel 라우터 + 4개 패널(초기)
- [x] P1-06 FileTree + Rust fs_commands
- [x] P1-07 CenterWorkspace + EditorTab(CodeMirror6) + ImageViewerTab
- [x] P1-08 Chat 탭 Placeholder + 시작 시 기본 탭 자동 오픈
- [x] P1-09 Settings 라우트 골격
- [x] P1-10 ThemeContext + 다크모드

## Phase 2 — Agent Runtime & Chat `[x]`

- [x] P2-01 Ollama 클라이언트 (/api/chat 스트리밍 + usage + 에러 분류)
- [x] P2-02 런타임 타입 + 훅 레지스트리 + 도구 레지스트리
- [x] P2-03 FortressAgent 루프 (턴 반복/큐/재시도/취소)
- [x] P2-04 시스템 프롬프트 섹션 빌더 + diff
- [x] P2-05 읽기 도구: read/ls/grep/find + 출력 절단
- [x] P2-06 변경 도구: write/edit + shell + web_search
- [x] P2-07 useChat 훅
- [x] P2-08 ChatTab 실동작 연결 (도구 카드/컨텍스트 게이지 포함)
- [x] P2-09 에러 처리/재시도 UI

## Phase 3 — Skills & AGENTS.md Loader `[x]`

- [x] P3-01 frontmatter 파서
- [x] P3-02 컨텍스트 파일(AGENTS.md) 계층 수집
- [x] P3-03 스킬 스캐너 (Agent Skills 표준 검증)
- [x] P3-04 프롬프트 노출 (`<available_skills>`)
- [x] P3-05 SkillsContext + 워크스페이스 신뢰 확인
- [x] P3-06 SkillListPanel + SkillViewerTab (진단 표시 포함)
- [x] P3-07 프롬프트 병합 (useChat에 데이터 전달)
- [x] P3-08 `/skill:name` 명시 호출

## Phase 4 — Session Storage & Compaction `[x]`

- [x] P4-01 tauri-plugin-sql 통합 + 엔트리 스키마 마이그레이션
- [x] P4-02 Repository 계층(sessions/entries/agents/settings)
- [x] P4-03 컨텍스트 재구성 (buildContext)
- [x] P4-04 ChatSessionsContext + ChatSessionList 실동작
- [x] P4-05 useChat ↔ DB 연결 + 탭 상태 영속화
- [x] P4-06 토큰 추정 (Ollama usage 기반) + 압축 예산 해석
- [x] P4-07 컷 포인트 + 대화 직렬화
- [x] P4-08 compact() + 훅 등록 + 오버플로우 복구
- [x] P4-09 압축 UI (배너/게이지/`/compact`)

## Phase 5 — Visualization & HITL `[x]`

- [x] P5-01 parseVisualBlocks
- [x] P5-02 MermaidViewer
- [x] P5-03 RechartsViewer + JSON DSL
- [x] P5-04 시각화 지침 프롬프트 섹션
- [x] P5-05 위험도 분류 + 승인 버스
- [x] P5-06 승인 훅 등록 + ApprovalDialog
- [x] P5-07 approvalMode 설정 연동

## Phase 6 — Agent Management UI `[x]`

- [x] P6-01 AgentsContext
- [x] P6-02 AgentListPanel 실동작
- [x] P6-03 AgentEditorForm / AgentEditorTab
- [x] P6-04 Agent 삭제 확인 + 기본 승격
- [x] P6-05 ChatTab에서 Agent 선택/전환
- [x] P6-06 Agent 사용 통계(축소 버전)

## Phase 7 — Polish & QA `[x]`

## Phase 8 — Internationalization (ko/en) `[x]`

- [x] P8-01 i18n 인프라 (Locale 타입, ko/en 사전, LanguageContext, 첫 실행 언어 선택 팝업, 설정 연동)
- [x] P8-02 Shell 그룹 문구 전환 (ActivityBar/TopMenuBar/FileTree/ChatSessionList/CenterWorkspace/Welcome/Settings/ErrorBoundary)
- [x] P8-03 Chat 그룹 문구 전환 (chat/*, ChatTab, useKeyboardShortcuts)
- [x] P8-04 Agents/Skills/Editor 그룹 문구 전환 (agents/skills/monitor/stats/viewer/editor/image)
- [x] P8-05 `pnpm lint`/`typecheck`/`test` 통과 + ko/en 실동작 확인

- [x] P7-01 텍스트/문구 일관성 점검
- [x] P7-02 키보드 단축키
- [x] P7-03 에러 바운더리 및 전역 예외 처리
- [x] P7-04 성능 점검
- [x] P7-05 Windows 패키징 점검
- [x] P7-06 수동 QA 시나리오 실행
- [x] P7-07 README/사용자 가이드

## Phase 9 — Follow-ups (P9) `[x]`

- [x] P9-06 채팅별 실행 설정 표시 ([i] 스냅샷·설정 변경 안내·동작 중 설정 잠금)
- [x] P9-07 생성 파라미터 확장 (top-p/top-k/반복 억제/seed/stop/최대 토큰 + Provider·모델별 비활성화 + [i] 상세 설명)
- [x] P9-08 대화 목록/사이드바/모니터링 개편 (삭제 에이전트명 취소선 표시·대화 전체삭제·스킬 사이드바 제거 후 에이전트 설정 카드+refresh·모니터링 사이드 패널 신설)

## Phase 10 — Automated Evaluation `[x]`

> 구현 계획: `Docs/phases/Phase10-Evaluation.md`(작업 상세·소유 파일·웨이브) · 팩 제작 명세: `Docs/phases/Phase10-Eval-Packs.md` · 설계 요약: `Docs/Architecture.md` §14 · 기획서: `Docs/plan/LLM_Evaluation_Plan.md`
> **확정 결정 D1~D6(2026-09-25)**: 전 범위 구현 / 결과는 전역 DB / 외부 API·에이전트는 사용자 허락 시에만 / 데이터셋 앱 번들(라이선스 예외는 임포터) / 평가 중 채팅 금지 / 가중치·기준값 확인 후 수동 시작.
> 착수 순서: W0(01→02·03) → W1(04~09, 콘텐츠 21~24는 01 이후 언제든) → W2(10→11~14) → W3(15→16~20, 25) → W4(26). 각 작업의 "선행"을 반드시 확인할 것.

- [x] P10-00 평가 방법론 조사·기획서·구현 계획서 작성
- **W0 — 기반**
  - [x] P10-01 평가 타입·zod 스키마·상수(앵커·프로파일 5종)·i18n 영역 골격
  - [x] P10-02 DB 마이그레이션(평가 7 + 연동 3 테이블, 전역 DB 전용) + `evalRepo`·`integrationsRepo` + 메모리 폴백
  - [x] P10-03 전역 평가 잠금(`evalLock`) + 채팅 전송·큐잉 차단 + 잠금 배너
- **W1 — 엔진 부품 (P10-01 이후 병렬)**
  - [x] P10-04 팩 로더(3계층·해시·층화 샘플링·JSONL/KMMLU CSV/CSV 어댑터·생성기 레지스트리)
  - [x] P10-05 결정적 채점기(exact/includes/regex/choice/numeric/json_schema/tool_call_ast/no_tool_call/viz_block) + 채점 조합
  - [x] P10-06 IFEval 체커 TS 포팅(영문 전 체커 + Ko-IFEval 한국어 체커)
  - [x] P10-07 통계(Wilson·부트스트랩·pass@k/pass^k·Bradley-Terry)·정규화·집계·추천·검정력
  - [x] P10-08 Rust 평가 커맨드(팩 IO·샌드박스·다운로드·런타임 감지·Python 실행·내보내기) + 번들 리소스 설정
  - [x] P10-09 외부 연동: 설정 페이지·동의·게이트웨이·에이전트 CLI 실행·감사 로그
- **W2 — 실행 엔진**
  - [x] P10-10 러너 코어(후보·매트릭스·사전점검·시간추정·하드웨어 지문·솔버 3종·자원 샘플러·체크포인트/이어하기)
  - [x] P10-11 에이전트형 솔버 + 샌드박스 정책 훅(§8.4) + fs_state/trajectory 채점 (파일 작업 평가 A3·스킬 A5)
  - [x] P10-12 LLM Judge 패스(로컬/외부, 순서 교체, 자기 채점 방지, 길이 편향 점검) + 사람 채점·일치도
  - [x] P10-13 코드 실행 채점(JS Worker 기본 + Python 옵트인)
  - [x] P10-14 logprobs 기능(객관식 확률 모드 + 양자화 충실도 Q8)
- **W3 — UI**
  - [x] P10-15 UI 골격(평가 탭·사이드 패널·ActivityBar·TopMenu·EvalContext·탭 헬퍼)
  - [x] P10-16 실행 마법사(프로파일/팩/후보·매트릭스/Judge/확인 — 가중치·기준값 확인 필수, 외부 전송·코드 실행 확인, 지금/나중에 시작)
  - [x] P10-17 진행 화면(후보×팩 매트릭스·실시간 미리보기·자원 차트·로그·일시정지/취소)
  - [x] P10-18 리포트(추천 3종·순위표·레이더·파레토·히트맵·컨텍스트 곡선·드릴다운·사람 채점·실행 비교·Q8 표)
  - [x] P10-25 가져오기(JSONL/CSV/promptfoo/HF 프리셋)·내보내기(EEE/CSV)
  - [x] P10-19 팩 관리·편집기 + 개인 평가셋(채팅에서 저장·일괄 초안·픽스처 캡처·비밀 마스킹)
  - [x] P10-20 로컬 Arena(블라인드 A/B, BT 리더보드)
  - [x] P10-27 실행 마법사 단순화(Quick/Standard/Full 자동조합·Advanced fold·[i] 안내·실행명 규칙 — P10-16 후속 UX 개편)
- **콘텐츠 (P10-01 이후 언제든, 로더 검증은 P10-04 이후)**
  - [x] P10-21 FAB-A: `fab-tools-select`(60) · `fab-tools-relevance`(40) · `fab-viz`(30)
  - [x] P10-22 FAB-B: `fab-fs-tasks`(30, 픽스처 4종) · `fab-skill`(10) · `fab-compaction`(10) + compaction_recall 솔버
  - [x] P10-23 FAB-C: `fab-longctx`·`fab-perf-probe` 생성기 · `fab-ko-writing`(20) · `fab-code-js`(40) · `fab-quant-probe`(30)
  - [x] P10-24 공개셋 번들: gsm8k·gsm8k-perturb·mmlu-pro·ifeval·ko-ifeval·kmmlu(원본 CSV)·kobest·humaneval-plus·bfcl + NOTICE + 임포터 프리셋
- **W4 — 마무리**
  - [x] P10-26 통합 QA(시나리오 10종)·UserGuide·QA-Checklist·README

## Phase 11 — Vanilla Commander 전환 `[ ]`

> 구현 계획: `Docs/phases/Phase11-VanillaCommander.md`. **§1.2 D1~D10은 사용자 확인 전까지 "제안" 상태** — 확인된 항목만 착수.

- **W0 — 정리·기반**
  - [x] P11-01 정보 구조 재편(ActivityBar·패널·탭 타입)
  - [x] P11-02 외부 연동 모듈 이관(`src/lib/integrations`)
  - [x] P11-03 평가 기능 제거
  - [x] P11-04 앱 설정 모델 + 작업 폴더 + 기본값 상수 + 허용 루트
  - [x] P11-05 StatusBar
  - [x] P11-06 셋업 위저드
- **W1 — 파일 탐색기**
  - [x] P11-10 Rust 파일 커맨더 커맨드
  - [x] P11-11 FileExplorerTab
  - [x] P11-12 탐색기 사이드 패널(탭 목록·즐겨찾기·시스템 폴더)
  - [x] P11-13 파일 작업 큐·충돌 처리·정보
  - [x] P11-14 파일 뷰어(PDF/DOCX/XLSX/PPTX/ZIP + 외부 앱)
  - [x] P11-15 탐색기 1줄 채팅 입력
  - [x] P11-16 `@` 파일/폴더 참조
- **W2 — 에이전트**
  - [x] P11-20 에이전트 카드 단순화
  - [x] P11-21 에이전트 편집 화면 단순화(Advanced 접기)
  - [x] P11-22 프로바이더 3분류 + 외부 연동 등록 통합
  - [x] P11-23 외부 에이전트 런타임
  - [x] P11-24 파일 커맨더 시스템 프롬프트 + 도구
  - [x] P11-25 기본 에이전트 폴백 동의
  - [x] P11-26 이미지 첨부 + 비전
  - [x] P11-27 모니터링 메뉴 정리
- **W3 — 위키**
  - [x] P11-30 폴더 감시(Rust)
  - [x] P11-31 위키 설정 + 위키 패널/탭
  - [x] P11-32 위키 처리 파이프라인
  - [x] P11-33 문서 파서 계층
  - [x] P11-34 설정 > 문서 파싱 연동
- **W4 — 매크로**
  - [x] P11-40 매크로 저장소 + 화면
  - [x] P11-41 매크로 스케줄러
- **W5 — 마무리**
  - [x] P11-50 설정 재구성
  - [x] P11-51 문서·브랜딩 정리
  - [ ] P11-52 통합 QA

---

## 이슈 로그

작업 중 설계 문서와 실제 구현이 충돌하거나, 소유 파일 범위를 벗어난 수정이 필요했거나, 막힌 문제가 있으면 아래에 날짜/작업ID/내용을 기록하십시오.

| 날짜              | 작업 ID | 내용                      | 상태   |
| ----------------- | ------- | ------------------------- | ------ |
| (예시) 2026-09-18 | P0-00   | 예시: 문서 초안 작성 완료 | 해결됨 |
| 2026-09-22        | DESIGN  | Midnight Rampart 테마 적용: 시맨틱 토큰(success/warning/info/tertiary/code/subtle) 추가, 컴포넌트의 원시 팔레트 클래스 → 토큰 치환, 차트/Mermaid/CodeMirror 팔레트 통일. **신규 의존성** `@fontsource-variable/geist`·`@fontsource-variable/jetbrains-mono`·`@fontsource/ibm-plex-sans-kr` — 로컬 퍼스트 원칙상 Google Fonts CDN 대신 폰트를 번들하기 위함. | 해결됨 |
| 2026-09-22        | DESIGN  | 다크 테마 눈부심 개선(tokens v1.1): 채도 높은 남색 → 차콜 중립(`#18191C` 계열), 본문 `#D9DBE1`(11.8:1), 강조색 채도 완화. Mermaid·CodeMirror 다크 팔레트 동기화. 참고: `Docs/screenshot/dark-theme-01.png` | 해결됨 |
| 2026-09-22        | DESIGN  | 브랜드: 목책 요새 로고(`design/brand/`, `FortressMark`), 앱 아이콘(`src-tauri/icons` 재생성), 파비콘, README 배너 적용. `--brand` 토큰 추가. 웰컴 화면 문구를 "로컬 LLM 테스트 & 모니터링 워크벤치"로 변경 | 해결됨 |
| 2026-09-25        | P9-01   | Reasoning/effort 제어 신규: Agent에 `reasoning`(`default`/`off`/`on`)·`reasoningEffort`(`low`/`medium`/`high`) 추가. Ollama `/api/chat` 최상위 `think` 필드로 전달(Ollama thinking capability 공식 지원 확인). 채팅 화면 세션 오버라이드는 메시지/프롬프트를 건드리지 않아 prefill 오버헤드 없음. DB `agents`에 `reasoning`·`reasoning_effort` 컬럼 추가(기존 행은 모델 기본값으로 해석). | 해결됨 |
| 2026-09-25 | P9-02 | 프로젝트 폴더 전환 규칙 강화: ① LLM 동작 중 폴더 변경 금지(`chatQueueManager` busy 가드 + `WorkspaceContext.setWorkspaceRoot` boolean 반환 + TopMenuBar/FileTree UI 비활성화), ② 에이전트는 전역 DB 그대로 공유(기존 `agentsRepo` 전역 분리 유지), 세션/엔트리/실행로그/탭은 프로젝트 `.fortress/fortress.db`에 저장(기존 `getDatabase` 라우팅 유지), ③ 전환 직전 이전 프로젝트 탭을 `saveProjectTabs`로 플러시하여 디바운스 경합 유실 방지(다음 로드 시 복원 보장), ④ `AgentEditorTab` 타이틀 라인에 "대화 시작" 버튼 추가. | 해결됨 |
| 2026-09-25 | P9-03 | 다중 LLM Provider 지원: Agent에 `llmProvider`/`llmBaseUrl`/`llmApiKey` 추가(Ollama 기본, 구 행 호환). 신규 `src/lib/llm/providers.ts`(7종 프리셋: ollama/lmstudio/llamacpp/vllm/jan/openai-compatible/openai) + `openAiCompatibleClient.ts`(SSE, 외부 SDK 없음) + `providerRuntime.ts`(분기점). 턴 루프·압축 요약·연결 상태·모니터링을 Provider 분기 처리. 에이전트 편집 화면 기본 정보 카드 아래에 "LLM Provider" 섹션 추가(ko/en 문구 포함). 추가 웹 리서치 결과는 `Docs/plan/Multiple_LLM_Providers.md` §4~§5에 기록. **신규 의존성 없음**. | 해결됨 |
| 2026-09-25 | P9-04 | 모니터링 토큰 추적: ① "대화"(요청 1건→agent_end) 단위 집계 — 턴별 usage 실측 합산(입력/출력), 사고 토큰은 출력 중 사고문 비율 안분, 상태별 출력은 prefill=입력/thinking=사고분/decoding=본문분 귀속. 신규 `src/lib/monitoring/tokenTracker.ts`(인메모리, 테스트 포함) + 루프 경계 훅(`loop.ts` begin/record/finish) + `conversation_token_summaries` 원장 테이블(영속, `monitoringRepo`+`client.ts` 메모리 폴백+`0001_init.sql` 동기화). ② 스냅샷에 `thinking_tokens`/`conversation_id`/`conversation_seq` + 타임라인 "토큰(입력/출력/사고)" 컬럼·대화 배지(`C#seq`). ③ 카드 재배치: VRAM+RAM → "메모리 분배" 병합, 빈 자리→GPU·VRAM 추이, 추이 자리→신규 "토큰 정보" 카드(전체 누적·상태별 점유·최근 대화 5건·진행 중 표시, ko/en 문구 포함). `pnpm lint`/`typecheck`/`test`(51파일 249건) 통과. **신규 의존성 없음**. | 해결됨 |
| 2026-09-25 | P9-05 | 채팅-에이전트 귀속 강화: ① `ChatInput` 에이전트 전환 셀렉터 삭제(각 채팅은 단일 설정에 귀속, `agentReasoning` prop으로 effort 비활성화만 유지). ② "새 채팅" 경로(TopMenuBar/대화목록/Ctrl+N/빈 탭)는 기본 에이전트로 세션 생성(기존 `createSession` 기본값 유지, `ChatSessionList`는 `session.agentId`를 탭 meta에 전달). ③ 채팅 상단 배지에 Provider 표시(`이름 • Provider • 모델`), `/agent` 출력에 Provider 행 추가. ④ 대화 목록 행에 `Provider • 모델 • Ctx nK` 표시, 시간은 타이틀 우측으로 이동. ⑤ 에이전트 편집 잠금: 해당 에이전트를 쓰는 세션이 LLM 동작/대기 큐 중이면(`useGlobalLlmBusy`+세션 매핑, 미확인 시 보수적 잠금) `AgentEditorForm` 입력·저장 비활성화 + 고지 배너. ⑥ 근본 설정(Provider·Base URL·모델) 변경 시 기존 유지 + 새 에이전트로 분기 저장(이름 동일 시 ` (v2)` 접미, `isDefault: false`), 저장 전 `forkNotice` 배너 + 저장 버튼 `agentForm.saveAsNew` 전환, 새 설정 테스트는 “대화 시작” 새 채팅으로 유도. `pnpm lint`/`typecheck`/`test` 통과(신규 테스트 2건: 잠금·분기). **신규 의존성 없음**. | 해결됨 |
| 2026-09-25 | P9-06 | 채팅별 실행 설정 표시: ① `ChatConfigSnapshot`(모델·Provider·temperature·ctx 크기·reasoning/effort·think 전달값 등) + `captureChatConfigSnapshot`/`chatConfigSignature` 신규(`src/lib/types/agent.ts`). 전송 시점 스냅샷을 사용자 메시지에 첨부(`useChat.sendMessage`, 메시지 JSON 저장이라 DB 마이그레이션 없음, 구 행은 현재 설정 폴백 + 폴백 고지). LLM 매핑·압축 직렬화는 `content`만 사용하므로 영향 없음. ② 사용자 말풍선 푸터에 [i] 버튼 + 설정 상세 패널(`MessageBubble`, ko/en 문구 포함). ③ 설정 변경 시 채팅 중간 중앙 배지로 안내(`ChatTab` 서명 감지 + `useChat.injectConfigNotice`, UI 전용 미저장·LLM 미전송). ④ LLM 동작/대기 큐 점유 중 reasoning/effort 셀렉터 비활성화(`ChatInput` settingsLocked + `settingsLocked` 문구). `pnpm lint`/`typecheck`/`test`(52파일 260건) 통과. **신규 의존성 없음**. 소유 파일 밖 수정(Phase 문서에 P9 소유 목록 없음): `ChatInput.test.tsx`에 잠금 테스트 2건 추가. | 해결됨 |
| 2026-09-25 | P9-07 | 생성 파라미터 확장: Agent에 `topP`·`topK`·`repeatPenalty`·`frequencyPenalty`·`presencePenalty`·`seed`·`stopSequences`·`maxOutputTokens` 추가(미지정=자동, 필드 생략). 신규 `src/lib/llm/generationParams.ts`(Provider 지원 매트릭스·정규화·Ollama options/OpenAI body 매핑·effort 레벨 지원 판정, 테스트 포함). 런타임은 각 클라이언트가 자기 규격 키로만 변환(Ollama `top_p/top_k/repeat_penalty/seed/stop/num_predict`, OpenAI 호환 `top_p/frequency_penalty/presence_penalty/seed/stop/max_tokens`) + OpenAI 클라이언트의 Ollama 전용 키 제거 목록 확대. 편집 폼에 "생성 파라미터" 카드 + 전 파라미터 [i] 상세 설명(ko/en) + 미지원 항목 입력 잠금(값 유지, Ollama 전용/OpenAI 전용 뱃지) + effort 레벨 미지원 모델의 effort 잠금. 스냅샷·서명·말풍선 [i] 패널·`/agent` 출력에 생성 파라미터 반영. DB `agents`에 8컬럼 추가(기존 행은 자동 해석, `client.ts` 메모리 폴백·`0001_init.sql`·`agentsRepo`·테스트 목 동기화). `Architecture.md` §4.2·§5.8 갱신. **신규 의존성 없음**. | 해결됨 |
| 2026-09-25 | P9-08 | 대화 목록/사이드바/모니터링 개편: ① 삭제 에이전트 세션도 기억된 이름 표시 + 취소선(`AgentsContext` id→name 캐시 localStorage 영속 + `getKnownAgentName`, 행/그룹헤더 `line-through`, 미확인분은 기존 `sessions.agentDeleted` + `(삭제됨)` 접미). ② 대화 목록 전체삭제(헤더 휴지통 + `clearSessions` + 관련 채팅탭 일괄 닫기 + 확인 팝업 필수). ③ 스킬 사이드바 제거(`SidePanelView.skills`→`monitoring`, ActivityBar/TopMenuBar/SidePanel 교체, `SkillListPanel` 파일은 유지) + `AgentEditorForm` "활성 스킬" 카드 상시 표시·on/off·refresh 버튼(스킬 0개/로딩/empty 안내 포함). ④ 모니터링 사이드 패널 신설(`MonitoringListPanel`: 최근 스냅샷 200건, 대화 목록과 동일한 전체/에이전트/Provider/모델/상태 필터·그룹화, 행 클릭 시 모니터 탭 오픈, 개별 삭제 + 전체삭제 확인 팝업). 신규 `monitoringRepo.listRecentMonitoringSnapshots`/`deleteMonitoringSnapshot`/`clearAllMonitoringSnapshots`/`clearAllConversationSummaries` + `client.ts` 메모리 폴백(id 단건삭제·LIMIT) + `monitoringGroups.ts`(테스트 포함). `Architecture.md` §3.1·§3.2·트리 갱신, ko/en 문구 추가. `pnpm lint`/`typecheck`/`test`(55파일 290건) 통과. **신규 의존성 없음**. | 해결됨 |
| 2026-09-25 | P10-00 | 자동 평가 기능 기획 확정(D1~D6) 및 구현 계획 수립. 신규 문서: `Docs/phases/Phase10-Evaluation.md`, `Docs/phases/Phase10-Eval-Packs.md`, `Docs/plan/LLM_Evaluation_Plan.md`(확정본), `Docs/plan/LLM_Evaluation_Research.md`. `Architecture.md` §2·§3.1·§3.2·§3.3·§4.5·§8.4(평가 샌드박스 정책 = 승인 훅의 유일한 예외)·§12·§14 갱신, `ImplementationPlan.md`에 Phase 8~10 추가. 라이선스 확인 결과 HAE-RAE(CC-BY-NC-ND)·GPQA(평문 공개 금지 요청)·CLIcK·LogicKor(라이선스 미확인)는 번들 불가 → 임포터만 제공, KMMLU(CC-BY-ND)는 원본 CSV 무수정 번들. **신규 의존성 없음(계획)**. | 해결됨 |
| 2026-09-25 | P9-09 | wiki 내장 도구 신설(단일 `wiki` 도구, `action: ingest/query/list/delete`): llm-wiki 스킬의 온톨로지·그래프·백업 제외, 등록/조회/삭제 기본기만 추출. 저장 위치는 `{workspaceRoot}/wiki/`(`sources/<slug>.md` + `index.md`/`log.md` 부기). `BuiltinToolId`에 `wiki` 추가(risk `low`, sequential), `DEFAULT_ACTIVE_TOOLS`·신규 에이전트 기본값·`ALL_BUILTIN_TOOLS` UI에 기본 선택으로 등록, ko/en `agentForm.tool_wiki` 문구 추가. 기존 `.agents/skills/llm-wiki`는 그대로 유지. `Architecture.md` §2·§4.2 갱신. **신규 의존성 없음**. | 해결됨 |
| 2026-09-25 | P9-10 | 대화 시작 시 자동 모니터링: Agent에 `autoMonitor`(기본 on, 미지정 구 행은 켜짐) 추가. DB `agents`에 `auto_monitor` 컬럼 추가(`0001_init.sql`·`client.ts` 마이그레이션/메모리 폴백·`agentsRepo`·테스트 목 동기화). `monitoringCollector`에 자동 소유권(`startAuto`/`stopAuto`/`isAuto`) 추가 — 수동 시작분은 자동 중단하지 않음. `useChat`이 전송/`agent_start` 시 자동 시작, `agent_end`·`error`·`stop()`·세션 정리 시 자동 중단(대화 시작→모니터링 상태, LLM 작업 완료→중단). `AgentMonitorTab`은 수집 실행 상태를 폴링 동기화 + 자동 수집 중에는 탭을 닫아도 수집을 유지. `AgentEditorForm`에 "자동 모니터링" on/off 카드 + ko/en 문구. `Architecture.md` §4.2 갱신. `pnpm lint`/`typecheck`/`test` 통과. **신규 의존성 없음**. | 해결됨 |
| 2026-09-25 | P10-26 | 통합 마무리: P10-25 인수(변환기·EEE/CSV 내보내기 30건) + PackManager/EvalReport에 가져오기·내보내기 마운트 + EvalTab 5뷰 배선 + UserGuide 8장·QA-Checklist EV-01~10(UNVERIFIED, tauri-dev 실동작 필요)·README 기능 1줄. 최종 검증 `lint`·`typecheck` 통과, `test` 967/968(유일 실패는 기존 bundledSkills CRLF). 수동 QA 10종과 `tauri dev` UI 확인은 실머신에서 수행 필요. | 해결됨 |
| 2026-09-25 | P10-24 | 공개셋 9종 번들(gsm8k 1319·perturb 100·mmlu-pro 1400·ifeval 541·ko-ifeval 342·kmmlu 원본 CSV 45·kobest 1000·humaneval-plus 164·bfcl 500) + 변환 스크립트 11종 + NOTICE + 임포터 프리셋. KMMLU math-test.csv 7~8열 스왑 발견 → 원본 무수정 + 이름 기반 매핑(공유 파일 수정, 하위 호환). "체커 누락" 보고는 오탐으로 확인(멀티라인 등록, 25개 ID 전부 해소). 테스트 55건, `typecheck`·`lint` 통과. | 해결됨 |
| 2026-09-25 | P10-05~09 | W1 엔진 부품 완료. P10-05(결정적 채점기 10종+combine, 테스트 51건)는 분기 산출물 없이 직접 구현. P10-06(IFEval 25종+한국어 2종, 88건) — `registerIfevalScorer`의 동적 import 해킹을 정적 등록으로 교체 + `IfevalScoreInput.toolCalls`를 `ScorerInput`과 일치시킴(소유 파일 수정, 통합용). P10-07(통계·정규화·집계·추천, 45건). P10-08(Rust 14 커맨드, cargo check/test 통과) — `SandboxSnapshot`이 `scorers/types.ts`와 `runner/sandbox.ts`에 구조 동일하게 이중 정의됨(P10-11은 scorers 쪽을 정식으로 사용, 구조적 호환). P10-09(외부 연동 UI+게이트웨이+Rust CLI, 41건) — CLI 프리셋 미검증으로 제외. 전체 `pnpm test` 608/609(유일 실패는 기존 bundledSkills CRLF), `typecheck`·`lint` 통과. | 해결됨 |
| 2026-09-25 | P10-03 | 전역 평가 잠금(`src/lib/eval/evalLock.ts`, 가상 세션 `eval:<runId>` busy 등록으로 폴더 전환·에이전트 편집 잠금 자동 적용) + `useChat.sendMessage`·`ChatTab.handleSendMessage` 가드(큐에 넣지 않음) + `ChatInput` 입력·전송·슬래시·셀렉터 비활성화 + `EvalLockBanner` + `eval/lock` ko/en 문구. `useChat` 가드는 번역 컨텍스트가 없어 조용히 복귀하고 알림은 UI 층(배너·placeholder)이 담당 — 기존 `useChat` 테스트가 LanguageProvider 없이 렌더링되므로 `useLanguage`를 넣지 않음. 테스트 6건(evalLock 5 + ChatInput 1), `pnpm lint`/`typecheck` 통과. | 해결됨 |
| 2026-09-25 | P10-02 | 평가·연동 10 테이블 마이그레이션(`0001_init.sql`+`MIGRATION_STATEMENTS` 동기화) + `evalRepo`(run/candidate/trial/score/aggregate/profile/arena) + `integrationsRepo`(연동/설정/감사) + `MemorySqlFallback` 핸들러. 전역 DB 전용(`getGlobalDatabase`). 테스트 15건, `pnpm lint`/`typecheck` 통과. | 해결됨 |
| 2026-09-25 | P10-01 | 평가 타입·상수·i18n 골격 구현(`src/lib/eval/types.ts`·`constants.ts`·`types.test.ts`, `src/lib/i18n/dictionaries/eval/` 12영역 ko/en + index, ko/en 스프레드). `pnpm lint`/`typecheck`/신규 테스트(4건) 통과. 전체 `pnpm test`는 기존 실패 1건(`bundledSkills` CRLF 정규식, P10-01 무관·클린 트리에서도 재현) 제외하고 통과. | 해결됨 |
| 2026-09-25 | P9-11 | 앱 기본 제공 스킬 `basic-llm-wiki` 신설: llm-wiki에서 온톨로지·그래프·백업·lint·스크립트를 모두 제거하고 등록/조회(목록·검색)/삭제만 남긴 단일 `SKILL.md`(`src/lib/skills/bundled/basic-llm-wiki/`, 레이아웃은 `wiki` 도구와 동일한 `wiki/sources`·`index.md`·`log.md`). `bundledSkills.ts`(`BUNDLED_SKILLS`, `installBundledSkills`) + `src/vite-env.d.ts`(`?raw` 타입). `AgentEditorForm` 활성 스킬 목록에 미설치 번들 스킬을 `앱 기본 제공` 배지로 노출, 활성화 후 저장 시 워크스페이스 `.agents/skills/basic-llm-wiki/`로 복사(기존 파일 미덮어쓰기) 후 스킬 재스캔. 리포 루트 `.agents/skills/llm-wiki`는 미변경. 테스트 3건 추가, `pnpm lint`/`typecheck`/`test`(58파일 325건) 통과. **신규 의존성 없음**. | 해결됨 |
| 2026-09-27 | P10-27 | 실행 마법사 단순화 개편(P10-16 후속, 소유 파일 범위 내). 설계 변경점: ① 평가셋 단계의 `Smoke-all/Standard/Full` 일괄 티어 버튼 → `Quick(~30분)/Standard(~90분)/Full` 크기 선택으로 교체(프로파일 가중치·팩 tier 실측 기반 자동조합, 신규 `wizard/sizePresets.ts`). smoke-all도 팩 20종 합산 약 290샘플+agentic/long_context로 3시간+가 걸렸던 것이 원인. ② 팩별 세부·매트릭스·Q8·실행옵션은 Advanced fold로 이동. ③ `Judge 설정` 문구를 `평가 모델 설정`으로 변경(키 유지, 값만 변경). ④ Q8 토글이 실행 설정에 미반영되던 문제(상태만 있고 `buildRunConfig`에 전달 안 됨) → 켜면 `fab-quant-probe` 팩 자동 포함으로 연결. ⑤ 실행명 규칙 `{첫후보명}_{프로파일}_{날짜}` 자동 제안(사용자 수정 시 유지). ⑥ 다음 버튼 비활성 사유 문구 + 단계별 [i] 안내 추가(`AgentEditorForm` ParamInfo와 동일 패턴). 외부 프론티어 LLM 후행 평가는 이번 범위 제외(후속 제안으로 남김). `Docs/phases/Phase10-Evaluation.md` P10-16절의旧 프리셋 설명과 달라지므로 해당 문서 동기화가 필요. **신규 의존성 없음**. | 해결됨 |
| 2026-09-27 | EVAL-PACKS-EMPTY | 평가 팩 목록 빈 표시 수정: ① `packFs.ts`·`FixtureCapture.tsx`의 invoke 인자를 snake_case → camelCase로 통일(Tauri 명령 인자는 camelCase 자동 매핑, `ipc.ts`·`read.ts`와 동일 규약. 중첩 `files[]`의 `rel_path`는 Rust 구조체 필드라 snake_case 유지). ② `packLoader.ts`에 생성기 side-effect import(`longContext`·`perfProbe`) 추가 — 미등록 시 생성기 팩 로드 실패. 관련 테스트 24건·`typecheck`·`lint` 통과. | 해결됨 |
| 2026-09-27 | EVAL-RUNUX-A | 평가 등록·실행 UX 개편 Phase A: ① 마법사 완료 팝업 문구 "평가가 등록되었습니다"+설명, 버튼 [나중에 실행/즉시 실행]으로 변경. 팝업을 닫는 모든 경로에서 위자드 탭(`eval:wizard`) 정리, 즉시 실행은 실행 탭을 먼저 열고 `startRun`을 비동기로 띄움(기존에는 완료까지 dialog가 블로킹). ② `EvalRunner` pause/resume/cancel/skip 요청 시 로그 이벤트 발행 + `EvalContext.pausePending` 신설 — 진행 화면에 "일시정지 대기 중" 배지·비활성 버튼 표시(기존에는 눌러도 무반응). ③ 평가 패널 "평가셋 관리" 버튼에 팩 0개/오류 시 ! 뱃지+경고 타이틀. ④ 매트릭스 카드명 "후보별 평가 현황"으로 변경, 가로 스크롤 표 → 동일 크기 반응형 그리드+카드 클릭 시 하단 상세(결과 분포·점수·항목 목록), 상단에 테스트 대상/평가 모델 정보. ⑤ 진행 화면 리소스 카드 삭제, 헤더·컨트롤·현황·미리보기·로그에 [i] 안내 추가. `pnpm lint`·`typecheck` 통과, 관련 테스트 20건 통과(전체는 기존 실패 4건만 — bundledSkills·fab-b·public-packs, 클린 트리 재현 확인). **신규 의존성 없음**. | 해결됨 |
| 2026-09-27 | EVAL-RUNUX-B | 평가 실행 과정 수집·파일 저장·재조회(Phase B): ① Rust 신규 명령 `eval_append_run_log`·`eval_read_run_log` — `{workspace}/.fortress/eval-runs/<runId>/progress.jsonl`에 JSONL 추가/읽기(활성 워크스페이스 일치 검사·run_id 검증·containment·1MB/2MB 캡, 테스트 2건). ② 신규 `runner/progressLog.ts`(레코드 9종: run_started/hardware·status·candidate·trial_started/finished(타이밍·자원·점수)·resource·log·run_finished(종합 포함)+배치 Writer(실패해도 실행 불변)+파서·로그병합·자원투영, 테스트 6건). ③ `EvalRunner` 전 경로 기록(재개 시 이어쓰기, 스트리밍 델타·ETA 제외, 종료 시 종합 포함, 러너 테스트 1건 추가). ④ 진행 화면: 실행 환경 카드(GPU·VRAM·RAM·OS·버전·옵션·최근 측정)+후보별 결과·자원 카드(진행·평균·결과분포·로드·자원·속도·종합)+파일 기반 실행 로그(재시작 후에도 조회·다운로드 버튼·경로 안내). `cargo check/test`·`lint`·`typecheck` 통과, `pnpm test` 983/987(실패 4건은 기존 bundledSkills·fab-b·public-packs). **신규 의존성 없음**. | 해결됨 |
| 2026-09-27 | EVAL-PROGRESS-FIX | 평가 진행 화면 4건 수정. 원인 확정: ① "후보별 결과·자원" 텍스트 요약 → `CandidateResults`를 모니터링식 5카드(오프로딩 이중 바·메모리 분배·GPU·VRAM 추이 미니차트·토큰 정보·모델 아키텍처)로 재작성(`hardware`+`pendingTrialIds` prop 추가). ② FAB Q4 1개만 100%·Q5 전체 무표시는 버그가 아니라 비동기 채점기(`llm_judge_rubric` 0.8 / `code_exec`)가 본 루프에서 건너뛰어진 것 — 매트릭스 셀/항목별 "확정 전 n·부분·채점 대기" 배지+안내 문구 추가(신규 `scorers/deferredScorers.ts`, ko/en 문구). ③ Q5는 `code_exec`를 실행하는 패스가 아예 없어 영원히 0건이었음 → 신규 `runner/codeExecPass.ts`(멱등, JS Worker 로컬 실행·Python은 기존 확인 게이트, `source:'auto'`)를 본 루프→Judge 전에 연결(`RunnerDeps.codeExecPass`, `EvalContext` 배선). ④ GSM8K timeout 후 정체: 단일 trial 기록 실패가 전체 실행을 `failed`로 끝내던 경로를 루프 내 try/catch로 격리(다음 항목 계속, `done` 진행 보장)+timeout 로그·3회부터 연속 타임아웃 경고 추가. 테스트 8건 추가(패스 멱등 2·타임아웃 후 완주·패스 호출·매트릭스 배지·5카드 렌더). `lint`·`typecheck` 통과, `pnpm test` 988/992(실패 4건은 기존 bundledSkills·fab-b·public-packs와 동일). **신규 의존성 없음**. | 해결됨 |
| 2026-09-27 | EVAL-MONITOR-LAYOUT | "후보별 결과·자원" 섹션을 "평가 모니터링"으로 개명(`results.title` ko/en)+후보별 블록 내부를 모니터링 화면과 같은 행 구조로 재배치(1행 3열: 오프로딩/메모리 분배/추이, 2행 2열: 토큰/아키텍처). 기존 `grid-cols-2`에서 토큰 카드가 반 칸을 차지해 우측 여백이 생기던 문제 해소. 후보 블록은 세로 스택으로 변경(좁은 폭에서도 3열 카드가 찌그러지지 않음). 관련 테스트 타이틀 단언 갱신, `lint`·`typecheck`·관련 67건 통과. **신규 의존성 없음**. | 해결됨 |
| 2026-09-27 | EVAL-MONITOR-CARDS | 평가 모니터링의 토큰·아키텍처 카드를 모니터링 화면과 동일 사양으로 교체. 토큰: `monitor.*` 문구 재사용(입력/출력/사고/전체 4타일+색상)+최근 trial 5건 목록(샘플·결과·턴·입/출/사고)+속도/측정 행 유지. 아키텍처: 6타일(아키텍처/레이어 수/임베딩 차원/어텐션 헤드/KV 헤드/FFN 차원)+모델 태그, 값은 Ollama `/api/show` 조회(`useArchInfo`, ollama 후보만·실패 시 '—'·전역 캐시로 재조회 방지, 비-Ollama는 설정 푸터만). 미사용 eval 문구 6건 제거(ko/en 패리티 유지). `lint`·`typecheck`·관련 24건 통과. **신규 의존성 없음**. | 해결됨 |
| 2026-09-27 | EVAL-MONITOR-ROW1 | 평가 모니터링 1행 3카드도 모니터링 화면과 동일 구조로 교체. 오프로딩: GPU 오프로딩 비율 이중 바+가속/분배 라벨+GPU VRAM/시스템 RAM 박스(피크 기반 여유 계산, RAM 여유 미측정 시 전체만). 메모리 분배: VRAM(사용 피크+여유 스택)/RAM(전체) `BarChart`(범례·단위·집계중 문구 동일). 추이: trial 시각 X축+좌 %/우 GB 이중축 `AreaChart`+범례+건수 타이틀. 카드 크롬 통일(아이콘+`rounded-xl`+`p-4`). trial 자원으로 계산 불가한 KV/가중치 분할은 두지 않고 사용(피크)/여유/전체로 정직 표기(신규 `memUsed`·`memTotal` 키). 대체된 eval 문구 7건 제거(ko/en 패리티 유지). `lint`·`typecheck`·관련 24건 통과. **신규 의존성 없음**. | 해결됨 |
| 2026-09-29 | CHAT-MONITOR-MD-UX | 채팅·모니터링·설정 UX 10건 일괄. ① 빈 새 채팅 lazy 생성(대화 목록 5개 진입점의 즉시 `createSession` 제거, 첫 전송 시에만 DB 등록 + `ChatSessionsContext.refreshSessions`에서 빈 세션 숨김·60초 경과분 정리 + `ChatTab` 언마운트 정리). ② macOS 통합 메모리(`system_commands.rs`에 sysctl/vm_stat RAM 조회 + Apple GPU면 전체 풀을 VRAM으로 미러, Linux는 `/proc/meminfo` 추가) + 모니터링 수집기 통합 메모리 판정(가중치·KV 전량 VRAM 귀속, 모델 매칭 exact 우선으로 `qwen3.5:*` 오귀속 방지, KV는 모델 contextLimit 클램프+양자화별 원자 크기+`head_dim` 지원, dims 누락 시 0 반환으로 허수 GB 차단). ③ `/api/show` 별칭 파싱(`hidden_size`·`num_layers`·`num_attention_heads`·`num_key_value_heads`·`intermediate_size`·`max_position_embeddings` 등, MLX 키 대응) + 아키텍처 카드 `Q4_K` 하드코딩 제거 + 통합 메모리 배지(`monitor.unified` ko/en). ④ 채팅 MD(`.chat-markdown` CSS: bold/표/리스트/인용/제목) + `MessageBubble` memo + `language-[\w+#-]+` 수정 + 스트리밍 중 mermaid 렌더 보류·디바운스 250ms·테마 초기화 1회·`securityLevel strict`·안정 id. ⑤ 입력창 프롬프트 히스토리(↑/↓, 전역 최근 100, 초안 보존, 한 줄 입력에서만) + 대화 로그 저장/불러오기(세션별 localStorage, 불러오면 전량 일시정지 큐로). ⑥ temperature 기본 0.2(`DEFAULT_TEMPERATURE`, 슬라이더 상한 2.0으로 정정) + 압축 단계표(8K→2K/1K·16K→4K/2K·24K→6K/4K·32K±→8K/8K, `Architecture.md` §4.2·§9.1 동기화). ⑦ 전역 기본값 3종(`defaultTemperature`·`defaultReserveTokens`·`defaultKeepRecentTokens`, `app_settings` 마이그레이션+메모리 폴백+`SettingsModel` 전면 개편·항목별 [?]·적용값 미리보기). ⑧ 내장 `wiki` 도구 에디터 UI 제거(런타임 등록은 기존값 호환 유지, `basic-llm-wiki` 스킬로 대체). `lint`·`typecheck` 통과, `test` 990/994(실패 4건은 기존 bundledSkills·fab-b·public-packs). **신규 의존성 없음**. | 해결됨 |
| 2026-09-30 | TAURI-BLANK | `pnpm tauri dev`에서 Tauri 창이 완전 빈 화면(브라우저 `localhost:14200`은 정상). 원인 확정: `tauri.conf.json` CSP의 `connect-src`에 Tauri IPC(`ipc: http://ipc.localhost`) 누락 — 공식 예제(`v2.tauri.app/security/csp`)는 포함. `img-src`에 `http://asset.localhost` 추가. 프록시 없음·WebView2 154 확인. CSP 수정 후 `tauri dev` 정상 표시 확인. | 해결됨 |
| 2026-10-02 | RENAME | 앱 내 Fortress 명칭 → Vanilla Commander 일괄 변경: 화면 문구·프롬프트·창 제목(productName `Vanilla Commander`)·로그 파일명·localStorage 키(`fortress*` → `vanilla-commander*`)·DB(`fortress.db` → `vanilla-commander.db`)·워크스페이스 폴더(`.fortress` → `.vanilla-commander`)·`FortressAgent` → `VanillaAgent`·`ensure_fortress_dir` → `ensure_app_data_dir`. 구 데이터는 첫 실행 시 자동 이관(`legacyStorageMigration.ts`, Rust `rename_legacy_db_files`, DB의 `Fortress Default` 에이전트명 갱신). 평가 모듈 내부 포맷 식별자(`fortress-default` 등)와 Docs/ 과거 기록 문서는 유지(P11-03 삭제·P11-51 문서 정리에서 처리). 참고: `core.autocrlf=true` 체크아웃으로 SKILL.md·평가 팩이 CRLF가 되어 테스트 4건 실패(기존 문제, `.gitattributes`로 `eol=lf` 지정 필요) | 해결됨 |
| 2026-10-02 | P11-00 | Phase 11 설계 결정 D1~D10 사용자 확인 완료 — 전부 제안대로 확정. 이에 따라 P11-01 착수(브랜치 `feat/phase11-w0-foundation`). | 해결됨 |
| 2026-10-02 | P11-01 | 소유 파일 밖 최소 수정(빌드 유지 목적, 원 소유 작업에서 인수 예정): `WorkspaceTabsContext.tsx`(복원 시 삭제된 탭 타입 필터 5줄, 확인 기준 요구) · `Workspace.tsx`(폴더 미선택 게이팅 해제, D2) · `SidePanelContext.tsx`(폴더 미선택 강제 explorer 해제, D2 — ActivityBar 게이팅 제거와 세트) · `EvalTab.tsx`(EvalTabView import 제거, P11-03 인수) · `openEvalTab.ts`+test(단일 캐스트 상수, P11-03 인수) · `AgentListPanel.tsx`(통계/로그 버튼 → agent-monitor 임시 연결, P11-20 인수) · `WorkspaceNoFolder.test.tsx`(게이팅 제거 반영). CenterWorkspace의 eval/agent-stats case 삭제 + 신규 5종 placeholder. V7(기본 탭=파일 탐색기)은 FileExplorerTab이 나오는 P11-11에서 전환(지금은 채팅 유지). 검증: `lint`·`typecheck`·`build` 통과, `test` 1003/1007(실패 4건은 기존 bundledSkills·fab-b·public-packs CRLF 문제와 동일). | 해결됨 |
| 2026-10-02 | P11-02 | 외부 연동 이관 완료(git mv로 히스토리 유지): `lib/eval/integrations` 4모듈+테스트 → `lib/integrations/`, 다이얼로그 3종 → `components/integrations/`, 연동 i18n → 신규 `integrations.{ko,en}.ts`(평가 문구 개정·신규 목적 키). `integrations/types.ts` 신설(목적 chat-agent/wiki-ingest/doc-parse, consent-v2로 기존 동의 무효화). `integration_run_cli`에 `cwd` 선택 인자 + 워크스페이스 containment 검사(Rust 테스트 포함). 소유 밖 최소 수정(P11-03 인수): judgePass·runner·preflight·StepReview·StepCandidates·arenaUtils의 구 목적 캐스트/경로. 검증: `lint`·`typecheck` 통과, `cargo test integration_commands` 7건 통과, `test` 1003/1007(실패 4건은 기존 CRLF 문제와 동일). | 해결됨 |
| 2026-10-02 | P11-03 | 평가 기능 제거 완료(약 200파일): `components/eval`·`lib/eval`·`EvalContext`·`evalRepo`·`EvalTab`·eval i18n·`eval_commands.rs`(핸들러 15종 제거)·`resources/evals`(번들 해제)·채팅 evalLock 차단 코드·메시지 저장 버튼. DB는 append-only 원칙대로 CREATE 유지 + DROP 7종 추가(연동 3종 유지). `EvaluationGuide`·Phase10 문서에 폐기 헤더. 검증: `lint`·`typecheck`·`build`·`cargo check/test`(18건) 통과, 잔여 eval import 0건(Ollama `prompt_eval_*` 제외), `test` 383/384(유일 실패는 기존 bundledSkills CRLF — fab-b·public-packs 실패는 테스트 파일 삭제로 해소). | 해결됨 |
| 2026-10-02 | P11-05 | StatusBar 완료: `StatusBarContext`(슬롯 publish/clear + 5초 일시 메시지 notify), 하단 `StatusBar`(좌측 슬롯 + 우측 메시지), 기본 퍼블리셔(기본 에이전트명·모델·연결 상태·실행 중, 60초 재확인), `statusBar` 사전, 컨텍스트 테스트 3건. 나머지 슬롯은 각 기능 작업이 퍼블리시한다. 검증: `lint`·`typecheck` 통과, `test` 389/390(유일 실패는 기존 bundledSkills CRLF). | 해결됨 |
| 2026-10-02 | P11-04 | 설정 모델 + 작업 폴더 + 허용 루트 완료: `agent/defaults.ts` 신설(V4·V6: 승인 dangerous-only·셸 제외 전체 도구·basic-llm-wiki·temperature 0.2) + `DEFAULT_AGENT` 연결. settings에 setupCompletedAt·workFolder·favorites·agentAllowedRoots·wiki·parsers 블록 추가(6 컬럼, zod 검증, 메모리 폴백·ALTER 동기화, round-trip 테스트 3건). `WorkspaceContext`에 workFolder/setWorkFolder/ensureWorkFolderLayout + Rust 허용 루트 동기화. Rust: `set_active_workspace` → `set_agent_allowed_roots`(정규화 저장), 검증은 허용 루트 기준(명시 루트 우회 차단), 사용자 명령은 canonicalize만(`resolve_user_path`, reveal 적용), `ensure_work_folder_layout` 신설(Rust 테스트 3건). 부수 수정: 메모리 폴백의 전체 UPDATE 유실 버그(탭 전용 prefix 오매칭) 수정 + projectDb 테스트 기대값 정정. fc_* 분할(P11-10)이 D1 사용자/에이전트 분리를 완성한다. 검증: `lint`·`typecheck`·`build`·`cargo test`(21건) 통과, `test` 386/387(유일 실패는 기존 bundledSkills CRLF). | 해결됨 |
| 2026-10-02 | P11-06 | 셋업 위저드 완료: 6단계(언어·작업 폴더·에이전트·위키·매크로·완료) + 단계별 적용/건너뛰기, 재실행은 현재값 프리필, 완료 시 기본 에이전트 편집 탭 자동 오픈(D9). `LanguageSelectDialog`는 위저드 1단계로 흡수(파일 삭제). 진입점 `/?setup=1`(설정 > 일반에 재실행 버튼 — P11-50 화면 소유이나 최소 버튼 1개 추가). 첫 실행 판정은 `setupCompletedAt == null`. 검증: `lint`·`typecheck`·`build` 통과, 위저드 테스트 1건(6단계 완주·setupCompletedAt·에이전트 생성) 통과, `test` 390/391(유일 실패는 기존 bundledSkills CRLF). | 해결됨 |
| 2026-10-02 | P11-13 | 파일 작업 큐·충돌·정보 완료(W1 순서 조정: 11보다 먼저 infra 구축): `lib/commander`(types·ipc·jobs/useJobs·clipboard·format), `ConflictDialog`·`PropertiesDialog`·`SearchResultsView`, StatusBar 작업/클립보드 슬롯, `JobsProvider` 배선. lint 규칙상 JobsContext/useJobs 분리. 검증: `lint`·`typecheck` 통과, `test` 394/395(유일 실패는 기존 bundledSkills CRLF). | 해결됨 |
| 2026-10-02 | P11-11 | 탐색기 탭 완료: `FileExplorerTab`(툴바·주소창·목록·정렬·히스토리·다중 선택·단축키·컨텍스트 메뉴·검색 모드·정보·즐겨찾기) + 탭 메타 영속 + StatusBar 탭 슬롯. D2 완성(폴더 없이 탭 열림·복원·저장) + V7(기본 탭=탐색기). "에이전트에게 묻기"는 P11-15까지 비활성, 파일 열기 라우팅은 P11-14 `openFile`로 교체 예정. 검증: `lint`·`typecheck`·`build` 통과, 탭 테스트 4건, `test` 398/399(유일 실패는 기존 bundledSkills CRLF). | 해결됨 |
| 2026-10-02 | P11-12 | 탐색기 패널 완료: `ExplorerPanel`(탭 없으면 자동 생성·열린 탭 목록·즐겨찾기 추가/삭제/순서/드롭·시스템 폴더), `FileTree` 삭제. 검증: `lint`·`typecheck` 통과, 패널 테스트 3건, `test` 398/399(유일 실패는 기존 bundledSkills CRLF). | 해결됨 |
| 2026-10-02 | P11-14 | 파일 뷰어 완료: `openFile` 라우팅(이미지·문서·아카이브·에디터·외부앱, 대용량 텍스트 읽기전용), `DocumentViewerTab`(PDF 렌더·DOCX·XLSX/CSV 표·PPTX 아웃라인)·`ArchiveViewerTab`(목록·전체 해제), `fc_read_file_bytes`·`fc_read_text_head` + `EditorTab` 읽기전용 지원. 신규 의존성 `pdfjs-dist`·`mammoth`·`jszip`·`xlsx`(공식 tarball) — TODO 기록. `FileExplorerTab`이 신 라우팅 사용. 검증: `lint`·`typecheck`·`build` 통과, `cargo test` 28건, `test` 406/407(유일 실패는 기존 bundledSkills CRLF). | 해결됨 |
| 2026-10-02 | P11-15 | 탐색기 1줄 채팅 완료: `ExplorerChatBar`(위치·선택 자동 첨부, 접이식 결과 드로어 + 채팅탭 열기, 도구 결과 시 목록 새로고침), 탭별 숨은 세션(`origin='explorer'`, 대화 목록 제외). sessions `origin` 컬럼 추가(ALTER·폴백·리포 동기화). 검증: `lint`·`typecheck` 통과, 채팅바 테스트 1건, `test` 407/408(유일 실패는 기존 bundledSkills CRLF). | 해결됨 |
| 2026-10-02 | P11-16 | `@` 참조 완료: `mentions.ts`(쿼리·선택·해석: 32KB 이하 인라인/폴더 1단계/이미지·바이너리 경로만), `MentionPopup`+`useMention`(현재 폴더+즐겨찾기), `ChatInput`·탐색기 입력창 연동(전송 시 해석 + 세션 허용 루트). 팝업은 폴더 직접 나열 방식(심층 fc_search 연동은 후속). 이미지 첨부는 P11-26에서 전환. "에이전트에게 묻기" 메뉴 삽입은 미구현으로 남음. 검증: `lint`·`typecheck` 통과, mentions 7건·ChatInput 통합 1건, `test` 415/416(유일 실패는 기존 bundledSkills CRLF). | 해결됨 |
| 2026-10-03 | P11-20 | 에이전트 카드 단순화 완료: 이름·배지·상태·설명·모델·ctx만 표시, 대화 시작·수정 버튼만. 모니터링·통계·로그 버튼 삭제, `AgentStatsTab`·`AgentStatsPanel` 삭제(진입점은 상단 메뉴 유지). 검증: `lint`·`typecheck` 통과, 카드 테스트 7건, `test` 413/414(유일 실패는 기존 bundledSkills CRLF). | 해결됨 |
| 2026-10-03 | P11-21 | 편집 화면 단순화 완료: 기본 정보·프로바이더만 노출, 시스템 프롬프트·생성 옵션·승인·모니터링·도구·스킬은 `고급 설정` 1개로 접기. 파일 분할은 생략(단일 순차 실행, 충돌 회피 목적 달성 불가 — P11-22/26이 재작업하는 카드만 분리 예정, TODO 기록). 검증: `lint`·`typecheck` 통과, 편집 폼 8건, `test` 414/415(유일 실패는 기존 bundledSkills CRLF). | 해결됨 |
| 2026-10-03 | P11-22 | 프로바이더 3분류 + 외부 연동 등록 완료: `external-agent` 종류·`externalAgentId` 컬럼, 4번째 연동 그룹(agent-cli 선택 + 인라인 등록/CLI 프리셋/PATH 탐지), llm-api→클라우드 에이전트 1회 변환, 저장 시 동의 게이트, `find_executable` 명령. 테스트 모크의 위치 기반 파싱도 30컬럼 대응. 검증: `lint`·`typecheck`·`build` 통과, `cargo test` 29건, `test` 416/417(유일 실패는 기존 bundledSkills CRLF). | 해결됨 |
| 2026-10-03 | P11-23 | 외부 에이전트 런타임 완료: `externalAgentClient`(게이트웨이 경유 CLI 1회 실행·단일 청크·cwd 전달), `providerRuntime` 분기, `useChat` 연결(자체 도구 없음), 연결 확인(`find_executable`), 편집 화면 도구/스킬 비활성 표시. 검증: `lint`·`typecheck` 통과, 런타임 테스트 4건, `test` 420/421(유일 실패는 기존 bundledSkills CRLF). | 해결됨 |
| 2026-10-03 | P11-24 | 파일 커맨더 프롬프트·도구 완료: 11종 도구(복사·이동·이름변경·폴더·휴지통·압축·해제·정보·검색·탐색기·문서읽기, zod 별칭 흡수·위험도 분류·D10 백업), 기본 프롬프트 재작성 + `<commander>` 동적 섹션, 탐색기 브리지, 내장 파서(`parsers/builtin`, P11-33 인계), 새 에이전트 기본값 포함. 검증: `lint`·`typecheck`·`build` 통과, 도구 테스트 8건, `test` 429/430(유일 실패는 기존 bundledSkills CRLF). | 해결됨 |
| 2026-10-03 | P11-25 | 폴백 동의 완료: `resolveAgent`(외부 판정·후보·백그라운드 선택·저장), `AgentFallbackDialog`(외부 별도 체크·로컬만 다시 묻지 않기), `useChat` 전송 게이트 1곳, 채팅탭 세션 한정 적용 + 전환 안내, 탐색기는 차단·안내. 검증: `lint`·`typecheck` 통과, 폴백 5건, `test` 434/435(유일 실패는 기존 bundledSkills CRLF). | 해결됨 |
| 2026-10-03 | P11-26 | 이미지 첨부 + 비전 완료: `Agent.vision`(auto/yes/no, DB 컬럼·리포·기본값) + `resolveVisionSupport`(auto는 Ollama capabilities, OpenAI 호환은 unknown) + `ensureChatImage`(작업 폴더 밖은 chat-images 복사) + 매퍼(Ollama images/OpenAI image_url, 전송 직전 data URL 해석) + `ChatInput` 첨부 UI(버튼·붙여넣기·드래그·썸네일, 최대 4개·5MB) + `ChatTab` 비전 게이트(미지원 시 폴백 다이얼로그로 전환 제안)·응답 위키 저장 버튼 + 편집 화면 비전 라디오 + `useChatQueue` enqueue images 전달. 부수 수정: `resolveRequestImages` 제네릭 완화(OpenAI 메시지 합집합 대응)·`vision.ts` 중복 구현을 매퍼 재export로 통합·showModel 목 2건에 supportsVision 추가. 검증: `lint`·`typecheck`·`build` 통과, 신규 `vision.test.ts` 10건, 전체 `test` 444/445(유일 실패는 기존 bundledSkills CRLF). | 해결됨 |
| 2026-10-03 | P11-27 | 모니터링 메뉴 정리 완료: `MonitoringListPanel`·`monitoringGroups(.test)` 삭제(이미 참조 없음, groups는 테스트만 사용), 미사용 i18n 키 제거(`monitoringList` 16종·`activityBar/topMenu.monitoring`·`agentStats` 7종·`agentList.stats/log`). `AgentMonitorTab`·수집기·TopMenuBar 진입 유지. 검증: `lint`·`typecheck` 통과, 관련 21건 통과. | 해결됨 |
| 2026-10-03 | P11-51 | 문서·브랜딩 정리 완료: `Architecture.md`(§0·§2 트리·§3 레이아웃·§4.2 Agent·§4.5 작업 폴더·§5.5 commander 섹션·§5.8 멀티프로바이더·§5.9 외부 런타임·§7 D1·§8.4 폐기·§12 IPC·§13·§14 폐기·§15~17 신설) + README(기능·사용법·평가 삭제)·UserGuide·QA-Checklist(P11-52 VC-01~11 편입)·삭제 화면 잔여 주석 정리. 구 `.fortress` 경로·`fortress:` 키는 첫 실행 자동 이관으로만 유지, 신규 기록은 vanilla-commander 사용 (결정 기록). 검증: `lint`·`typecheck` 통과. | 해결됨 |
| 2026-10-03 | P11-50 | 설정 재구성 완료: 라우트 일반·parsers·update로 축소 + `SettingsModel`·`SettingsApproval`·`SettingsIntegrations`(테스트 포함) 삭제 + 사용 없던 `settingsModel/settingsApproval/navModel/navApproval` 키 제거 + 일반에 작업 폴더 변경(2단계 확인)·허용 폴더·감사 로그(50건) 추가 + `SettingsUpdate`(버전 + 준비 중). 검증: `lint`·`typecheck` 통과, 관련 12건 통과. **신규 의존성 없음**. | 해결됨 |
| 2026-10-03 | P11-41 | 매크로 스케줄러 완료: `lib/macros/scheduler.ts`(1분 틱·interval/daily/weekly 만기 판정·catchUp 보충/소진·동시 1개·채팅 busy 대기·승인 요청 감시) + MacroPanel 바인딩(실행 이력 표시·세션 열기 유지·승인 대기 StatusBar 알림, 승인은 대화상자에서만 처리). 검증: `lint`·`typecheck` 통과, 신규 9건·매크로 전체 18건 통과. **신규 의존성 없음**. | 해결됨 |
| 2026-10-03 | P11-40 | 매크로 저장소 + 화면 완료: `macros` 테이블(`0003_macros.sql` 신규 + `0001_init.sql`·`MIGRATION_STATEMENTS`·메모리 폴백 동기화) + `lib/macros/`(types·macrosRepo·이관·실행·컨텍스트, `chatMacros` 이동·래퍼 유지) + `MacroPanel`(목록·실행·스케줄·세션 열기) + `MacroEditorTab`(프롬프트 순서·`@` 참조·에이전트·위치·스케줄·테스트 실행) + 채팅 저장 다이얼로그 신 저장소 전환 + SidePanel/CenterWorkspace/Workspace 배선. 검증: `lint`·`typecheck` 통과, 신규 13건·관련 36건 통과. **신규 의존성 없음**. | 해결됨 |
| 2026-10-03 | P11-34 | 문서 파싱 연동 화면 완료: `SettingsParsers`(확장자별 파서 표·외부 파서 등록/삭제·프리셋 4종·`find_executable` 설치 감지·샘플 파일 실행 미리보기) + parsers 사전 + 라우트·내비 1줄씩(App·Layout은 P11-50 소유, 재구성 예정 명시). 검증: `lint`·`typecheck` 통과, 신규 2건 통과. **신규 의존성 없음**. | 해결됨 |
| 2026-10-03 | P11-32 | 위키 처리 파이프라인 완료: `lib/wiki/pipeline.ts`(이벤트→필터→직렬 1건·채팅 busy 시 10초 대기→추출(P11-33 파서·이미지/스캔PDF는 비전 기술)→LLM 1회 분류(zod·1회 재시도·날짜 폴백)→이동(fc_move rename + 완료 대기)→wiki ingest→jobs 행 갱신). 외부 처리 에이전트는 wiki-ingest 동의·목적 확인, 미충족 시 로컬 폴백·스킵. StatusBar 위키 슬롯은 패널 브리지로 퍼블리시. 파이프라인 시작은 WikiPanel 마운트에서 멱등 실행(앱 전역 자동시작은 후속). 검증: `lint`·`typecheck` 통과, 신규 8건·관련 24건 통과. **신규 의존성 없음**. | 해결됨 |
| 2026-10-03 | P11-31 | 위키 설정 + 패널/탭 완료: `wiki_jobs` 테이블(`0002_wiki_jobs.sql` 신규 + `0001_init.sql`·`MIGRATION_STATEMENTS`·메모리 폴백 동기화 — P10-02 선례) + `wikiJobsRepo`(생성·갱신·이력·상태별) + `lib/wiki/settings.ts`(기본 프롬프트·inbox 해석·glob·필터 판정) + `WikiPanel`(감시 토글·대기열·최근·페이지 목록·MD 열기) + `WikiTab`(감시·이동·분류·필터·프롬프트·처리 에이전트 + 이력 표·재처리·원본 열기) + wiki 사전 + SidePanel/CenterWorkspace 배선. 검증: `lint`·`typecheck` 통과, 신규 7건·관련 42건 통과. | 해결됨 |
| 2026-10-03 | P11-33 | 문서 파서 계층 완료: `parsers/index.ts`(외부 오버라이드→내장→실패 디스패치, `ParseError` 사유 4종, 스캔 PDF 판정) + `parsers/external.ts`(4 프리셋·토큰 치환·`find_executable`+`runIntegrationCli` 재사용, file 모드는 유지 cwd 필수) + `builtin`은 `parseBuiltinDocument`로 개명(pdf `pages` 추가·pptx/docx Rust 우선+JS 폴백) + `doc_read`가 신 디스패치 사용(실패 사유 반환). Rust `fc_office_text`(pptx 슬라이드 `<a:t>`/docx `<w:t>` 추출, 200K 캡, 테스트용 zip 생성). 검증: `lint`·`typecheck`·`cargo test` 34건·신규 파서 9건 통과. **신규 의존성 없음**. | 해결됨 |
| 2026-10-03 | P11-30 | 폴더 감시 완료: `watch_commands.rs` 신설(`wiki_watch_set`/`wiki_watch_stop`/`wiki_watch_status`/`wiki_default_watch_folder`, `wiki://file-event {path,kind}` 발행). `notify` 8 + `notify-debouncer-full` 0.5 (신규 의존성 — 표준 크로스플랫폼 감시, Phase 문서 §3.2 승인분). 임시 다운로드 파일 제외 + 크기 안정화(1초 간격 2회 동일) 후 발행 + 5초 중복 쿨다운. 검증: `cargo check`·`cargo test watch_commands` 4건 통과. JS 구독 래퍼는 P11-31에서. | 해결됨 |
| 2026-10-02 | P11-10 | Rust 파일 커맨더 완료: `commander_commands.rs` 신설(목록·시스템 폴더·정보·복사/이동·휴지통/영구삭제·이름변경·새폴더/파일·검색·zip/해제/목록·열기/보기, job+`fc://progress` 이벤트·충돌 질의·취소). 신규 의존성 `trash`·`zip`·`dirs`(opener·clipboard은 P11-11/14로 연기, TODO 기록). 시스템 폴더 쓰기 경고, ZipSlip 방지, 이동 fast-path. 검증: `cargo test` 27건 통과(신규 6건). JS 호출층은 P11-13(`jobs.ts`)에서 담당. | 해결됨 |

---

## 설계 변경 이력

| 날짜       | 내용                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 영향 문서                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 2026-09-18 | `..\pi` 검토 후 4개 결정 변경: ① LangGraph → 자체 루프 + 훅, ② 코드 스킬/QuickJS 샌드박스 폐기(Agent Skills 표준 마크다운 스킬만), ③ 도구 세트 확장(read/write/edit/ls/grep/find/shell/web_search) + 출력 절단, ④ 세션 저장을 엔트리 기반으로 재설계. 부수: `@langchain/*`·`js-tiktoken`·`rquickjs` 제거, P4-07(Checkpointer) 삭제, P0-08(스파이크)·P2-04(프롬프트 섹션)·P3-08(`/skill:`)·P4-09(압축 UI) 추가. `Phase2-LLM-Engine.md` → `Phase2-Agent-Runtime.md` 교체. | `Architecture.md` §0·§1.3·§2·§4.2~4.4·§5~§9·§12·§13, `ImplementationPlan.md`, Phase 0·2·3·4·5·6·7 |
| 2026-09-25 | 자동 평가(Phase 10) 추가: 평가 팩·러너·채점·정규화·추천·외부 연동 게이트웨이·Arena. 평가 에이전트형 과제는 승인 훅 대신 샌드박스 정책 훅 사용(§8.4), 평가 결과는 전역 DB(§4.5), 외부 전송은 단일 게이트웨이+동의+감사 로그(§14.5). | `Architecture.md` §2·§3·§4.5·§8.4·§12·§14, `ImplementationPlan.md`, `phases/Phase10-*.md` |
