import { useSyncExternalStore } from 'react';
import type { ClipboardMode, FileClipboard } from './types';

let clipboard: FileClipboard | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function snapshot(): FileClipboard | null {
  return clipboard;
}

/** 앱 내부 파일 클립보드 (복사/잘라내기, P11-13). 텍스트 클립보드와 별개다. */
export function setFileClipboard(mode: ClipboardMode, paths: string[]): void {
  clipboard = paths.length > 0 ? { mode, paths: [...paths] } : null;
  emit();
}

export function clearFileClipboard(): void {
  clipboard = null;
  emit();
}

export function getFileClipboard(): FileClipboard | null {
  return clipboard;
}

export function useFileClipboard(): FileClipboard | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
