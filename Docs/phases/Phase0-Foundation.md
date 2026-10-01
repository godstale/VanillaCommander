# Phase 0 — Foundation (레포/툴체인 셋업)

**목표**: 이후 모든 Phase가 위에서 개발을 시작할 수 있는 빈 골격(스캐폴딩)을 완성한다. 이 Phase가 끝나면 `pnpm tauri dev`로 빈 창(흰 화면)이 뜨고, lint/typecheck 명령이 동작해야 한다.

**선행 조건**: 없음 (최초 Phase).

**공통 참고**: `Docs/Architecture.md` §0, §2 (디렉터리 구조 최종 목표).

---

## P0-01. pnpm + Vite 7 + React 19 + TypeScript 프로젝트 스캐폴딩

- **소유 파일**: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`(임시 최소 내용, P0-03에서 확장)
- **작업 내용**:
  1. `pnpm create vite@latest . --template react-ts` 흐름과 동일하게(또는 수동으로) React 19 + TS 템플릿을 생성한다. 이미 있는 `Docs/`, `.agents/`, `.claude/` 폴더는 건드리지 않는다.
  2. `package.json`의 `name`을 `fortress`로, `version`을 `0.1.0`으로 설정한다.
  3. React `^19.1.0`, `react-dom ^19.1.0`, TypeScript `~5.8.3`으로 버전을 고정한다 (VivoStudio와 동일 — `Docs/Architecture.md` §0).
  4. `tsconfig.json`은 `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`를 켠다. path alias `@/* → src/*` 설정.
  5. `vite.config.ts`에 `@` alias 등록, Tauri 개발 편의를 위한 `clearScreen: false`, `server.strictPort: true` 등 Tauri 공식 가이드의 기본 설정을 반영한다.
  6. `src/App.tsx`는 임시로 `<div>Fortress</div>` 정도만 렌더링 (Phase 1에서 실제 레이아웃으로 교체).
- **확인 방법**: `pnpm install && pnpm dev`로 브라우저 프리뷰가 뜨는지 확인. `pnpm typecheck`(스크립트는 P0-04에서 추가) 통과.

## P0-02. Tauri 2 통합

- **소유 파일**: `src-tauri/**` 전체(신규 생성), `package.json`의 `scripts`/`devDependencies` 중 Tauri 관련 항목(P0-01과 겹치는 `package.json`은 이 항목이 `scripts.tauri`, `@tauri-apps/cli`, `@tauri-apps/api` 의존성 추가만 담당 — 다른 필드는 P0-01 소유).
- **작업 내용**:
  1. `pnpm add -D @tauri-apps/cli@^2` , `pnpm add @tauri-apps/api@^2`.
  2. `pnpm tauri init`으로 `src-tauri/` 골격 생성. 앱 식별자는 `com.fortress.app` (가제, 필요시 조정), 제품명 `Fortress`.
  3. `src-tauri/tauri.conf.json`의 `app.security.csp`에 Ollama 로컬 API 호출을 위해 `connect-src`에 `http://127.0.0.1:11434`와 `http://localhost:11434`를 허용 목록에 추가한다 (`Docs/Architecture.md` §5.5).
  4. `src-tauri/capabilities/default.json`에 파일시스템 스코프 등 최소 권한만 우선 등록(세부 스코프는 Phase 1의 `fs_commands.rs` 작업에서 조정).
  5. `src-tauri/src/main.rs` / `lib.rs`는 기본 템플릿 그대로 두되, `src-tauri/src/commands/` 빈 폴더(placeholder `mod.rs`)만 만들어 Phase 1이 바로 채울 수 있게 한다.
- **확인 방법**: `pnpm tauri dev`로 네이티브 창이 뜨는지 확인.

## P0-03. Tailwind CSS + shadcn/ui("new-york") 설정

- **소유 파일**: `tailwind.config.ts`, `postcss.config.mjs`, `components.json`, `src/index.css`(P0-01이 만든 임시 내용을 이 작업이 최종 테마 CSS 변수로 교체), `src/lib/utils.ts`(`cn()` 헬퍼)
- **작업 내용**:
  1. Tailwind CSS 3.4 설치 및 초기화.
  2. `pnpm dlx shadcn@latest init` (style: `new-york`, base color 임의, CSS 변수 사용)으로 `components.json` 생성.
  3. `src/index.css`에 다크 우선 CSS 변수 테마를 정의한다 (`Docs/Architecture.md` §1.1의 "다크 우선 테마" 항목 — VivoStudio의 `:root`가 dark 기본, `.light` 클래스로 override하는 패턴을 재구현. **VivoStudio 코드를 복사하지 말고 동일한 CSS 변수 이름 체계(`--background`, `--foreground`, `--primary`, `--sidebar` 등 shadcn 표준 토큰)로 새로 작성**).
  4. `tailwindcss-animate` 플러그인 추가.
  5. 최초 shadcn 컴포넌트 3종만 미리 추가: `button`, `separator`, `tooltip` (나머지는 각 Phase에서 필요할 때 그때그때 `shadcn add`로 추가 — 미리 다 추가하지 않는다, YAGNI).
- **확인 방법**: `<Button>` 컴포넌트를 `App.tsx`에 임시로 렌더링해 Tailwind 스타일이 적용되는지 시각 확인 후 원복(또는 Phase1이 대체).

## P0-04. Lint/Format/스크립트 정비

- **소유 파일**: `.eslintrc.cjs`(또는 `eslint.config.js`, Vite 템플릿이 생성하는 형식에 맞춤), `.prettierrc`, `package.json`의 `scripts` 필드 중 `lint`/`format`/`typecheck`/`test` 키만(다른 키는 다른 작업 소유이므로 병합 시 주의)
- **작업 내용**:
  1. `package.json`에 다음 스크립트를 추가한다:
     ```json
     {
       "scripts": {
         "dev": "vite",
         "build": "tsc -b && vite build",
         "preview": "vite preview",
         "tauri": "tauri",
         "typecheck": "tsc --noEmit",
         "lint": "eslint . --max-warnings=0",
         "format": "prettier --write .",
         "test": "vitest run"
       }
     }
     ```
  2. ESLint: `@typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` 구성. `no-explicit-any`는 경고가 아니라 **에러**로 설정 (`AGENTS.md`의 "no any" 규칙과 일치시킴).
  3. Prettier 기본 설정(세미콜론 사용, 2-space indent, singleQuote 등은 팀 취향이나 기존 습관 없으니 Prettier 기본값 유지).
  4. Vitest 설치(`pnpm add -D vitest @testing-library/react @testing-library/jest-dom jsdom`) 및 `vite.config.ts`에 `test` 필드 추가(주의: `vite.config.ts`는 P0-01 소유 파일이므로, 이 작업에서는 `test` 필드만 추가하는 작은 diff로 제한하고 다른 필드를 건드리지 않는다).
- **확인 방법**: `pnpm lint`, `pnpm typecheck`, `pnpm test`(테스트 0개라도 정상 종료) 모두 성공.

## P0-05. 기본 폴더 구조 생성

- **소유 파일**: `src/lib/context/.gitkeep`, `src/lib/agent/.gitkeep`, `src/lib/llm/.gitkeep`, `src/lib/prompt/.gitkeep`, `src/lib/tools/.gitkeep`, `src/lib/skills/.gitkeep`, `src/lib/compaction/.gitkeep`, `src/lib/approval/.gitkeep`, `src/lib/db/.gitkeep`, `src/lib/markdown/.gitkeep`, `src/lib/types/.gitkeep`, `src/lib/utils/.gitkeep`(이미 P0-03에서 `utils.ts`가 생겼다면 `.gitkeep` 생략), `src/components/layout/.gitkeep`, `src/components/sidepanel/.gitkeep`, `src/components/explorer/.gitkeep`, `src/components/chatsessions/.gitkeep`, `src/components/agents/.gitkeep`, `src/components/skills/.gitkeep`, `src/components/workspace/.gitkeep`, `src/components/chat/.gitkeep`, `src/pages/Settings/.gitkeep`, `src/hooks/.gitkeep`
- **작업 내용**: `Docs/Architecture.md` §2의 최종 디렉터리 트리에 나오는 폴더 중 아직 존재하지 않는 것을 빈 `.gitkeep`으로 미리 만들어 둔다 (git은 빈 폴더를 추적하지 않으므로). 실제 코드 파일은 각 폴더를 채우는 Phase가 추가하면서 `.gitkeep`을 지운다.
- **확인 방법**: `git status`에 새 폴더들이 보이는지 확인.

## P0-06. `.gitignore` / README / GitHub 원격 연동 / 초기 커밋

- **소유 파일**: `.gitignore`, `README.md`
- **작업 내용**:
  1. `.gitignore`에 최소한 다음을 포함: `node_modules/`, `dist/`, `src-tauri/target/`, `src-tauri/gen/`, `.DS_Store`, `*.local`, `.env`, `db.sqlite*`(로컬 개발용 SQLite 파일은 커밋하지 않음).
  2. `README.md`에 프로젝트 한 줄 소개, 개발 환경 요구사항(Node/pnpm/Rust/Ollama 버전), 시작 명령(`pnpm install`, `pnpm tauri dev`)을 작성한다. 상세 기획은 `Docs/ImplementationPlan.md`로 링크.
  3. `git remote`는 이미 `origin = https://github.com/godstale/FortressAgent.git`로 설정되어 있음(리포지토리 초기화 시 완료). 이 작업에서는 **push하지 않고 로컬 커밋까지만** 수행한다. push는 사용자 승인 후 진행한다(원격 저장소에 반영되는 작업이므로).
  4. Phase 0의 모든 작업(P0-01~P0-07)이 끝난 뒤, 전체를 하나의 초기 커밋(`chore: bootstrap project scaffolding`)으로 묶는다.
- **확인 방법**: `git log --oneline`에 초기 커밋이 보이는지 확인. `git push`는 사용자에게 확인 후 별도로 실행.

## P0-07. Ollama 연결 스모크 테스트 (수동 확인 스크립트)

- **소유 파일**: `scripts/check-ollama.mjs` (신규, Node 스크립트)
- **작업 내용**: 로컬에서 `http://127.0.0.1:11434/api/tags`를 호출해 Ollama 서버가 떠 있는지, 설치된 모델 목록이 무엇인지 콘솔에 출력하는 간단한 Node 스크립트를 작성한다. `package.json`에 `"check:ollama": "node scripts/check-ollama.mjs"` 스크립트 추가(이 필드 추가만 담당, P0-04의 다른 스크립트는 건드리지 않음).
- **확인 방법**: `pnpm check:ollama` 실행 시 Ollama가 켜져 있으면 모델 목록이, 꺼져 있으면 친절한 에러 메시지가 출력되는지 확인. (이 스크립트는 Phase 2 개발자의 로컬 확인용 도구이며, 앱 자체 기능은 아님.)

## P0-08. 에이전트 루프 스파이크 (버리는 코드)

- **소유 파일**: `scripts/spike-agent-loop.mjs`(신규), `Docs/spikes/ollama-tool-calling.md`(신규)
- **배경**: Phase 2~5 전체가 **로컬 모델의 tool-calling이 실제로 동작한다**는 전제 위에 서 있습니다. 이 전제는 모델마다 편차가 크므로, UI를 다 만든 뒤 Phase 2에서 확인하면 너무 늦습니다. Phase 0에서 20~30분짜리 스파이크로 먼저 확인합니다.
- **작업 내용**: React/Tauri 없이 Node 스크립트만으로 최소 루프를 구현합니다.
  1. `POST /api/chat`에 `tools`로 도구 2개(`list_files`, `read_file`)를 선언하고 `stream: true`로 호출.
  2. `tool_calls`가 오면 실제로 실행하고 결과를 `{role:"tool"}`로 되돌려 보낸 뒤 다시 호출 — **최소 3턴**을 반복.
  3. 각 응답의 `prompt_eval_count`/`eval_count`를 출력해 usage 실측이 실제로 오는지 확인.
  4. 후보 모델 3개 이상(예: `qwen2.5-coder:7b`, `llama3.1:8b`, `mistral-nemo`)에 대해 반복하고 결과를 표로 기록.
- **기록할 것** (`Docs/spikes/ollama-tool-calling.md`):
  | 모델 | 단일 도구 호출 | 멀티턴(3턴) | 병렬 호출 | usage 보고 | 비고 |
  - 실패하는 모델은 **무엇이 어떻게 실패하는지**(도구를 아예 안 부름 / 인자 JSON이 깨짐 / 2턴째부터 루프에 빠짐)를 적을 것.
- **스파이크 실패 시**: `Docs/TODO.md` 이슈에 기록하고, Phase 2 진입 전에 폴백 전략을 결정합니다 — ① 지원 모델 화이트리스트만 노출, ② 한 번에 도구 1개만 바인딩, ③ tool-calling 대신 텍스트 프로토콜(모델이 정해진 형식으로 출력 → 파서가 도구 호출로 변환).
- **확인 방법**: 문서에 최소 3개 모델의 결과가 표로 기록되어 있고, Phase 2에서 기본값으로 쓸 모델이 하나 정해져 있을 것. **스크립트는 스파이크용이므로 lint/test 대상에서 제외하고, Phase 2 완료 후 삭제해도 무방합니다**(문서는 남깁니다).

---

## Phase 0 완료 조건

- [ ] `pnpm tauri dev`로 빈 네이티브 창이 정상적으로 뜬다.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`가 모두 에러 없이 통과한다.
- [ ] `Docs/Architecture.md` §2의 폴더 구조가 (내용은 비어 있더라도) 전부 존재한다.
- [ ] `Docs/spikes/ollama-tool-calling.md`에 최소 3개 모델의 tool-calling 검증 결과가 기록되어 있고, Phase 2 기본 모델이 정해져 있다.
- [ ] git 초기 커밋이 완료되어 있다.
- [ ] `Docs/TODO.md`의 Phase 0 항목이 모두 `[x]`다.
