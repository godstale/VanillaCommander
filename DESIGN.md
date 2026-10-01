# DESIGN.md — "Vanilla" 디자인 시스템

> VanillaCommander의 라이트/다크 테마, 색상 토큰, 타이포그래피, 컴포넌트 패턴을 정의한 문서입니다.
> 원본은 Vanilla 템플릿(`godstale/TauriTemplate`)의 디자인 시스템이며, 시각 미리보기(`#/design` 디자인 둘러보기)는
> 템플릿 쪽에 있습니다. Claude 디자인 아티팩트 "Vanilla Design System"도 참고하세요.

---

## 1. 컨셉

**Vanilla** — AI Agent 중심의 순수한(pure) 앱을 위한 디자인 시스템입니다. 앞으로 만드는 프로젝트는
이름 앞에 "바닐라(Vanilla)"를 붙이고, 이 시스템으로 색·아이콘·컴포넌트·이미지를 통일합니다.

- **무채색 바탕 위의 흰 카드.** 표면은 R=G=B 무채색입니다. 라이트는 회색(`#F4F4F4`) 바탕에 흰 카드, 다크는 거의 검정(`#0A0A0A`) 바탕에 한 단계 밝은 카드.
- **강조색은 테마당 하나.** 라이트 = **녹색**, 다크 = **주황**. 강조색은 주요 액션·포커스·활성 네비·진행률에만 씁니다.
- **RGB 계열은 의미가 있을 때만.** 파랑(정보), 빨강(오류), 황색(확인 필요), 녹색(성공). 장식용으로 쓰지 않습니다.
- **알약과 우물.** 버튼은 완전한 알약형, 카드는 20px 라운드, 입력 12px. 깊이는 표면 단계와 1px 테두리로 만들고 그림자는 라이트의 떠 있는 카드에만 아주 얇게.
- **일러스트는 손그림 바닐라 난초.** 아이콘·배너·패턴은 `design/brand/`의 한 원본 계열에서 나옵니다(분홍 바탕 `#D9B9AE`, 크림 꽃잎 `#FBE7A1`, 꼬투리 갈색 `#5A1F1A`, 중심 `#F2A33A`).
- **시인성 우선.** 모든 텍스트 토큰은 `card`·`muted` 표면 위에서 **WCAG AA(4.5:1) 이상**입니다(`node design/build-theme.mjs`가 매번 검증).
- **로컬 퍼스트.** 폰트는 CDN이 아니라 `@fontsource` 패키지로 번들합니다.

## 2. 리소스 맵

| 경로                                     | 역할                                                                                                     |
| :--------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| `design/tokens.json`                     | **단일 진실 공급원.** 스케일(neutral/green/orange/blue/red), 다크/라이트 시맨틱 토큰(hex), 폰트, 라운드. |
| `design/build-theme.mjs`                 | `tokens.json` → `design/theme.css` 생성 + 대비율 리포트(AA 미달 시 exit 1). 의존성 없음.                 |
| `design/theme.css`                       | 생성물. shadcn/ui 규약의 HSL CSS 변수(`:root, .dark` = 다크, `.light` = 라이트).                         |
| `design/tailwind.preset.ts`              | Tailwind v3 프리셋. 색상 유틸리티, 폰트, 라운드(`rounded-card` = 20px).                                  |
| `design/brand/`                          | 앱 아이콘(cream/dark/light PNG), 로고 그림, 배너·패턴 SVG. §9 참고.                                      |
| `public/favicon.png`                     | 파비콘.                                                                                                  |
| `src-tauri/icons/*`                      | `pnpm tauri icon design/brand/app-icon.png`로 생성한 전 플랫폼 아이콘(ico/icns/png/Android/iOS).         |
| `src/components/brand/AppMark.tsx`       | 앱 내 로고(`vanilla-art.png`, `compact` 옵션).                                                           |
| `src/components/ui/*`                    | Button·Input·Textarea·Badge·Card/Well·Switch·Progress·SegmentedTabs·Table 등 컴포넌트.                   |
| `src/index.css`                          | 앱 적용본. `design/theme.css`의 변수 블록 + 폰트 import + base 스타일.                                   |
| `src/lib/context/ThemeContext.tsx`       | `light` / `dark` / `system` 전환. `<html>`에 `.light` 또는 `.dark` 클래스를 토글.                        |
| `src/components/workspace/EditorTab.tsx` | CodeMirror 다크/라이트 테마(팔레트 hex).                                                                 |
| `src/components/chat/MermaidViewer.tsx`  | Mermaid `base` 테마 + `themeVariables`(팔레트 hex).                                                      |

## 3. 색상

### 3.1 시맨틱 토큰

`--토큰` 이름은 shadcn/ui 규약을 따르고, 앱 전용 토큰(★)을 추가했습니다.

| 토큰                   | Dark                                          | Light                                        | 용도                                             |
| :--------------------- | :-------------------------------------------- | :------------------------------------------- | :----------------------------------------------- |
| `background`           | `#0A0A0A`                                     | `#F4F4F4`                                    | 앱 바탕                                          |
| `card`                 | `#151515`                                     | `#FFFFFF`                                    | 패널, 카드                                       |
| `popover`              | `#1C1C1C`                                     | `#FFFFFF`                                    | 메뉴, 툴팁, 다이얼로그                           |
| `muted`                | `#1A1A1A`                                     | `#EFEFEF`                                    | 입력 배경, 우물형 표면                           |
| `secondary` / `accent` | `#262626`                                     | `#EBEBEB` / `#E6E6E6`                        | 중립 버튼 / hover 표면                           |
| `border` / `input`     | `#2A2A2A` / `#333333`                         | `#E0E0E0` / `#D6D6D6`                        | 테두리                                           |
| `foreground`           | `#EDEDED`                                     | `#111111`                                    | 본문 텍스트                                      |
| `muted-foreground`     | `#A3A3A3`                                     | `#595959`                                    | 보조 텍스트, 라벨                                |
| ★`subtle-foreground`   | `#8F8F8F`                                     | `#6B6B6B`                                    | 메타 정보. Tailwind: `text-subtle`               |
| `primary` / `ring`     | `#F59A4A`                                     | `#187444`                                    | **강조색** — 주황(다크) / 녹색(라이트)           |
| ★`info`                | `#7FA6FF`                                     | `#2459C9`                                    | 정보                                             |
| ★`success`             | `#5BC98A`                                     | `#0F7A3E`                                    | 연결됨, 완료, 추가(+)                            |
| ★`warning`             | `#E8B04A`                                     | `#9A5B00`                                    | 사람의 확인이 필요한 순간                        |
| `destructive`          | `#F0766C`                                     | `#C4372C`                                    | 오류, 삭제(−)                                    |
| ★`tertiary`            | `#CFCFCF`                                     | `#3D3D3D`                                    | 진행 중 상태(중립 잉크)                          |
| ★`brand`               | `#F4EEE3`                                     | `#5A1F1A`                                    | **선화 로고 전용**. 텍스트·상태 표시에 쓰지 않음 |
| ★`code`                | `#0F0F0F`                                     | `#151515`                                    | 코드 블록 배경 — 두 테마 모두 어둡게 유지        |
| `chart-1…5`            | primary · info · success · destructive · gray | primary · info · orange · destructive · gray | 차트 시리즈                                      |

모든 색 토큰에는 `-foreground` 짝이 있어 채운 배경 위 글자색으로 씁니다(`bg-warning text-warning-foreground`).

**워크스페이스 레이어 토큰(★).** 메인 워크스페이스 셸은 창의 상단·좌측에 가까운 영역일수록 배경이 짙습니다.
글자색은 `foreground`/`muted-foreground`를 그대로 쓰고, 이 표면 위 hover는 `hover:bg-foreground/[0.08]`을 씁니다.
설정 화면은 이 규칙 대상이 아니며 `sidebar`(라이트=흰색) + `background`를 유지합니다.

| 토큰          | Dark      | Light     | 영역                                         |
| :------------ | :-------- | :-------- | :------------------------------------------- |
| `titlebar`    | `#050505` | `#E8E8E8` | 상단 메뉴바(`TopMenuBar`)                    |
| `activitybar` | `#080808` | `#EDEDED` | 좌측 아이콘 바(`ActivityBar`)                |
| `panel`       | `#0C0C0C` | `#F2F2F2` | 사이드 패널(탐색기·채팅 세션·에이전트 등)    |
| `tabbar`      | `#101010` | `#F8F8F8` | 탭 스트립, 탭 내부 툴바·상태바               |
| `editor`      | `#141414` | `#FFFFFF` | 탭 본문(에디터·뷰어·환영 화면), 활성 탭      |

### 3.2 사용 규칙

- **원시 팔레트 클래스 금지.** `bg-zinc-800` 같은 Tailwind 기본 팔레트 대신 시맨틱 토큰만 씁니다.
  (예외: `CodeViewer`의 구문 강조 색, 타이틀바 닫기 버튼의 OS 관례 `hover:bg-red-600`)
- **은은한 강조는 투명도로.** 배경 `bg-{token}/10`, 테두리 `border-{token}/30`, 글자 `text-{token}`.
- **한 화면에 강조색 영역은 하나.** 가장 중요한 CTA는 `Button variant="ink"`(라이트=검정, 다크=흰색 알약)로 레퍼런스의 절제된 룩을 유지해도 됩니다.
- **의미 고정.** 확인 필요 = warning, 진행 중 = tertiary/primary, 보조 정보 = info.

## 4. 타이포그래피

| 역할           | 폰트                                                                | 크기 / 굵기                                   |
| :------------- | :------------------------------------------------------------------ | :-------------------------------------------- |
| UI·본문(라틴)  | **Geist Variable** (`@fontsource-variable/geist`)                   | 본문 14px / 1.6, UI 12–13px                   |
| UI·본문(한글)  | **IBM Plex Sans KR** 400–700 (`@fontsource/ibm-plex-sans-kr`)       | Geist에 한글 글리프가 없어 폴백으로 자동 적용 |
| 라벨·코드·수치 | **JetBrains Mono Variable** (`@fontsource-variable/jetbrains-mono`) | 11–13px, 라벨은 대문자 + `tracking-wider`     |

| 스타일  | 크기 / 행간 / 굵기 / 자간        |
| :------ | :------------------------------- |
| Display | 72 / 1.02 / 600 / −3.5%          |
| H1      | 48 / 1.08 / 600 / −3%            |
| H2      | 32 / 1.15 / 600 / −2.5%          |
| H3      | 22 / 1.25 / 600 / −1.5%          |
| H4      | 16 / 1.35 / 600                  |
| Lead    | 18 / 1.55 / 400 / muted          |
| Body    | 14 / 1.6 / 400                   |
| Small   | 12 / 1.5 / muted                 |
| Label   | 11 / 500 / +8% / 대문자 / subtle |

## 5. 형태와 컴포넌트 패턴

- **라운드:** `--radius: 0.75rem`. 버튼·배지·세그먼트 `rounded-full`, 입력 `rounded-xl`(12px), 카드·우물 `rounded-card`(20px).
- **간격:** 4px 그리드. 카드 내부 20–24px, 카드 사이 12–16px.
- **깊이:** 표면 단계(background → card → muted/popover)와 1px `border`. `Card`는 `shadow-sm` 한 단계만.
- **터치/클릭 영역:** 아이콘 버튼 최소 32px(주요 액션 40px), 아이콘만 있는 버튼엔 `aria-label`.

| 패턴        | 구성                                                                           |
| :---------- | :----------------------------------------------------------------------------- |
| 상태 배지   | `Badge variant="success" dot` = `rounded-full bg-{token}/10 text-{token}` + 점 |
| 카드 / 우물 | `Card`(흰 표면 + 테두리) 위에 `Well`(muted 표면)로 층을 나눔                   |
| 활성 네비   | `bg-primary/10 text-primary` 항목                                              |
| 플로팅 네비 | 알약형 컨테이너(`rounded-full border bg-card shadow-sm`) 안에 링크들           |
| 세그먼트    | `SegmentedTabs`: muted 알약 트랙 + 선택 항목은 `bg-card`                       |

## 6. 서드파티 컴포넌트 테마

- **CodeMirror:** `EditorTab.tsx`의 다크/라이트 테마. 다크는 주황 계열 강조, 라이트는 녹색 계열 강조.
- **코드 블록(`CodeViewer`):** `bg-code text-code-foreground`로 두 테마 모두 어두운 블록을 유지합니다.
- **Mermaid:** `MermaidViewer.tsx`의 `MERMAID_DARK`/`MERMAID_LIGHT`(Mermaid는 CSS 변수를 못 읽어 hex로 미러링).
- **Recharts:** 시리즈 색은 `hsl(var(--chart-1…5))`, 경고성 시리즈는 `hsl(var(--warning))`을 그대로 넘깁니다.

## 7. 테마 전환 방식

- `:root`(= `.dark`)가 **다크 기본값**, `<html class="light">`가 라이트입니다(`index.html`은 라이트로 시작해 FOUC 방지).
- `.dark` / `.light` 클래스를 중첩 요소에 달면 그 영역만 해당 테마로 보입니다.
- `ThemeContext`가 `light | dark | system`을 `localStorage('fortress-theme')`에 저장하고 `<html>`에 클래스를 토글합니다.
- 컴포넌트는 가능하면 `dark:` 변형 없이 **토큰만으로** 양쪽 테마를 처리합니다(입력 필드의 다크 전용 배경 정도만 예외).

## 8. 색을 바꾸고 싶을 때

1. `design/tokens.json`의 hex를 수정합니다.
2. `node design/build-theme.mjs` — `design/theme.css`가 재생성되고, 대비율이 AA 미만인 쌍이 있으면 ✗ 표시와 함께 실패합니다.
3. 생성된 `:root, .dark` / `.light` 블록을 `src/index.css`에 반영합니다.
4. hex를 직접 쓰는 곳(`EditorTab.tsx`, `MermaidViewer.tsx`)도 함께 맞춥니다.

## 9. 브랜드 파일

| 파일                              | 용도                                                |
| :-------------------------------- | :-------------------------------------------------- |
| `design/brand/app-icon.png`       | 앱 아이콘 원본(크림 타일). `pnpm tauri icon`의 입력 |
| `design/brand/app-icon-dark.png`  | 다크 변형(그래파이트 타일)                          |
| `design/brand/app-icon-light.png` | 라이트 변형(흰 타일 + 연회색 테두리)                |
| `design/brand/vanilla-art.png`    | 투명 배경 로고 그림(`AppMark`, 512×512)             |
| `design/brand/app-banner.jpg`     | README·소개용 배너(1280 × 320 @2x, 사진 저작자 표기) |
| `design/brand/app-pattern.svg`    | 빈 화면·스플래시용 패턴(512 × 512, 이음매 없음)     |
| `public/favicon.png`              | 브라우저 탭·웹 프리뷰 파비콘                        |
| `src-tauri/icons/*`               | 데스크탑·모바일 앱 아이콘(앱 아이콘 PNG에서 생성)   |
