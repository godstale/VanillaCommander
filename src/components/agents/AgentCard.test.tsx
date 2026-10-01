import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import '@testing-library/jest-dom/vitest';
import { AgentCard } from './AgentCard';
import type { Agent } from '@/lib/types/agent';

const mockAgent: Agent = {
  id: 'agent-test-1',
  name: '코딩 전문가',
  description: '타입스크립트와 리액트 개발을 돕습니다.',
  systemPrompt: 'You are a helpful coding assistant.',
  model: 'qwen2.5:7b',
  temperature: 0.7,
  contextSize: 8192,
  reserveTokens: 1000,
  keepRecentTokens: 500,
  enabledSkills: ['skill-1'],
  enabledBuiltinTools: ['read', 'write'],
  approvalMode: 'dangerous-only',
  isDefault: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('AgentCard connection status', () => {
  it('renders with unknown status (neutral icon) by default', () => {
    render(
      <AgentCard
        agent={mockAgent}
        onStartChat={vi.fn()}
        onEdit={vi.fn()}
        onSetDefault={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const statusButton = screen.getByLabelText(/상태체크 전/i);
    expect(statusButton).toBeInTheDocument();
    expect(statusButton.className).toContain('text-foreground');
  });

  it('renders green icon styling when status is connected', () => {
    render(
      <AgentCard
        agent={mockAgent}
        status="connected"
        onStartChat={vi.fn()}
        onEdit={vi.fn()}
        onSetDefault={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const statusButton = screen.getByLabelText(/연결됨/i);
    expect(statusButton).toBeInTheDocument();
    expect(statusButton.className).toContain('text-success');
  });

  it('renders red icon styling when status is disconnected', () => {
    render(
      <AgentCard
        agent={mockAgent}
        status="disconnected"
        onStartChat={vi.fn()}
        onEdit={vi.fn()}
        onSetDefault={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const statusButton = screen.getByLabelText(/미연결/i);
    expect(statusButton).toBeInTheDocument();
    expect(statusButton.className).toContain('text-destructive');
  });

  it('triggers onCheckConnection when clicking the status icon button', () => {
    const onCheckConnection = vi.fn();
    render(
      <AgentCard
        agent={mockAgent}
        onCheckConnection={onCheckConnection}
        onStartChat={vi.fn()}
        onEdit={vi.fn()}
        onSetDefault={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const statusButton = screen.getByRole('button', { name: /에이전트 연결 상태/i });
    fireEvent.click(statusButton);

    expect(onCheckConnection).toHaveBeenCalledWith(mockAgent);
  });

  it('triggers onOpenMonitor when clicking the status icon button if onOpenMonitor is provided', () => {
    const onOpenMonitor = vi.fn();
    render(
      <AgentCard
        agent={mockAgent}
        onOpenMonitor={onOpenMonitor}
        onStartChat={vi.fn()}
        onEdit={vi.fn()}
        onSetDefault={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const statusButton = screen.getByRole('button', { name: /에이전트 연결 상태/i });
    fireEvent.click(statusButton);

    expect(onOpenMonitor).toHaveBeenCalledWith(mockAgent);
  });

  it('triggers onCheckConnection when clicking the header refresh button', () => {
    const onCheckConnection = vi.fn();
    render(
      <AgentCard
        agent={mockAgent}
        onCheckConnection={onCheckConnection}
        onStartChat={vi.fn()}
        onEdit={vi.fn()}
        onSetDefault={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const refreshButton = screen.getByTitle('연결 상태 확인');
    fireEvent.click(refreshButton);

    expect(onCheckConnection).toHaveBeenCalledWith(mockAgent);
  });

  it('shows checking state when isChecking is true', () => {
    render(
      <AgentCard
        agent={mockAgent}
        isChecking={true}
        onStartChat={vi.fn()}
        onEdit={vi.fn()}
        onSetDefault={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const statusButton = screen.getByRole('button', { name: /에이전트 연결 상태/i });
    expect(statusButton).toBeDisabled();
    expect(statusButton.getAttribute('title')).toContain('확인 중');
  });
});
