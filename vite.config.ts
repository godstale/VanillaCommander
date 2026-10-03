import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  server: {
    // TAURI-BLANK 재발 방지: dev 서버 바인드 호스트를 127.0.0.1로 고정한다.
    // 'localhost'는 Windows에서 ::1(IPv6)로 해석될 수 있어 Vite 리스너와
    // Tauri WebView의 해석이 엇갈리면 앱 창만 흰 화면이 된다.
    // devUrl·HMR 호스트는 반드시 이 값과 일치시킬 것 (scripts/check-tauri-blank.mjs가 감시).
    host: '127.0.0.1',
    port: 14200,
    strictPort: true,
    hmr: {
      protocol: 'ws',
      host: '127.0.0.1',
      port: 14201,
    },
    watch: {
      ignored: [
        '**/src-tauri/**',
        '**/.vanilla-commander/**',
        '**/*.db',
        '**/*.db-*',
        '**/*.sqlite*',
        '**/logs/**',
      ],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    passWithNoTests: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/src-tauri/**',
      '**/.vanilla-commander/**',
    ],
  },
});
