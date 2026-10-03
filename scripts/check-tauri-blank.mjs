// TAURI-BLANK 재발 방지 가드.
// `pnpm tauri dev`에서 브라우저(localhost:14200... 아니, 127.0.0.1:14200)는 정상인데
// Tauri 창만 흰 화면이 되는 고질 문제의 원인 후보(devUrl/호스트/CSP/부트 폴백)를
// 한 번에 점검한다. `pnpm check:tauri-blank`로 실행, vitest에서도 같은 검사를 수행한다.
// (scripts/*.test.mjs는 vitest 기본 include에 잡히고, eslint는 scripts를 무시한다.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const DEV_HOST = '127.0.0.1';
export const DEV_PORT = 14200;
export const HMR_PORT = 14201;
export const OLLAMA_HOSTS = ['http://127.0.0.1:11434', 'http://localhost:11434'];

// vite.config.ts는 TS라 import하지 않고 텍스트로 파싱한다.
function parseViteServer(text) {
  const pick = (re) => {
    const m = text.match(re);
    return m ? m[1] : null;
  };
  return {
    host: pick(/host\s*:\s*['"]([^'"]+)['"]/),
    port: pick(/port\s*:\s*(\d+)/),
    strictPort: /strictPort\s*:\s*true/.test(text),
    hmrHost: pick(/hmr\s*:\s*\{[^}]*host\s*:\s*['"]([^'"]+)['"]/),
    hmrPort: pick(/hmr\s*:\s*\{[^}]*port\s*:\s*(\d+)/),
  };
}

function parseCspDirectives(csp) {
  const map = new Map();
  for (const part of String(csp).split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    map.set(tokens[0], tokens.slice(1));
  }
  return map;
}

/**
 * @param {{ tauriConfText: string, viteConfigText: string, indexHtmlText: string, capabilitiesText: string }} inputs
 * @returns {{ issues: string[], devUrl: string | null }}
 */
export function checkTauriBlank(inputs) {
  const issues = [];
  let devUrl = null;

  let conf = null;
  try {
    conf = JSON.parse(inputs.tauriConfText);
  } catch {
    return { issues: ['src-tauri/tauri.conf.json: JSON 파싱 실패'], devUrl };
  }

  const build = conf.build ?? {};
  devUrl = typeof build.devUrl === 'string' ? build.devUrl : null;
  if (build.frontendDist !== '../dist') {
    issues.push(`build.frontendDist가 '../dist'가 아님 (현재: ${JSON.stringify(build.frontendDist)})`);
  }
  if (build.beforeDevCommand !== 'pnpm dev') {
    issues.push(`build.beforeDevCommand가 'pnpm dev'가 아님 (현재: ${JSON.stringify(build.beforeDevCommand)})`);
  }

  let devHost = null;
  let devPort = null;
  if (!devUrl) {
    issues.push('build.devUrl이 없음 — tauri dev가 빌드 산출물을 열어 흰 화면이 된다');
  } else {
    try {
      const u = new URL(devUrl);
      devHost = u.hostname;
      devPort = u.port;
    } catch {
      issues.push(`build.devUrl 파싱 실패 (${devUrl})`);
    }
  }

  const server = parseViteServer(inputs.viteConfigText);
  if (!server.port) {
    issues.push('vite.config.ts: server.port를 찾지 못함');
  } else if (devPort && server.port !== devPort) {
    issues.push(`포트 불일치: vite server.port=${server.port} vs devUrl 포트=${devPort} — Tauri 창이 빈 dev 서버를 연다`);
  }
  if (!server.strictPort) {
    issues.push('vite.config.ts: strictPort: true가 없음 — 포트 충돌 시 다른 포트로 떠서 Tauri 창만 흰 화면이 된다');
  }
  if (server.host && devHost && server.host !== devHost) {
    issues.push(`호스트 불일치: vite server.host=${server.host} vs devUrl 호스트=${devHost} — Windows IPv6(::1) 해석 엇갈림의 고질 원인이 된다`);
  }
  if (server.hmrHost && devHost && server.hmrHost !== devHost) {
    issues.push(`HMR 호스트 불일치: hmr.host=${server.hmrHost} vs devUrl 호스트=${devHost}`);
  }

  const csp = conf?.app?.security?.csp;
  if (csp == null || csp === false) {
    issues.push('app.security.csp가 비어 있음 — prod에서 IPC/Ollama 호출이 막힐 수 있다');
  } else if (typeof csp !== 'string') {
    issues.push('app.security.csp가 문자열이 아님');
  } else {
    const dirs = parseCspDirectives(csp);
    const need = (dir, token, why) => {
      const values = dirs.get(dir) ?? dirs.get('default-src') ?? [];
      if (!values.includes(token)) {
        issues.push(`CSP ${dir}에 '${token}' 누락 — ${why}`);
      }
    };
    // 과거 TAURI-BLANK의 확정 원인: IPC 항목 누락 (Docs/Architecture.md §5.8)
    need('connect-src', 'ipc:', 'Tauri IPC 호출이 차단되어 빈 화면이 된다');
    need('connect-src', 'http://ipc.localhost', 'Tauri IPC 호출이 차단되어 빈 화면이 된다');
    for (const h of OLLAMA_HOSTS) need('connect-src', h, 'Ollama 직접 호출이 차단된다');
    // dev 서버 모듈/HMR 허용 (브라우저는 되는데 Tauri 창만 흰 화면의 또 다른 확정 원인)
    for (const h of [`http://${DEV_HOST}:${DEV_PORT}`, 'http://localhost:14200']) {
      need('script-src', h, 'Vite dev 스크립트가 차단되어 흰 화면이 된다');
      need('connect-src', h, 'Vite dev 모듈 요청이 차단된다');
    }
    for (const h of [`ws://${DEV_HOST}:${DEV_PORT}`, 'ws://localhost:14200', `ws://${DEV_HOST}:${HMR_PORT}`, 'ws://localhost:14201']) {
      need('connect-src', h, 'Vite HMR 소켓이 차단되어 갱신/재연결이 실패한다');
    }
    if (!dirs.has('script-src')) {
      issues.push("CSP에 script-src가 없음 — default-src 'self'로 폴백되어 Vite dev 인라인 프리앰블이 차단될 수 있다");
    }
    if (!dirs.has('worker-src')) {
      issues.push('CSP에 worker-src가 없음 — pdfjs/mermaid 등 blob 워커가 차단될 수 있다');
    }
  }

  // capability 창 라벨과 실제 창 라벨의 대응 (어긋나면 IPC 권한이 안 붙는다)
  try {
    const caps = JSON.parse(inputs.capabilitiesText);
    const windows = caps.windows ?? [];
    const label = conf?.app?.windows?.[0]?.label ?? 'main';
    if (!windows.includes(label) && !windows.includes('*')) {
      issues.push(`capabilities windows(${JSON.stringify(windows)})에 실제 창 라벨 '${label}'이 없음 — IPC 권한 미적용 가능`);
    }
  } catch {
    issues.push('capabilities/default.json: JSON 파싱 실패');
  }

  if (!inputs.indexHtmlText.includes('vc-boot-fallback')) {
    issues.push('index.html에 #vc-boot-fallback 부트 폴백이 없음 — 흰 화면 시 진단 문구가 안 나온다');
  }
  if (!inputs.indexHtmlText.includes('/src/main.tsx')) {
    issues.push('index.html에 /src/main.tsx 진입 스크립트가 없음');
  }

  return { issues, devUrl };
}

function loadInputs(repoRoot) {
  const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8');
  return {
    tauriConfText: read('src-tauri/tauri.conf.json'),
    viteConfigText: read('vite.config.ts'),
    indexHtmlText: read('index.html'),
    capabilitiesText: read('src-tauri/capabilities/default.json'),
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const selfPath = fileURLToPath(import.meta.url);
if (invokedPath === selfPath) {
  const repoRoot = path.resolve(path.dirname(selfPath), '..');
  const { issues, devUrl } = checkTauriBlank(loadInputs(repoRoot));
  console.log(`[check:tauri-blank] devUrl=${devUrl ?? '(없음)'}`);
  if (issues.length === 0) {
    console.log('[check:tauri-blank] OK — devUrl/호스트/CSP/부트 폴백 모두 정상');
  } else {
    console.error(`[check:tauri-blank] ${issues.length}건 문제 발견:`);
    for (const issue of issues) console.error(` - ${issue}`);
    process.exitCode = 1;
  }
}
