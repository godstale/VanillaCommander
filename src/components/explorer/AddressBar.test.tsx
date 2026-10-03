import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import { AddressBar } from './AddressBar';

describe('AddressBar', () => {
  it('builds valid Windows targets without mixed separators', () => {
    const seen: string[] = [];
    render(<AddressBar path="C:\\Workspace\\___Working\\___test" onNavigate={(p) => seen.push(p)} />);
    // "___Working" 브레드크럼 클릭 → 현재 탭에서 C:\Workspace\___Working 으로 이동해야 한다.
    fireEvent.click(screen.getByRole('button', { name: '___Working' }));
    expect(seen).toEqual(['C:\\Workspace\\___Working']);
  });

  it('strips the verbatim prefix instead of producing ?/C:/...', () => {
    const seen: string[] = [];
    const verbatim = '\\\\?\\C:\\Workspace\\___Working\\___test';
    render(<AddressBar path={verbatim} onNavigate={(p) => seen.push(p)} />);
    fireEvent.click(screen.getByRole('button', { name: '___Working' }));
    expect(seen).toEqual(['C:\\Workspace\\___Working']);
    expect(seen[0]).not.toContain('?');
  });

  it('keeps forward-slash style for posix-like drive paths', () => {
    const seen: string[] = [];
    render(<AddressBar path="C:/work/docs" onNavigate={(p) => seen.push(p)} />);
    fireEvent.click(screen.getByRole('button', { name: 'work' }));
    expect(seen).toEqual(['C:/work']);
  });

  it('does not navigate when the last segment is clicked', () => {
    const onNavigate = vi.fn();
    render(<AddressBar path="C:\\Workspace\\___Working" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: '___Working' }));
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
