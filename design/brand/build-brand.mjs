#!/usr/bin/env node
// Generates the Fortress palisade logo family (design/brand/*.svg, public/favicon.svg).
// The mark is five hand-cut log stakes of uneven height lashed by two rails — a plain
// wooden stockade, deliberately rough rather than a polished castle.
// Usage: node design/brand/build-brand.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

export const BRAND = {
  timber: '#D4A262', // stakes on dark
  timberDeep: '#9A6630', // stakes on light (4.5:1 on #F4F6FB)
  lashing: '#8C5E34', // rails over light stakes
  lashingLight: '#6B4420',
  charcoal: '#1F2024',
  charcoalDeep: '#18191C',
  paper: '#F4F6FB',
  ink: '#D9DBE1',
  inkLight: '#0E1330',
  muted: '#9DA1AC',
};

// 64-unit grid. Logs stand shoulder to shoulder (0.8 gaps) so the wall reads as a stockade,
// not a garden fence; the tall end logs act as watch posts and an arched gate is cut at the foot.
const LOGS = { w: 7.4, gap: 0.8, x0: 3.7, apex: [5, 12, 10, 8, 10, 12, 5], rails: [[23, 3.5]] };
const SMALL_LOGS = { w: 10, gap: 1.6, x0: 3.2, apex: [5, 12, 9, 12, 5], rails: [[23, 4.5]] }; // for ≤ 24 px
const GATE = 'M24.5 58V46.5a7.5 7.5 0 0 1 15 0V58Z';
const FOOT = 58;

let maskSeq = 0;
export function markPaths({ logs = LOGS, stakeFill = 'currentColor', railFill = 'currentColor', id } = {}) {
  const maskId = id || `fortress-gate-${++maskSeq}`;
  const { w, gap, x0, apex, rails } = logs;
  const shoulder = w * 0.95;
  const stakes = apex
    .map((t, i) => {
      const x = +(x0 + i * (w + gap)).toFixed(2);
      return `<polygon points="${x},${t + shoulder} ${+(x + w / 2).toFixed(2)},${t} ${+(x + w).toFixed(2)},${t + shoulder} ${+(x + w).toFixed(2)},${FOOT} ${x},${FOOT}" fill="${stakeFill}"/>`;
    })
    .join('');
  const railSvg = rails.map(([y, h]) => `<rect x="1.5" y="${y}" width="61" height="${h}" rx="1.2" fill="${railFill}"/>`).join('');
  return `<mask id="${maskId}"><rect width="64" height="64" fill="#fff"/><path d="${GATE}" fill="#000"/></mask><g mask="url(#${maskId})">${stakes}${railSvg}</g>`;
}

const svg = (w, h, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;

const tile = (bg, stakeFill, railFill, { small = false } = {}) =>
  `<rect width="64" height="64" rx="14" fill="${bg}"/>` +
  `<g transform="translate(9.6 9.6) scale(0.7)">${markPaths({ logs: small ? SMALL_LOGS : LOGS, stakeFill, railFill })}</g>`;

const FONT = "Geist, 'Segoe UI', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
const MONO = "'JetBrains Mono', Consolas, monospace";

const wordmark = (stakeFill, railFill, ink) =>
  `<g transform="translate(0 4) scale(0.875)">${markPaths({ stakeFill, railFill })}</g>` +
  `<text x="70" y="47" font-family="${FONT}" font-size="40" font-weight="700" letter-spacing="-0.5" fill="${ink}">Fortress</text>`;

function banner() {
  const W = 1280;
  const H = 320;
  let fence = '';
  // Background stockade along the bottom edge: deterministic "hand-cut" heights.
  for (let i = 0, x = -6; x < W; i++, x += 30) {
    const apex = 214 + ((i * 37) % 23) - (i % 5 === 2 ? 14 : 0);
    fence += `<polygon points="${x},${apex + 16} ${x + 12},${apex} ${x + 24},${apex + 16} ${x + 24},${H} ${x},${H}" fill="#26282D"/>`;
  }
  fence += `<rect x="0" y="262" width="${W}" height="7" fill="#1F2024"/><rect x="0" y="292" width="${W}" height="7" fill="#1F2024"/>`;
  const chips = ['Ollama', 'GPU · VRAM 모니터', 'tok/s 벤치마크', '컨텍스트 스트레스 테스트'];
  let cx = 96;
  const chipSvg = chips
    .map((c) => {
      const w = 22 + [...c].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x3000 ? 15 : 8.6), 0);
      const out = `<rect x="${cx}" y="176" width="${w}" height="30" rx="15" fill="#26282D" stroke="#34363D"/><text x="${cx + 11}" y="196" font-family="${MONO}" font-size="14" fill="#9DA1AC">${c}</text>`;
      cx += w + 10;
      return out;
    })
    .join('');
  return (
    `<rect width="${W}" height="${H}" fill="${BRAND.charcoalDeep}"/>${fence}` +
    `<g transform="translate(96 48) scale(1.25)">${tile(BRAND.charcoal, BRAND.timber, BRAND.lashing)}</g>` +
    `<text x="200" y="104" font-family="${FONT}" font-size="60" font-weight="700" letter-spacing="-1" fill="${BRAND.ink}">Fortress</text>` +
    `<text x="202" y="140" font-family="${FONT}" font-size="22" fill="${BRAND.muted}">내 PC에 맞는 로컬 LLM을 찾는 테스트 &amp; 모니터링 워크벤치</text>` +
    chipSvg
  );
}

const out = {
  'design/brand/fortress-mark.svg': svg(64, 64, markPaths(), 'Fortress'),
  'design/brand/fortress-mark-small.svg': svg(64, 64, markPaths({ logs: SMALL_LOGS }), 'Fortress'),
  'design/brand/fortress-app-icon.svg': svg(64, 64, tile(BRAND.charcoal, BRAND.timber, BRAND.lashing), 'Fortress'),
  'design/brand/fortress-app-icon-light.svg': svg(64, 64, tile('#FFFFFF', BRAND.timberDeep, BRAND.lashingLight), 'Fortress'),
  'design/brand/fortress-wordmark-dark.svg': svg(250, 64, wordmark(BRAND.timber, BRAND.lashing, BRAND.ink), 'Fortress'),
  'design/brand/fortress-wordmark-light.svg': svg(250, 64, wordmark(BRAND.timberDeep, BRAND.lashingLight, BRAND.inkLight), 'Fortress'),
  'design/brand/fortress-banner.svg': svg(1280, 320, banner(), 'Fortress — 로컬 LLM 테스트 & 모니터링 워크벤치'),
  'public/favicon.svg': svg(64, 64, tile(BRAND.charcoal, BRAND.timber, BRAND.lashing, { small: true }), 'Fortress'),
};
for (const [path, content] of Object.entries(out)) writeFileSync(join(root, path), content);
console.log(`wrote ${Object.keys(out).length} files`);
