import { describe, it, expect, beforeEach } from 'vitest';
import { needsApproval } from './policy';
import { approvalBus } from './approvalBus';

describe('needsApproval policy truth table', () => {
  it('mode: always requires approval for all risk levels', () => {
    expect(needsApproval({ toolName: 'read', approvalMode: 'always', risk: 'low' })).toBe(true);
    expect(needsApproval({ toolName: 'write', approvalMode: 'always', risk: 'high' })).toBe(true);
    expect(needsApproval({ toolName: 'shell', approvalMode: 'always', risk: 'critical' })).toBe(true);
  });

  it('mode: dangerous-only requires approval only for high and critical', () => {
    expect(needsApproval({ toolName: 'read', approvalMode: 'dangerous-only', risk: 'low' })).toBe(false);
    expect(needsApproval({ toolName: 'grep', approvalMode: 'dangerous-only', risk: 'low' })).toBe(false);
    expect(needsApproval({ toolName: 'write', approvalMode: 'dangerous-only', risk: 'high' })).toBe(true);
    expect(needsApproval({ toolName: 'edit', approvalMode: 'dangerous-only', risk: 'high' })).toBe(true);
    expect(needsApproval({ toolName: 'shell', approvalMode: 'dangerous-only', risk: 'critical' })).toBe(true);
  });

  it('mode: never auto-approves low and high, but critical (shell) STILL requires approval', () => {
    expect(needsApproval({ toolName: 'read', approvalMode: 'never', risk: 'low' })).toBe(false);
    expect(needsApproval({ toolName: 'write', approvalMode: 'never', risk: 'high' })).toBe(false);
    expect(needsApproval({ toolName: 'shell', approvalMode: 'never', risk: 'critical' })).toBe(true);
  });

  it('skips approval if session override exists', () => {
    const sessionOverrides = new Set(['write']);
    expect(
      needsApproval({
        toolName: 'write',
        approvalMode: 'dangerous-only',
        risk: 'high',
        sessionOverrides,
      }),
    ).toBe(false);

    expect(
      needsApproval({
        toolName: 'edit',
        approvalMode: 'dangerous-only',
        risk: 'high',
        sessionOverrides,
      }),
    ).toBe(true);
  });
});

describe('ApprovalBus', () => {
  beforeEach(() => {
    approvalBus.clearSessionOverrides();
    approvalBus.abortAll();
  });

  it('resolves request when approved', async () => {
    const reqPromise = approvalBus.request({
      id: 'req-1',
      toolCallId: 'tc-1',
      toolName: 'write',
      arguments: { path: 'test.txt' },
      risk: 'high',
    });

    const pending = approvalBus.getPendingRequests();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('req-1');

    const resolved = approvalBus.resolve('req-1', { approved: true });
    expect(resolved).toBe(true);

    const decision = await reqPromise;
    expect(decision.approved).toBe(true);
    expect(approvalBus.getPendingRequests()).toHaveLength(0);
  });

  it('saves session override when rememberForSession is true', async () => {
    const reqPromise = approvalBus.request({
      id: 'req-2',
      toolCallId: 'tc-2',
      toolName: 'write',
      arguments: {},
      risk: 'high',
    });

    approvalBus.resolve('req-2', { approved: true, rememberForSession: true });
    await reqPromise;

    expect(approvalBus.getSessionOverrides().has('write')).toBe(true);
  });

  it('cleans up and rejects all pending promises on rejectAll', async () => {
    const p1 = approvalBus.request({
      id: 'req-3',
      toolCallId: 'tc-3',
      toolName: 'edit',
      arguments: {},
      risk: 'high',
    });
    const p2 = approvalBus.request({
      id: 'req-4',
      toolCallId: 'tc-4',
      toolName: 'shell',
      arguments: {},
      risk: 'critical',
    });

    approvalBus.rejectAll('User cancelled session');

    const res1 = await p1;
    const res2 = await p2;

    expect(res1.approved).toBe(false);
    expect(res1.reason).toBe('User cancelled session');
    expect(res2.approved).toBe(false);
    expect(res2.reason).toBe('User cancelled session');
    expect(approvalBus.getPendingRequests()).toHaveLength(0);
  });

  it('resolves immediately when abort signal fires', async () => {
    const controller = new AbortController();
    const p = approvalBus.request(
      {
        id: 'req-5',
        toolCallId: 'tc-5',
        toolName: 'shell',
        arguments: {},
        risk: 'critical',
      },
      controller.signal,
    );

    controller.abort();
    const res = await p;

    expect(res.approved).toBe(false);
    expect(res.reason).toContain('aborted');
    expect(approvalBus.getPendingRequests()).toHaveLength(0);
  });
});
