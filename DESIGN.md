# DESIGN.md — Fortress "Midnight Rampart" 디자인 시스템

> Fortress의 라이트/다크 테마, 색상 토큰, 타이포그래피, 컴포넌트 패턴을 정의하고 **다른 앱으로 그대로 포팅**하는 방법을 담은 문서입니다.
> 디자인 캔버스(워크스페이스·모니터·토큰·브랜드 시안): <https://claude.ai/artifact/CeN5zCXrfbW9FDoajL3KSQ>
> 참고 이미지: 팔레트 `Docs/screenshot/color-palette-01.png`, 다크 테마 톤 `Docs/screenshot/dark-theme-01.png`

---

## 1. 컨셉

**Midnight Rampart(한밤의 성벽)** — Fortress는 화려한 AI 제품이 아니라 *내 PC에 맞는 로컬 LLM을 직접 시험하고 측정하는 작업대*입니다. 그래서 "직접 세운 목책 요새 위의 선명한 계기판"을 콘셉트로 잡았습니다. 브랜드(로고)는 투박하고 기본적으로, UI는 조용한 바탕 위에 수치와 상태만 또렷하게 보이도록 합니다. 라이트는 남색 기운의 밝은 중립, 다크는 **눈부심을 줄인 차콜 중립**입니다.

- **투박한 브랜드, 정직한 계기판.** 로고는 통나무 말뚝과 결속목만으로 된 목책입니다(§9). 장식·그라디언트·광택을 쓰지 않습니다.
- **바탕은 조용하게, 신호는 선명하게.** 표면은 채도 낮은 남색 중립(Neutral) 계열이고, 색은 *의미가 있을 때만* 씁니다.
- **색 = 의미.** 파랑은 액션, 인디고는 도구 호출, 마젠타는 모델의 사고/실행 중, 앰버는 사람의 승인이 필요한 순간(HITL)입니다. 같은 색을 다른 의미로 쓰지 않습니다.
- **다크는 편안하게(v1.1).** 어두운 환경에서 오래 봐도 눈이 덜 피로하도록 다크 테마는 순수 검정·채도 높은 남색 대신 약간 푸른 기운의 차콜(`#18191C`~`#2C2E34`)을 쓰고, 본문은 순백 대신 `#D9DBE1`(대비 11.8:1), 강조색은 채도를 낮춘 파스텔 톤으로 맞췄습니다. 대비는 AA를 넉넉히 넘기되 7:1~12:1 범위에 머물게 해 번쩍임을 피합니다.
- **시인성 우선.** 모든 텍스트 토큰은 각 테마의 `card`·`muted` 표면 위에서 **WCAG AA(4.5:1) 이상**입니다(`node design/build-theme.mjs`가 매번 검증).
- **로컬 퍼스트.** 폰트는 CDN이 아니라 `@fontsource` 패키지로 번들합니다. 오프라인에서도 동일하게 보입니다.

## 2. 리소스 맵

| 경로 | 역할 |
| :--- | :--- |
| `design/tokens.json` | **단일 진실 공급원.** 4개 색상 스케일(11단계), 다크/라이트 시맨틱 토큰(hex), 폰트, 라운드. |
| `design/build-theme.mjs` | `tokens.json` → `design/theme.css` 생성 + 대비율 리포트(AA 미달 시 exit 1). 의존성 없음. |
| `design/theme.css` | 생성물. shadcn/ui 규약의 HSL CSS 변수(`:root` = 다크, `.light` = 라이트). 어떤 앱에도 복사 가능. |
| `design/tailwind.preset.ts` | Tailwind v3 프리셋. 색상 유틸리티(`bg-success`, `text-info`…), 폰트, 라운드. 이 앱의 `tailwind.config.ts`도 이 프리셋을 사용합니다. |
| `design/brand/` | 로고 패밀리 SVG(마크·앱 아이콘·워드마크·README 배너)와 생성기 `build-brand.mjs`. §9 참고. |
| `public/favicon.svg` | 파비콘(간소화 5-말뚝 마크, 차콜 타일). |
| `src/components/brand/FortressMark.tsx` | 앱 내 로고 컴포넌트(`currentColor`, `compact` 옵션). |
| `src/index.css` | 앱 적용본. `design/theme.css`의 변수 블록 + 폰트 import + base 스타일. |
| `src/lib/context/ThemeContext.tsx` | `light` / `dark` / `system` 전환. `<html>`에 `.light` 또는 `.dark` 클래스를 토글. |
| `src/components/workspace/EditorTab.tsx` | CodeMirror 다크/라이트 테마(팔레트 hex). |
| `src/components/chat/MermaidViewer.tsx` | Mermaid `base` 테마 + `themeVariables`(팔레트 hex). |

## 3. 색상

### 3.1 기본 스케일

참고 이미지의 4개 기준색을 유지하고, 50–950 11단계로 확장했습니다.

| 스케일 | 기준(500) | 용도 |
| :--- | :--- | :--- |
| Primary | `#0476FF` | 액션, 포커스, 선택 상태, 링크 |
| Secondary | `#596FD5` | 도구 호출, 보조 정보(`info` 토큰의 원천) |
| Tertiary | `#A958AF` | 모델 사고 과정, 실행 중 상태 |
| Neutral | `#6D759E` | 표면, 테두리, 텍스트 |

> **참고 이미지에서 바꾼 점:** `#0476FF`를 그대로 라이트 버튼에 쓰면 흰 글씨 대비가 4.3:1로 AA에 못 미칩니다. 그래서 라이트 테마의 `primary`는 한 단계 진한 `#0062DB`(5.57:1), 다크 테마는 밝은 `#5B9BFF` 위에 남색 글씨(6.70:1)를 씁니다.

### 3.2 시맨틱 토큰

`--토큰` 이름은 shadcn/ui 규약을 그대로 따르고, Fortress 전용 토큰(★)을 추가했습니다. 대비율은 `card` 표면 기준입니다.

| 토큰 | Dark | Light | 용도 |
| :--- | :--- | :--- | :--- |
| `background` | `#18191C` | `#F4F6FB` | 앱 바탕 |
| `card` | `#1F2024` | `#FFFFFF` | 패널, 카드 |
| `popover` | `#26282D` | `#FFFFFF` | 메뉴, 툴팁, 다이얼로그 |
| `muted` | `#232429` | `#EEF1F8` | 보조 표면, 입력 배경 |
| `secondary` / `accent` | `#2C2E34` | `#E3E7F2` | 중립 버튼 / hover 표면 |
| `border` / `input` | `#34363D` | `#D3D8E8` | 테두리 |
| `foreground` | `#D9DBE1` (11.8) | `#0E1330` (18.2) | 본문 텍스트 |
| `muted-foreground` | `#9DA1AC` (6.30) | `#4A5173` (7.73) | 보조 텍스트, 라벨 |
| ★`subtle-foreground` | `#8C909B` (5.10) | `#5F6689` (5.60) | 메타 정보(시간, 경로). Tailwind: `text-subtle` |
| `primary` | `#6F9EF0` | `#0062DB` | 주요 버튼, 선택, 링크 |
| `ring` | `#7FA8F2` | `#0062DB` | 포커스 링 |
| ★`info` | `#9FA8D6` | `#4357BE` | 도구 호출 배지, 보조 데이터 |
| ★`tertiary` | `#C99BCC` | `#8E4394` | Thinking 블록, 실행 중(RUN) 상태 |
| ★`success` | `#6CC49A` | `#0B7A4B` | 연결됨, 완료, 추가(+) |
| ★`warning` | `#E0B26A` | `#8F5600` | **HITL 승인 요청**, 경고, 임계치 근접 |
| `destructive` | `#E8837A` | `#C4302B` | 오류, 거부, 삭제(−) |
| ★`brand` | `#D4A262` | `#9A6630` | **로고 전용**(목책 통나무색). 텍스트·상태 표시에 쓰지 않음. Tailwind: `text-brand` |
| ★`code` | `#141518` | `#111733` | 코드 블록/로그 배경 — **두 테마 모두 어둡게 유지** |
| `chart-1…5` | primary · tertiary · success · warning · info | 동일 순서 | Recharts 시리즈 |

모든 색 토큰에는 `-foreground` 짝이 있어 채운 배경 위 글자색으로 씁니다(`bg-warning text-warning-foreground`).

### 3.3 사용 규칙

- **원시 팔레트 클래스 금지.** `text-emerald-400`, `bg-zinc-800` 같은 Tailwind 기본 팔레트 대신 시맨틱 토큰만 씁니다. 다크 전용으로 고른 `-400` 색은 라이트 배경에서 대비가 무너지기 때문입니다. 검사:
  ```bash
  grep -rnE "\b(bg|text|border)-(zinc|slate|gray|red|green|emerald|amber|yellow|blue|sky|indigo|violet|purple|pink|rose|orange|teal|cyan)-[0-9]+" src --include=*.tsx
  ```
  (예외: `CodeViewer`의 구문 강조 색, 타이틀바 닫기 버튼의 OS 관례 `hover:bg-red-600`)
- **은은한 강조는 투명도로.** 배경 `bg-{token}/10`, 테두리 `border-{token}/30`, 글자 `text-{token}`. 별도의 "soft" 토큰을 만들지 않습니다.
- **HITL은 항상 warning.** 파일 쓰기/편집 승인 카드는 `border-warning` + `bg-warning/10`, 승인 버튼은 `primary`, 거부는 `destructive` 외곽선.
- **사고 과정은 항상 tertiary**, **도구 호출은 항상 info.** 채팅 흐름에서 "누가 무엇을 하는지"가 색만으로 구분되게 합니다.

## 4. 타이포그래피

| 역할 | 폰트 | 크기 / 굵기 |
| :--- | :--- | :--- |
| UI·본문(라틴) | **Geist Variable** (`@fontsource-variable/geist`) | 본문 14px / 1.6, UI 12–13px |
| UI·본문(한글) | **IBM Plex Sans KR** 400–700 (`@fontsource/ibm-plex-sans-kr`) | Geist에 한글 글리프가 없어 폴백으로 자동 적용 |
| 라벨·코드·수치 | **JetBrains Mono Variable** (`@fontsource-variable/jetbrains-mono`) | 11–13px, 섹션 라벨은 대문자 + `tracking-wider` |
| 헤드라인 | Geist 700 | 26–40px, `tracking-tight` |

- Tailwind: `font-sans`(기본, `body`에 적용), `font-mono`(`code`/`pre`/`kbd`에 자동 적용).
- 수치(토큰 수, tok/s, VRAM)는 `font-mono` 또는 `tabular-nums`로 자릿수를 고정합니다.

## 5. 형태와 컴포넌트 패턴

- **라운드:** `--radius: 0.5rem` → `rounded-lg`(8px) 버튼·입력, `rounded-xl`(12px) 카드, `rounded-full` 상태 점·알약 배지.
- **간격:** 4px 그리드. 패널 내부 12–16px, 카드 내부 12–20px, 카드 사이 12–16px.
- **깊이:** 그림자 대신 **표면 단계**(background → card → popover/muted → accent)와 1px `border`로 층을 구분합니다.
- **터치/클릭 영역:** 아이콘 버튼 최소 32px(주요 액션 36–40px), 아이콘만 있는 버튼엔 `aria-label`.

| 패턴 | 구성 |
| :--- | :--- |
| 상태 알약 | `rounded-full bg-{token}/10 text-{token}` + 7px 점 `bg-{token}` |
| 도구 호출 카드 | `bg-card border` + 도구명 배지 `bg-info/10 text-info font-mono` + 인자 `text-muted-foreground font-mono` + 결과 `text-success` |
| Thinking 블록 | `bg-tertiary/10 text-tertiary`, 접힘 상태 기본 |
| 승인(HITL) 카드 | `border-warning bg-warning/10`, 아이콘 타일 `bg-warning text-warning-foreground`, 버튼: 변경 보기(중립) · 거부(`destructive` 외곽선) · 승인(`primary`) |
| 컨텍스트 게이지 | 채움 `bg-success` → 65% 이상 `bg-warning` → 85% 이상 `bg-destructive` (`ContextGauge.tsx`) |
| 활성 네비(ActivityBar) | `bg-primary/10 text-primary` 타일(왼쪽 막대 표시 없음) |

## 6. 서드파티 컴포넌트 테마

- **Recharts:** 색은 CSS 변수 문자열을 그대로 넘깁니다 — `fill="hsl(var(--chart-1))"`. 툴팁은 `contentStyle={{ backgroundColor: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))', border: '1px solid hsl(var(--border))' }}`. 테마 전환 시 리렌더 없이 즉시 바뀝니다.
- **Mermaid:** hex로 음영을 계산하므로 CSS 변수를 못 읽습니다. `theme: 'base'` + `MERMAID_DARK` / `MERMAID_LIGHT` 상수(`MermaidViewer.tsx`)로 팔레트 hex를 넘깁니다.
- **CodeMirror:** `EditorTab.tsx`의 `dark/lightEditorTheme`, `dark/lightHighlightStyle`. 구문 색은 키워드=tertiary, 문자열=success, 숫자·타입=warning, 함수=primary 계열로 채팅 UI와 같은 의미 체계를 따릅니다.
- **코드 블록(`CodeViewer`):** `bg-code text-code-foreground`로 두 테마 모두 어두운 블록을 유지하고, 그 위의 구문 색은 고정입니다.

## 7. 테마 전환 방식

- `:root`가 **다크 기본값**, `<html class="light">`가 라이트입니다(`index.html`은 라이트로 시작해 FOUC 방지).
- `ThemeContext`가 `light | dark | system`을 `localStorage('fortress-theme')`에 저장하고 `<html>`에 `.light` / `.dark`를 토글합니다. Tailwind `darkMode: ['class']`이므로 `dark:` 변형도 동작합니다.
- 컴포넌트는 가능하면 `dark:` 변형 없이 **토큰만으로** 양쪽 테마를 처리합니다.

## 8. 다른 앱으로 포팅하기

### A. shadcn/ui + Tailwind v3 앱 (가장 빠름)

1. 폰트 설치: `pnpm add @fontsource-variable/geist @fontsource-variable/jetbrains-mono @fontsource/ibm-plex-sans-kr`
2. `design/` 폴더에서 `tokens.json`, `build-theme.mjs`, `theme.css`, `tailwind.preset.ts`를 복사합니다.
3. `tailwind.config.ts`:
   ```ts
   import fortressPreset from './design/tailwind.preset';
   export default { content: ['./index.html', './src/**/*.{ts,tsx}'], presets: [fortressPreset], plugins: [require('tailwindcss-animate')] };
   ```
4. 전역 CSS 맨 위:
   ```css
   @import '@fontsource-variable/geist';
   @import '@fontsource-variable/jetbrains-mono';
   @import '@fontsource/ibm-plex-sans-kr/400.css';
   @import '@fontsource/ibm-plex-sans-kr/500.css';
   @import '@fontsource/ibm-plex-sans-kr/600.css';
   @import '@fontsource/ibm-plex-sans-kr/700.css';
   @import './design/theme.css';   /* 또는 변수 블록을 붙여넣기 */
   @tailwind base; @tailwind components; @tailwind utilities;
   @layer base { body { @apply bg-background text-foreground font-sans antialiased; } code, kbd, pre, samp { @apply font-mono; } }
   ```
5. 테마 전환: `<html>`에 `light` 클래스를 붙이면 라이트, 떼면 다크(`dark` 클래스는 `dark:` 변형용).
6. 기존 코드의 원시 팔레트 클래스를 §3.3 규칙으로 치환합니다(emerald/green→`success`, amber/yellow/orange→`warning`, rose/red→`destructive`, sky/blue→`primary`, cyan/teal/indigo→`info`, purple/violet/pink→`tertiary`, zinc/gray→`muted`·`muted-foreground`·`border`).

### B. Tailwind를 쓰지 않는 앱

`design/theme.css`만 가져오면 됩니다. 값이 HSL 채널(`216.6 100% 67.8%`)이므로 `color: hsl(var(--primary))`, `background: hsl(var(--primary) / 0.1)`처럼 씁니다. hex가 필요하면 `design/tokens.json`을 직접 읽습니다(CSS-in-JS, React Native, Flutter 등).

### C. 색을 바꾸고 싶을 때

1. `design/tokens.json`의 hex를 수정합니다.
2. `node design/build-theme.mjs` — `design/theme.css`가 재생성되고, 대비율이 AA 미만인 쌍이 있으면 ✗ 표시와 함께 실패합니다.
3. 생성된 `:root` / `.light` 블록을 `src/index.css`에 반영합니다.
4. hex를 직접 쓰는 곳(`MermaidViewer.tsx`, `EditorTab.tsx`)도 함께 맞춥니다.

## 9. 브랜드 — 목책 요새(Palisade)

### 9.1 로고

끝을 깎은 통나무 말뚝 7개를 촘촘히 세우고, 결속목 한 줄로 묶고, 가운데 아래에 아치형 성문을 뚫은 모양입니다. 양 끝 말뚝을 가장 높게 두어 망루처럼 보이게 했고, 높이는 일부러 들쭉날쭉하게 해서 손으로 세운 느낌을 냅니다. 말뚝 사이를 0.8u로 좁힌 이유는, 간격이 넓으면 요새가 아니라 정원 울타리처럼 보이기 때문입니다.

| 요소 | 규격(64u 그리드) |
| :--- | :--- |
| 말뚝 | 7개 × 폭 7.4u, 간격 0.8u, 뾰족한 끝(어깨 = 꼭짓점 + 7u), 밑단 y=58 |
| 꼭짓점 높이 | 5 · 12 · 10 · 8 · 10 · 12 · 5 (양 끝이 가장 높음) |
| 결속목 | y=23, 두께 3.5u, 좌우 1.5u씩 돌출 |
| 성문 | 폭 15u 아치(반지름 7.5u), 마스크로 뚫음 |
| 간소화 마크(≤ 24px) | 말뚝 5개 × 폭 10u, 간격 1.6u, 결속목 4.5u |

### 9.2 색

| 이름 | 값 | 용도 |
| :--- | :--- | :--- |
| Timber | `#D4A262` | 다크 배경 위 말뚝(`--brand` 다크, 대비 7.1:1) |
| Timber Deep | `#9A6630` | 라이트 배경 위 말뚝(`--brand` 라이트, 4.5:1) |
| Lashing | `#8C5E34` / `#6B4420` | 2도 인쇄 시 결속목(다크 / 라이트) |
| Charcoal | `#1F2024` | 앱 아이콘 타일 |

브랜드 색은 **로고에만** 씁니다. UI의 경고(`warning`)와 색상이 비슷하므로 텍스트나 상태 표시에 쓰면 의미가 섞입니다.

### 9.3 파일

| 파일 | 용도 |
| :--- | :--- |
| `design/brand/fortress-mark.svg` | 단색 마크(`currentColor`) — 아이콘 폰트·인라인 사용 |
| `design/brand/fortress-mark-small.svg` | 단색 간소화 마크(≤ 24px) |
| `design/brand/fortress-app-icon.svg` | 앱 아이콘 원본(차콜 타일 + 2도 마크). `pnpm tauri icon`의 입력 |
| `design/brand/fortress-app-icon-light.svg` | 라이트 배경용 앱 아이콘 |
| `design/brand/fortress-wordmark-dark.svg` / `-light.svg` | 마크 + "Fortress" 워드마크(어두운/밝은 배경용) |
| `design/brand/fortress-banner.svg` | README·소개용 배너(1280 × 320) |
| `public/favicon.svg` | 브라우저 탭·웹 프리뷰 파비콘 |
| `src-tauri/icons/*` | 데스크탑 앱 아이콘(ico/icns/png), 앱 아이콘 SVG에서 생성 |

### 9.4 수정·재생성

1. 형태나 색을 바꿀 때는 `design/brand/build-brand.mjs`의 `LOGS`·`BRAND` 값을 고칩니다. 앱 내 컴포넌트 `FortressMark.tsx`도 같은 값을 쓰므로 함께 맞춥니다.
2. `node design/brand/build-brand.mjs` — `design/brand/*.svg`와 `public/favicon.svg`를 다시 만듭니다.
3. `pnpm tauri icon design/brand/fortress-app-icon.svg` — 데스크탑 아이콘을 다시 만듭니다. 모바일 타깃을 쓰지 않으므로 생성된 `src-tauri/icons/android`, `ios` 폴더는 지웁니다.

### 9.5 사용 규칙

- 여백은 마크 높이의 1/4 이상 둡니다. 최소 크기는 16px이며, 24px 이하에서는 간소화 마크를 씁니다.
- 앱 안에서는 `<FortressMark className="text-brand" />`처럼 `text-brand`로 칠합니다(메뉴바는 `compact`).
- 말뚝을 둥글게 하거나, 그라디언트·그림자·광택을 넣거나, 성·방패 같은 다른 상징과 합치지 않습니다.
