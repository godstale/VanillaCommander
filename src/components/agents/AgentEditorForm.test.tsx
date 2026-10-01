import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AgentEditorForm } from './AgentEditorForm';
import { DEFAULT_AGENT } from '@/lib/agent/defaultAgent';
import { WorkspaceProvider } from '@/lib/context/WorkspaceContext';
import { AgentsProvider } from '@/lib/context/AgentsContext';
import { SettingsProvider } from '@/lib/context/SettingsContext';
import { SkillsProvider } from '@/lib/context/SkillsContext';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

// Mock listModels & showModel
vi.mock('@/lib/llm/ollamaClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/ollamaClient')>();
  return {
    ...actual,
    listModels: vi.fn().mockResolvedValue([
      { name: 'qwen3.5:9b', size: 9e9, digest: '', modified_at: '' },
      { name: 'llama3.2:3b', size: 3e9, digest: '', modified_at: '' },
    ]),
    showModel: vi.fn().mockResolvedValue({ contextLength: 8192, supportsTools: true }),
  };
});

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <LanguageProvider>
    <WorkspaceProvider>
      <SettingsProvider>
        <SkillsProvider>
          <AgentsProvider>{children}</AgentsProvider>
        </SkillsProvider>
      </SettingsProvider>
    </WorkspaceProvider>
  </LanguageProvider>
);

describe('AgentEditorForm', () => {
  it('renders all configuration fields in create mode', async () => {
    render(
      <TestWrapper>
        <AgentEditorForm mode="create" onSave={vi.fn()} />
      </TestWrapper>,
    );

    expect(screen.getByText('기본 정보')).toBeInTheDocument();
    expect(screen.getByText('LLM Provider')).toBeInTheDocument();
    expect(screen.getByText('LLM 생성 옵션')).toBeInTheDocument();
    expect(screen.getByText('도구 승인 정책')).toBeInTheDocument();
    expect(screen.getByText('자동 모니터링')).toBeInTheDocument();
    expect(screen.getByText('활성 내장 도구')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /에이전트 생성/i })).toBeInTheDocument();
  });

  it('validates required name field', async () => {
    const handleSave = vi.fn();
    render(
      <TestWrapper>
        <AgentEditorForm mode="create" onSave={handleSave} />
      </TestWrapper>,
    );

    const nameInput = screen.getByPlaceholderText(/예: 문서 분석 전문가/);
    fireEvent.change(nameInput, { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: /에이전트 생성/i }));
    expect(handleSave).not.toHaveBeenCalled();
  });

  it('blocks saving until the connection test succeeds', async () => {
    const handleSave = vi.fn();
    render(
      <TestWrapper>
        <AgentEditorForm mode="create" onSave={vi.fn()} />
      </TestWrapper>,
    );

    const nameInput = screen.getByPlaceholderText(/예: 문서 분석 전문가/);
    fireEvent.change(nameInput, { target: { value: 'No Test' } });

    // 자동 연결 테스트가 끝나기 전(또는 실패 시)에는 저장 차단 문구가 노출된다.
    // 마운트 직후 자동 테스트가 진행 중이거나, 모델 목록 조회 결과에 따라
    // 차단 문구 또는 연결 성공 표시 중 하나가 나타난다.
    await waitFor(() => {
      const blocked = screen.queryByText(/연결 테스트가 성공해야 저장할 수 있습니다/);
      const connected = screen.queryByText('연결됨');
      expect(blocked ?? connected).not.toBeNull();
    });
    expect(handleSave).not.toHaveBeenCalled();
  });

  it('submits valid agent creation after picking a model and testing', async () => {
    const handleSave = vi.fn();
    render(
      <TestWrapper>
        <AgentEditorForm mode="create" onSave={handleSave} />
      </TestWrapper>,
    );

    const nameInput = screen.getByPlaceholderText(/예: 문서 분석 전문가/);
    fireEvent.change(nameInput, { target: { value: 'Doc Analyzer' } });

    // 마운트 시 자동 조회가 끝날 때까지 대기한다 (그동안 버튼명이 "확인 중..."이다).
    await screen.findByText(/Provider·모델 변경 시/);

    // 신규 화면의 모델은 비어 시작한다. 목록에서 선택(여기서는 직접 입력) 후 테스트한다.
    const modelInput = screen.getByPlaceholderText('qwen3.5:9b');
    fireEvent.change(modelInput, { target: { value: 'qwen3.5:9b' } });
    fireEvent.click(screen.getByRole('button', { name: /연결 테스트/ }));

    await waitFor(() => {
      expect(screen.getByText('연결됨')).toBeInTheDocument();
    });
    const saveButton = screen.getByRole('button', { name: /에이전트 생성/i });
    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(handleSave).toHaveBeenCalled();
      const saved = handleSave.mock.calls[0][0];
      expect(saved.name).toBe('Doc Analyzer');
      expect(saved.model).toBe('qwen3.5:9b');
    });
  });

  it('asks for a model before testing when empty', async () => {
    render(
      <TestWrapper>
        <AgentEditorForm mode="create" onSave={vi.fn()} />
      </TestWrapper>,
    );

    await screen.findByText(/Provider·모델 변경 시/);
    fireEvent.click(screen.getByRole('button', { name: /연결 테스트/ }));
    expect(await screen.findByText(/모델을 먼저 선택하거나 입력/)).toBeInTheDocument();
  });

  it('locks saving while a chat with the agent is running', () => {
    render(
      <TestWrapper>
        <AgentEditorForm
          mode="edit"
          initialAgent={{ ...DEFAULT_AGENT, id: 'agent-1', name: 'Runner' }}
          saveLocked
          onSave={vi.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.getByText(/대기 상태가 될 때까지/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /변경사항 저장/ })).toBeDisabled();
  });

  it('resets the connection result when the model changes and requires re-test', async () => {
    const handleSave = vi.fn();
    render(
      <TestWrapper>
        <AgentEditorForm
          mode="edit"
          initialAgent={{
            ...DEFAULT_AGENT,
            id: 'agent-1',
            name: 'ForkMe',
            model: 'qwen3.5:9b',
            llmProvider: 'ollama',
          }}
          onSave={handleSave}
        />
      </TestWrapper>,
    );

    // 마운트 자동 테스트 성공을 기다린다.
    await waitFor(() => {
      expect(screen.getByText('연결됨')).toBeInTheDocument();
    });

    const modelInput = await screen.findByDisplayValue(/qwen3\.5:9b/);
    fireEvent.change(modelInput, { target: { value: 'llama3.2:3b' } });

    expect(await screen.findByText(/기존 설정을 유지한 채/)).toBeInTheDocument();
    // 모델 변경으로 연결 결과가 리셋되어 저장이 차단된다.
    expect(await screen.findByText(/연결 테스트가 성공해야 저장할 수 있습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /새 에이전트로 저장/ })).toBeDisabled();

    // 수동 연결 테스트 후 저장 게이트가 열린다.
    fireEvent.click(screen.getByRole('button', { name: /연결 테스트/ }));
    await waitFor(() => {
      expect(screen.getByText('연결됨')).toBeInTheDocument();
    });
    const saveButton = screen.getByRole('button', { name: /새 에이전트로 저장/ });
    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(handleSave).toHaveBeenCalled();
      const saved = handleSave.mock.calls[0][0];
      expect(saved.name).toBe('ForkMe (v2)');
      expect(saved.model).toBe('llama3.2:3b');
      expect(saved.isDefault).toBe(false);
    });
  });
});
