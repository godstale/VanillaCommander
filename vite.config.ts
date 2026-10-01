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
    port: 14200,
    strictPort: true,
    watch: {
      ignored: [
        '**/src-tauri/**',
        '**/.fortress/**',
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
      '**/.fortress/**',
    ],
  },
});
