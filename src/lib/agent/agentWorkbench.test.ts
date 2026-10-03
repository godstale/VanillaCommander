import { describe, expect, it } from 'vitest';
import { agentWorkbenchView } from './agentWorkbench';

describe('agentWorkbenchView', () => {
  it('prefers meta.view', () => {
    expect(agentWorkbenchView({ type: 'agent-editor', meta: { view: 'monitor' } })).toBe('monitor');
  });
  it('defaults by tab type (legacy agent-monitor tabs open monitoring)', () => {
    expect(agentWorkbenchView({ type: 'agent-editor' })).toBe('edit');
    expect(agentWorkbenchView({ type: 'agent-monitor' })).toBe('monitor');
  });
});
