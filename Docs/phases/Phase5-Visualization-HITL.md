# Phase 5 — Visualization & Human-in-the-Loop (HITL)

**목표**: 어시스턴트 응답에 포함된 Mermaid/Recharts 코드펜스를 인라인 시각화로 렌더링하고, 위험한 도구 호출(파일 쓰기/편집, 셸 실행) 전에 사용자 승인을 받는 흐름을 완성한다.

**선행 조건**: Phase 2 완료. (Phase 3, 4와 완전히 병렬 진행 가능 — `Docs/ImplementationPlan.md`의 "병렬 진행 조건" 참고)

**공통 참고**: `Docs/Architecture.md` §5.6(확장점 규약), §8(HITL — **필독**), §10(시각화).

> 📌 **초안 대비 변경**: 승인이 `approvalNode` + LangGraph `interrupt()` + 체크포인터 재개 → **`beforeToolCall` 훅이 Promise를 await**하는 방식으로 바뀌었습니다(§5.0, §8.2). 그 결과 이 Phase는 Phase 4의 산출물에 의존하지 않고, 그래프/루프 파일을 수정하지 않습니다. 코드 스킬 승인은 코드 스킬 자체가 폐기되어 사라졌고, 대신 **`shell` 도구가 `critical` 위험도**로 그 자리를 대신합니다.

---

## P5-01. parseVisualBlocks

- **소유 파일**: `src/lib/markdown/parseVisualBlocks.ts`
- **작업 내용**: 마크다운 텍스트에서 \`\`\`mermaid, \`\`\`recharts 코드펜스 블록을 찾아 위치와 내용을 추출하는 파서. `recharts` 블록은 JSON으로 파싱 시도하고 실패 시 원본 텍스트로 폴백(파싱 에러가 전체 렌더링을 깨뜨리지 않도록).
- **확인 방법**: 여러 코드펜스가 섞인 샘플 마크다운으로 Vitest 작성.

## P5-02. MermaidViewer

- **소유 파일**: `src/components/chat/MermaidViewer.tsx`
- **작업 내용**: `pnpm add mermaid`. 다이어그램 코드를 받아 SVG로 렌더링. 렌더링 실패 시(문법 오류) 에러 메시지 + 원본 코드를 `<pre>`로 표시(크래시 방지). 다크/라이트 테마에 맞춰 mermaid `theme` 설정 동기화(`ThemeContext` 구독).
- **확인 방법**: 플로우차트/시퀀스 다이어그램 샘플 코드로 정상 렌더링 확인, 잘못된 문법으로 에러 폴백 확인.

## P5-03. RechartsViewer + JSON DSL

- **소유 파일**: `src/components/chat/RechartsViewer.tsx`, `src/lib/types/chartDsl.ts`
- **작업 내용**:
  1. `chartDsl.ts`에 최소 DSL 스키마 정의(Zod):
     ```ts
     const ChartDsl = z.object({
       type: z.enum(['bar', 'line', 'pie', 'area']),
       data: z.array(z.record(z.union([z.string(), z.number()]))),
       xKey: z.string().optional(),
       series: z.array(
         z.object({
           key: z.string(),
           label: z.string().optional(),
           color: z.string().optional(),
         }),
       ),
       title: z.string().optional(),
     });
     ```
  2. `pnpm add recharts`. `RechartsViewer`는 `type`에 따라 `BarChart`/`LineChart`/`PieChart`/`AreaChart` 중 하나로 매핑 렌더링. 스키마 검증 실패 시 에러 폴백(원본 JSON `<pre>` 표시).
- **확인 방법**: 4가지 차트 타입 각각 샘플 데이터로 렌더링 확인.

## P5-04. 시각화 지침 시스템 프롬프트 통합

- **소유 파일**: `src/lib/prompt/visualizationSection.ts`(신규), `src/hooks/useChat.ts`(P2-07 파일에 **소규모 추가** — `buildSystemPromptSections()`에 `visualization` 값을 넘기는 것뿐), `src/components/chat/MessageBubble.tsx`(P2-08 파일에 `parseVisualBlocks` 연동 추가)
- **작업 내용**: `visualizationSection.ts`가 "다이어그램이 필요하면 \`\`\`mermaid, 차트가 필요하면 아래 JSON 스키마를 따르는 \`\`\`recharts 코드펜스로 응답하라"는 지침 + P5-03의 DSL 스키마 예시 문자열을 반환한다. **`buildSystemPrompt.ts`는 수정하지 않는다** — P2-04에서 `visualization` 슬롯이 이미 준비되어 있다(§5.5).
  `MessageBubble`은 react-markdown 커스텀 컴포넌트 매핑(`code` 렌더러)에서 언어가 `mermaid`/`recharts`이면 각각 `MermaidViewer`/`RechartsViewer`로 치환.
- **확인 방법**: "지난 3개월 매출 추이를 막대그래프로 보여줘" 같은 프롬프트에 대해 실제 차트가 인라인 렌더링되는지 확인. 로컬 모델이 형식을 안 지키면 `visualizationSection.ts`에 few-shot 예시를 추가한다(다른 파일을 건드리지 않고 해결 가능한 구조).

## P5-05. 위험도 분류 + 승인 버스

- **소유 파일**: `src/lib/approval/approvalBus.ts`, `src/lib/approval/policy.ts`, `src/lib/tools/risk.ts`(P2-02 파일 — 이미 §8.1 표가 구현되어 있으면 **수정 불필요**, 누락분만 보강)
- **작업 내용**:
  1. `policy.ts`: `needsApproval(tool, agentApprovalMode, sessionOverrides): boolean` — §8.1 규칙 구현.
     - `"always"` → 모든 도구
     - `"dangerous-only"`(기본) → `high` 이상
     - `"never"` → `high`는 자동 승인, **`critical`(셸)은 여전히 승인 필요**
     - 세션 내 "이 도구는 항상 승인" 오버라이드가 있으면 건너뜀
  2. `approvalBus.ts`: `request(payload): Promise<ApprovalDecision>` — 승인 요청을 발행하고 UI 응답을 기다리는 Promise를 반환. `resolve(id, decision)` / `rejectAll(reason)` 제공. **`abort()`와 창 닫힘 시 대기 중인 Promise를 모두 정리**해야 한다(§8.2) — 안 그러면 루프가 영원히 멈춘다.
- **확인 방법**: 3가지 `approvalMode` × 3가지 위험도 조합에 대한 `needsApproval` 진리표를 Vitest로 검증(특히 `never` + `critical` = true). `rejectAll`이 대기 중 Promise를 해제하는지도 확인.

## P5-06. 승인 훅 등록 + ApprovalDialog

- **소유 파일**: `src/lib/approval/register.ts`, `src/components/chat/ApprovalDialog.tsx`, `src/lib/agent/bootstrap.ts`(**import 한 줄만 추가** — §5.6), `src/hooks/useChat.ts`(P2-07 파일에 `approval_request` 이벤트 구독 **추가**)
- **작업 내용**:
  1. `register.ts`: `registerHooks("approval", { beforeToolCall })`. `beforeToolCall`은 `needsApproval`이 false면 `undefined`(즉시 실행), true면 `approvalBus.request(...)`를 await 해서 거절 시 `{ block: true, reason }`을 반환한다. 거절 사유는 루프가 `isError: true` `toolResult`로 만들어 LLM에 전달하므로, 모델이 대안을 찾을 수 있다.
  2. `ApprovalDialog.tsx`: 도구명, 위험도 배지, 인자(JSON pretty-print — **`shell`은 실행될 명령 전문을 그대로**), 대상 파일 경로를 표시. 버튼: "승인" / "거절(+사유 입력)" / "이 세션에서 이 도구는 항상 승인". `edit` 도구는 변경 전후 diff를 보여주면 더 좋다(선택).
  3. `bootstrap.ts`에 `import "../approval/register";` 한 줄 추가.
  4. **`loop.ts`/`agent.ts`를 수정하지 않는다.**
- **확인 방법**: 파일 쓰기를 요청하는 프롬프트로 다이얼로그가 뜨는지, 승인 시 실행되고 거절 시 사유가 모델에게 전달되어 모델이 다른 방법을 제안하는지 수동 확인. 승인 대기 중 "중지" 버튼을 눌렀을 때 멈추지 않고 정상 종료되는지도 반드시 확인.

## P5-07. approvalMode 설정 연동

- **소유 파일**: `src/pages/Settings/SettingsApproval.tsx`(Phase 1 placeholder 실동작 전환), `src/lib/context/SettingsContext.tsx`(신규 — 전역 기본값 관리, Phase 1/4에서 `localStorage`/`app_settings`에 흩어져 있던 설정을 이 Context로 통합 참조하도록 정리)
- **작업 내용**: 전역 기본 `approvalMode`(라디오 버튼 3종) 설정. Agent별 override는 Phase 6의 `AgentEditorForm`에서 연결하므로 여기서는 전역값만. `"never"` 선택 시 명확한 경고 문구와 함께 "셸 실행은 이 설정과 무관하게 항상 승인을 요구합니다"를 명시한다. `shell` 도구 활성화 UI에도 위험 경고를 표시한다(§7).
- **확인 방법**: 전역 설정 변경이 새 세션에 즉시 반영되는지, `never`에서도 셸이 승인을 요구하는지 확인.

---

## Phase 5 완료 조건

- [ ] Mermaid 다이어그램과 Recharts 차트가 채팅 응답에 인라인으로 렌더링되고, 문법 오류 시 원본 코드로 폴백한다.
- [ ] 위험한 도구 호출(`write`/`edit`) 전에 승인 다이얼로그가 뜨고, 승인/거절에 따라 루프가 올바르게 이어진다.
- [ ] 거절 사유가 모델에게 전달되어 모델이 대안을 제시한다.
- [ ] `shell` 도구는 `approvalMode: "never"`에서도 승인을 요구한다.
- [ ] 승인 대기 중 "중지"를 누르면 대기가 해제되고 실행이 정상 종료된다(멈추지 않는다).
- [ ] 승인 모드(always/dangerous-only/never)를 전역 설정에서 변경할 수 있다.
- [ ] **`src/lib/agent/` 아래에서 `bootstrap.ts`의 import 한 줄 외에는 수정하지 않았다**(§5.6 확장점 규약 준수 확인).
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 통과.
- [ ] `Docs/TODO.md`의 Phase 5 항목이 모두 `[x]`다.
