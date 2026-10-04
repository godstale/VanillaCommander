import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import '@testing-library/jest-dom/vitest';
import { SettingsParsers } from './SettingsParsers';
import { SettingsProvider } from '@/lib/context/SettingsContext';

vi.mock('@/lib/db/repositories/settingsRepo', () => {
  const base = {
    id: 'singleton',
    openTabs: [],
    activeTabId: null,
    theme: 'dark',
    language: 'ko',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    defaultContextSize: 8192,
    defaultApprovalMode: 'dangerous-only',
    trustedWorkspaces: [],
    lastWorkspaceRoot: null,
    workFolder: null,
    wiki: {
      watchEnabled: false,
      watchFolders: [],
      recursive: false,
      scanIntervalMin: 10,
      moveAfterIngest: true,
      inboxDir: '',
      categories: [],
      allowNewCategories: false,
      allowedExtensions: [],
      maxFileMb: 20,
      excludeGlobs: [],
      prompt: '',
      agentId: null,
    },
    parsers: { overrides: {} },
  };
  return {
    DEFAULT_APP_SETTINGS: base,
    getSettings: vi.fn().mockResolvedValue(base),
    updateSettings: vi.fn().mockImplementation((updates) =>
      Promise.resolve({ ...base, ...updates }),
    ),
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => {
    throw new Error('not installed');
  }),
}));

describe('SettingsParsers', () => {
  it('renders the per-extension table with builtin labels', async () => {
    render(
      <SettingsProvider>
        <SettingsParsers />
      </SettingsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('문서 파싱 연동')).toBeInTheDocument();
    });
    expect(screen.getByText('.pdf')).toBeInTheDocument();
    expect(screen.getByText(/내장: pdfjs/)).toBeInTheDocument();
  });

  it('applies a preset and registers the override', async () => {
    const { updateSettings } = await import('@/lib/db/repositories/settingsRepo');
    render(
      <SettingsProvider>
        <SettingsParsers />
      </SettingsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('MarkItDown')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('MarkItDown'));
    const commandInput = screen.getByLabelText('명령 템플릿');
    expect((commandInput as HTMLInputElement).value).toContain('markitdown');

    fireEvent.click(screen.getByText('등록'));
    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({
        parsers: {
          overrides: {
            pdf: { command: 'markitdown "{input}"', outputMode: 'stdout' },
          },
        },
      });
    });
  });
});
