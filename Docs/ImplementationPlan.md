# Fortress 구현 계획서 (마스터 로드맵)

이 문서는 Fortress 프로젝트의 전체 구현 로드맵입니다. 실제 상세 작업 내용은 `Docs/phases/Phase*.md`에 있으며, 진행상황 체크는 `Docs/TODO.md`에서 합니다. 아키텍처/설계 결정은 `Docs/Architecture.md`를 따릅니다.

## 어떤 에이전트든 시작하기 전에 반드시 할 일

1. `Docs/Architecture.md` 전체를 읽는다. (공통 설계 원칙, 디렉터리 구조, 데이터 모델)
2. `AGENTS.md`(리포지토리 루트)를 읽는다. (코딩 규칙, 빌드/테스트 명령, 커밋 규칙)
3. `Docs/TODO.md`에서 자신이 맡을 작업 ID의 상태를 확인한다. `[ ] 대기` 또는 `[~] 진행중`만 새로 시작할 수 있다. 이미 `[~]`인 항목을 다른 에이전트가 작업 중이면 건드리지 않는다.
4. 해당 작업이 속한 `Docs/phases/PhaseN-*.md`에서 작업 ID에 해당하는 섹션을 읽고 **"소유 파일(Owned Files)"** 목록을 확인한다. 이 목록에 없는 파일은 수정하지 않는다(다른 작업과 충돌 방지). 부득이하게 목록 밖 파일을 수정해야 하면 `Docs/TODO.md`의 "이슈" 섹션에 사유를 기록하고 진행한다.
5. 작업 시작 시 `Docs/TODO.md`에서 해당 항목을 `[ ]` → `[~]`로 바꾸고, 완료 시 `[~]` → `[x]`로 바꾼다. Phase 전체가 끝나면 Phase 헤더도 갱신한다.

## Phase 개요 (레이어 기준 분할)

각 Phase는 앱의 한 "레이어"를 완성합니다. Phase는 순서대로 의존하므로, 이전 Phase의 작업 ID들이 `[x]` 완료되기 전에 다음 Phase를 시작하지 않는 것이 원칙입니다. 단, 같은 Phase 내의 작업 ID들은 "소유 파일"이 겹치지 않는 한 여러 에이전트가 병렬로 진행할 수 있습니다.

| Phase | 이름                         | 목표                                                                           | 문서                                                                      |
| ----- | ---------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 0     | Foundation                   | 레포/툴체인/기본 골격 셋업 + **에이전트 루프 스파이크**                        | [Phase0-Foundation.md](./phases/Phase0-Foundation.md)                     |
| 1     | Shell & Layout UI            | VivoStudio 스타일 좌측 사이드바/패널/우측 탭 UI 골격 (LLM 미연동, placeholder) | [Phase1-Shell-UI.md](./phases/Phase1-Shell-UI.md)                         |
| 2     | Agent Runtime & Chat         | 자체 에이전트 루프 + Ollama 직접 연동, 내장 도구 8종, 실제 채팅 동작           | [Phase2-Agent-Runtime.md](./phases/Phase2-Agent-Runtime.md)               |
| 3     | Skills & AGENTS.md Loader    | 컨텍스트 파일 계층 수집, Agent Skills 표준 스킬 스캔·프롬프트 노출             | [Phase3-Skills-Agents-Loader.md](./phases/Phase3-Skills-Agents-Loader.md) |
| 4     | Session Storage & Compaction | SQLite 엔트리 저장, 탭 영속화, 컨텍스트 자동 압축                              | [Phase4-Session-Storage.md](./phases/Phase4-Session-Storage.md)           |
| 5     | Visualization & HITL         | Mermaid/Recharts 렌더링, 승인 모드(Human-in-the-loop)                          | [Phase5-Visualization-HITL.md](./phases/Phase5-Visualization-HITL.md)     |
| 6     | Agent Management UI          | 에이전트(페르소나) CRUD UI, 채팅에서 에이전트 선택                             | [Phase6-Agent-Management-UI.md](./phases/Phase6-Agent-Management-UI.md)   |
| 7     | Polish & QA                  | 단축키, 에러 처리, 패키징, 수동 QA, 문서화                                     | [Phase7-Polish-QA.md](./phases/Phase7-Polish-QA.md)                       |
| 8     | Internationalization         | ko/en i18n 인프라와 전 화면 문구 전환                                          | (TODO.md 기록)                                                            |
| 9     | Follow-ups                   | reasoning·다중 Provider·토큰 추적·생성 파라미터·모니터링 개편                  | (TODO.md 이슈 로그 기록)                                                  |
| 10    | Automated Evaluation         | 평가 팩·러너·채점·정규화·추천·외부 연동·Arena (Architecture §14)               | [Phase10-Evaluation.md](./phases/Phase10-Evaluation.md), [Phase10-Eval-Packs.md](./phases/Phase10-Eval-Packs.md) |

## 의존성 그래프

```
Phase 0 (Foundation)
   └─▶ Phase 1 (Shell & Layout UI)
           └─▶ Phase 2 (Agent Runtime & Chat)
                   ├─▶ Phase 3 (Skills & AGENTS.md Loader)   ┐
                   ├─▶ Phase 4 (Session Storage & Compaction) ├ 병렬 가능 (§확장점 규약)
                   └─▶ Phase 5 (Visualization & HITL)         ┘
                           └─▶ Phase 6 (Agent Management UI)   ※ Phase 3, 4 완료 필요 (enabledSkills, Agent 저장)
                                   └─▶ Phase 7 (Polish & QA)
                                           └─▶ Phase 8 (i18n) ─▶ Phase 9 (Follow-ups)
                                                   └─▶ Phase 10 (Automated Evaluation) — 내부 웨이브 W0~W4는 Phase10-Evaluation.md §0.4
```

### Phase 3·4·5 병렬 진행 조건 (중요)

초안은 "서로 다른 파일을 소유하므로 병렬 가능"이라고 했지만 실제로는 `buildGraph.ts` / `agentNode.ts` / `state.ts` / `useChat.ts`를 세 Phase가 모두 수정하는 구조였습니다. `Docs/Architecture.md` §5.0/§5.6의 재설계로 이 충돌을 제거했습니다:

- Phase 2가 `src/lib/agent/hooks.ts`와 `hookRegistry.ts`를 만들고, **이후 아무도 수정하지 않습니다.**
- Phase 4(압축)는 `src/lib/compaction/register.ts`에서, Phase 5(승인)는 `src/lib/approval/register.ts`에서 **자기 훅만 등록**합니다.
- Phase 3(스킬)은 런타임을 아예 건드리지 않습니다 — 스킬은 도구가 아니라 시스템 프롬프트 데이터이므로, `buildSystemPrompt()`에 넘길 `skills`/`contextFiles` 배열만 생산합니다.
- 세 Phase가 공유하는 유일한 파일은 `src/lib/agent/bootstrap.ts`이며 **Phase당 import 한 줄**입니다. 충돌해도 병합이 자명합니다.

이 조건이 깨지는 변경(예: 새 노드/새 공유 상태 도입)을 하려면 먼저 `Docs/TODO.md`의 "이슈" 섹션에 기록하십시오.

## 완료 기준 (Definition of Done) — 모든 작업 공통

- TypeScript 컴파일 에러 없음 (`pnpm typecheck`).
- Lint 통과 (`pnpm lint`).
- 신규/변경된 로직에 대한 최소한의 수동 확인 절차를 거쳤음 (각 작업 문서의 "확인 방법" 참고). 자동화 테스트가 있는 영역은 `pnpm test`도 통과해야 함.
- `Docs/TODO.md`의 해당 항목 체크 갱신.
- 커밋 메시지는 `AGENTS.md`의 커밋 규칙을 따름.

## 참고 리서치 자료

- 최초 요구사항/기술 리서치: `Docs/FortressPlan.txt`
- VivoStudio UI 아키텍처, VivoAcademy 에이전트/채팅, **pi 에이전트 런타임** 리서치 결과는 `Docs/Architecture.md` §1에 요약되어 있습니다. 원본 소스가 필요하면 `..\VivoStudio`, `..\VivoAcademy`, `..\pi`를 직접 참고하되, **코드를 그대로 복사하지 말고 패턴만 재구현**하십시오 (라이선스/의존성 불일치 방지, `AGENTS.md` 참고).
- pi에서 특히 자주 참조하게 될 파일:
  - `packages/agent/src/types.ts` — 루프 설정/훅/도구/이벤트 타입
  - `packages/agent/src/harness/compaction/compaction.ts` — 압축 알고리즘
  - `packages/coding-agent/src/core/skills.ts` — 스킬 스캔/검증/프롬프트 노출
  - `packages/coding-agent/src/core/resource-loader.ts` — AGENTS.md 계층 수집
  - `packages/coding-agent/src/core/system-prompt.ts` — 섹션 프롬프트 + diff
  - `packages/coding-agent/src/core/tools/` — 도구 구현과 출력 절단
  - `packages/coding-agent/docs/{compaction,skills,sessions}.md` — 위 구현의 산문 설명

## 초안 대비 주요 설계 변경 (2026-09-18)

`..\pi` 검토 결과 아래 네 가지를 변경했습니다. 각 항목의 근거는 `Docs/Architecture.md`의 해당 절에 있습니다.

| 변경            | 이전                                                                    | 이후                                                                                                                                    | 근거      |
| --------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 에이전트 런타임 | LangGraph.js `StateGraph` + `interrupt()` + 자체 `BaseCheckpointSaver`  | 자체 턴 루프 + 콜백 훅, Ollama HTTP 직접 호출                                                                                           | §5.0      |
| 스킬            | 프롬프트 스킬을 `DynamicTool`로 등록, 코드 스킬은 QuickJS 샌드박스 실행 | Agent Skills 표준 마크다운 스킬만. 프롬프트에 이름·설명·경로만 노출하고 `read`로 로드(프로그레시브 디스클로저). 코드 스킬·샌드박스 폐기 | §6.2, §7  |
| 도구 세트       | `read_file`/`write_file`/`list_directory`/`web_search`                  | `read`/`write`/`edit`/`ls`/`grep`/`find`/`shell`/`web_search` + 출력 이중 상한 절단                                                     | §12, §5.2 |
| 세션 저장       | `messages(role, content TEXT)` 정규화 테이블                            | append-only 엔트리(`message`/`compaction`/`custom`) + JSON payload                                                                      | §4.3      |

부수 효과: `@langchain/*` 의존성 제거, `js-tiktoken` 제거(Ollama 실측 usage 사용), `rquickjs` 제거, P4-07(Checkpointer) 작업 삭제.
