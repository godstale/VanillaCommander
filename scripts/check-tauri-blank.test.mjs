// scripts/check-tauri-blank.mjs의 회귀 테스트. 실제 리포 파일에 대한 통합 단언이
// `pnpm test`에서 TAURI-BLANK 재발(CSP IPC 누락·devUrl/호스트 엇갈림·폴백 삭제)을 막는다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkTauriBlank } from './check-tauri-blank.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8');

const validInputs = () => ({
  tauriConfText: read('src-tauri/tauri.conf.json'),
  viteConfigText: read('vite.config.ts'),
  indexHtmlText: read('index.html'),
  capabilitiesText: read('src-tauri/capabilities/default.json'),
});

describe('check-tauri-blank', () => {
  it('현재 리포 설정은 검사를 통과한다', () => {
    const { issues } = checkTauriBlank(validInputs());
    expect(issues).toEqual([]);
  });

  it('CSP에서 Tauri IPC 항목이 빠지면 잡는다 (과거 TAURI-BLANK 확정 원인)', () => {
    const inputs = validInputs();
    inputs.tauriConfText = inputs.tauriConfText
      .replaceAll('ipc: ', '')
      .replaceAll('http://ipc.localhost ', '');
    const { issues } = checkTauriBlank(inputs);
    expect(issues.some((i) => i.includes('ipc:'))).toBe(true);
    expect(issues.some((i) => i.includes('http://ipc.localhost'))).toBe(true);
  });

  it('devUrl과 vite 포트/호스트가 엇갈리면 잡는다', () => {
    const inputs = validInputs();
    inputs.tauriConfText = inputs.tauriConfText.replace('127.0.0.1:14200', 'localhost:9999');
    const { issues } = checkTauriBlank(inputs);
    expect(issues.some((i) => i.includes('포트 불일치'))).toBe(true);
    expect(issues.some((i) => i.includes('호스트 불일치'))).toBe(true);
  });

  it('strictPort가 없으면 잡는다', () => {
    const inputs = validInputs();
    inputs.viteConfigText = inputs.viteConfigText.replace('strictPort: true', 'strictPort: false');
    const { issues } = checkTauriBlank(inputs);
    expect(issues.some((i) => i.includes('strictPort'))).toBe(true);
  });

  it('부트 폴백이 삭제되면 잡는다', () => {
    const inputs = validInputs();
    inputs.indexHtmlText = inputs.indexHtmlText.replaceAll('vc-boot-fallback', 'removed');
    const { issues } = checkTauriBlank(inputs);
    expect(issues.some((i) => i.includes('부트 폴백'))).toBe(true);
  });

  it('깨진 tauri.conf.json을 보고한다', () => {
    const { issues } = checkTauriBlank({
      tauriConfText: '{ broken',
      viteConfigText: '',
      indexHtmlText: '',
      capabilitiesText: '{}',
    });
    expect(issues.some((i) => i.includes('JSON 파싱 실패'))).toBe(true);
  });
});
