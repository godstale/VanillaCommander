import './lib/legacyStorageMigration';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// TAURI-BLANK 재발 방지용 부트 워치독. 번들 로드 자체가 막히면(CSP 차단·dev 서버
// 미기동) index.html의 정적 폴백이 그대로 남아 원인을 노출하고, 여기서는 마운트
// 성공 시 폴백을 치운다. 타임아웃에도 폴백만 남았으면(React 미마운트) 숨은 진단
// 문구를 드러내고 콘솔에 기록한다. 순수 DOM API만 사용(인라인 스크립트 불필요).
const BOOT_TIMEOUT_MS = 8000;

function revealBootHint(reason: string): void {
  const fallback = document.getElementById('vc-boot-fallback');
  if (!fallback) return;
  fallback.setAttribute('data-boot-timed-out', 'true');
  const hint = fallback.querySelector('[data-boot-hint]');
  if (hint) hint.removeAttribute('hidden');
  console.error(`[boot] React did not mount within ${BOOT_TIMEOUT_MS}ms (${reason}). ` +
    'Check the dev server (pnpm dev → http://127.0.0.1:14200), reload the Tauri window (Ctrl+R), or run pnpm check:tauri-blank.');
}

const rootEl = document.getElementById('root') as HTMLElement;
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

window.setTimeout(() => {
  const fallback = document.getElementById('vc-boot-fallback');
  if (!fallback) return;
  // React 마운트 시 createRoot가 폴백을 치우므로, 폴백만 남았으면 미마운트다.
  if (rootEl.childElementCount <= 1) {
    revealBootHint('only boot fallback remains');
  } else {
    fallback.remove();
  }
}, BOOT_TIMEOUT_MS);
