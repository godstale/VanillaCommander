# Phase 3 — Skills & AGENTS.md Loader

**목표**: 사용자의 워크스페이스에 있는 `AGENTS.md` 계층과 `.agents/skills/`의 스킬을 스캔해 시스템 프롬프트에 노출한다. 스킬 관리 사이드패널(좌측)이 실동작하게 된다.

**선행 조건**: Phase 2 완료.

**공통 참고**: `Docs/Architecture.md` §4.4(SkillManifest), §6(로더 설계 — **전체 필독**), §7(안전 경계).

**pi 참고**: `..\pi\packages\coding-agent\src\core\skills.ts`, `core\resource-loader.ts`(`loadProjectContextFiles`), `core\utils\frontmatter.ts`, `docs\skills.md`. **코드를 복사하지 말고 설계만 재구현할 것.**

> ⚠️ **이름 혼동 주의**: 이 Phase가 다루는 `.agents/skills/`는 **Fortress 앱이 연 사용자 워크스페이스 폴더** 안의 것입니다. Fortress 리포지토리 자체의 `.agents/skills/`(Claude Code 전역 스킬 미러)와는 무관하며 절대 그 폴더를 코드에서 참조하지 않습니다.

> 📌 **초안 대비 변경**: 코드 스킬(`index.json`/`index.js`)과 QuickJS 샌드박스는 **폐기**되었습니다(`Docs/Architecture.md` §7). 스킬을 `DynamicTool`로 등록하던 설계도 폐기되었습니다 — 스킬은 도구가 아니라 시스템 프롬프트 데이터입니다(§6.2). 그 결과 **이 Phase는 에이전트 런타임 파일을 전혀 수정하지 않으며**, Phase 4·5와 완전히 병렬 진행할 수 있습니다.

---

## P3-01. frontmatter 파서

- **소유 파일**: `src/lib/skills/frontmatter.ts`
- **작업 내용**: `---\n…\n---` 블록에서 `key: value` 라인을 추출하는 최소 파서. 지원 범위: 문자열, `true`/`false`, 따옴표 제거, 여러 줄 값은 미지원(한 줄로 제한). YAML 전체 문법을 지원하지 않으며, **파싱 실패 시 throw하지 말고 `{frontmatter: {}, body, error}` 형태로 반환**한다(스캐너가 경고로 처리). BOM 제거 포함.
- **확인 방법**: frontmatter 없음 / 정상 / 깨진 구분자 / BOM 포함 / boolean 값 — 5가지 케이스 Vitest.

## P3-02. 컨텍스트 파일(AGENTS.md) 계층 수집

- **소유 파일**: `src/lib/skills/contextFiles.ts`
- **작업 내용**: `Docs/Architecture.md` §6.1 구현.
  1. `loadContextFileFromDir(dir)`: 후보 파일명을 **`AGENTS.override.md` → `AGENTS.md` → `AGENTS.MD` → `CLAUDE.md` → `CLAUDE.MD`** 순으로 확인해 **첫 번째로 존재하는 것 하나만** 반환.
  2. `loadProjectContextFiles({workspaceRoot, globalDir})`: 전역 디렉터리를 먼저 넣고, 워크스페이스 루트에서 파일시스템 루트까지 조상을 거슬러 올라가며 수집한 뒤 **루트 → 워크스페이스 순서로** 정렬해 반환. 같은 경로는 중복 제거.
  3. 반환 타입은 `Array<{path: string; content: string}>`.
- **확인 방법**: 중첩 폴더(조부모/부모/자식 각각에 AGENTS.md)를 만든 임시 디렉터리로 순서와 중복 제거를 검증하는 Vitest. `AGENTS.override.md`가 `AGENTS.md`를 이기는지도 확인.

## P3-03. 스킬 스캐너

- **소유 파일**: `src/lib/skills/scanner.ts`, `src/lib/types/skill.ts`
- **작업 내용**:
  1. `skill.ts`에 `Docs/Architecture.md` §4.4의 `SkillManifest`/`SkillSource`/`SkillDiagnostic` 정의.
  2. `scanSkills({workspaceRoot, globalDir}): Promise<{skills: SkillManifest[]; diagnostics: SkillDiagnostic[]}>` — §6.2의 탐색 규칙 구현:
     - 디렉터리에 `SKILL.md`가 있으면 **그 디렉터리를 스킬 루트로 보고 더 내려가지 않는다**.
     - 없으면 하위로 재귀. `node_modules`와 `.`으로 시작하는 폴더는 건너뛴다.
     - `.gitignore`/`.ignore` 존중(Rust 쪽 `ignore` 크레이트를 재사용하는 새 커맨드를 만들거나, JS에서 최소 구현 — **JS 최소 구현을 권장**: 이 단계에서 Rust 커맨드를 추가하면 P2-05가 소유한 파일을 건드리게 된다).
     - 전역(`%APPDATA%/Fortress/skills/`) → 워크스페이스(`.agents/skills/`) 순으로 수집.
  3. §4.4의 검증 규칙 적용: `name`은 1~64자 `[a-z0-9-]`(위반 시 **경고 후 로드**), `description`은 필수 최대 1024자(**없으면 로드하지 않음**). `name`이 없으면 부모 폴더명을 쓴다.
  4. 이름 충돌 시 **먼저 찾은 것을 유지**하고 `collision` 진단을 남긴다.
- **확인 방법**: 정상 스킬 / description 누락 / 이름 규칙 위반 / 중첩 SKILL.md(내려가지 않는지) / 이름 충돌 — 5가지 케이스를 담은 임시 폴더로 Vitest.

## P3-04. 프롬프트 노출 (`<available_skills>`)

- **소유 파일**: `src/lib/skills/formatForPrompt.ts`
- **작업 내용**: §6.2의 XML 형식을 생성하는 `formatSkillsForPrompt(skills): string`. `disableModelInvocation: true`인 스킬은 제외. XML 이스케이프(`& < > " '`) 필수. 스킬이 0개면 빈 문자열 반환(섹션 자체가 생략되도록).
  프롬프트 머리말에 "`read` 도구로 스킬 파일을 로드하라", "스킬 파일의 상대 경로는 스킬 디렉터리 기준으로 해석하라"를 포함한다.
- **확인 방법**: 특수문자가 든 설명이 올바르게 이스케이프되는지, `disableModelInvocation` 필터가 동작하는지 Vitest.

## P3-05. SkillsContext + 워크스페이스 신뢰 확인

- **소유 파일**: `src/lib/context/SkillsContext.tsx`, `src/lib/context/WorkspaceContext.tsx`, `src/components/workspace/TrustWorkspaceDialog.tsx`
- **작업 내용**:
  1. `WorkspaceContext`: 현재 워크스페이스 루트와 신뢰 여부를 관리. 새 폴더를 처음 열면 §7의 **신뢰 확인 다이얼로그**를 띄운다("이 폴더의 AGENTS.md와 스킬을 로드할까요? 스킬은 모델에게 임의 행동을 지시할 수 있습니다"). 신뢰 결정은 폴더 경로 단위로 기억(Phase 4 전까지는 `localStorage`, 이후 `app_settings`로 이관).
  2. `SkillsContext`: 워크스페이스가 바뀌거나 신뢰가 부여되면 `scanSkills` + `loadProjectContextFiles` 재실행. 결과와 진단을 보관. 사용자가 스킬별로 활성/비활성을 토글할 수 있고(Agent의 `enabledSkills`와 별개인 **로컬 오버라이드**), 신뢰하지 않은 워크스페이스에서는 컨텍스트 파일과 워크스페이스 스킬을 로드하지 않는다(전역 스킬은 로드).
- **확인 방법**: 신뢰 거부 시 스킬/컨텍스트 파일이 비는지, 승인 후 로드되는지 수동 확인.

## P3-06. SkillListPanel + SkillViewerTab

- **소유 파일**: `src/components/skills/SkillListPanel.tsx`(Phase 1 placeholder 교체), `src/components/workspace/SkillViewerTab.tsx`
- **작업 내용**: `SkillListPanel`은 스킬 카드 목록(이름/설명/출처 배지 `전역`·`워크스페이스`) + 활성 토글 + 클릭 시 `skill-viewer` 탭 오픈. **진단(경고/충돌)을 패널 상단에 접을 수 있는 목록으로 표시**한다 — 스킬이 왜 안 잡히는지 사용자가 알 수 있어야 한다. `SkillViewerTab`은 `SKILL.md` 본문을 react-markdown으로 렌더링하고, 스킬 폴더의 파일 목록도 함께 보여준다.
- **확인 방법**: 토글이 즉시 반영되고, 잘못된 스킬의 경고가 표시되며, 뷰어에 본문이 보이는지 확인.

## P3-07. 프롬프트 병합

- **소유 파일**: `src/hooks/useChat.ts`(P2-07 파일에 **소규모 추가** — `SkillsContext`에서 `contextFiles`/`skills`를 읽어 `buildSystemPromptSections()` 인자로 넘기는 것뿐)
- **작업 내용**: `useChat`이 `FortressAgent`를 만들 때 `buildSystemPromptSections({agent, tools, contextFiles, skills, cwd})`에 실제 값을 넘긴다. **`buildSystemPrompt.ts`는 수정하지 않는다** — P2-04에서 슬롯이 이미 준비되어 있다.
  세션 도중 스킬 토글/워크스페이스 변경이 일어나면 `diffSections()`로 변경된 섹션만 새 system 메시지로 주입한다(§5.5).
  `agent.enabledSkills`에 없는 스킬은 프롬프트에서 제외한다.
- **확인 방법**: 워크스페이스에 `AGENTS.md`를 두고 "너는 어떤 지침을 따르고 있어?"라고 물어 반영 여부 확인. 스킬을 하나 두고 관련 질문을 던져 모델이 `read`로 `SKILL.md`를 읽는지 확인(안 읽으면 P3-08로 보완).

## P3-08. `/skill:name` 명시 호출

- **소유 파일**: `src/lib/skills/invokeSkill.ts`, `src/components/chat/ChatInput.tsx`(P2-08 파일에 슬래시 명령 처리 **추가**)
- **작업 내용**: §6.4 구현. 입력창에 `/skill:<name> [args]`를 입력하면 해당 `SKILL.md` 본문을 읽어 user 메시지로 주입하고, 인자가 있으면 본문 뒤에 `User: <args>`를 덧붙인다. 입력 중 `/skill:`을 타이핑하면 스킬 이름 자동완성 목록을 띄운다. `disableModelInvocation: true`인 스킬도 이 경로로는 호출 가능하다.
- **확인 방법**: 자동완성이 뜨고, 호출 시 본문이 주입되어 모델이 그대로 따르는지 수동 확인.

---

## Phase 3 완료 조건

- [ ] 워크스페이스 및 조상 디렉터리의 `AGENTS.md`가 루트→워크스페이스 순서로 시스템 프롬프트에 반영된다.
- [ ] `.agents/skills/`와 전역 스킬 폴더의 `SKILL.md`가 재귀 스캔되어 좌측 패널에 표시된다.
- [ ] 잘못된 스킬(description 누락, 이름 규칙 위반, 이름 충돌)에 대해 진단이 표시된다.
- [ ] 시스템 프롬프트에 `<available_skills>`로 이름·설명·경로만 노출되고, 모델이 `read` 도구로 본문을 로드한다.
- [ ] `/skill:name`으로 스킬을 강제 호출할 수 있다.
- [ ] 신뢰하지 않은 워크스페이스에서는 컨텍스트 파일과 워크스페이스 스킬이 로드되지 않는다.
- [ ] 스킬 활성/비활성 토글이 동작하고 프롬프트에 즉시 반영된다.
- [ ] **`src/lib/agent/` 아래 파일을 하나도 수정하지 않았다**(§5.6 확장점 규약 준수 확인).
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 통과.
- [ ] `Docs/TODO.md`의 Phase 3 항목이 모두 `[x]`다.
