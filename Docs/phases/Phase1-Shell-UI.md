# Phase 1 — Shell & Layout UI (VivoStudio 스타일 골격)

**목표**: LLM 연동 없이, VivoStudio 패턴을 이식한 좌측 사이드바 + 좌측 패널 + 우측 탭 콘텐츠 UI 골격을 완성한다. 채팅 탭은 이 시점엔 정적 placeholder(입력해도 응답 없음)이며, 실제 LLM 연동은 Phase 2에서 이 골격 위에 붙인다.

**선행 조건**: Phase 0 완료 (`Docs/TODO.md` Phase 0 전체 `[x]`).

**공통 참고**: `Docs/Architecture.md` §2(디렉터리 구조), §3(레이아웃 상세 설계).

---

## P1-01. 타입 정의 + WorkspaceTabsContext + SidePanelContext

- **소유 파일**: `src/lib/types/workspaceTab.ts`, `src/lib/context/WorkspaceTabsContext.tsx`, `src/lib/context/SidePanelContext.tsx`
- **작업 내용**:
  1. `workspaceTab.ts`에 `Docs/Architecture.md` §3.3의 `WorkspaceTabType`, `WorkspaceTab` 타입을 정의.
  2. `WorkspaceTabsContext.tsx`: VivoStudio의 `WorkspaceTabsContext.tsx` 패턴(멱등 `openTab`, `closeTab`/`closeTabs`/`closeAllTabs`, `setActiveTab`, `updateTab`)을 **새로 작성**(복사 금지, API 시그니처만 동일하게 재현). 이 Phase에서는 아직 영속화(SQLite 저장/복원)는 구현하지 않는다 — 메모리 상태만 유지하고, Phase 4에서 영속화 로직을 이 Context에 추가한다. 주석으로 `// TODO(Phase4): persist to SQLite`를 남긴다.
  3. `SidePanelContext.tsx`: `activeView: SidePanelView`(`"chat-sessions" | "explorer" | "agents" | "skills" | null`), `setActiveView` 제공.
- **확인 방법**: 단위 테스트(`src/lib/context/WorkspaceTabsContext.test.tsx`, Vitest + Testing Library)로 `openTab`이 동일 id에 대해 중복 생성하지 않음을 검증.

## P1-02. ActivityBar

- **소유 파일**: `src/components/layout/ActivityBar.tsx`
- **작업 내용**: `Docs/Architecture.md` §3.1의 데이터 기반 배열(`ITEMS`)과 컨트롤드 컴포넌트 패턴대로 구현. Props: `{ activeView: SidePanelView; onSelect: (view) => void }`. 하단에 `lucide-react`의 `Settings` 아이콘으로 `react-router-dom`의 `<Link to="/settings">` 렌더링.
- **확인 방법**: Storybook 없이도 되지만, `App.tsx`에 임시로 마운트해 4개 아이콘 + Settings 아이콘이 보이고 클릭 시 `activeView` state가 바뀌는지 확인(콘솔 로그로 확인 가능).

## P1-03. WorkspaceLayout (리사이저블 스플릿)

- **소유 파일**: `src/components/layout/WorkspaceLayout.tsx`
- **작업 내용**: `pnpm add react-resizable-panels`. `Docs/Architecture.md` §3.2대로 `PanelGroup`/`Panel`/`PanelResizeHandle` 구성. `ImperativePanelHandle` ref를 props로 받아 부모(추후 `App.tsx` 또는 `Workspace.tsx`)가 ActivityBar의 클릭-토글-접기 로직을 구현할 수 있게 한다. Props: `{ sidePanel: ReactNode; centerWorkspace: ReactNode; sidePanelRef: RefObject<ImperativePanelHandle> }`.
- **확인 방법**: 좌우 드래그로 리사이즈되는지, 최소 크기 이하로 줄어들지 않는지 수동 확인.

## P1-04. Workspace 페이지 조립 (ActivityBar + WorkspaceLayout 연결)

- **소유 파일**: `src/pages/Workspace.tsx`(신규), `src/App.tsx`(라우트 등록만 수정 — `<HashRouter>` 도입, `/` → `Workspace`, `/settings/*` → Settings 라우트는 P1-09가 채움)
- **작업 내용**:
  1. `pnpm add react-router-dom@^7`. `App.tsx`를 VivoStudio처럼 **`HashRouter`**로 구성(이유: Tauri 번들 자산 프로토콜은 SPA fallback이 없음 — `Docs/Architecture.md` §1.1 참고, 및 VivoStudio/VivoAcademy 리서치에서 공통 확인된 패턴).
  2. `Workspace.tsx`에서 P1-02의 `ActivityBar`, P1-03의 `WorkspaceLayout`, P1-01의 두 Context Provider를 조립한다. `handleActivityBarSelect` 로직(활성 아이콘 재클릭 시 패널 접기)을 여기서 구현(`Docs/Architecture.md` §3.1 마지막 문단).
- **확인 방법**: `pnpm tauri dev`로 사이드바 클릭 시 패널이 펼쳐지고 접히는지 확인.

## P1-05. SidePanel 라우터 + 4개 패널 (초기 버전)

- **소유 파일**: `src/components/sidepanel/SidePanel.tsx`, `src/components/chatsessions/ChatSessionList.tsx`(placeholder), `src/components/agents/AgentListPanel.tsx`(placeholder), `src/components/skills/SkillListPanel.tsx`(placeholder)
- **작업 내용**: `SidePanel.tsx`는 `activeView`에 따라 4개 컴포넌트 중 하나를 렌더링하는 얇은 라우터(`Docs/Architecture.md` §3.2). 이 Phase에서 `ChatSessionList`, `AgentListPanel`, `SkillListPanel`은 "곧 제공됩니다" 정도의 정적 placeholder만 렌더링(각각 Phase 4, Phase 6, Phase 3에서 실동작으로 교체). `explorer` 뷰는 P1-06에서 실제 `FileTree`를 붙인다.
- **확인 방법**: 사이드바에서 각 아이콘 클릭 시 대응하는 패널(또는 placeholder)이 보이는지 확인.

## P1-06. FileTree (파일 탐색기) 전체 이식 + Rust `fs_commands`

- **소유 파일**: `src/components/explorer/FileTree.tsx`, `src/lib/types/fileTree.ts`, `src-tauri/src/commands/fs_commands.rs`, `src-tauri/src/commands/mod.rs`(등록), `src-tauri/capabilities/default.json`(fs 스코프 조정)
- **작업 내용**:
  1. Rust: `Docs/Architecture.md` §12의 커맨드(`read_text_file`, `write_text_file`, `read_project_folder_tree`, `create_file`, `create_folder`, `rename_path`, `delete_path`)를 구현. `read_project_folder_tree`는 재귀적으로 `{name, path, is_dir, children}` 트리를 반환. 워크스페이스 루트 밖 경로는 거부(경로 정규화 후 prefix 체크).
  2. `capabilities/default.json`에 사용자가 선택한 워크스페이스 폴더에 대한 fs 스코프를 등록(Tauri 2의 `fs:scope` 권한 — 앱 시작 시 사용자가 폴더를 선택하면 동적으로 스코프를 추가하는 방식은 `@tauri-apps/plugin-dialog` + 런타임 스코프 API 사용).
  3. 프런트: VivoStudio `FileTree.tsx`의 트리/리스트 뷰 토글, 확장 상태(`Set<string>`), 컨텍스트 메뉴(복사/잘라내기/붙여넣기/삭제/이름변경/새 파일/새 폴더), 인라인 이름변경, 필터 검색을 **새로 작성**(복사 금지, 기능은 동일하게 재현). 단, VivoStudio의 `course://changed` 외부 변경 감지 버스는 **1차 스코프 제외**(파일시스템 워처는 Phase 7 이후 필요시 추가).
  4. 파일 클릭 시 이미지 확장자(`png/jpg/jpeg/gif/svg/webp`)는 `image-viewer` 탭, 그 외는 `editor` 탭을 `openTab`으로 연다(탭 id는 `` `image-viewer:${path}` ``/`` `editor:${path}` ``).
- **확인 방법**: 워크스페이스 폴더 선택 → 트리 렌더링 → 새 파일/폴더 생성/삭제/이름변경이 실제 디스크에 반영되는지 확인.

## P1-07. CenterWorkspace(탭바) + EditorTab(CodeMirror6) + ImageViewerTab

- **소유 파일**: `src/components/workspace/CenterWorkspace.tsx`, `src/components/workspace/EditorTab.tsx`, `src/components/workspace/ImageViewerTab.tsx`, `src/components/workspace/TabPlaceholder.tsx`
- **작업 내용**:
  1. `CenterWorkspace.tsx`: `Docs/Architecture.md` §3.3의 탭 데이터 모델을 사용해 탭 스트립(아이콘+제목+닫기 버튼) 렌더링, `renderTabContent(tab)`으로 타입별 컴포넌트 라우팅. **스플릿 페인 드래그앤드롭은 구현하지 않는다**(1차 스코프 제외 — `Docs/Architecture.md` §1.1). 탭 우클릭 컨텍스트 메뉴(닫기/다른 탭 닫기/모두 닫기)는 VivoStudio 패턴을 참고해 새로 작성.
  2. `EditorTab.tsx`: `pnpm add @codemirror/lang-javascript @codemirror/lang-json @codemirror/lang-markdown @codemirror/lang-python @codemirror/theme-one-dark codemirror`(필요한 언어만 우선 추가, 확장자별 language extension 매핑 함수 작성). `read_text_file`/`write_text_file` Tauri 커맨드로 디스크 직접 읽기/쓰기, 500ms 디바운스 autosave. Markdown 파일은 원본/분할/미리보기 3단 토글(react-markdown+remark-gfm, `pnpm add react-markdown remark-gfm`).
  3. `ImageViewerTab.tsx`: `convertFileSrc` + 25~400% 줌 컨트롤(VivoStudio 패턴 재현).
  4. `TabPlaceholder.tsx`: 아직 구현되지 않은 탭 타입(`agent-editor`, `skill-viewer` — Phase 3/6에서 실제 구현으로 교체됨) 및 이 Phase의 `chat` 탭(placeholder, P1-08 참고)을 위한 "곧 제공됩니다" 표시.
- **확인 방법**: 파일 열기 → 문법 강조 확인 → 편집 후 자동저장 → 파일 시스템에서 변경 확인. 이미지 파일 열기 → 줌 동작 확인.

## P1-08. Chat 탭 Placeholder + 앱 시작 시 기본 탭 자동 오픈

- **소유 파일**: `src/components/workspace/ChatTab.tsx`(이 Phase에서는 정적 UI만 — 입력창+빈 메시지 리스트, 전송 버튼은 비활성화 또는 "Phase 2에서 연결 예정" 토스트만 표시)
- **작업 내용**: `Workspace.tsx` 마운트 시 열린 탭이 0개이면 `openTab({ type: "chat", id: "chat:default", title: "새 채팅" })`을 자동 호출한다(`Docs/Architecture.md` §3.3 "앱 시작 시 기본 동작"). 실제 세션/에이전트 연결은 Phase 2, 4, 6에서 채워진다.
- **확인 방법**: 앱을 처음 실행하면 채팅 탭이 자동으로 열려 있는지 확인.

## P1-09. Settings 라우트 골격

- **소유 파일**: `src/pages/Settings/SettingsLayout.tsx`, `src/pages/Settings/SettingsGeneral.tsx`, `src/pages/Settings/SettingsModel.tsx`, `src/pages/Settings/SettingsApproval.tsx`, `src/App.tsx`(라우트 추가 — `/settings`, `/settings/model`, `/settings/approval` 중첩 라우트)
- **작업 내용**: VivoStudio의 Settings 레이아웃 패턴(좌측 탭 메뉴 + 우측 폼 영역)을 재현. 이 Phase에서는 폼 필드를 그리기만 하고 실제 저장 로직은 연결하지 않는다(`SettingsGeneral`은 언어/테마 정도, `SettingsModel`/`SettingsApproval`은 Phase 2/4/5/6에서 실제 `SettingsContext`와 연결). 각 페이지 상단에 `// TODO(PhaseN): wire to SettingsContext` 주석을 남긴다.
- **확인 방법**: `/settings` 진입 시 좌측 탭 메뉴로 3개 서브페이지 전환이 되는지 확인.

## P1-10. ThemeContext + 다크모드 적용

- **소유 파일**: `src/lib/context/ThemeContext.tsx`
- **작업 내용**: `"light" | "dark" | "system"` 테마 선택, `resolveTheme()`/`applyTheme()`(VivoStudio 패턴 재구현), 모듈 로드 시점에 동기적으로 `document.documentElement.classList`를 조정해 FOUC 방지. 이 Phase에서는 `localStorage`에 임시 저장(Phase 4에서 SQLite `app_settings`로 이관 예정, 주석으로 명시).
- **확인 방법**: `SettingsGeneral`에서 테마 전환 시 즉시 반영되고 새로고침 후에도 유지되는지 확인.

---

## Phase 1 완료 조건

- [ ] 앱 실행 시 좌측 사이드바 4개 아이콘 + 하단 설정 아이콘이 보인다.
- [ ] 파일 탐색기에서 실제 폴더/파일 CRUD가 동작한다.
- [ ] 텍스트 파일을 열면 문법 강조가 되는 편집기가 뜨고 자동저장된다.
- [ ] 이미지 파일을 열면 뷰어가 뜨고 줌이 동작한다.
- [ ] 앱 시작 시 채팅 탭이 자동으로 열려 있다(내용은 아직 placeholder).
- [ ] `/settings` 라우트가 동작한다.
- [ ] `pnpm lint && pnpm typecheck && pnpm build` 통과.
- [ ] `Docs/TODO.md`의 Phase 1 항목이 모두 `[x]`다.
