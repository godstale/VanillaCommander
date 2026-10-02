# Phase 11 — Vanilla Commander 전환

**목표**: "로컬 LLM 테스트·검증 워크벤치(Fortress)"를 **파일 커맨더 + 챗 제어 에이전트 + 로컬 LLM 자동화(위키·매크로)** 앱인 **Vanilla Commander**로 전환한다. 기존 에이전트 런타임(루프·도구·압축·스킬·세션·승인)은 그대로 재사용하고, 평가·모니터링 중심 UI를 걷어낸 자리에 파일 탐색기·위키·매크로·상태바·셋업 위저드를 얹는다.

**선행 조건**: Phase 0~10 완료(현재 `[x]`), Vanilla 디자인 브랜치(`feat/vanilla-design`) main 병합.

**필독 문서**
1. `Docs/Architecture.md` — 특히 §2 디렉터리, §4.2 Agent, §4.5 저장소, §5.6 훅, §7·§8 안전 경계, §14.5 외부 연동
2. `AGENTS.md` — 코딩 규칙(`any` 금지, i18n, 소유 파일, pnpm, 신규 의존성 사유 기록)
3. 이 문서 §1의 결정 사항 — **D-항목 중 "확인 필요"가 남아 있으면 해당 작업을 시작하지 않는다**

---

## 1. 설계 결정

### 1.1 확정 (요구사항에서 직접 도출)

| ID | 결정 | 구현 영향 |
| --- | --- | --- |
| V1 | 사이드바 메뉴: 파일 탐색기 · 채팅 · 에이전트 · 위키 · 매크로 · (최하단) 설정 | `SidePanelView`에서 `monitoring`·`evaluation` 제거, `wiki`·`macros` 추가 |
| V2 | **평가·모니터링 메뉴 삭제.** 평가의 외부 LLM API/외부 에이전트 등록 기능만 에이전트 편집으로 이관 | `src/lib/eval/integrations` → `src/lib/integrations`로 이동 후 나머지 평가 코드 삭제 |
| V3 | 모니터링 화면(`AgentMonitorTab`)은 유지, 진입점은 상단 좌측 에이전트 아이콘 하나 | 모니터링 사이드 패널·통계 탭(`AgentStatsTab`)·로그 메뉴 삭제 |
| V4 | 설정에서 "모델 및 LLM"·"도구 승인 정책" 삭제 → **앱 기본값 상수 + 에이전트별 설정**만 사용 | `SettingsModel`·`SettingsApproval` 삭제, 기본값은 `src/lib/agent/defaults.ts`로 일원화 |
| V5 | 설정 "외부 연동" → **문서 파싱 연동**(PDF/DOC/Excel 등 외부 파서) 화면으로 교체, "업데이트" 메뉴 추가(미구현 placeholder) | 아래 P11-34, P11-50 |
| V6 | 새 에이전트 기본값: 내장 도구 = 쉘 제외 전체, 스킬 = `basic-llm-wiki`, 승인 = `dangerous-only` | `defaults.ts` |
| V7 | 시작 시 저장된 탭 복원, 탭이 없으면 **파일 탐색기 탭** 1개 오픈(기존: 채팅 탭) | `Workspace.tsx` |
| V8 | 셋업 위저드는 최초 1회 자동 실행 + 설정에서 재실행(기존 값 프리필) | `settings.setupCompletedAt` |

### 1.2 제안 (구현 전 사용자 확인 필요)

| ID | 쟁점 | 제안 | 이유 |
| --- | --- | --- | --- |
| **D1** | 파일 접근 범위. 현재는 "워크스페이스 루트" 밖 접근을 Rust에서 거부(§7 Layer 1). 파일 커맨더는 PC 전체를 다뤄야 함 | **사용자 조작과 에이전트 조작을 분리.** ① 사용자가 UI로 하는 파일 작업은 OS 권한 내 전체 허용(시스템 폴더는 경고). ② 에이전트 도구는 "허용 루트" 안에서만 동작: 작업 폴더 + 현재 탐색기 탭 경로 + `@`로 참조한 경로 + 사용자가 등록한 허용 폴더. ③ 에이전트의 쓰기/이동/삭제는 `dangerous`로 분류해 승인 필요(작업 폴더 내부는 예외 가능) | 보안 원칙(AGENTS.md §7)을 유지하면서 커맨더 기능 확보. Rust 스코프 검사 함수에 "허용 루트 목록"을 넘기는 형태로 변경 |
| **D2** | "워크스페이스(프로젝트 폴더)" 개념 | **폐지하고 작업 폴더(Work Folder)로 대체.** 세션·탭·매크로는 전역 DB, 위키·백업·설정 파일은 작업 폴더에 저장. 기존 "폴더 열기 전 메뉴 비활성화" 로직 제거 | 커맨더는 특정 프로젝트에 묶이지 않음. 현재 `.fortress/` 프로젝트 DB 분리(§4.5)는 의미가 사라짐 |
| **D3** | 외부 에이전트(Claude Code·Codex CLI 등) 연동 방식 | 매 턴 대화를 프롬프트로 만들어 CLI에 1회 실행(현 `integration_run_cli` 재사용), **cwd = 현재 탐색기 폴더**(현재는 임시 폴더). 도구 호출은 외부 에이전트가 자체 수행하므로 우리 승인 훅을 거치지 않음 → 연결 시마다 "데이터 외부 노출 + 외부 에이전트가 파일을 직접 수정할 수 있음" 동의 | 외부 에이전트의 가치는 자체 도구 실행에 있음. 대신 동의 문구를 강화 |
| **D4** | 탐색기 하단 1줄 채팅 결과 표시 위치 | 탐색기 탭 안에 **접이식 결과 드로어**(최근 대화 몇 턴)를 두고, "채팅 탭에서 열기"로 전체 세션 확인. 탭마다 숨은 채팅 세션 1개를 연결 | 탐색 흐름을 끊지 않으면서 결과 확인 가능 |
| **D5** | 위키 자동 처리 시 사용할 에이전트 | 위키 설정에 "처리 에이전트" 항목(기본 = 기본 에이전트). 이미지는 vision 가능 에이전트가 없으면 건너뛰고 "대기" 목록에 둠 | 위키는 백그라운드 작업이라 채팅 에이전트와 분리하는 편이 예측 가능 |
| **D6** | 파일 이동 후 분류 체계(참고: newneek "일잘러의 폴더 정리") | 3가지 규칙을 프리셋으로 제공: **날짜순** `YYYY/MM-DD/`(단발성 자료, 기본값) · **순번** `NN-<주제>/`(연속 프로젝트, 0 패딩) · **빈도순** `일일/주간/월간/분기/반기/연간/상시`. 기본 프롬프트는 "LLM이 파일 내용을 보고 세 규칙 중 하나와 폴더명을 결정"하고, 사용자는 프롬프트를 수정 가능 | 글의 통합 규칙("간단한 자료는 날짜순, 연속성은 순번, 대분류는 빈도순")을 LLM 판단 기준으로 그대로 사용 |
| **D7** | 매크로 자동 실행 | 앱이 실행 중일 때만 동작하는 인앱 스케줄러(간격/매일/매주). 앱 종료 중 놓친 실행은 "다음 실행 시 1회 보충" 옵션. OS 작업 스케줄러 등록은 하지 않음 | 구현·권한 단순. 백그라운드 상주(트레이)는 후속 과제 |
| **D8** | PPT 뷰어 | 내장 뷰어는 **슬라이드별 텍스트·이미지 목록(아웃라인)**만 제공, 원본 보기는 "시스템 기본 앱으로 열기" 버튼 | 브라우저에서 PPTX를 충실히 렌더링하는 신뢰할 만한 라이브러리가 없음 |
| **D9** | 셋업 위저드 "마지막 항목까지 수정하면 에이전트 설정" 해석 | 위저드 완료 시 **기본 에이전트 편집 탭을 자동으로 연다**(Ollama 감지 결과로 모델 프리필) | 요구사항 문구를 이렇게 해석함 — 다르면 정정 필요 |
| **D10** | 삭제 동작 | 사용자 삭제 = OS 휴지통(`trash`), Shift+Del = 영구 삭제(확인). 에이전트가 수정/삭제/이동하는 파일은 실행 직전 **작업 폴더 `backup/`에 스냅샷** | 셋업에서 언급한 "파일 백업" 용도. 에이전트 실수 복구 경로 확보 |

### 1.3 작업 폴더 레이아웃 (D2 확정 시)

```
<WorkFolder>/
  wiki/            # basic-llm-wiki 레이아웃 그대로 (index.md, log.md, sources/)
  wiki-inbox/      # 위키 처리 후 이동된 원본 파일 (D6 분류 규칙 적용)
  backup/          # 에이전트 변경 전 스냅샷 (YYYY-MM-DD/<원래 경로 해시>/파일)
  config/          # 사용자 편집 가능한 설정(위키 프롬프트, 파서 설정 export 등)
  skills/          # 사용자 스킬 (.agents/skills 대체 위치, 신뢰 확인 유지)
```

---

## 2. 화면 구조 (변경 전 → 후)

| 영역 | 현재 | 변경 후 |
| --- | --- | --- |
| ActivityBar | 탐색기·채팅·에이전트·모니터링·평가 / 설정 | 탐색기·채팅·에이전트·위키·매크로 / 설정 |
| 탐색기 패널 | 프로젝트 폴더 트리(`FileTree`) | [+ 새 탐색기] · 열린 탐색기 탭 목록 · 즐겨찾기 · 시스템 폴더(홈/바탕화면/문서/다운로드/사진/드라이브) |
| 채팅 패널 | 세션 목록 | 동일 |
| 에이전트 패널 | 카드(모델·ctx·temp·도구·스킬 / 대화·수정·모니터링·통계·로그) | 카드(**모델명·ctx**만 / **대화 시작·수정**만) |
| 위키 패널 | (없음) | 감시 상태·처리 대기열·최근 처리·위키 페이지 목록, [위키 설정] |
| 매크로 패널 | (없음, 채팅 내 다이얼로그 + localStorage) | 매크로 목록 + 스케줄 표시, [새 매크로] |
| 탭 종류 | chat, editor, image-viewer, agent-editor, agent-stats, agent-monitor, skill-viewer, eval | **file-explorer**, chat, editor, image-viewer, **document-viewer**, **archive-viewer**, agent-editor, agent-monitor, skill-viewer, **wiki**, **macro-editor** |
| 하단 | (없음) | **StatusBar** |
| 설정 | 일반·모델·승인·외부 연동 | 일반(언어·테마·작업 폴더·위저드 재실행) · 문서 파싱 연동 · 업데이트 |

### 2.1 StatusBar 슬롯

왼쪽부터: 에이전트 상태(기본 에이전트명·연결 상태·실행 중 턴) · 백그라운드 작업(복사/이동/압축 진행률, 위키 처리 n건, 예약 매크로) · 위키 감시(on/off·감시 폴더 수) · 현재 탭 정보(탐색기: 선택 n개/총 크기·경로, 에디터: 줄/열·인코딩) · 앱 클립보드(복사/잘라내기 대기 n개) · 일시 메시지(토스트 대체, 5초).
구현은 `StatusBarContext`의 `publish(slot, item)`/`clear(slot)` API — 각 기능이 자기 슬롯만 갱신한다(공유 파일 충돌 방지).

---

## 3. 공통 규칙 (모든 P11 작업)

### 3.1 공유 파일 규칙

| 파일 | 누가 | 무엇만 |
| --- | --- | --- |
| `src/lib/types/workspaceTab.ts` | P11-01 | 탭 타입·사이드 패널 뷰 유니온 **일괄 확정**(이후 수정 금지) |
| `src/components/sidepanel/SidePanel.tsx` | P11-01 | 패널 스위치 일괄 확정(아직 없는 패널은 placeholder import) |
| `src/components/workspace/CenterWorkspace.tsx` | P11-01, 이후 각 탭 소유 작업 | 탭 렌더 `case` 한 줄씩 |
| `src-tauri/src/lib.rs`·`commands/mod.rs` | Rust 커맨드 추가 작업 | `invoke_handler` 항목·`pub mod` 한 줄 |
| `src/lib/i18n/dictionaries/{ko,en}.ts` | P11-01 | 영역별 사전 스프레드 줄(`explorer`·`wiki`·`macros`·`setup`·`statusBar`·`parsers`)만 추가. 영역 사전 파일은 해당 작업이 소유 |
| `src/lib/db/migrations/` | P11-04(설정), P11-40(매크로), P11-31(위키) | 새 파일만 추가(기존 마이그레이션 수정 금지) |
| `src/lib/agent/bootstrap.ts` | P11-24 | 파일 커맨더 도구 등록 import 한 줄 |
| `Docs/TODO.md` | 전원 | 자기 작업 행·이슈 로그 |

### 3.2 신규 의존성 (승인 후 TODO 이슈 로그에 사유 기록)

| 패키지 | 위치 | 용도 | 비고 |
| --- | --- | --- | --- |
| `notify` + `notify-debouncer-full` | Rust | 위키 폴더 감시 | 표준 크로스플랫폼 감시 |
| `trash` | Rust | 휴지통 삭제 | D10 |
| `zip` | Rust | 압축/해제/목록, PPTX·DOCX XML 추출 | 7z/rar는 외부 도구가 있을 때만(후속) |
| `tauri-plugin-opener` | Rust+JS | 시스템 기본 앱/브라우저로 열기, 탐색기에서 보기 | 기존 `open_in_browser`·`reveal_in_explorer` 대체 |
| `tauri-plugin-clipboard-manager` | Rust+JS | 텍스트 클립보드(경로 복사) | 파일 클립보드는 앱 내부 상태로 처리 |
| `pdfjs-dist` | JS | PDF 뷰어 + 텍스트 추출 | 워커 번들 설정 필요 |
| `mammoth` | JS | DOCX → HTML(뷰어) / 텍스트(위키) | |
| `xlsx`(SheetJS, cdn.sheetjs.com tarball) | JS | XLSX/CSV 뷰어 + 텍스트 추출 | npm 레지스트리 버전은 구버전이라 공식 tarball 사용 |

`@tanstack/react-virtual` 등 가상 스크롤은 대용량 폴더 성능 문제가 실측될 때만 추가한다(YAGNI).

### 3.3 완료 기준

`pnpm lint`·`typecheck`·`test` 통과 + `pnpm tauri dev` 수동 확인 + ko/en 사전 키 동시 추가 + `Docs/TODO.md` 갱신.

### 3.4 웨이브(착수 순서)

```
W0 정리·기반 : 01 → 02 → 03 → (04, 05, 06 병렬)
W1 탐색기    : 10 → (11, 12, 13, 14 병렬) → 15 → 16
W2 에이전트  : 20, 21, 27 병렬 / 22 → 23 / 24(10 이후) / 25 / 26
W3 위키      : 30, 33 병렬 → 31 → 32 → 34
W4 매크로    : 40 → 41
W5 마무리    : 50 → 51 → 52
```
W1·W2·W3·W4는 W0 완료 후 서로 병렬 가능(소유 파일이 겹치지 않음). 단 P11-16(`@` 멘션)은 W1·W2 양쪽이 쓰므로 먼저 끝내는 쪽이 공용 컴포넌트를 만든다.

---

## 4. 작업 목록

### W0 — 정리·기반

#### P11-01. 정보 구조 재편 (ActivityBar·패널·탭 타입)
- `workspaceTab.ts`: 탭/패널 유니온을 §2 표대로 확정. `EvalTabView` 삭제.
- `ActivityBar.tsx`: 메뉴 5개 + 설정. "폴더 없으면 비활성화" 로직 제거(D2).
- `SidePanel.tsx`: `wiki`·`macros` 패널 placeholder 연결, `monitoring`·`evaluation` 제거.
- `TopMenuBar.tsx`: 평가·모니터링 메뉴 제거, 좌측 에이전트 아이콘 → `AgentMonitorTab` 직접 오픈(V3).
- i18n 영역 사전 골격 파일 생성(빈 객체) + `ko.ts`/`en.ts` 스프레드.
- **소유**: 위 파일 + `src/lib/i18n/dictionaries/{explorer,wiki,macros,setup,statusBar,parsers}.{ko,en}.ts`(골격만)
- **확인**: 메뉴 5개 노출, 기존 탭 복원 시 삭제된 탭 타입(`eval`·`agent-stats`)은 조용히 버려짐.

#### P11-02. 외부 연동 모듈 이관
- `src/lib/eval/integrations/{gateway,cliRunner,consent,endpointClass}.ts` → `src/lib/integrations/`. 필요한 타입·zod 스키마(`ExternalIntegration`, `IntegrationSettings`, `DataClass`, `IntegrationPurpose`)와 `CONSENT_TEXT_VERSION`을 `src/lib/integrations/types.ts`로 분리.
- `IntegrationPurpose`에 `'chat-agent'`·`'wiki-ingest'`·`'doc-parse'` 추가, 평가 전용 목적 제거. 동의 문구를 "채팅·파일 내용이 외부로 전송될 수 있음"으로 개정 → **동의 버전 올림(기존 동의 무효화)**.
- `ConsentDialog`·`IntegrationEditorDialog`·`AuditLogTable` → `src/components/integrations/`.
- Rust `integration_run_cli`에 선택 인자 `cwd`(D3) 추가 — 허용 루트 검사 후 사용.
- **소유**: `src/lib/integrations/**`, `src/components/integrations/**`, `src-tauri/src/commands/integration_commands.rs`, `integrationsRepo.ts`(import 경로만)
- **테스트**: 기존 gateway/cliRunner/consent 테스트 이동 후 통과.

#### P11-03. 평가 기능 제거
- 삭제: `src/components/eval/**`, `src/lib/eval/**`(이관분 제외), `EvalTab`, `EvalContext`, `evalRepo`, `src/lib/i18n/dictionaries/eval/**`, `eval_commands.rs`, `resources/evals`(번들 설정 포함), `evalLock`에 의한 채팅 차단 코드.
- DB: 평가 테이블은 **신규 마이그레이션으로 DROP**(append-only 정책상 기존 파일은 수정하지 않음). `external_integrations`·`integration_settings`·감사 로그 테이블은 유지.
- `Docs/EvaluationGuide.md`·`Phase10-*` 문서는 "폐기됨(Vanilla 전환)" 헤더만 추가하고 보존.
- **확인**: `pnpm build` 번들 크기 감소, 채팅 정상 동작, 남은 `eval` import 0건(`grep`).

#### P11-04. 앱 설정 모델 + 작업 폴더
- `settingsRepo`/`SettingsContext`에 `setupCompletedAt`, `workFolder`, `favorites[]`, `agentAllowedRoots[]`, `wiki`·`parsers` 설정 블록 추가(zod).
- `WorkspaceContext`를 **WorkFolder 컨텍스트**로 축소(D2): `workFolder`, `ensureWorkFolderLayout()`(§1.3 하위 폴더 생성), 신뢰 확인은 `skills/` 로드에만 적용.
- 앱 기본값 상수 `src/lib/agent/defaults.ts`(V4·V6): 승인 모드, 도구 목록, 스킬, 압축 예산, temperature 등. 기존 `SettingsModel`/`SettingsApproval`이 쓰던 전역값 참조를 이 상수로 교체.
- Rust 스코프 검사: `set_active_workspace` → `set_agent_allowed_roots(Vec<String>)`. 사용자 UI용 파일 커맨드는 스코프 검사 없이 canonicalize만(D1).
- **소유**: `settingsRepo.ts`, `SettingsContext.tsx`, `WorkspaceContext.tsx`, `src/lib/agent/defaults.ts`, `fs_commands.rs`(스코프 부분), 새 마이그레이션 1개

#### P11-05. StatusBar
- `src/lib/context/StatusBarContext.tsx`(slot 기반 publish/clear), `src/components/layout/StatusBar.tsx`, `Workspace.tsx` 하단 배치.
- 기본 퍼블리셔: 에이전트 상태(`agentStatus.ts` 재사용), 일시 메시지. 나머지 슬롯은 각 기능 작업이 퍼블리시.
- **소유**: 위 2개 파일 + `statusBar` 사전

#### P11-06. 셋업 위저드
- `src/components/setup/SetupWizard.tsx` + 단계 컴포넌트: ①언어(기존 `LanguageSelectDialog` 흡수) ②작업 폴더(선택+레이아웃 생성) ③에이전트 안내(Ollama 감지·모델 목록·기본 에이전트 생성/갱신, 외부 API/에이전트는 나중에 가능 안내) ④위키 안내(다운로드 폴더 감시 on/off, 이동 여부) ⑤매크로 안내(설명만) ⑥완료 → 기본 에이전트 편집 탭 오픈(D9).
- 재실행 모드: 현재 설정 프리필, 각 단계 "변경 없음으로 다음" 가능. 진입점: 설정 > 일반.
- 최초 실행 판정: `setupCompletedAt == null`. 기존 사용자(Fortress DB 존재)는 위저드를 띄우되 값 프리필.
- **소유**: `src/components/setup/**`, `setup` 사전, `App.tsx`(위저드 게이트 1곳)

### W1 — 파일 탐색기

#### P11-10. Rust 파일 커맨더 커맨드
신규 `src-tauri/src/commands/commander_commands.rs`:
- `fc_list_dir(path, showHidden)` → 이름·종류·크기·수정일·숨김/읽기전용·심링크 여부
- `fc_system_folders()` → 홈/바탕화면/문서/다운로드/사진/음악/동영상 + 드라이브 목록(Windows A–Z 검사)
- `fc_stat(paths)` → 정보 대화상자용(폴더는 재귀 크기·파일 수, 취소 가능)
- `fc_copy`/`fc_move(sources, destDir, conflict)` → **job id 반환 + `fc://progress` 이벤트**(바이트·파일 수), `fc_cancel(jobId)`; 충돌 정책 `ask|overwrite|skip|rename`(ask면 이벤트로 질의)
- `fc_trash(paths)` / `fc_delete_permanent(paths)` / `fc_rename` / `fc_mkdir` / `fc_create_file`
- `fc_search(root, namePattern, contentQuery?, maxResults)` → 스트리밍 이벤트(기존 `search_commands`의 ignore 워커 재사용, `.gitignore` 무시 옵션)
- `fc_zip(sources, dest)` / `fc_unzip(archive, destDir)` / `fc_archive_list(archive)` (job 기반)
- `fc_open_default(path)`(opener) / `fc_reveal(path)`
- 모든 경로 canonicalize, 시스템 폴더(Windows, Program Files 등) 쓰기 시 `warning` 플래그 반환.
- **소유**: `commander_commands.rs`, `Cargo.toml`(의존성 줄), `capabilities/*.json`(opener·clipboard 권한)
- **테스트**: Rust 단위 테스트(임시 디렉터리에서 copy/move 충돌·zip 왕복·cancel).

#### P11-11. FileExplorerTab
- `src/components/explorer/FileExplorerTab.tsx` + `AddressBar`(브레드크럼/직접 입력) · `FileList`(상세 보기: 이름·크기·종류·수정일, 정렬, 다중 선택, 키보드 탐색) · `ExplorerToolbar`(뒤로/앞으로/위로/새로고침/새 폴더/보기 옵션/숨김 파일).
- 단축키(Commander 관례 + Windows 관례): Enter 열기, Backspace 상위, F2 이름 바꾸기, F5 복사(반대 창으로), F6 이동, F7 새 폴더, Del 휴지통, Shift+Del 영구 삭제, Ctrl+C/X/V, Ctrl+F 찾기, Alt+Enter 정보.
- 컨텍스트 메뉴: 열기/연결 프로그램으로 열기/복사/잘라내기/붙여넣기/이름 바꾸기/삭제/압축/압축 풀기/경로 복사/즐겨찾기 추가/정보/**에이전트에게 묻기**(선택 파일을 `@` 참조로 하단 입력창에 삽입).
- 분할 보기: 기존 `CenterWorkspace`의 primary/secondary 분할을 그대로 사용. F5/F6의 "반대 창" = 다른 pane의 활성 탐색기 탭.
- 탭 메타(`meta.path`, `meta.history`, `meta.sort`)를 탭 영속화에 저장.
- StatusBar "현재 탭" 슬롯 퍼블리시.
- **소유**: `src/components/explorer/**`(FileTree 제외), `explorer` 사전 일부, `CenterWorkspace.tsx` case 1줄

#### P11-12. 탐색기 사이드 패널
- `ExplorerPanel.tsx`: 상단 [+] 버튼(새 탐색기 탭, 마지막 경로 또는 홈) · 열린 탐색기 탭 목록(클릭 시 활성화, 닫기) · 즐겨찾기(추가/삭제/순서, 드래그로 폴더 등록) · 시스템 폴더·드라이브.
- 사이드바 "파일 탐색기" 클릭 시 열린 탐색기 탭이 없으면 1개 생성(요구사항).
- 기존 `FileTree.tsx`는 삭제(프로젝트 트리 개념 폐지, D2).
- **소유**: `src/components/explorer/ExplorerPanel.tsx`, `FileTree.tsx` 삭제

#### P11-13. 파일 작업 큐·충돌 처리
- `src/lib/commander/jobs.ts` + `JobsContext`: Rust job 이벤트 구독, 진행률·취소·완료 알림, StatusBar "백그라운드 작업" 슬롯.
- `ConflictDialog`(덮어쓰기/건너뛰기/이름 변경 + "모두 적용"), `PropertiesDialog`, `SearchResultsView`(탐색기 탭 내부 모드).
- 앱 내부 파일 클립보드(복사/잘라내기 목록) → StatusBar 클립보드 슬롯.
- **소유**: `src/lib/commander/**`, `src/components/explorer/dialogs/**`

#### P11-14. 파일 뷰어
- `src/lib/commander/openFile.ts`: 확장자 → 열기 방식 라우팅
  - 텍스트/코드/MD/JSON/CSV → 기존 `EditorTab`(MD는 미리보기 토글 추가)
  - 이미지 → 기존 `ImageViewerTab`
  - PDF(`pdfjs-dist`) · DOCX(`mammoth` HTML) · XLSX/XLS/CSV 표(SheetJS, 시트 탭) · PPTX(D8 아웃라인) → 새 `DocumentViewerTab`
  - ZIP → `ArchiveViewerTab`(목록·선택 해제)
  - HTML → 외부 기본 브라우저, 동영상/음악/실행파일/기타 → 시스템 기본 앱
  - 대용량(예: 텍스트 5MB 초과) → 읽기 전용 + 앞부분만
- 모든 뷰어 상단에 "시스템 기본 앱으로 열기" 버튼.
- **소유**: `openFile.ts`, `src/components/viewers/**`, `CenterWorkspace.tsx` case 2줄

#### P11-15. 탐색기 1줄 채팅 입력
- 탐색기 탭 하단 `ExplorerChatBar`(1줄, Enter 전송, Shift+Enter 없음) + 접이식 결과 드로어(D4).
- 전송 시 컨텍스트 자동 첨부: 현재 경로·선택 항목 목록(이름만, 내용은 `@` 참조 시에만). 탭마다 숨은 채팅 세션(`session.origin = 'explorer'`)을 만들어 `useChat` 재사용.
- 에이전트가 파일을 바꾸면 해당 탐색기 목록 자동 새로고침(도구 결과 이벤트 구독).
- **소유**: `src/components/explorer/ExplorerChatBar.tsx`, `ChatSessionsContext`(origin 필드 1개)

#### P11-16. `@` 파일/폴더 참조 (공용)
- `src/components/chat/MentionInput.tsx`(또는 `ChatInput` 확장): `@` 입력 시 팝업 — 현재 폴더 기준 퍼지 검색(`fc_search` 이름 모드), 최근/즐겨찾기 우선, 방향키 선택.
- 전송 시 해석(`src/lib/chat/mentions.ts`): 파일 → 크기 상한(예: 32KB) 내 본문 인라인, 초과 시 경로만 + "read 도구로 읽으라" 안내 / 폴더 → 1단계 목록 / 이미지 → 이미지 첨부(P11-26)로 전환. 참조 경로는 에이전트 허용 루트에 세션 한정으로 추가(D1).
- **소유**: 위 2개 + `ChatInput.tsx`

### W2 — 에이전트

#### P11-20. 에이전트 카드 단순화
- 표시: 이름·기본 배지·상태 점·설명·**모델명·컨텍스트 크기**. 버튼: **대화 시작·수정** (+ 기존 아이콘: 상태 확인·기본 지정·복제·삭제).
- temp·도구·스킬 수, 모니터링·통계·로그 버튼 삭제. `AgentStatsPanel`·`AgentStatsTab`·로그 관련 코드 삭제.
- **소유**: `AgentCard.tsx`, `AgentListPanel.tsx`, `AgentStats*` 삭제

#### P11-21. 에이전트 편집 화면 단순화
- 기본 노출: **기본 정보(이름·설명)**, **LLM 프로바이더**(P11-22), 비전 지원(P11-26).
- `▸ 고급 설정` 접이식 1개 안에: 시스템 프롬프트, LLM 생성 옵션(reasoning·ctx 등), 생성 파라미터, 도구 승인 정책(기본 `dangerous-only`), 자동 모니터링, 활성 내장 도구(기본 쉘 제외 전체), 활성 스킬(기본 `basic-llm-wiki`).
- 1,855줄인 `AgentEditorForm.tsx`를 카드 단위 파일로 분할(`agents/editor/*Card.tsx`)하면서 작업 — 동작 변경 없는 분할 커밋을 먼저 하고, UI 변경 커밋을 뒤에 둔다.
- **소유**: `src/components/agents/AgentEditorForm.tsx`, `src/components/agents/editor/**`, `AgentEditorTab.tsx`

#### P11-22. 프로바이더 3분류 + 외부 연동 등록 통합
- 프로바이더 선택을 3그룹으로: **[로컬/직접 연동]** 기존 local 프리셋 · **[외부 에이전트 연동]** 등록된 agent-cli 연동 목록 + "새 외부 에이전트 등록" · **[클라우드/외부 API]** 기존 cloud/gateway 프리셋.
- `LlmProviderKind`에 `'external-agent'` 추가, `Agent.externalAgentId` 필드(DB 컬럼 추가 마이그레이션).
- 외부 에이전트 등록: `IntegrationEditorDialog`를 편집 화면에서 인라인 호출. 프리셋 제공(Claude Code `claude -p --output-format json`, Codex `codex exec`, Gemini CLI 등 — 실행 파일 자동 탐지는 PATH 검색).
- 평가에서 쓰던 "외부 LLM API(llm-api) 연동" 레코드는 클라우드 프로바이더 에이전트로 **1회 변환 마이그레이션**(이름 = 연동 이름) 후 llm-api 종류 폐지.
- 클라우드/외부 에이전트 선택·저장 시 동의 다이얼로그(P11-02 개정 문구) 필수.
- **소유**: `providers.ts`, `types/agent.ts`, `agentsRepo.ts`, 편집 화면의 프로바이더 카드 파일, 마이그레이션 1개

#### P11-23. 외부 에이전트 런타임
- `src/lib/llm/externalAgentClient.ts`: `getStreamChatFn`과 같은 시그니처로 CLI 1회 실행 결과를 단일 청크로 반환(D3). 진행 중 표시는 "외부 에이전트 실행 중(경과 시간)".
- 우리 루프의 도구 호출 없음 → 해당 에이전트는 도구·스킬 섹션 비활성화 표시. cwd = 대화가 시작된 탐색기 경로(채팅 탭이면 작업 폴더).
- 게이트웨이 `callIntegration`을 거쳐 권한 검사·감사 로그 유지.
- **소유**: `externalAgentClient.ts`, `providerRuntime.ts`(분기 1곳)

#### P11-24. 파일 커맨더 시스템 프롬프트 + 도구
- 기본 시스템 프롬프트 재작성(`defaultAgent.ts`): "당신은 Vanilla Commander의 파일 관리 비서다. 사용자의 현재 위치·선택 파일을 기준으로 동작하고, 파괴적 작업 전 계획을 한 줄로 밝힌다…" + 동적 섹션 `buildSystemPrompt`에 **현재 탐색기 위치·선택 항목·작업 폴더·허용 루트** 섹션 추가.
- 신규 도구(`src/lib/tools/commander/*.ts`, zod 스키마 + 위험도 분류):
  - `fs_copy`·`fs_move`·`fs_rename`·`fs_mkdir`·`fs_trash`(dangerous, 실행 전 D10 백업)
  - `fs_zip`·`fs_unzip`(dangerous: 쓰기)
  - `fs_info`·`fs_search`(safe)
  - `explorer`(safe): 탐색기 탭 열기/이동/선택 — 에이전트가 결과를 화면에 보여줄 때 사용
  - `doc_read`(safe): PDF/DOCX/XLSX/PPTX 텍스트 추출(P11-33 파서 재사용)
- 기존 `ls`/`find`/`grep`과 기능 중복 시 설명문에서 사용처를 구분. 로컬 소형 모델 대비 파라미터 별칭 흡수(`wiki.ts`의 preprocess 패턴 재사용).
- **소유**: `src/lib/tools/commander/**`, `defaultAgent.ts`, `buildSystemPrompt.ts`(섹션 1개), `risk.ts`(분류 추가), `bootstrap.ts` 1줄
- **테스트**: 도구별 스키마·위험도·백업 호출 단위 테스트.

#### P11-25. 기본 에이전트 폴백 동의
- 전송 직전 기본 에이전트 상태 확인(`agentStatus.ts`) 실패 시 `AgentFallbackDialog`: 사용 가능한 다른 에이전트 목록(상태 확인 결과 포함) 중 선택. 클라우드/외부 에이전트에는 **"대화 내용과 참조 파일이 외부로 전송될 수 있습니다"** 경고 배지 + 별도 체크.
- 선택은 이번 세션에만 적용(기본 에이전트 변경 아님), "다시 묻지 않기"는 로컬 에이전트에만 허용.
- 위키·매크로 백그라운드 실행에서는 다이얼로그 대신 "대기 + StatusBar 알림"(무단 외부 전송 방지).
- **소유**: `src/components/agents/AgentFallbackDialog.tsx`, `src/lib/agent/resolveAgent.ts`, `useChat.ts`(호출 1곳)

#### P11-26. 이미지 첨부 + 비전
- `Agent.vision: 'auto' | 'yes' | 'no'`(기본 auto). auto는 Ollama `/api/show`의 `capabilities`에 `vision` 포함 여부로 판정(이미 `ollamaClient.ts`가 capabilities를 읽음), OpenAI 호환은 판정 불가 → 편집 화면에서 수동 선택 안내.
- 채팅 입력: 이미지 버튼·붙여넣기·드래그(탐색기에서 드래그 포함). 메시지 타입에 `images`(경로 또는 base64) 추가, `messageMapper`에서 Ollama `images` 필드 / OpenAI `image_url` content part로 변환. DB 엔트리 JSON에 경로 저장(대용량 base64 저장 금지, 필요 시 작업 폴더 `chat-images/`에 복사).
- 비전 미지원 에이전트에서 이미지 첨부 시 폴백 다이얼로그(P11-25)로 비전 에이전트 제안.
- "분석 결과를 위키에 저장" 버튼: 응답 메시지 액션 → `wiki` 도구 ingest(이미지 원본 경로를 출처로 기록).
- **소유**: `types/chat.ts`, `messageMapper.ts`, `ChatInput.tsx`(이미지 부분, P11-16과 순차), `MessageBubble.tsx`(액션 1개)

#### P11-27. 모니터링 메뉴 정리
- `MonitoringListPanel` 삭제, `AgentMonitorTab`은 유지(진입: TopMenuBar 에이전트 아이콘). 모니터링 수집기(`src/lib/monitoring/**`)는 탭이 쓰는 부분만 유지.
- **소유**: `src/components/monitoring/**`, `src/lib/monitoring/monitoringGroups.ts`

### W3 — 위키

#### P11-30. 폴더 감시 (Rust)
- `watch_commands.rs`: `wiki_watch_set(folders)` — `notify-debouncer-full`(2초) → `wiki://file-event { path, kind }` 이벤트. 임시 다운로드 파일(`.crdownload`, `.part`, `.tmp`, `~$*`) 제외, **크기 안정화 확인**(1초 간격 2회 동일) 후 발행.
- 기본 감시 폴더 = OS 다운로드 폴더(`dirs`/Tauri path API).
- **소유**: `watch_commands.rs`, `Cargo.toml` 의존성 줄

#### P11-31. 위키 설정 모델 + 위키 패널/탭
- 설정(`settings.wiki`): 감시 on/off · 감시 폴더 목록 · 이동 여부 · 이동 대상 폴더(기본 `<WorkFolder>/wiki-inbox`) · 분류 규칙(D6: 자동/날짜/순번/빈도) · 대상 필터(확장자 화이트리스트, 최대 크기, 제외 glob) · 처리 프롬프트(기본값 + 초기화 버튼) · 처리 에이전트(D5).
- `WikiPanel`(사이드): 감시 상태 토글, 대기열/최근 처리(성공·실패·건너뜀 사유), 위키 페이지 목록(`wiki/index.md` 파싱) → 클릭 시 MD 뷰어.
- `WikiTab`: 위 설정 편집 화면 + 처리 이력 표(재처리·원본 위치 열기).
- 처리 이력은 DB `wiki_jobs` 테이블(새 마이그레이션).
- **소유**: `src/components/wiki/**`, `src/lib/wiki/settings.ts`, `wiki` 사전, 마이그레이션 1개

#### P11-32. 위키 처리 파이프라인
- `src/lib/wiki/pipeline.ts`: 이벤트 → 필터 → 대기열(직렬 1건씩, 채팅 실행 중이면 대기 — `chatQueueManager`와 조정) → ① 내용 추출(텍스트는 직접, 문서는 P11-33 파서, 이미지는 비전 에이전트 필요·없으면 `waiting-vision`) → ② LLM 1회 호출로 `{ classification, folderName, title, slug, summary, tags }` JSON 생성(zod 검증, 실패 시 1회 재시도 후 날짜순 폴백) → ③ (옵션) 이동 + 원본 경로 기록 → ④ `wiki` 도구 ingest(출처: 이동 후 경로).
- 에이전트 루프 대신 **단일 구조화 호출**을 사용(백그라운드 작업에 도구 루프를 돌리지 않아 예측 가능·저비용).
- 외부(클라우드/외부 에이전트) 처리 에이전트는 동의 + 목적 `wiki-ingest` 허용 시에만.
- StatusBar 위키 슬롯 퍼블리시.
- **소유**: `src/lib/wiki/**`(settings 제외)
- **테스트**: 분류 JSON 파싱·폴백, 필터, 경로 생성(0 패딩 순번, 날짜 폴더).

#### P11-33. 문서 파서 계층
- `src/lib/parsers/index.ts`: `parseDocument(path) → { text, meta, method }`. 우선순위: 사용자 지정 외부 파서(확장자별) → 내장 파서(PDF=pdfjs 텍스트 레이어, DOCX=mammoth, XLSX/CSV=SheetJS 시트별 CSV, PPTX=Rust zip XML 추출, 텍스트) → 실패.
- 외부 파서 = CLI 템플릿(`{input}`/`{output}` 토큰, stdout 또는 출력 파일). 프리셋: **MarkItDown**(`markitdown {input}`), **Docling**, **Pandoc**(`pandoc {input} -t markdown`), **LibreOffice**(`soffice --headless --convert-to txt`), 사용자 정의. 로컬 실행이므로 외부 전송 동의 대상 아님(단 실행 파일 경로 검증·타임아웃은 `integration_run_cli` 규칙 재사용).
- 스캔 PDF(텍스트 레이어 없음)는 "외부 파서(OCR) 또는 비전 에이전트 필요"로 실패 사유 반환.
- **소유**: `src/lib/parsers/**`, `fs`의 PPTX/DOCX XML 추출 커맨드(`commander_commands.rs`에 1개 함수 — P11-10 완료 후)

#### P11-34. 설정 > 문서 파싱 연동
- `SettingsParsers.tsx`: 확장자별 사용 파서 표, 외부 파서 등록/테스트(샘플 파일로 실행해 결과 미리보기), 설치 여부 감지(PATH).
- **소유**: `src/pages/Settings/SettingsParsers.tsx`, `parsers` 사전

### W4 — 매크로

#### P11-40. 매크로 저장소 + 화면
- localStorage → DB `macros` 테이블(새 마이그레이션, 첫 실행 시 localStorage 1회 이관). 필드: 이름·프롬프트 목록·에이전트·실행 위치(작업 폴더/지정 폴더)·스케줄·마지막 실행 결과.
- `MacrosContext`, `MacroPanel`(목록·실행·스케줄 표시), `MacroEditorTab`(프롬프트 순서 편집·`@` 참조·테스트 실행). 채팅의 기존 "매크로 저장" 다이얼로그는 새 저장소를 사용.
- **소유**: `src/lib/chat/chatMacros.ts`→`src/lib/macros/**`, `src/components/macros/**`, `ChatMacroDialog.tsx`, `macros` 사전, 마이그레이션 1개

#### P11-41. 매크로 스케줄러
- `src/lib/macros/scheduler.ts`: 스케줄 종류 `interval(분)`·`daily(HH:mm)`·`weekly(요일+HH:mm)`. 1분 틱, 놓친 실행 보충 옵션(D7), 동시 실행 1개, 채팅 실행 중이면 대기.
- 실행 = 매크로 전용 숨은 세션(`origin='macro'`)에서 프롬프트 순차 전송. 승인이 필요한 도구 호출이 나오면 **자동 승인하지 않고** 일시정지 + StatusBar/알림으로 사용자 확인 요청(AGENTS.md §7 — 승인 우회 금지).
- 실행 이력·결과 요약을 매크로 화면에 표시, "세션 열기"로 전체 대화 확인.
- **소유**: `scheduler.ts`, 매크로 패널의 스케줄 UI

### W5 — 설정·마무리

#### P11-50. 설정 재구성
- 라우트: `/settings`(일반) · `/settings/parsers` · `/settings/update`. `model`·`approval`·`integrations` 라우트와 파일 삭제(외부 연동 관리 UI는 에이전트 편집으로 이관 완료 상태여야 함).
- 일반: 언어·테마·작업 폴더 변경(이동 여부 확인)·에이전트 허용 폴더·**셋업 위저드 다시 실행**·외부 전송 감사 로그 보기.
- 업데이트: 현재 버전 표시 + "준비 중" 안내(기능 미구현).
- **소유**: `App.tsx`(라우트), `src/pages/Settings/**`

#### P11-51. 문서·브랜딩 정리
- `Architecture.md`: §0 요약, §2 트리, §3 레이아웃, §4.5 저장소(D2), §7 안전 경계(D1 허용 루트·사용자/에이전트 분리), §12 IPC, §14 → "평가 폐기, 외부 연동만 §15로 이관", 신규 §16 위키·§17 매크로.
- `AGENTS.md`/`CLAUDE.md`/`README.md`/`UserGuide.md`/`QA-Checklist.md`의 Fortress 명칭·기능 설명 갱신. `.fortress` 경로·`fortress:` storage 키는 호환을 위해 유지할지 결정해 기록.
- **소유**: 위 문서

#### P11-52. 통합 QA
시나리오(최소):
1. 신규 설치 → 위저드 6단계 → 기본 에이전트 편집 탭 자동 오픈
2. 탐색기 2개 분할 → F5 복사(충돌 → 이름 변경) → 진행률 StatusBar → 취소
3. ZIP 압축/해제, 휴지통 삭제, 정보 대화상자(폴더 크기)
4. PDF/DOCX/XLSX/PPTX/이미지/ZIP 더블클릭 뷰어, HTML·MP4는 외부 앱
5. 탐색기 하단 입력 "`@보고서.pdf` 요약해서 같은 폴더에 md로 저장" → 승인 → 백업 생성 → 목록 새로고침
6. 채팅 이미지 첨부(비전 모델) → 위키 저장
7. 다운로드 폴더에 PDF 저장 → 위키 자동 처리 → 이동·분류·위키 페이지 생성
8. 기본 에이전트(Ollama) 중지 → 폴백 다이얼로그 → 클라우드 선택 시 외부 전송 경고
9. 외부 에이전트(Claude Code CLI) 등록 → 동의 → 대화
10. 매크로 5분 간격 스케줄 → 자동 실행 → 승인 필요 도구에서 일시정지
11. 설정에서 위저드 재실행(값 프리필) → 작업 폴더 변경

---

## 5. 위험·주의

- **보안 모델 변경(D1)이 가장 큰 위험.** 에이전트 도구가 허용 루트를 벗어나지 못하는지 Rust 테스트로 고정하고, 심링크·`..`·UNC 경로 케이스를 포함한다. 셸 도구는 기본 비활성 + 항상 승인(변경 없음).
- 외부 에이전트(D3)는 우리 승인 훅 밖에서 파일을 바꿀 수 있다 — 동의 문구와 에이전트 카드 배지로 명확히 표시.
- 위키 감시는 다운로드 폴더의 **모든 신규 파일**을 LLM에 넣는다 — 기본 필터(확장자 화이트리스트·최대 크기 20MB·실행 파일 제외)와 "처음 N건은 확인 후 처리" 옵션 고려.
- 평가 코드 삭제 범위가 크다(약 200개 파일). P11-02 이관 → 테스트 통과 확인 → P11-03 삭제 순서를 지키고 커밋을 분리한다.
- `AgentEditorForm.tsx`(1,855줄)·`AgentMonitorTab.tsx`(2,608줄)는 충돌 위험이 커서 한 작업만 동시에 만진다.
