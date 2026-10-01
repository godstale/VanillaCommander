import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import '@testing-library/jest-dom/vitest';
import { ApprovalDialog } from './ApprovalDialog';

describe('ApprovalDialog', () => {
  const shellRequest = {
    id: 'req-shell-1',
    toolCallId: 'tc-shell-1',
    toolName: 'shell',
    arguments: { command: 'cargo build --release' },
    risk: 'critical' as const,
  };

  it('renders tool approval details and shell command', () => {
    render(<ApprovalDialog request={shellRequest} onDecision={vi.fn()} />);

    expect(screen.getByText('도구 실행 승인 요청')).toBeInTheDocument();
    expect(screen.getByText('shell')).toBeInTheDocument();
    expect(screen.getByText('critical')).toBeInTheDocument();
    expect(screen.getByText('$ cargo build --release')).toBeInTheDocument();
  });

  it('handles approve click', () => {
    const handleDecision = vi.fn();
    render(<ApprovalDialog request={shellRequest} onDecision={handleDecision} />);

    fireEvent.click(screen.getByRole('button', { name: /^승인$/ }));
    expect(handleDecision).toHaveBeenCalledWith('req-shell-1', {
      approved: true,
      reason: undefined,
      rememberForSession: false,
    });
  });

  it('handles decline click with custom reason', () => {
    const handleDecision = vi.fn();
    render(<ApprovalDialog request={shellRequest} onDecision={handleDecision} />);

    // Open reject input
    fireEvent.click(screen.getByText('+ 거절 사유 직접 입력'));
    const input = screen.getByPlaceholderText(/프로젝트 빌드 명령은/);
    fireEvent.change(input, { target: { value: 'Don not run release build now' } });

    fireEvent.click(screen.getByRole('button', { name: /거절/i }));
    expect(handleDecision).toHaveBeenCalledWith('req-shell-1', {
      approved: false,
      reason: 'Don not run release build now',
      rememberForSession: false,
    });
  });

  it('handles remember for session click', () => {
    const handleDecision = vi.fn();
    render(<ApprovalDialog request={shellRequest} onDecision={handleDecision} />);

    fireEvent.click(screen.getByRole('button', { name: /이 세션에서 항상 승인/i }));
    expect(handleDecision).toHaveBeenCalledWith('req-shell-1', {
      approved: true,
      reason: undefined,
      rememberForSession: true,
    });
  });

  it('renders target file path for write tool request', () => {
    const writeRequest = {
      id: 'req-write-1',
      toolCallId: 'tc-write-1',
      toolName: 'write',
      arguments: { path: './ThreeLEDToggle.ino', content: 'void setup() {}' },
      risk: 'high' as const,
    };

    render(<ApprovalDialog request={writeRequest} onDecision={vi.fn()} />);

    expect(screen.getByText('대상 파일:')).toBeInTheDocument();
    expect(screen.getByText('./ThreeLEDToggle.ino')).toBeInTheDocument();
  });
});
