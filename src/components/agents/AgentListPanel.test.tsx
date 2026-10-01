import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AgentListPanel } from './AgentListPanel';
import { WorkspaceProvider } from '@/lib/context/WorkspaceContext';
import { SettingsProvider } from '@/lib/context/SettingsContext';
import { SkillsProvider } from '@/lib/context/SkillsContext';
import { AgentsProvider } from '@/lib/context/AgentsContext';
import { ChatSessionsProvider } from '@/lib/context/ChatSessionsContext';
import { WorkspaceTabsProvider } from '@/lib/context/WorkspaceTabsContext';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

const PanelWrapper = ({ children }: { children: React.ReactNode }) => (
  <LanguageProvider>
    <WorkspaceProvider>
      <SettingsProvider>
        <SkillsProvider>
          <AgentsProvider>
            <ChatSessionsProvider>
              <WorkspaceTabsProvider>{children}</WorkspaceTabsProvider>
            </ChatSessionsProvider>
          </AgentsProvider>
        </SkillsProvider>
      </SettingsProvider>
    </WorkspaceProvider>
  </LanguageProvider>
);

describe('AgentListPanel', () => {
  it('renders agent list panel with header and action buttons', async () => {
    render(
      <PanelWrapper>
        <AgentListPanel />
      </PanelWrapper>,
    );

    expect(screen.getByText('에이전트 관리')).toBeInTheDocument();
    expect(screen.getByTitle('새 에이전트 추가')).toBeInTheDocument();

    await waitFor(() => {
      // Default agent should appear
      expect(screen.getByText('기본')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /대화 시작/i })).toBeInTheDocument();
      expect(screen.getByTitle('모든 에이전트 연결 상태 확인')).toBeInTheDocument();
    });
  });

  it('triggers start conversation on card button click', async () => {
    render(
      <PanelWrapper>
        <AgentListPanel />
      </PanelWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /대화 시작/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /대화 시작/i }));

    // Should create a session and open tab without throwing
    await waitFor(() => {
      expect(screen.queryByText(/에이전트 목록 불러오는 중/)).toBeNull();
    });
  });

  it('allows clicking the check connection refresh button in the header', async () => {
    render(
      <PanelWrapper>
        <AgentListPanel />
      </PanelWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTitle('모든 에이전트 연결 상태 확인')).toBeInTheDocument();
    });

    const refreshBtn = screen.getByTitle('모든 에이전트 연결 상태 확인');
    fireEvent.click(refreshBtn);

    // Should execute without throwing error
    expect(refreshBtn).toBeInTheDocument();
  });
});

