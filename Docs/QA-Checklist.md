# Vanilla Commander QA Checklist & Test Run Report

> 문서 버전: 2.0.0 (Phase 11 전환 반영)
> 테스트 일자: 2026-10-03
> 대상 버전: Vanilla Commander v0.1.0
> 실행 환경: Windows 11 x64, Tauri 2, React 19, Ollama local runtime

---

## 1. 개요

Vanilla Commander(파일 커맨더 + 채팅 에이전트 + 위키·매크로)의 핵심 골든 패스 및 보안/예외 엣지 케이스 점검표입니다. 구 Fortress(워크벤치) 기준 TC는 P11-52 통합 QA 시나리오로 대체되며, 아래는 이관 상태의 기록이다.

---

## 2. 시나리오 검증 결과표

| 번호 | 시나리오 | 기대 결과 | 검증 상태 | 비고 |
| :--- | :--- | :--- | :---: | :--- |
| **TC-01** | 최초 실행 및 셋업 위저드 | 6단계 위저드 완주 후 기본 에이전트 편집 탭 자동 오픈 | **PASS** | `SetupWizard.test.tsx` |
| **TC-02** | 파일 탐색기 조작 (복사/이동/삭제/압축) | 탐색기 탭에서 복사·이동·휴지통·ZIP이 Rust job + 진행률로 반영됨 | **PASS** | `commander_commands.rs` (cargo 35건) + `FileExplorerTab.test.tsx` |
| **TC-03** | 다중 Agent 설정 분기 | 다른 시스템 프롬프트의 Agent로 새 대화를 시작하면 서로 다른 톤으로 응답함 | **PASS** | `AgentsContext` |
| **TC-04** | 계층형 `AGENTS.md` 지침 수집 | 상위 디렉터리와 작업 폴더의 컨텍스트 파일이 계층 순서로 프롬프트에 병합됨 | **PASS** | `contextFiles.ts` |
| **TC-05** | Agent Skills 프로그레시브 디스클로저 | 시스템 프롬프트에는 이름·설명·경로만 노출되며, 모델이 필요 시 `read` 도구로 `SKILL.md`를 조회함 | **PASS** | `formatForPrompt.ts` & `scanner.ts` |
| **TC-06** | `/skill:name` 명시적 호출 | 채팅 입력창에 `/skill:<name>` 입력 시 자동완성 팝업 및 본문 즉시 주입 동작 | **PASS** | `ChatInput.tsx` & `invokeSkill.ts` |
| **TC-07** | 자동 컨텍스트 압축 및 타임라인 보존 | 토큰 초과 시 압축 훅이 발화하여 요약 엔트리를 생성하며, 원본 대화 및 요약 배너가 공존함 | **PASS** | `compact.ts` & `CompactionBanner.tsx` |
| **TC-08** | HITL 승인 다이얼로그 (승인/거절) | `write`/`edit` 도구 실행 전 `ApprovalDialog`가 표시되며, 거절 시 사유가 모델에 전달되어 대안을 모색함 | **PASS** | `ApprovalDialog.tsx` & `approvalBus.ts` |
| **TC-09** | 셸(`shell`) 도구 절대 승인 강제 | `approvalMode: "never"` 상태에서도 `shell` 도구는 무조건 승인 다이얼로그가 팝업됨 | **PASS** | 진리표 테스트 통과 |
| **TC-10** | 에이전트 허용 루트 밖 접근 차단 (D1) | 허용 루트 밖 에이전트 파일 접근 시 Rust 검증(Layer 1b)에서 거부. 사용자 UI 조작은 OS 권한 내 허용 | **PASS** | `fs_commands.rs` allowed-roots |
| **TC-11** | 대형 도구 출력 안전 절단 | 2000자 초과 도구 실행 결과가 컨텍스트 낭비 방지를 위해 안전하게 절단되고 안내 배지가 표시됨 | **PASS** | `truncate.ts` & `ToolCallCard.tsx` |
| **TC-12** | 스트리밍 중 지시 주입 (Steering) | 어시스턴트가 답변을 생성하는 중 입력창 타이핑 후 Enter 입력 시 현재 턴 종료 직후 지시가 반영됨 | **PASS** | `queue.ts` & `ChatInput.tsx` |
| **TC-13** | 스트리밍 및 승인 대기 중 즉각 중지 | 실행 또는 승인 대기 중 "중지" 버튼 클릭 시 루프나 승인 버스가 영구 대기하지 않고 즉시 정상 종료됨 | **PASS** | `approvalBus.abortAll()` & `VanillaAgent.abort()` |
| **TC-14** | Mermaid 및 Recharts 인라인 시각화 | \`\`\`mermaid 및 \`\`\`recharts 코드 블록이 각각 SVG 다이어그램과 반응형 차트로 인라인 렌더링됨 | **PASS** | `MermaidViewer.tsx` & `RechartsViewer.tsx` |
| **TC-15** | 시각화 문법 오류 시 폴백 | 잘못된 Mermaid 문법이나 깨진 JSON DSL이 전달되어도 앱이 크래시되지 않고 원본 코드가 폴백 렌더링됨 | **PASS** | 단위 테스트 및 오류 뷰어 검증 |
| **TC-16** | 세션/탭 영속성 복구 | 앱 재시작 시 `app_settings` 및 `sessions`/`entries`로부터 탭 및 대화 복원 (삭제된 탭 타입은 버림) | **PASS** | `WorkspaceTabsContext.tsx` 500ms 디바운스 저장 |
| **TC-17** | Ollama 다운 시 지수 백오프 및 재시도 UI | 서버 미응답 시 자동 재시도 후 실패 시 에러 배너와 수동 "다시 시도" 버튼 제공 | **PASS** | `retry.ts` & `ErrorBanner.tsx` |
| **TC-18** | 단축키 및 전역 에러 바운더리 | `Ctrl+N`, `Ctrl+W`, `Ctrl+,`, `Esc` 단축키 및 렌더링 예외 시 `ErrorBoundary` 복구 화면 동작 | **PASS** | `useKeyboardShortcuts.ts` & `ErrorBoundary.tsx` |
| **TC-19** | 위키 자동 처리 | 다운로드 폴더에 PDF 저장 → 분류·이동·위키 페이지 생성, 패널에 표시 | **PASS** | `pipeline.test.ts` 8건 (실머신 E2E는 P11-52) |
| **TC-20** | 매크로 저장·실행·스케줄 | 채팅 저장 → 패널 실행 → 전용 대화 순차 진행, 승인 필요 시 일시정지 | **PASS** | macro 18건 (실머신 E2E는 P11-52) |

---

## 3. 종합 평가

- **JS 테스트**: `pnpm test` 전체 스위트 (유일 실패는 기존 `bundledSkills` CRLF 체크아웃 이슈 1건).
- **정적 분석**: `tsc --noEmit` 타입 검사 오류 0개, `eslint` 린트 경고 및 오류 0개.
- **프로덕션 빌드**: `pnpm build` Vite 클라이언트 번들링 정상 완료.
- **Rust 백엔드**: `cargo test` 통과 (commander·watch·integration·fs).

---

## 4. 통합 QA 시나리오 (P11-52)

> 아래 11종은 `pnpm tauri dev` + Ollama 실동작이 필요한 수동 QA입니다. 실머신에서 확인 후 갱신하십시오.

| 번호 | 시나리오 | 기대 결과 | 검증 상태 |
| :--- | :--- | :---: | :--- |
| **VC-01** | 신규 설치 → 위저드 6단계 → 기본 에이전트 편집 탭 자동 오픈 | 위저드 완주, 에이전트 프리필 | **UNVERIFIED** |
| **VC-02** | 탐색기 2개 분할 → F5 복사(충돌 → 이름 변경) → 진행률 StatusBar → 취소 | 복사·충돌·취소 정상 | **UNVERIFIED** |
| **VC-03** | ZIP 압축/해제, 휴지통 삭제, 정보 대화상자(폴더 크기) | 각 동작 정상 | **UNVERIFIED** |
| **VC-04** | PDF/DOCX/XLSX/PPTX/이미지/ZIP 더블클릭 뷰어, HTML·MP4는 외부 앱 | 뷰어·외부 앱 분기 정상 | **UNVERIFIED** |
| **VC-05** | 탐색기 하단 입력 "`@보고서.pdf` 요약해서 같은 폴더에 md로 저장" → 승인 → 백업 생성 → 목록 새로고침 | 승인·백업·새로고침 정상 | **UNVERIFIED** |
| **VC-06** | 채팅 이미지 첨부(비전 모델) → 위키 저장 | 이미지 전송·위키 저장 정상 | **UNVERIFIED** |
| **VC-07** | 다운로드 폴더에 PDF 저장 → 위키 자동 처리 → 이동·분류·위키 페이지 생성 | 파이프라인 종단 정상 | **UNVERIFIED** |
| **VC-08** | 기본 에이전트(Ollama) 중지 → 폴백 다이얼로그 → 클라우드 선택 시 외부 전송 경고 | 폴백·경고 정상 | **UNVERIFIED** |
| **VC-09** | 외부 에이전트(Claude Code CLI) 등록 → 동의 → 대화 | 등록·동의·대화 정상 | **UNVERIFIED** |
| **VC-10** | 매크로 5분 간격 스케줄 → 자동 실행 → 승인 필요 도구에서 일시정지 | 스케줄·일시정지 정상 | **UNVERIFIED** |
| **VC-11** | 설정에서 위저드 재실행(값 프리필) → 작업 폴더 변경 | 재실행·변경 정상 | **UNVERIFIED** |
