# Phase 6 — Agent Management UI (에이전트 페르소나 관리)

**목표**: VivoAcademy의 "에이전트 관리" UI 패턴(카드 목록, 생성 다이얼로그, 상세/편집 탭)을 참고해, Fortress의 Agent(페르소나/프리셋)를 CRUD할 수 있는 화면을 완성한다. 채팅에서 Agent를 선택/전환할 수 있게 된다.

**선행 조건**: Phase 3 완료(스킬 선택 UI에 필요), Phase 4 완료(Agent 저장에 필요).

**공통 참고**: `Docs/Architecture.md` §1.2(VivoAcademy에서 가져오는 것), §4.2(Agent 데이터 모델).

---

## P6-01. AgentsContext

- **소유 파일**: `src/lib/context/AgentsContext.tsx`
- **작업 내용**: `agentsRepo`(Phase 4에서 구현됨)를 사용해 Agent 목록 조회/생성/수정/삭제 및 `isDefault` 불변식 관리(정확히 하나만 `true` — VivoAcademy `external-agents.ts`의 로직을 참고해 새로 구현: 첫 Agent는 자동 기본, 기본 삭제 시 다음 Agent 승격, 마지막 하나 남은 기본 Agent는 해제 불가). 앱 최초 실행 시 Agent가 0개이면 `Docs/Architecture.md`의 `DEFAULT_AGENT`(Phase 2에서 하드코딩했던 상수)를 초기값으로 DB에 시딩한다.
- **확인 방법**: Vitest로 불변식 로직(생성/삭제 시나리오별 `isDefault` 상태 전이) 검증.

## P6-02. AgentListPanel 실동작

- **소유 파일**: `src/components/agents/AgentListPanel.tsx`(Phase1 placeholder 교체), `src/components/agents/AgentCard.tsx`
- **작업 내용**: VivoAcademy `Agents.tsx`의 카드 그리드 UX(모델/온도/컨텍스트 크기 미니 정보, "기본" 배지, 편집/삭제 메뉴, 빈 상태 CTA "첫 에이전트 만들기")를 재현. 카드 클릭(또는 "대화 시작" 버튼) 시 해당 Agent로 새 채팅 세션을 만들고 `chat` 탭을 연다. "편집" 클릭 시 `agent-editor` 탭을 연다.
- **확인 방법**: 목록/빈 상태/배지 표시가 올바른지, 카드 클릭으로 새 대화가 시작되는지 확인.

## P6-03. AgentEditorForm / AgentEditorTab

- **소유 파일**: `src/components/agents/AgentEditorForm.tsx`, `src/components/workspace/AgentEditorTab.tsx`(Phase1 TabPlaceholder에서 이 타입 분기를 실제 컴포넌트로 교체)
- **작업 내용**: 아래 항목의 생성/수정 공용 폼(`mode: "create" | "edit"` prop).
  - 이름 / 설명 / 시스템 프롬프트(멀티라인)
  - 모델(드롭다운, `listModels()`로 실시간 조회. tool-calling 미지원 모델에는 경고 배지 — §5.8)
  - 온도(슬라이더)
  - 컨텍스트 크기(숫자 입력, 0이면 모델의 `/api/show` 값 또는 전역 기본값 상속)
  - **압축 예산**: `reserveTokens` / `keepRecentTokens` 숫자 입력. 0이면 `contextSize`에서 파생되며(§9.1), 폼에는 **파생된 실제 값을 회색 placeholder로 미리보기**한다(예: "0 = 자동 (2048)"). 초안의 "압축 임계값 슬라이더 0.5~0.9"는 폐기 — 단위가 비율이 아니라 절대 토큰 수다.
  - 승인 모드(라디오 3종. `never` 선택 시 "셸 실행은 이 설정과 무관하게 항상 승인을 요구합니다" 안내)
  - 활성 스킬(Phase 3의 `SkillsContext` 목록에서 다중 선택 체크박스)
  - 활성 내장 도구(체크박스 8종: `read`/`write`/`edit`/`ls`/`grep`/`find`/`shell`/`web_search`. `shell`에는 위험 경고 표시 — §7)
  - **교차 검증**: 스킬을 하나라도 켰는데 `read`가 꺼져 있으면 "스킬 본문을 읽으려면 `read` 도구가 필요합니다" 경고를 표시한다(§4.2).
- **확인 방법**: 새 Agent 생성 → 목록에 반영 → 편집 → 변경사항 저장 확인.

## P6-04. Agent 삭제 확인 + 기본 승격

- **소유 파일**: `src/components/agents/AgentCard.tsx`(P6-02 파일에 삭제 다이얼로그 추가 — 별도 파일 분리 불필요할 만큼 작으면 같은 파일에 포함, 커지면 `AgentDeleteDialog.tsx`로 분리)
- **작업 내용**: shadcn `AlertDialog`로 삭제 확인. 삭제 대상이 기본 Agent이고 다른 Agent가 남아있으면 `AgentsContext`가 자동으로 다음 Agent를 기본으로 승격(P6-01 로직 재사용, 이 작업은 UI 연결만).
- **확인 방법**: 기본 Agent 삭제 시 다른 Agent가 자동으로 기본 배지를 받는지 확인.

## P6-05. ChatTab에서 Agent 선택/전환

- **소유 파일**: `src/components/workspace/ChatTab.tsx`(Phase 2 파일에 확장 — 하드코딩된 `DEFAULT_AGENT` 참조를 `AgentsContext`/세션의 `agentId` 기반으로 교체), `src/components/chat/ChatInput.tsx`(상단에 Agent 선택 드롭다운 추가 — 새 세션 시작 시에만 변경 가능, 기존 세션은 세션 생성 시점의 Agent 고정)
- **작업 내용**: 새 채팅 시작 시 Agent 선택 드롭다운(기본값은 `isDefault` Agent) 노출. 기존 세션을 열면 해당 세션에 연결된 `agentId`의 설정으로 그래프가 동작(세션 중간에 Agent를 바꾸는 기능은 1차 스코프 제외 — 새 세션을 만들도록 유도).
- **확인 방법**: 서로 다른 시스템 프롬프트를 가진 두 Agent로 각각 새 채팅을 만들어 응답 톤이 실제로 달라지는지 확인.

## P6-06. Agent 사용 통계 (축소 버전)

- **소유 파일**: `src/components/agents/AgentStatsPanel.tsx`(신규, `AgentEditorTab` 또는 `AgentCard` 상세보기에서 노출)
- **작업 내용**: VivoAcademy의 recharts 기반 통계(§원본 리서치)를 참고하되 1차 스코프는 축소: 해당 Agent로 생성된 세션 수, 총 메시지 수 정도만 `sessionsRepo`/`entriesRepo` 집계로 표시(막대 차트 1개, `RechartsViewer`가 아닌 별도 간단한 recharts 컴포넌트 — 채팅 시각화용 DSL과 혼동하지 않도록 별개 컴포넌트로 유지).
- **확인 방법**: 세션/메시지 생성 후 통계 숫자가 올바르게 갱신되는지 확인.

---

## Phase 6 완료 조건

- [ ] Agent를 생성/수정/삭제할 수 있고, 기본 Agent 불변식이 항상 유지된다.
- [ ] 서로 다른 Agent로 새 채팅을 시작하면 실제로 다른 페르소나(시스템 프롬프트/모델/도구/스킬)로 동작한다.
- [ ] Agent별 간단한 사용 통계가 표시된다.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 통과.
- [ ] `Docs/TODO.md`의 Phase 6 항목이 모두 `[x]`다.
