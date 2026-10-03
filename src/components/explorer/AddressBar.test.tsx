import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import { SettingsProvider } from '@/lib/context/SettingsContext';
import { AddressBar } from './AddressBar';

const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    return Promise.resolve();
  },
}));

function renderBar(path: string, onNavigate: (p: string) => void, editSignal?: number) {
  return render(
    <SettingsProvider>
      <AddressBar path={path} onNavigate={onNavigate} editSignal={editSignal} />
    </SettingsProvider>,
  );
}

describe('AddressBar', () => {
  beforeEach(() => {
    calls.length = 0;
    setDatabase(new MemorySqlFallback());
    window.localStorage.clear();
  });

  it('builds valid Windows targets without mixed separators', () => {
    const seen: string[] = [];
    renderBar('C:\\Workspace\\___Working\\___test', (p) => seen.push(p));
    // "___Working" 브레드크럼 클릭 → 현재 탭에서 C:\Workspace\___Working 으로 이동해야 한다.
    fireEvent.click(screen.getByRole('button', { name: '___Working' }));
    expect(seen).toEqual(['C:\\Workspace\\___Working']);
  });

  it('strips the verbatim prefix instead of producing ?/C:/...', () => {
    const seen: string[] = [];
    const verbatim = '\\\\?\\C:\\Workspace\\___Working\\___test';
    renderBar(verbatim, (p) => seen.push(p));
    fireEvent.click(screen.getByRole('button', { name: '___Working' }));
    expect(seen).toEqual(['C:\\Workspace\\___Working']);
    expect(seen[0]).not.toContain('?');
  });

  it('keeps forward-slash style for posix-like drive paths', () => {
    const seen: string[] = [];
    renderBar('C:/work/docs', (p) => seen.push(p));
    fireEvent.click(screen.getByRole('button', { name: 'work' }));
    expect(seen).toEqual(['C:/work']);
  });

  it('does not navigate when the last segment is clicked', () => {
    const onNavigate = vi.fn();
    renderBar('C:\\Workspace\\___Working', onNavigate);
    fireEvent.click(screen.getByRole('button', { name: '___Working' }));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('enters edit mode when editSignal changes (Alt+D)', () => {
    const { rerender } = renderBar('C:/work/docs', vi.fn(), 0);
    expect(screen.queryByPlaceholderText('경로 입력...')).not.toBeInTheDocument();
    rerender(
      <SettingsProvider>
        <AddressBar path="C:/work/docs" onNavigate={vi.fn()} editSignal={1} />
      </SettingsProvider>,
    );
    const input = screen.getByPlaceholderText('경로 입력...') as HTMLInputElement;
    expect(input.value).toBe('C:/work/docs');
  });

  it('does not enter edit mode on mount under StrictMode (P13-06)', () => {
    render(
      <React.StrictMode>
        <SettingsProvider>
          <AddressBar path="C:/work/docs" onNavigate={vi.fn()} editSignal={0} />
        </SettingsProvider>
      </React.StrictMode>,
    );
    // 이중 마운트에도 직접 입력창이 뜨지 않고 브레드크럼이 유지된다.
    expect(screen.queryByPlaceholderText('경로 입력...')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'docs' })).toBeInTheDocument();
  });

  it('shows a context menu on segment right-click with terminal entry', () => {
    const onNavigate = vi.fn();
    renderBar('C:\\work\\docs', onNavigate);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'work' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '터미널에서 열기' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: '터미널에서 열기' }));
    expect(calls.some((c) => c.cmd === 'fc_open_terminal')).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
