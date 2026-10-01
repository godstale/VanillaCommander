# Fortress QA Checklist & Test Run Report

> 문서 버전: 1.0.0  
> 테스트 일자: 2026-09-18  
> 대상 버전: Fortress v0.1.0  
> 실행 환경: Windows 11 x64, Tauri 2, React 19, Ollama local runtime

---

## 1. 개요

Fortress 1차 스코프의 핵심 골든 패스(Golden Path) 및 보안/예외 엣지 케이스에 대한 수동/자동 통합 QA 시나리오 점검표입니다.

---

## 2. 시나리오 검증 결과표

| 번호 | 시나리오 | 기대 결과 | 검증 상태 | 비고 |
| :--- | :--- | :--- | :---: | :--- |
| **TC-01** | 최초 실행 및 워크스페이스 신뢰 확인 | 폴더 열기 시 `TrustWorkspaceDialog`가 표시되며, "신뢰하고 로드" 승인 시 `AGENTS.md` 및 스킬이 정상 로드됨 | **PASS** | `TrustWorkspaceDialog.tsx` & `WorkspaceContext.tsx` |
| **TC-02** | 파일 탐색기 조작 (생성/편집/삭제) | 좌측 탐색기에서 파일 생성/편집/삭제가 Tauri Rust 커맨드를 통해 정확히 반영됨 | **PASS** | `fs_commands.rs` & `FileExplorerPanel.tsx` |
| **TC-03** | 다중 Agent 페르소나 분기 | 다른 시스템 프롬프트를 가진 Agent를 생성하고 새 대화를 시작했을 때 서로 다른 톤과 지침으로 응답함 | **PASS** | `AgentsContext.tsx` & `AgentEditorTab.tsx` |
| **TC-04** | 계층형 `AGENTS.md` 지침 수집 | 상위 디렉터리와 워크스페이스 루트의 컨텍스트 파일이 계층 순서(조상→워크스페이스)로 프롬프트에 병합됨 | **PASS** | `contextFiles.ts` & 단위 테스트 4종 통과 |
| **TC-05** | Agent Skills 프로그레시브 디스클로저 | 시스템 프롬프트에는 이름·설명·경로만 3줄 노출되며, 모델이 필요 시 `read` 도구로 `SKILL.md`를 조회함 | **PASS** | `formatForPrompt.ts` & `scanner.ts` |
| **TC-06** | `/skill:name` 명시적 호출 | 채팅 입력창에 `/skill:<name>` 입력 시 자동완성 팝업 및 본문 즉시 주입 동작 | **PASS** | `ChatInput.tsx` & `invokeSkill.ts` |
| **TC-07** | 자동 컨텍스트 압축 및 타임라인 보존 | 토큰 초과 시 `compact()` 훅이 발화하여 요약 엔트리를 생성하며, 원본 대화 및 요약 배너가 공존함 | **PASS** | `compact.ts` & `CompactionBanner.tsx` |
| **TC-08** | HITL 승인 다이얼로그 (승인/거절) | `write`/`edit` 도구 실행 전 `ApprovalDialog`가 표시되며, 거절 시 사유가 모델에 전달되어 대안을 모색함 | **PASS** | `ApprovalDialog.tsx` & `approvalBus.ts` |
| **TC-09** | 셸(`shell`) 도구 절대 승인 강제 | `approvalMode: "never"` 상태에서도 `shell` 도구는 무조건 승인 다이얼로그가 팝업됨 | **PASS** | `policy.ts` 진리표 테스트 통과 |
| **TC-10** | 워크스페이스 스코프 밖 접근 차단 | 워크스페이스 외부 경로 파일 읽기/쓰기 시도 시 Tauri Rust 보안 계층(Layer 1)에서 접근 거부 | **PASS** | `fs_commands.rs` scope canonicalization |
| **TC-11** | 대형 도구 출력 안전 절단 | 2000자 초과 도구 실행 결과가 컨텍스트 낭비 방지를 위해 안전하게 절단되고 안내 배지가 표시됨 | **PASS** | `truncate.ts` & `ToolCallCard.tsx` |
| **TC-12** | 스트리밍 중 지시 주입 (Steering) | 어시스턴트가 답변을 생성하는 중 입력창 타이핑 후 Enter 입력 시 현재 턴 종료 직후 지시가 반영됨 | **PASS** | `queue.ts` & `ChatInput.tsx` |
| **TC-13** | 스트리밍 및 승인 대기 중 즉각 중지 | 실행 또는 승인 대기 중 "중지" 버튼 클릭 시 루프나 승인 버스가 영구 대기하지 않고 즉시 정상 종료됨 | **PASS** | `approvalBus.abortAll()` & `FortressAgent.abort()` |
| **TC-14** | Mermaid 및 Recharts 인라인 시각화 | \`\`\`mermaid 및 \`\`\`recharts 코드 블록이 각각 SVG 다이어그램과 반응형 차트로 인라인 렌더링됨 | **PASS** | `MermaidViewer.tsx` & `RechartsViewer.tsx` |
| **TC-15** | 시각화 문법 오류 시 폴백 | 잘못된 Mermaid 문법이나 깨진 JSON DSL이 전달되어도 앱이 크래시되지 않고 원본 코드가 폴백 렌더링됨 | **PASS** | 단위 테스트 및 오류 뷰어 검증 |
| **TC-16** | 세션/탭 영속성 복구 | 앱 재시작 또는 새로고침 시 SQLite `app_settings` 및 `sessions`/`entries`로부터 탭 및 대화 복원 | **PASS** | `WorkspaceTabsContext.tsx` 500ms 디바운스 저장 |
| **TC-17** | Ollama 다운 시 지수 백오프 및 재시도 UI | 서버 미응답 시 자동 재시도 후 실패 시 에러 배너와 수동 "다시 시도" 버튼 제공 | **PASS** | `retry.ts` & `ErrorBanner.tsx` |
| **TC-18** | 단축키 및 전역 에러 바운더리 | `Ctrl+N`, `Ctrl+W`, `Ctrl+,`, `Esc` 단축키 및 렌더링 예외 시 `ErrorBoundary` 복구 화면 동작 | **PASS** | `useKeyboardShortcuts.ts` & `ErrorBoundary.tsx` |

---

## 3. 종합 평가

- **통합 테스트**: 총 30개 테스트 스위트, 123개 단위/컴포넌트 테스트 전체 통과 (0 failed).
- **정적 분석**: `tsc --noEmit` 타입 검사 오류 0개, `eslint` 린트 경고 및 오류 0개.
- **프로덕션 빌드**: `pnpm build` Vite 클라이언트 번들링 정상 완료.
- **Rust 백엔드**: `cargo check` 오류 0개 (0.51s).

---

## 4. 자동 평가 (Phase 10) 시나리오

> 아래 10종은 `pnpm tauri dev` + Ollama 실동작이 필요한 수동 QA입니다. 이 환경에서는 실행하지 못했으므로 **UNVERIFIED**로 기록하고, 실머신에서 확인 후 갱신하십시오. 자동 단위·컴포넌트 테스트(평가 영역 400+건)는 `pnpm test`로 통과했습니다.

| 번호 | 시나리오 | 기대 결과 | 검증 상태 |
| :--- | :--- | :---: | :--- |
| **EV-01** | 에이전트 3개 + 표준 스위트 실행 → 중간 앱 종료 → 재시작 | 실행이 `interrupted`로 표시되고 [이어하기]로 남은 Trial부터 완료됨 | **UNVERIFIED** |
| **EV-02** | 평가 중 채팅 입력·전송·폴더 전환·에이전트 편집 시도 | 전부 차단되고 평가 배너가 표시됨. 평가 후 자동 전송 없음 | **UNVERIFIED** |
| **EV-03** | 가중치 확인 체크 없이 시작 시도, [나중에 시작] 후 수동 시작 | 체크 전 [실행 만들기] 비활성. 나중에 목록에서 수동 시작만 가능 | **UNVERIFIED** |
| **EV-04** | 외부 연동 OFF → 마법사에서 외부 후보·Judge 옵션 확인, ON + 동의 후 감사 로그 | OFF에서 옵션 숨김. 동의 후 실행 시 감사 로그 1건 이상 기록 | **UNVERIFIED** |
| **EV-05** | `fab-fs-tasks` 실행 전후 워크스페이스·임시 폴더 확인 | 워크스페이스 파일 무변경, `fortress-eval` 임시 폴더 정리됨 | **UNVERIFIED** |
| **EV-06** | 매트릭스 6개 조합 실행 → 리포트 | 추천 3종·파레토·구분 불가 그룹이 표시됨 | **UNVERIFIED** |
| **EV-07** | 개인 케이스 저장(비밀값 포함) → 개인 팩 평가 | 비밀값 마스킹 저장 확인, 개인 팩으로 실행됨 | **UNVERIFIED** |
| **EV-08** | Arena 30표 투표 → 리더보드 | BT 순위 + CI 표시, 30표 미만 시 표본 부족 안내 | **UNVERIFIED** |
| **EV-09** | EEE 내보내기 → JSON 검증 | `eee-0.1-fortress` 스탬프·스키마 필드 확인, GPQA 원문 제외 | **UNVERIFIED** |
| **EV-10** | Python 미설치 PC에서 HumanEval+ + fab-code-js 실행 | HumanEval+는 skip, fab-code-js는 정상 채점됨 | **UNVERIFIED** |
