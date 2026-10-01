<p align="center"><img src="./design/brand/fortress-banner.svg" alt="Fortress — 내 PC에 맞는 로컬 LLM을 찾는 테스트 &amp; 모니터링 워크벤치" width="100%" /></p>

# VanillaCommander

**VanillaCommander**는 **Fortress**를 기반으로 만드는 **file commander 앱**입니다.  
Tauri 2와 React 19로 구축되었으며, 외부 프레임워크 오버헤드(No LangChain) 없이 자체 경량 런타임(`pi` 아키텍처)을 통해 자율 에이전트 루프, 실시간 시각화, 파일 조작 도구, 그리고 하드웨어/추론 모니터링을 단일 데스크탑 앱에서 통합 제공합니다.

---

## ✨ 주요 핵심 기능

- 🤖 **자율 에이전트 루프 (`pi` Architecture)**
  - 외부 프레임워크 없이 순수 TypeScript로 구동되는 경량 에이전트 루프.
  - 모델의 사고 과정(`<think>` / `thinking`) 감지 및 사고 단계에서 중단되는 현상을 방지하는 자동 복구 메커니즘 내장.
- 🛠 **10종 내장 도구 (Tools, 신규 에이전트 기본 8종 활성)**
  - 파일 조작: `read`, `write`, `edit`, `ls`, `grep`, `find`
  - 웹 탐색: `web_search` (DuckDuckGo), `web_fetch` (콘텐츠 스크래핑)
  - `shell` (OS 셸 실행, 기본 비활성 — 승인 필수), `wiki` (개인 지식 베이스, 기존 저장값 호환용으로만 등록 유지 — 신규 사용은 `basic-llm-wiki` 스킬 권장)
- 📊 **실시간 인터랙티브 시각화**
  - **Mermaid 다이어그램**: 모델이 생성한 흐름도, 시퀀스, 아키텍처 다이어그램을 실시간 SVG로 렌더링 (확대/축소/이동 지원).
  - **Recharts 데이터 차트**: 모델이 제공한 구조화된 데이터 블록을 Line, Bar, Pie 등의 동적 차트로 즉시 시각화.
- 📈 **실시간 하드웨어 & 추론 모니터링 대시보드**
  - Tauri 네이티브 Rust 백엔드를 통해 GPU 사용량, VRAM 점유량, GPU 온도, KV 캐시 소비량을 실시간 수집.
  - 추론 속도(tokens/sec), 컨텍스트 사용률, 누적 프롬프트/완료 토큰을 Recharts 시계열 그래프로 모니터링.
- 🧠 **Agent Skills 오픈 표준 지원**
  - 워크스페이스의 `.agents/skills/*/SKILL.md` 및 `AGENTS.md` 자동 탐색.
  - 프로그레시브 디스클로저(필요 시에만 스킬 본문 로드)를 통해 컨텍스트 낭비 방지.
- 🗄 **로컬 퍼스트 & 프로젝트 격리 스토리지**
  - 대화 및 모니터링 스냅샷은 워크스페이스 내 `.fortress/fortress.db` (SQLite)에 Append-Only 이벤트 소싱 방식으로 안전하게 보관.
- 🛡 **인간 개입 승인 (Human-in-the-Loop, HITL)**
  - 파일 쓰기/편집 및 중요 도구 호출 시 사용자의 사전 승인을 강제하는 보안 계층.
- 🧪 **자동 평가 (Evaluation)**
  - 같은 평가셋을 여러 후보(모델×설정)에 자동 실행해 품질·에이전트·성능·자원·신뢰성을 0~100으로 비교하고 최적 후보를 추천.
  - 내장 FAB 11종 + 공개셋 9종 번들, 실행 마법사·진행 화면·리포트·Arena·개인 평가셋·EEE 내보내기 포함.
- 📑 **생산성을 극대화하는 다중 탭 레이아웃**
  - 드래그 앤 드롭 탭 재정렬, 탭 컨텍스트 메뉴(우측/좌측/다른 탭 닫기), 3패널 반응형 분할, 파일 탐색기 CRUD.

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

# 146개 테스트 파일 1009개 테스트 실행 (2026-09-30 실측)
pnpm test

# 프로덕션 배포용 데스크탑 인스톨러 생성
pnpm tauri build
```

---

## 💡 앱 사용 가이드 (How to Use)

1. **워크스페이스 폴더 열기**
   - 상단 메뉴의 `File` → `Open Folder`를 눌러 작업할 프로젝트 폴더를 선택합니다.
   - 좌측 패널에 파일 트리가 나타나며, 프로젝트 전용 데이터베이스(`.fortress/fortress.db`)가 자동 생성됩니다.
2. **에이전트 선택 및 설정**
   - 좌측 하단 `Agents` 패널에서 기본 에이전트를 확인하거나 새 에이전트를 생성할 수 있습니다.
   - 에이전트 수정 탭에서 모델, 시스템 프롬프트, 도구 활성화 여부, 컨텍스트 크기(예: 32k, 64k)를 조정할 수 있습니다.
3. **대화 및 자율 작업 실행**
   - 중앙 작업공간의 대화창(`ChatTab`)에 원하는 작업을 입력합니다.
   - 예: *"src 폴더의 모든 컴포넌트 구조를 분석해서 Mermaid 다이어그램으로 그려줘."*
   - 모델이 자율적으로 `find`, `ls`, `read` 도구를 호출하며 정보를 수집하고 답변을 도출합니다.
4. **도구 승인 (HITL)**
   - 에이전트가 파일 수정(`write`, `edit`)을 시도하면 화면에 승인 다이얼로그가 표시됩니다. 변경 사항을 확인하고 **승인** 또는 **거부**할 수 있습니다.
5. **실시간 모니터링 확인**
   - `Agents` 패널에서 에이전트 카드의 모니터 아이콘(또는 상단 메뉴 `Agent` → `Monitor Dashboard`)을 클릭하면 실시간 모니터링 탭이 열립니다.
   - VRAM 점유율, KV 캐시 크기, 디코딩 속도(tokens/s)가 실시간 그래프로 시각화됩니다.
6. **자동 평가로 모델 비교하기**
   - 좌측 ActivityBar의 **평가(플라스크)** 아이콘 → [새 평가] → 마법사 4단계(**프로파일 → 평가셋 → 후보 → 검토·생성**)를 진행합니다.
   - 검토·생성 단계에서 가중치·기준값 전체를 보고 "가중치를 확인했습니다"를 체크해야 [실행 생성]이 활성화되며, 완료 팝업에서 [즉시 실행] 또는 [나중에 실행]을 고릅니다.
   - 완료되면 같은 탭이 리포트로 전환되어 최적/빠른 대안/고품질 대안 추천, 순위표·레이더·파레토 차트를 확인합니다.
   - ⚠️ 평가 중에는 모든 채팅 입력·전송이 차단되고(상단 배너 표시), 종료 후 자동 해제됩니다.
   - 자세한 절차·옵션·결과 읽기는 **[Docs/EvaluationGuide.md](./Docs/EvaluationGuide.md)**를 참고하세요.

---

## 🧪 자동 평가 사용법 (Evaluation)

**Fortress 평가**는 같은 평가셋을 같은 조건으로 여러 후보(모델×설정)에 자동 실행해
품질·에이전트·성능·자원·신뢰성을 0~100 공통 척도로 비교하고, 이 PC와 작업에 가장 맞는 후보를 추천합니다.

### 실행 흐름 (마법사 4단계)

1. **프로파일 선택**: 내장 5종(균형 / 코딩 에이전트 / 한국어 문서 작성 / 빠른 응답 / 긴 문서 분석) 중 목적에 맞는 기준을 고릅니다. [복제·편집]으로 커스텀 저장도 가능합니다.
2. **평가셋 선택**: 1개 이상 선택. 내장 20종(**FAB 11종** + **공개셋 9종**: `gsm8k`, `gsm8k-perturb`, `mmlu-pro`, `ifeval`, `ko-ifeval`, `kmmlu`, `kobest`, `humaneval-plus`, `bfcl` 등) + 내 개인 팩. **크기 선택(Quick 약 30분 / Standard 약 1시간 반 / Full 수 시간)**으로 분량을 자동조합하고, 팩별 세부 분량은 고급 설정에서 조절합니다.
3. **후보·평가 모델·옵션**: 비교할 에이전트를 1개 이상 선택(최대 24). 루브릭·작문 계열 팩은 **평가 모델 설정** 필수. 외부 LLM을 평가 모델·후보로 쓰려면 **설정 > 외부 연동**을 먼저 켜야 합니다.
4. **검토 후 생성**: 가중치·기준값 전체를 보고 "가중치를 확인했습니다" 체크 → [실행 생성] → 완료 팝업에서 [즉시 실행] / [나중에 실행]. 자동·예약 실행은 없습니다.

### 결과 읽기

- **추천 3종**(최적 / 빠른 대안 / 고품질 대안) + 사유 문장. 신뢰구간이 겹치면 "구분 불가".
- **순위표 · 차원 레이더 · 파레토 산점도 · 카테고리 히트맵**으로 강점·약점 비교.
- **이전 실행과 비교** (같은 팩 해시 기준, 회귀 ↓ 강조), **샘플 드릴다운**(팩 → 샘플 → 후보별 출력·채점 사유), **사람 직접 채점**(집계 재계산).

### 알아두면 좋은 기능

- **개인 평가셋**: 채팅 말풍선 메뉴(⋯) → "평가 케이스로 저장". 비밀값은 자동 마스킹되어 프로젝트 개인 팩(`personal-<폴더명>`)에 저장됩니다.
- **가져오기**: 팩 관리 뷰의 [팩 가져오기]에서 Inspect JSONL·CSV·promptfoo YAML·HuggingFace를 전역 팩으로 변환.
- **내보내기**: 리포트의 [내보내기]에서 EEE JSON·샘플 JSONL·Trials CSV 저장 (GPQA 원문은 제외).
- **Arena**: 두 후보를 블라인드로 비교 투표 → Bradley-Terry 리더보드.
- **평가 중 잠금**: 채팅·폴더 전환·에이전트 편집이 잠기며, 중단된 실행은 `interrupted` 표시 후 [이어하기] 가능.

> 📖 전체 절차·옵션·문제 해결은 **[Docs/EvaluationGuide.md](./Docs/EvaluationGuide.md)**에 정리되어 있습니다.

---

## ⌨️ 단축키 안내

| 단축키 | 동작 |
| :--- | :--- |
| `Ctrl+N` | 새 대화 세션 시작 |
| `Ctrl+W` | 현재 활성 탭 닫기 |
| `Ctrl+,` | 에이전트 설정 탭 열기 |

---

## 📚 Docs 문서 및 개발 참고 자료 가이드

Fortress의 내부 구조 파악, 커스텀 에이전트 개발, 벤치마크 분석 및 시스템 재구현에 필요한 문서들이 `Docs/` 폴더에 체계적으로 구성되어 있습니다.

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
| **사용자 가이드** | **[UserGuide.md](./Docs/UserGuide.md)**<br>화면 레이아웃 구성, 에이전트 편집, 도구 승인 절차, 시각화 기능 등 사용자를 위한 실전 매뉴얼. | [바로가기](./Docs/UserGuide.md) |
| **자동 평가 사용법** | **[EvaluationGuide.md](./Docs/EvaluationGuide.md)**<br>평가 실행 마법사 4단계, 프로파일·평가셋·후보 설정, 리포트 읽기, 개인 평가셋·가져오기·내보내기·Arena 상세 가이드. | [바로가기](./Docs/EvaluationGuide.md) |
| **Nemotron 64k 벤치마크 분석 보고서** | **[MonitoringAnalysis_Nemotron3.5_64k.md](./Docs/MonitoringAnalysis_Nemotron3.5_64k.md)**<br>RTX 4070 SUPER(12GB) 환경에서 Nemotron-3.5-Lightning(30B MoE, A3B, Mamba-2 하이브리드) 64k 컨텍스트 실측 데이터 및 VRAM/속도 분석 리포트. | [바로가기](./Docs/MonitoringAnalysis_Nemotron3.5_64k.md) |
| **Qwen 64k 벤치마크 분석 보고서** | **[MonitoringAnalysis_Qwen3.5_64k.md](./Docs/MonitoringAnalysis_Qwen3.5_64k.md)**<br>RTX 4070 SUPER(12GB) 환경에서 Qwen3.5 64k 컨텍스트 및 8개 도구/위키 연동 실측 데이터 분석 및 대용량 최적화 리포트. | [바로가기](./Docs/MonitoringAnalysis_Qwen3.5_64k.md) |
| **Qwen 8k 벤치마크 분석 보고서** | **[MonitoringAnalysis_Qwen3.5_8k.md](./Docs/MonitoringAnalysis_Qwen3.5_8k.md)**<br>8k 컨텍스트 환경의 하드웨어 리소스 병목 진단 및 VRAM 예산 산정 가이드. | [바로가기](./Docs/MonitoringAnalysis_Qwen3.5_8k.md) |
| **단계별 구현 계획서** | **[ImplementationPlan.md](./Docs/ImplementationPlan.md)**<br>Phase 0부터 Phase 10까지(i18n·Follow-ups·자동 평가 포함)의 상세 작업 분할 및 단계별 의존성 그래프. | [바로가기](./Docs/ImplementationPlan.md) |
| **진행상황 트래커** | **[TODO.md](./Docs/TODO.md)**<br>전체 작업 항목의 완료 상태 트래커 및 과거 이슈 해결 기록. | [바로가기](./Docs/TODO.md) |
| **품질 검증 체크리스트** | **[QA-Checklist.md](./Docs/QA-Checklist.md)**<br>기능, 성능, 보안, UX 각 영역별 테스트 시나리오 및 품질 검증 기준. | [바로가기](./Docs/QA-Checklist.md) |
| **디자인 시스템** | **[DESIGN.md](./DESIGN.md)**<br>Midnight Rampart 라이트/다크 테마의 색상 토큰, 타이포그래피, 컴포넌트 패턴, 다른 앱으로의 포팅 가이드(`design/` 리소스). | [바로가기](./DESIGN.md) |
| **AI 에이전트 작업 지침** | **[AGENTS.md](./AGENTS.md)**<br>Fortress 리포지토리를 개발하는 AI 코딩 에이전트를 위한 컨벤션, 코딩 규칙, 커밋 수칙. | [바로가기](./AGENTS.md) |

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
