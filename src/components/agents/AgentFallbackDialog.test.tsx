import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import { AgentFallbackDialog } from './AgentFallbackDialog';
import type { FallbackCandidate } from '@/lib/agent/resolveAgent';
import type { Agent } from '@/lib/types/agent';
import { DEFAULT_AGENT } from '@/lib/agent/defaultAgent';

function makeAgent(id: string, name: string, provider: Agent['llmProvider']): Agent {
  return { ...DEFAULT_AGENT, id, name, llmProvider: provider, model: `${name}-model` };
}

const local = makeAgent('local-1', 'Local Ollama', 'ollama');
const cloud = makeAgent('cloud-1', 'Cloud GPT', 'openai');

const candidates: FallbackCandidate[] = [
  { agent: local, status: 'connected', external: false },
  { agent: cloud, status: 'connected', external: true },
];

describe('AgentFallbackDialog', () => {
  it('picks a local agent without extra confirmation', () => {
    const onPick = vi.fn();
    render(
      <AgentFallbackDialog
        open
        candidates={candidates}
        failedAgentName="Dead Default"
        onPick={onPick}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/Dead Default/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '이 에이전트로 계속' }));
    expect(onPick).toHaveBeenCalledWith(local, { dontAsk: false, externalConfirmed: false });
  });

  it('requires the external checkbox and gates dont-ask to local picks', () => {
    const onPick = vi.fn();
    render(
      <AgentFallbackDialog
        open
        candidates={candidates}
        failedAgentName="Dead Default"
        onPick={onPick}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Cloud GPT'));
    // 외부 전송 확인 전에는 계속할 수 없다.
    fireEvent.click(screen.getByRole('button', { name: '이 에이전트로 계속' }));
    expect(onPick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(/외부로 전송될 수 있음/));
    fireEvent.click(screen.getByRole('button', { name: '이 에이전트로 계속' }));
    expect(onPick).toHaveBeenCalledWith(cloud, { dontAsk: false, externalConfirmed: true });
  });
});
