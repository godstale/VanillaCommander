<p align="center"><img src="./design/brand/app-banner.jpg" alt="Vanilla Commander" width="100%" /></p>
<p align="right"><sub>사진: <a href="https://unsplash.com/ko/%EC%82%AC%EC%A7%84/%ED%9D%91%EB%B0%B1-%EC%A7%81%EC%84%A0-GA6WtJ7DtSo?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText">Unsplash</a>의 <a href="https://unsplash.com/ko/@molnj?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText">Jocelyn Morales</a></sub></p>

# Vanilla Commander

**Vanilla Commander**는 로컬 LLM 에이전트를 결합해 채팅으로 제어하는 **file commander 앱**입니다.  
Tauri 2와 React 19로 구축되었으며, 외부 프레임워크 오버헤드(No LangChain) 없이 자체 경량 런타임(`pi` 아키텍처)을 통해 파일 탐색기, 채팅 제어 에이전트, 위키·매크로 자동화를 단일 데스크탑 앱에서 통합 제공합니다.

---

## ✨ 주요 핵심 기능

- 📁 **파일 커맨더 (2열 탐색기)**
  - 상세 목록(정렬·다중 선택·키보드 탐색), 브레드크럼 주소창, 즐겨찾기·시스템 폴더, 분할 보기(F5 복사/F6 이동).
  - 복사/이동/압축/검색은 Rust job + 진행률·취소·충돌 처리(`덮어쓰기/건너뛰기/이름 변경`).
  - PDF/DOCX/XLSX/PPTX/ZIP 내장 뷰어 + 코드 에디터(CodeMirror 6). 삭제는 휴지통(`trash`), 에이전트 변경분은 작업 폴더 `backup/`에 스냅샷.
- 🤖 **자율 에이전트 루프 (`pi` Architecture)**
  - 외부 프레임워크 없이 순수 TypeScript로 구동되는 경량 에이전트 루프.
  - 모델의 사고 과정(`<think>` / `thinking`) 감지 및 사고 단계에서 중단되는 현상을 방지하는 자동 복구 메커니즘 내장.
  - Ollama 네이티브 + OpenAI 호환 런타임 + 외부 에이전트 CLI(Claude Code·Codex 등) 연동, 이미지 첨부(비전) 지원.
- 🛠 **21종 내장 도구 (신규 에이전트 기본: 셸 제외 전체 활성)**
  - 파일 조작: `read`, `write`, `edit`, `ls`, `grep`, `find`
  - 파일 커맨더: `fs_copy`, `fs_move`, `fs_rename`, `fs_mkdir`, `fs_trash`, `fs_zip`, `fs_unzip`, `fs_info`, `fs_search`, `explorer`, `doc_read`
  - 웹 탐색: `web_search` (DuckDuckGo), `web_fetch` (콘텐츠 스크래핑)
  - `shell` (OS 셸 실행, 기본 비활성 — 승인 필수), `wiki` (개인 지식 베이스)
- 📊 **실시간 인터랙티브 시각화**
  - **Mermaid 다이어그램**: 모델이 생성한 흐름도, 시퀀스, 아키텍처 다이어그램을 실시간 SVG로 렌더링 (확대/축소/이동 지원).
  - **Recharts 데이터 차트**: 모델이 제공한 구조화된 데이터 블록을 Line, Bar, Pie 등의 동적 차트로 즉시 시각화.
- 📈 **하드웨어 & 추론 모니터링 탭**
  - Tauri 네이티브 Rust 백엔드를 통해 GPU 사용량, VRAM 점유량, GPU 온도, KV 캐시 소비량을 실시간 수집.
  - 추론 속도(tokens/sec), 컨텍스트 사용률, 누적 프롬프트/완료 토큰을 Recharts 시계열 그래프로 모니터링 (상단 `Agent` 메뉴에서 진입).
- 🧠 **Agent Skills 오픈 표준 지원**
  - 작업 폴더 `skills/`·워크스페이스의 `.agents/skills/*/SKILL.md` 및 `AGENTS.md` 자동 탐색.
  - 프로그레시브 디스클로저(필요 시에만 스킬 본문 로드)를 통해 컨텍스트 낭비 방지.
- 📚 **위키 자동 등록**
  - 다운로드 폴더 감시 → 문서 파싱(PDF/DOCX/XLSX/PPTX/이미지) → LLM 1회 분류(날짜/순번/빈도) → `wiki/` ingest + 원본 보관.
- ⚡ **매크로 (프롬프트 묶음 + 스케줄)**
  - 채팅 프롬프트를 묶어 순서대로 실행하고, 간격/매일/매주 스케줄로 자동 실행. 승인 필요 시 일시정지 후 확인 요청.
- 🗄 **로컬 퍼스트 스토리지**
  - 세션·매크로·위키 이력은 전역 SQLite(`vanilla-commander.db`)에 Append-Only 이벤트 소싱 방식으로 보관. 위키·백업·설정 파일은 작업 폴더에 저장.
- 🛡 **인간 개입 승인 (Human-in-the-Loop, HITL)**
  - 파일 쓰기/편집 및 중요 도구 호출 시 사용자의 사전 승인을 강제하는 보안 계층. 셸은 항상 승인.

---

## 🛠 시스템 요구사항

- **Node.js**: v20.x 이상 (v22.x 권장)
- **pnpm**: 9.x 이상 (npm/yarn 사용 금지 - lockfile 일관성)
- **Rust**: 1.77.2 이상 (stable toolchain)
- **Ollama**: 최신 버전 (기본 로컬 주소: `http://127.0.0.1:11434`)
  - 권장 모델: `qwen3.5:9b` (강력 추천), `qwen2.5-coder:7b`, `llama3.1:8b`

---

## 🚀 빠른 시작 가이드 (Quick Start)

### 1. Ollama 모델 다운로드 및 준비
```bash
# 권장 모델 다운로드 (Qwen 3.5 9B)
ollama run qwen3.5:9b
```

### 2. 의존성 설치
```bash
# 저장소 루트에서 실행
pnpm install
```

### 3. 애플리케이션 실행
```bash
# 데스크탑 앱 개발 모드 실행 (Tauri + Vite)
pnpm tauri dev

# 또는 웹 브라우저 단독 프리뷰 (일부 Tauri 네이티브 기능 제외)
pnpm dev
```

### 4. 빌드 및 테스트
```bash
# 코드 검증 (타입 체크 및 린트)
pnpm typecheck
pnpm lint

# 전체 테스트 실행
pnpm test

# Rust 백엔드 테스트
cargo test --manifest-path src-tauri/Cargo.toml

# 프로덕션 배포용 데스크탑 인스톨러 생성
pnpm tauri build
```

---

## 💡 앱 사용 가이드 (How to Use)

1. **첫 실행 — 셋업 위저드**
   - 최초 실행 시 6단계 위저드(언어 → 작업 폴더 → 에이전트 → 위키 → 매크로 → 완료)가 자동으로 뜹니다. 완료되면 기본 에이전트 편집 탭이 열립니다.
   - Ollama가 켜져 있으면 모델 목록을 자동으로 불러와 기본 에이전트를 채워줍니다.
2. **파일 탐색기로 정리하기**
   - 시작 화면은 파일 탐색기 탭입니다. F5 복사 / F6 이동 / F7 새 폴더 / Del 휴지통, `@보고서.pdf` 형태 참조는 하단 1줄 채팅에 넣어 에이전트에게 맡기세요.
   - PDF/DOCX/XLSX/PPTX/ZIP은 더블클릭으로 내장 뷰어, 나머지는 시스템 기본 앱으로 열립니다.
3. **채팅으로 에이전트에게 시키기**
   - 좌측 채팅 패널에서 새 대화를 시작하세요. 각 채팅은 하나의 에이전트 설정에 귀속됩니다.
   - 이미지는 입력창의 이미지 버튼·붙여넣기·드래그로 첨부합니다 (비전 지원 모델 필요).
   - 기본 에이전트에 연결할 수 없으면 폴백 다이얼로그가 다른 에이전트를 제안합니다.
4. **도구 승인 (HITL)**
   - 에이전트가 파일 수정(`write`, `edit`)·이동·삭제 등을 시도하면 승인 다이얼로그가 표시됩니다. 셸(`shell`)은 항상 승인이 필요합니다.
5. **위키에 쌓기**
   - 다운로드 폴더에 파일이 들어오면 자동으로 분류·등록됩니다. 위키 패널에서 대기열·이력을 보고, 페이지를 클릭하면 바로 열립니다.
6. **매크로로 반복하기**
   - 채팅의 저장 버튼으로 프롬프트 묶음을 매크로로 저장하고, 매크로 패널에서 실행·스케줄(간격/매일/매주)을 겁니다. 실행은 전용 대화에서 순차 진행되며 승인 필요 시 멈춰서 확인을 요청합니다.
7. **모니터링 확인**
   - 상단 메뉴 `Agent` → 모니터 항목을 클릭하면 실시간 모니터링 탭이 열립니다.

---

## 🗂 위키 · 매크로 사용법

**위키**는 다운로드 폴더에 들어온 파일을 자동으로 정리하는 지식 베이스입니다.

1. 위키 설정에서 감시를 켜고 감시 폴더(기본: OS 다운로드 폴더)를 확인합니다.
2. 새 파일이 들어오면 내용 추출 → LLM 1회 분류(날짜/순번/빈도) → `wiki/` 등록 + 원본 보관 폴더 이동이 자동으로 일어납니다.
3. 이미지는 비전 지원 에이전트가, 스캔 PDF는 OCR 외부 파서 또는 비전 에이전트가 필요합니다. 없으면 대기 목록에 남습니다.

**매크로**는 채팅 프롬프트 묶음의 저장·반복 실행입니다.

1. 채팅의 저장 버튼으로 현재 대화의 사용자 프롬프트를 매크로로 저장합니다.
2. 매크로 패널에서 [실행]하면 전용 대화에서 순서대로 실행되고, 편집 탭에서 순서·에이전트·스케줄을 바꿀 수 있습니다.
3. 스케줄(간격/매일/매주)을 걸면 앱 실행 중에 자동 실행됩니다. 승인 필요 도구가 나오면 멈춰서 확인을 요청합니다.

> 📖 자동 평가 기능은 Vanilla Commander 전환(P11-03)에서 삭제되었습니다. 이력만 `Docs/EvaluationGuide.md`·`Docs/phases/Phase10-*`에 "폐기됨" 헤더와 함께 보존됩니다.

---

## ⌨️ 단축키 안내

| 단축키 | 동작 |
| :--- | :--- |
| `Ctrl+N` | 새 대화 세션 시작 |
| `Ctrl+W` | 현재 활성 탭 닫기 |
| `Ctrl+,` | 에이전트 설정 탭 열기 |

---

## 📚 Docs 문서 및 개발 참고 자료 가이드

Vanilla Commander의 내부 구조 파악, 커스텀 에이전트 개발, 벤치마크 분석 및 시스템 재구현에 필요한 문서들이 `Docs/` 폴더에 체계적으로 구성되어 있습니다.

### 📌 추천 읽기 순서
1. **신규 개발자 / 앱 재구현자**: `Docs/ReimplementationGuide.md` → `Docs/Architecture.md`
2. **실무 사용자**: `README.md` → `Docs/UserGuide.md`
3. **하드웨어 및 LLM 최적화 담당자**: `Docs/MonitoringAnalysis_Qwen3.5_64k.md` → `Docs/MonitoringAnalysis_Qwen3.5_8k.md`
4. **AI 코딩 에이전트 (Claude, Codex, Antigravity)**: `AGENTS.md` → `Docs/Architecture.md` → `Docs/TODO.md`

### 📂 문서 맵

| 문서명 | 성격 및 설명 | 링크 |
| :--- | :--- | :---: |
| **재구현 및 종합 청사진** | **[ReimplementationGuide.md](./Docs/ReimplementationGuide.md)**<br>현재까지의 구현사항, 계층별 아키텍처, 런타임 루프 분석, 디렉터리 구성, 신규 앱 개발 및 재구현 시 단계별 가이드라인을 집대성한 핵심 문서. | [바로가기](./Docs/ReimplementationGuide.md) |
| **시스템 아키텍처 설계서** | **[Architecture.md](./Docs/Architecture.md)**<br>데이터 모델, 엔트리 스키마, 신뢰 경계(Security), 런타임 수명 주기, 도구 정의의 단일 진실 공급원(Single Source of Truth). | [바로가기](./Docs/Architecture.md) |
| **사용자 가이드** | **[UserGuide.md](./Docs/UserGuide.md)**<br>화면 레이아웃 구성, 파일 커맨더·채팅·위키·매크로 사용법, 도구 승인 절차 등 사용자를 위한 실전 매뉴얼. | [바로가기](./Docs/UserGuide.md) |
| **자동 평가 사용법 (폐기됨)** | **[EvaluationGuide.md](./Docs/EvaluationGuide.md)**<br>Phase 10 자동 평가의 이력 문서. P11-03에서 기능이 삭제되어 "폐기됨" 헤더와 함께 보존. | [바로가기](./Docs/EvaluationGuide.md) |
| **Nemotron 64k 벤치마크 분석 보고서** | **[MonitoringAnalysis_Nemotron3.5_64k.md](./Docs/MonitoringAnalysis_Nemotron3.5_64k.md)**<br>RTX 4070 SUPER(12GB) 환경에서 Nemotron-3.5-Lightning(30B MoE, A3B, Mamba-2 하이브리드) 64k 컨텍스트 실측 데이터 및 VRAM/속도 분석 리포트. | [바로가기](./Docs/MonitoringAnalysis_Nemotron3.5_64k.md) |
| **Qwen 64k 벤치마크 분석 보고서** | **[MonitoringAnalysis_Qwen3.5_64k.md](./Docs/MonitoringAnalysis_Qwen3.5_64k.md)**<br>RTX 4070 SUPER(12GB) 환경에서 Qwen3.5 64k 컨텍스트 및 8개 도구/위키 연동 실측 데이터 분석 및 대용량 최적화 리포트. | [바로가기](./Docs/MonitoringAnalysis_Qwen3.5_64k.md) |
| **Qwen 8k 벤치마크 분석 보고서** | **[MonitoringAnalysis_Qwen3.5_8k.md](./Docs/MonitoringAnalysis_Qwen3.5_8k.md)**<br>8k 컨텍스트 환경의 하드웨어 리소스 병목 진단 및 VRAM 예산 산정 가이드. | [바로가기](./Docs/MonitoringAnalysis_Qwen3.5_8k.md) |
| **단계별 구현 계획서** | **[ImplementationPlan.md](./Docs/ImplementationPlan.md)**<br>Phase 0부터 Phase 11까지(파일 커맨더 전환 포함)의 상세 작업 분할 및 단계별 의존성 그래프. | [바로가기](./Docs/ImplementationPlan.md) |
| **진행상황 트래커** | **[TODO.md](./Docs/TODO.md)**<br>전체 작업 항목의 완료 상태 트래커 및 과거 이슈 해결 기록. | [바로가기](./Docs/TODO.md) |
| **품질 검증 체크리스트** | **[QA-Checklist.md](./Docs/QA-Checklist.md)**<br>기능, 성능, 보안, UX 각 영역별 테스트 시나리오 및 품질 검증 기준. | [바로가기](./Docs/QA-Checklist.md) |
| **디자인 시스템** | **[DESIGN.md](./DESIGN.md)**<br>Midnight Rampart 라이트/다크 테마의 색상 토큰, 타이포그래피, 컴포넌트 패턴, 다른 앱으로의 포팅 가이드(`design/` 리소스). | [바로가기](./DESIGN.md) |
| **AI 에이전트 작업 지침** | **[AGENTS.md](./AGENTS.md)**<br>Vanilla Commander 리포지토리를 개발하는 AI 코딩 에이전트를 위한 컨벤션, 코딩 규칙, 커밋 수칙. | [바로가기](./AGENTS.md) |

---

## 🏗 기술 스택 요약

| 영역 | 채택 기술 | 선정 사유 |
| :--- | :--- | :--- |
| **Desktop Shell** | **Tauri 2 (Rust)** | Chromium 대비 압도적으로 가벼운 메모리 점유, 네이티브 하드웨어 API 직접 호출 |
| **Frontend UI** | **React 19, TypeScript, Tailwind CSS v3** | 모던 컴포넌트 에코시스템, 엄격한 정적 타입 안전성 |
| **Component Kit** | **shadcn/ui, Radix UI, lucide-react** | 높은 접근성과 일관된 데스크탑 테마 |
| **Panel Layout** | **react-resizable-panels** | VivoStudio 풍 3패널 반응형 드래그 리사이징 |
| **Data Visualization** | **Mermaid.js, Recharts** | 에이전트가 출력한 다이어그램 및 수치 데이터를 즉시 시각화 |
| **State Management** | **React Context per concern** | 전역 스토어 오버헤드 없는 관심사별 모듈 격리 (Redux/Zustand 배제) |
| **Agent Runtime** | **Custom TS Loop (`pi` 기반)** | LangChain 배제, Ollama HTTP API 직접 연동으로 0% 오버헤드 달성 |
| **Local Storage** | **SQLite (`@tauri-apps/plugin-sql`)** | 프로젝트별 격리 DB 지원, Append-Only 이벤트 소싱 영속화 |
| **Routing** | **HashRouter (react-router-dom v7)** | Tauri 번들 자산 프로토콜과의 완벽한 호환성 (Whiteout 방지) |

---

## 📄 라이선스 (License)

이 프로젝트는 [MIT License](./LICENSE)를 따릅니다.
