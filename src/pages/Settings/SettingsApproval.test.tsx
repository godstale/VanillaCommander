import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import '@testing-library/jest-dom/vitest';
import { SettingsApproval } from './SettingsApproval';
import { SettingsProvider } from '@/lib/context/SettingsContext';

// Mock settingsRepo
vi.mock('@/lib/db/repositories/settingsRepo', () => ({
  DEFAULT_APP_SETTINGS: {
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
  },
  getSettings: vi.fn().mockResolvedValue({
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
  }),
  updateSettings: vi.fn().mockImplementation((updates) =>
    Promise.resolve({
      id: 'singleton',
      openTabs: [],
      activeTabId: null,
      theme: 'dark',
      language: 'ko',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      defaultContextSize: 8192,
      defaultApprovalMode: updates.defaultApprovalMode || 'dangerous-only',
      trustedWorkspaces: [],
      lastWorkspaceRoot: null,
    }),
  ),
}));

describe('SettingsApproval', () => {
  it('renders approval modes with default selection', async () => {
    render(
      <SettingsProvider>
        <SettingsApproval />
      </SettingsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('도구 승인 정책 (HITL)')).toBeInTheDocument();
      expect(screen.getByText('위험 도구만 승인 요청 (권장)')).toBeInTheDocument();
      expect(screen.getByText('모든 도구 승인 요청 (엄격)')).toBeInTheDocument();
      expect(screen.getByText('자동 승인 (위험)')).toBeInTheDocument();
    });
  });

  it('displays shell security boundary notice', async () => {
    render(
      <SettingsProvider>
        <SettingsApproval />
      </SettingsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('셸 실행 도구 안전 경계')).toBeInTheDocument();
      expect(screen.getByText(/보안 주의: 셸 실행/)).toBeInTheDocument();
    });
  });

  it('allows changing approval mode to always', async () => {
    render(
      <SettingsProvider>
        <SettingsApproval />
      </SettingsProvider>,
    );

    const alwaysOption = screen.getByText('모든 도구 승인 요청 (엄격)');
    fireEvent.click(alwaysOption);

    await waitFor(() => {
      expect(alwaysOption.closest('div[class*="border-primary"]')).not.toBeNull();
    });
  });
});
