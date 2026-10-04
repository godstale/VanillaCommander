# Phase 14 — 위키 완성 (상시 감시 · 카테고리 분류 · 검색)

**목표**: Phase 11 W3(P11-30~34)에서 만든 위키 뼈대를 "여러 폴더를 주기적으로 모니터링 → 내용 읽기 → 카테고리 계층 폴더로 이동 → 위키 기록 → 검색"까지 동작하는 기능으로 완성한다.

## 1. 현재 상태와 문제 (2026-10-04 점검)

| # | 문제 | 위치 |
|---|---|---|
| 1 | 감시·파이프라인이 앱 재시작 후 자동으로 켜지지 않음 (`wiki_watch_set`은 패널 토글/탭 저장 때만 호출, 파이프라인은 `WikiPanel` 마운트 때만 시작) | `WikiPanel.tsx`, `WikiTab.tsx` |
| 2 | 주기 스캔 없음. 이벤트 기반만, 하위 폴더 미감시(NonRecursive), 앱이 꺼진 사이 들어온 파일 누락, 중복 판정은 메모리 30초 | `watch_commands.rs`, `pipeline.ts` |
| 3 | 내용 기반 카테고리 체계가 아님: 날짜/순번/빈도 규칙에서 LLM이 `folderName`을 임의 생성 → 폴더 난립 | `pipeline.ts`, `settings.ts` |
| 4 | 위키 페이지 slug 충돌 시 덮어씀, frontmatter에 카테고리·원본 경로 없음 | `tools/wiki.ts` |
| 5 | 검색 UI 없음(에이전트 도구 grep만) | `tools/wiki.ts`, `WikiPanel.tsx` |
| 6 | 대기열 `pending`이 0으로 고정 | `pipeline.ts` |

## 2. 결정 사항

| ID | 결정 | 이유 |
|---|---|---|
| W-D1 | **laya 미도입.** LLM 1회 호출(구조화 출력)로 분류·요약을 처리한다 | laya는 선택지 고르기/yes-no만 가능해 제목·요약 생성 호출이 남고, Python+PyTorch+모델 ~1GB 설치 부담, 카테고리 수가 많아지면 정확도 저하 |
| W-D2 | 날짜/순번/빈도 분류 설정을 **카테고리 체계로 대체**한다. 날짜 폴더는 분류 실패 시 폴백으로만 유지 | 내용 기반 계층 구조 요구 |
| W-D3 | 초기 카테고리는 사용자가 정의, LLM의 새 카테고리 생성은 옵션(`allowNewCategories`) | 폴더 난립 방지 |
| W-D4 | 하위 폴더 재귀 감시는 기본 끔(옵션) | 다운로드 폴더는 보통 평면 |
| W-D5 | 위키 원본은 MD 파일(`wiki/sources/<slug>.md`), 검색 인덱스는 SQLite FTS5(재색인 가능한 파생 데이터) | 기존 구조·사용자 편집 호환 |

## 3. 작업 정의

### P14-01. 감시·파이프라인 상시 구동
- 앱 루트에 `WikiRuntime`(렌더링 없음)을 마운트: `configureWikiPipeline` + `startWikiPipeline` + `watchEnabled`면 `wiki_watch_set`. 설정·에이전트 변경 시 재적용.
- `WikiPanel`에서 구동 책임 제거(표시 전용), `pending` 실제 집계.
- 소유 파일: `src/components/wiki/WikiRuntime.tsx`(신규), `WikiPanel.tsx`, `lib/wiki/pipeline.ts`(pending), 앱 루트 마운트 지점.

### P14-02. 주기 스캔(reconcile) + 중복 방지
- Rust `wiki_scan_folders(folders, recursive)` → path·size·mtime 목록. 앱 시작 시와 `scanIntervalMin`(기본 10)마다 실행해 미처리 파일을 큐에 넣음. 감시 이벤트는 즉시 처리용으로 유지.
- `wiki_jobs.content_hash`(sha256) 추가(마이그레이션 `0004_wiki_job_hash.sql` 신규(0003은 macros가 사용) + `0001`·`MIGRATION_STATEMENTS`·메모리 폴백 동기화). 같은 해시로 완료된 파일은 skip.
- 설정: `recursive`, `scanIntervalMin`.

### P14-03. 카테고리 체계 기반 계층 분류
- 설정: `categories: string[]`(경로 목록, 최대 깊이 3), `allowNewCategories`. 기존 `classification` 제거(마이그레이션 시 무시).
- 분류 호출은 1회 유지. 프롬프트에 카테고리 경로 목록 + 문서 앞 ~6k자 → `{categoryPath, isNew, title, summary, tags}`. 새 경로는 허용 + 기존 부모 아래일 때만 채택, 아니면 폴백.
- 구조화 출력: `ollamaClient`에 `format`(JSON schema), OpenAI 호환 클라이언트에 `response_format`. 카테고리를 enum으로 제한.
- 이동 위치 = `<inboxDir>/<categoryPath>/`. 폴백 = `YYYY/MM-DD`.
- 구현 메모(2026-10-04): 분류 후보 = 설정 `categories` ∪ 보관 폴더의 기존 하위 폴더(깊이 3, 연도 4자리 폴더 제외). 응답 경로는 `resolveCategory`가 검증 — 기존 경로 일치 → 허용 시 기존 부모 아래 새 경로 → 가장 가까운 기존 상위 → 날짜 폴백. 구조화 출력 실패(미지원 서버) 시 재시도는 스키마 없이 프롬프트로만 강제. 설정 UI의 카테고리 편집은 우선 줄 단위 텍스트 영역이며 트리 편집기는 P14-06. 기존 저장 설정의 `classification` 값은 zod가 무시한다.

### P14-04. 위키 저장 구조 개선
- `wiki/sources/` 평면 유지. frontmatter에 `category`·`tags`·`source_path`·`original_path`·`hash`·`ingested_at`. slug 충돌 시 `-2` 접미. `index.md` 카테고리별 그룹.

### P14-05. 검색 (SQLite FTS5)
- `wiki_pages` + FTS5(trigram, 한국어 부분일치). 마이그레이션 `0005`. ingest/delete 시 갱신, `reindex`(MD → 인덱스) 제공.
- **선결 검증**: tauri-plugin-sql 번들 SQLite의 FTS5/trigram 지원. 불가 시 `LIKE` 폴백.
- `wiki` 도구 `query`를 FTS로 교체(grep 폴백).

### P14-06. UI
- `WikiPanel`: 검색창·스니펫·카테고리 트리·"지금 스캔". `WikiTab`: 재귀·스캔 주기·카테고리 편집기·새 카테고리 허용. ko/en 사전 동시 추가.

### P14-07. 문서·테스트
- `Architecture.md` §16, `UserGuide.md` 갱신. 테스트: reconcile 중복 방지, 카테고리 경로 검증, slug 충돌, FTS 질의, 분류 mock 파이프라인.

## 4. 순서

```
01 → 02 → 03 → 04 → 05 → 06 → 07   (03과 05는 소유 파일이 겹치지 않아 병렬 가능)
```

## 5. 의존성
- 신규 없음(예정). FTS5 불가 시 `Docs/TODO.md` 이슈 로그에 기록 후 결정.
