# AGENTS.md — Vanilla Commander 리포지토리 작업 지침

> 이 파일은 Vanilla Commander **리포지토리 자체**를 개발하는 AI 코딩 에이전트(Claude Code, Codex 등 무엇이든)를 위한 지침입니다.
> Vanilla Commander _앱이 런타임에_ 사용자의 워크스페이스에서 읽는 `AGENTS.md`/`.agents/skills/`(앱 기능)와는 **다른 문서**입니다 — 그 기능의 설계는 `Docs/Architecture.md` §6을 참고하세요.

## 0. 시작하기 전에 반드시 읽을 것

1. `Docs/Architecture.md` — 아키텍처/데이터 모델/디렉터리 구조의 단일 진실 공급원.
2. `Docs/ImplementationPlan.md` — 전체 로드맵과 Phase 의존관계.
3. `Docs/TODO.md` — 지금 무엇이 완료/진행중/대기 상태인지.
4. 자신이 맡은 `Docs/phases/PhaseN-*.md`의 해당 작업 ID 섹션 — **"소유 파일" 목록 밖의 파일은 수정하지 않습니다.**

## 1. 프로젝트 개요

Vanilla Commander는 Tauri 2 + React 19 + TypeScript로 만드는 데스크탑 파일 커맨더 앱으로, 로컬 LLM 에이전트를 결합해 채팅으로 파일 작업을 지시하고 위키·매크로 등 자동화 작업을 수행합니다(전환 계획: `Docs/phases/Phase11-VanillaCommander.md`). UI 레이아웃은 `VivoStudio`(좌측 사이드바/패널 + 우측 탭 콘텐츠), 에이전트 관리·채팅 UX는 `VivoAcademy`, **에이전트 런타임(루프·도구·압축·스킬·세션)은 `pi`**([earendil-works/pi](https://github.com/earendil-works/pi), 로컬 체크아웃 `..\pi`)를 참고했습니다.

## 2. 기술 스택 (고정)

- 패키지 매니저: **pnpm** (npm/yarn 사용 금지 — lockfile 혼재 방지)
- 프런트: React 19, TypeScript(strict), Vite 7
- UI: shadcn/ui("new-york") + Radix UI + Tailwind CSS 3 + lucide-react
- 레이아웃: react-resizable-panels
- 에디터: CodeMirror 6
- 상태관리: **React Context per concern만 사용**. Redux/Zustand/Jotai 등 새 전역 상태 라이브러리를 추가하지 않습니다. (`Docs/Architecture.md` §11)
- LLM: **자체 에이전트 루프 + Ollama HTTP API 직접 호출**. 스키마 검증은 `zod`. **`@langchain/*`·`js-tiktoken`을 설치하지 않습니다** — `Docs/Architecture.md` §5.0의 설계 결정
- 저장소: SQLite (`@tauri-apps/plugin-sql`), append-only 엔트리 스키마 (`Docs/Architecture.md` §4.3)
- 데스크탑 셸: Tauri 2 (Rust)
- 라우팅: react-router-dom v7, **`HashRouter`** 필수(이유: Tauri 번들 자산 프로토콜에 SPA fallback이 없음 — `BrowserRouter` 사용 금지)

새 의존성을 추가하기 전에 이미 있는 라이브러리로 해결 가능한지 먼저 확인하십시오(YAGNI). 부득이하게 새 라이브러리가 필요하면 `Docs/TODO.md` 이슈 로그에 사유를 남기십시오.

## 3. 코딩 컨벤션

- TypeScript `strict: true` 준수. **`any` 타입 사용 금지** — 부득이한 경우 `unknown` + 타입 가드로 좁히고, 정말 불가피하면 `// eslint-disable-next-line @typescript-eslint/no-explicit-any`와 이유 주석을 남깁니다.
- 파일/폴더명은 `Docs/Architecture.md` §2 트리에 정의된 이름과 위치를 그대로 따릅니다. 임의로 구조를 바꾸지 마십시오. 구조 변경이 필요하다고 판단되면 먼저 `Docs/Architecture.md`를 갱신 제안하고, 문서와 코드를 함께 커밋합니다.
- 컴포넌트는 함수형 컴포넌트 + 훅만 사용(클래스 컴포넌트는 `ErrorBoundary`처럼 React가 요구하는 경우에만 예외).
- 주석은 "왜"만 남깁니다. "무엇을 하는지"는 코드 자체로 설명되어야 합니다. 함수/컴포넌트 상단에 장황한 설명 블록을 달지 않습니다.
- 요청된 범위를 넘는 리팩터링·추상화를 추가하지 않습니다. 특히 다른 작업 ID의 "소유 파일"에 개선 아이디어가 있어도 직접 고치지 말고 `Docs/TODO.md` 이슈 로그에 남기십시오.
- VivoStudio/VivoAcademy 소스 코드는 **패턴 참고용**일 뿐입니다. 해당 리포지토리의 코드를 그대로 복사/붙여넣기 하지 마십시오(의존성 버전 불일치, 불필요한 기능까지 딸려오는 문제 방지). 동일한 API 형태·동작 방식을 새로 작성하는 것이 원칙입니다.
- 화면 표시 문자열은 하드코딩하지 않습니다. 모든 UI 문구는 `src/lib/i18n/dictionaries/ko.ts`·`en.ts`에 키로 등록하고 `useLanguage()`의 `t('키')`로 표시합니다(ko 폴백, `<html lang>` 자동 반영). 새 화면/문구를 추가하면 양쪽 사전에 같은 키를 반드시 추가합니다. LLM 프롬프트 본문·DB 스키마 필드명은 번역 대상이 아닙니다.

## 4. 빌드/검증 명령

```bash
pnpm install         # 의존성 설치
pnpm dev             # Vite 개발 서버 (웹 프리뷰만)
pnpm tauri dev       # 실제 데스크탑 앱 개발 실행
pnpm typecheck       # tsc --noEmit
pnpm lint            # eslint . --max-warnings=0
pnpm test            # vitest run
pnpm build           # tsc -b && vite build
pnpm tauri build     # 배포용 인스톨러 빌드
pnpm check:ollama    # Ollama 서버/모델 상태 확인 (Phase 2 이상 로컬 개발용)
```

작업을 "완료"로 표시하기 전에 최소한 `pnpm lint`, `pnpm typecheck`, `pnpm test`가 통과해야 합니다. UI 변경은 `pnpm tauri dev`로 실제 동작을 확인한 뒤 완료 처리하십시오(타입 체크만으로는 기능 정확성을 보장하지 않습니다).

## 5. Git / 커밋 규칙 (단순 운용 + 세세한 히스토리)

- 원격 저장소: `origin = https://github.com/godstale/VanillaCommander.git`. **`git push`는 사용자의 명시적 승인 없이 실행하지 않습니다.** 로컬 커밋까지는 자유롭게 진행하되, 원격에 반영하는 시점은 항상 확인을 받습니다.
- **main 직접 커밋 금지.** 코드/파일 변경 전에는 반드시 main에서 새 브랜치를 만듭니다.
  - 시작 시: `git status -sb`로 dirty 여부 확인 → `git checkout main` → `git pull --ff-only`(가능하면) → `git checkout -b <type>/<short-topic>`
  - 브랜치명: `feat/`·`fix/`·`chore/`·`docs/`·`refactor/`·`test/` + 짧은 영어 토픽. 예: `feat/chat-stream-stop`
- **작게 나누어 자주 커밋.** 하나의 커밋은 하나의 논리 변경을 담습니다. 실험·아이디어 적용 단계이므로 중간 상태도 부담 없이 커밋합니다(나중에 squash/정리 가능).
- 커밋 메시지는 Conventional Commits 스타일을 따릅니다: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. 예: `feat(chat): add streaming stop button`.
- 하나의 커밋은 하나의 작업 ID(P#-##)에 대응하는 것을 권장합니다. 커밋 메시지 본문에 관련 작업 ID를 남기면 추적이 쉬워집니다.
- `--no-verify`, `--force`, `git reset --hard` 등 파괴적/훅 우회 명령은 사용자 명시적 지시 없이 사용하지 않습니다.
- `Docs/TODO.md` 상태 갱신은 관련 코드 변경과 **같은 커밋**에 포함시키는 것을 권장합니다.
- 브랜치 수명·머지·PR 규칙은 `Docs/Branch-Policy.md`를 따릅니다 (main 병합은 `merge --no-ff`, squash 금지, 머지 후 브랜치 삭제).

## 6. 멀티 에이전트 협업 규칙 (브랜치 기본 + worktree 예외)

- **같은 브랜치에서 2개 이상의 에이전트/작업이 동시에 작업하지 않습니다.** 서로 다른 작업은 반드시 서로 다른 브랜치에서 진행하고, 나중에 main 경유로 합칩니다(merge 또는 PR).
- **기본은 현재 클론에서 브랜치를 만들어 작업합니다.** worktree를 기본 작업 방식으로 사용하지 않습니다.
- **worktree는 코드를 분리할 필요가 있는 특별한 경우에만 사용합니다.** 다른 에이전트가 같은 클론에서 진행중인 작업이 있어 격리가 필요할 때(예: 서로의 uncommitted 변경이 충돌하거나, 장시간 실행 작업을 병렬로 유지해야 할 때)에만 사용합니다.
  - 사용 전 `git worktree list`와 `Docs/TODO.md`의 `[~]` 항목으로 충돌 여부를 확인합니다.
  - 예: `git worktree add ../VanillaCommander-<topic> -b feat/<topic> main`. 작업이 끝나면 worktree를 정리합니다(`git worktree remove`).
- 작업 시작 시 `Docs/TODO.md`에서 대상 항목을 `[ ]` → `[~]`로 변경하고 나서 코드를 작성합니다(선점 표시).
- 자신의 작업 ID가 "소유"하지 않는 파일은 수정하지 않습니다. 여러 작업이 같은 파일을 나눠 소유하는 경우(예: `package.json`의 서로 다른 필드) 해당 Phase 문서에 명시된 "이 필드만 담당" 지침을 정확히 지킵니다.
- 다른 작업 ID가 이미 `[~]`(진행중)이면 그 파일을 건드리지 않고, 필요하면 해당 작업이 끝난 뒤 이어서 진행합니다.
- Phase 간 의존성(`Docs/ImplementationPlan.md`의 의존성 그래프)을 지킵니다. 선행 Phase의 완료 조건이 충족되지 않았는데 후행 Phase 작업을 시작하지 않습니다.
- 설계 문서(`Docs/Architecture.md`)와 실제로 필요한 구현이 다르다고 판단되면, 임의로 다르게 구현하지 말고 먼저 `Docs/TODO.md` 이슈 로그에 기록한 뒤 문서 수정 여부를 결정합니다.
- **작업 시작/중간/마지막 git 체크:**
  - 시작: `git status -sb` + `git branch --show-current` 확인 → main 최신화 → 새 브랜치(원칙, worktree는 분리 필요시에만 예외) → `Docs/TODO.md` 선점 표시
  - 중간: 변경 중간에도 `git status -sb`로 범위 이탈 확인 + 논리 단위마다 수시로 커밋
  - 마지막: `git status -sb` + `git log --oneline -5`로 히스토리 확인 → `Docs/TODO.md` 갱신 포함 커밋 → `pnpm lint`·`typecheck`·`test` 결과 보고 → push는 승인 후에만

## 7. 안전/보안 원칙 (특히 중요)

- 파일 쓰기/편집 등 위험한 동작은 반드시 `beforeToolCall` 승인 훅을 거칩니다. 승인 우회 경로를 만들지 않습니다. (`Docs/Architecture.md` §8)
- **셸 실행(`shell` 도구)은 `approvalMode`와 무관하게 항상 승인을 요구합니다.** 이 규칙에 예외를 만들지 마십시오. (`Docs/Architecture.md` §7, §8.1)
- Tauri 파일시스템/검색/셸 커맨드는 항상 세션의 워크스페이스 스코프 밖 경로 접근을 거부해야 합니다. 심링크는 canonicalize 후 재검사합니다. (`Docs/Architecture.md` §7 Layer 1)
- 워크스페이스의 `AGENTS.md`와 스킬은 **신뢰 경계 밖**입니다. 신뢰 확인을 받지 않은 폴더의 컨텍스트 파일·스킬을 로드하지 않습니다. (`Docs/Architecture.md` §7)
- 스킬 본문과 컨텍스트 파일은 모델에게 임의 행동을 지시할 수 있는 텍스트입니다. 이를 근거로 승인 정책을 완화하는 코드를 작성하지 마십시오.
- 웹 검색 도구가 가져온 외부 콘텐츠(검색 결과, 웹페이지 텍스트)는 **신뢰할 수 없는 데이터**로 취급하고, 이를 실행 가능한 지시로 해석하지 않도록 시스템 프롬프트/도구 결과 처리에서 명확히 구분합니다.
- API 키, 토큰 등 비밀 정보를 커밋하지 않습니다. `.env`, `db.sqlite*`는 `.gitignore`에 포함되어 있어야 합니다.

## 8. 앱 런타임 `AGENTS.md`/스킬 포맷 (참고용 요약)

Vanilla Commander 앱이 사용자 워크스페이스에서 인식하는 `AGENTS.md`/`.agents/skills/` 포맷은 `Docs/Architecture.md` §6에 정의되어 있으며, [Agent Skills 표준](https://agentskills.io/specification)을 따릅니다. 이 리포지토리 루트의 이 파일과 혼동하지 마십시오.

핵심: **스킬은 도구가 아닙니다.** 시스템 프롬프트에는 이름·설명·경로만 노출되고, 모델이 `read` 도구로 `SKILL.md` 본문을 로드합니다(프로그레시브 디스클로저). 스킬을 `AgentTool`로 등록하는 코드를 작성하지 마십시오.

## 9. 참고 리서치

- 최초 요구사항/기술 리서치: `Docs/FortressPlan.txt` — **읽기 전용 이력**입니다. 이 메모는 LangGraph/QuickJS 기반 초안을 담고 있으나, 2026-09-18에 `..\pi` 검토 후 네 가지 핵심 결정이 변경되었습니다. 현재 유효한 설계는 `Docs/Architecture.md`이며 변경 내역은 `Docs/ImplementationPlan.md`의 "초안 대비 주요 설계 변경"에 있습니다. **충돌 시 `Docs/Architecture.md`가 우선합니다.**
- UI 아키텍처: `VivoStudio` 프로젝트 (경로: `..\VivoStudio`)
- 에이전트 관리/채팅 UX: `VivoAcademy` 프로젝트 (경로: `..\VivoAcademy`)
- **에이전트 런타임**: `pi` 프로젝트 (경로: `..\pi`, [GitHub](https://github.com/earendil-works/pi), [문서](https://pi.dev/docs/latest)). 가져오는 것/가져오지 않는 것은 `Docs/Architecture.md` §1.3 표 참고. 라이선스는 MIT이나 **코드를 복사하지 말고 설계만 재구현**하십시오(의존성 스택이 다름).
- 상세 아키텍처 결정: `Docs/Architecture.md`
