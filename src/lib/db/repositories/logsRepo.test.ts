import { describe, it, expect, beforeEach } from 'vitest';
import { MemorySqlFallback } from '@/lib/db/client';
import * as logsRepo from './logsRepo';
import { appLogger } from '@/lib/logger/logger';

describe('logsRepo and execution_logs persistence', () => {
  let db: MemorySqlFallback;

  beforeEach(() => {
    db = new MemorySqlFallback();
  });

  it('inserts and retrieves execution log entries', async () => {
    await logsRepo.insertLogEntry(
      {
        id: 'log-1',
        timestamp: '2026-09-19T10:00:00.000Z',
        level: 'info',
        category: 'chat',
        message: '사용자 입력 수신',
        details: { prompt: '안녕' },
        sessionId: 'session-1',
        agentId: 'agent-1',
      },
      db,
    );

    await logsRepo.insertLogEntry(
      {
        id: 'log-2',
        timestamp: '2026-09-19T10:00:01.000Z',
        level: 'info',
        category: 'tools',
        message: '도구 실행 시작',
        details: { tool: 'web_search' },
        sessionId: 'session-1',
        agentId: 'agent-1',
      },
      db,
    );

    await logsRepo.insertLogEntry(
      {
        id: 'log-3',
        timestamp: '2026-09-19T10:00:02.000Z',
        level: 'info',
        category: 'chat',
        message: '다른 세션 로그',
        sessionId: 'session-2',
      },
      db,
    );

    const session1Logs = await logsRepo.getLogs({ sessionId: 'session-1' }, db);
    expect(session1Logs).toHaveLength(2);
    expect(session1Logs[0].message).toBe('사용자 입력 수신');
    expect(session1Logs[0].details).toEqual({ prompt: '안녕' });
    expect(session1Logs[1].message).toBe('도구 실행 시작');

    const allLogs = await logsRepo.getLogs({}, db);
    expect(allLogs).toHaveLength(3);
  });

  it('clears logs for a specific session or all sessions', async () => {
    await logsRepo.insertLogEntry(
      {
        id: 'log-1',
        timestamp: '2026-09-19T10:00:00.000Z',
        level: 'info',
        category: 'chat',
        message: '세션 1 로그',
        sessionId: 'session-1',
      },
      db,
    );
    await logsRepo.insertLogEntry(
      {
        id: 'log-2',
        timestamp: '2026-09-19T10:00:01.000Z',
        level: 'info',
        category: 'chat',
        message: '세션 2 로그',
        sessionId: 'session-2',
      },
      db,
    );

    await logsRepo.clearLogs('session-1', db);
    const session1Remaining = await logsRepo.getLogs({ sessionId: 'session-1' }, db);
    expect(session1Remaining).toHaveLength(0);

    const session2Remaining = await logsRepo.getLogs({ sessionId: 'session-2' }, db);
    expect(session2Remaining).toHaveLength(1);

    await logsRepo.clearLogs(undefined, db);
    const allRemaining = await logsRepo.getLogs({}, db);
    expect(allRemaining).toHaveLength(0);
  });

  it('appLogger records entries in-memory and can filter by session and agent', async () => {
    appLogger.clear();
    appLogger.info('agent', '에이전트 시작', { test: true }, 'test-session-123', 'agent-alpha');
    appLogger.error('tools', '도구 실패', { err: 'fail' }, 'test-session-123', 'agent-alpha');
    appLogger.info('chat', '다른 세션 다른 에이전트', undefined, 'other-session', 'agent-beta');

    const sessionLogs = appLogger.getSessionLogs('test-session-123');
    expect(sessionLogs).toHaveLength(2);
    expect(sessionLogs[0].category).toBe('agent');
    expect(sessionLogs[1].level).toBe('error');

    const agentAlphaLogs = appLogger.getAgentLogs('agent-alpha');
    expect(agentAlphaLogs).toHaveLength(2);
    expect(agentAlphaLogs[0].agentId).toBe('agent-alpha');

    const agentBetaLogs = appLogger.getAgentLogs('agent-beta');
    expect(agentBetaLogs).toHaveLength(1);
    expect(agentBetaLogs[0].agentId).toBe('agent-beta');

    await appLogger.clearAgentLogs('agent-alpha');
    expect(appLogger.getAgentLogs('agent-alpha')).toHaveLength(0);
    expect(appLogger.getAgentLogs('agent-beta')).toHaveLength(1);
  });

  it('filters logs by agentId in repository', async () => {
    await logsRepo.insertLogEntry(
      {
        id: 'log-a1',
        timestamp: '2026-09-19T11:00:00.000Z',
        level: 'info',
        category: 'chat',
        message: '에이전트 A 질문',
        sessionId: 's-1',
        agentId: 'agent-A',
      },
      db,
    );
    await logsRepo.insertLogEntry(
      {
        id: 'log-b1',
        timestamp: '2026-09-19T11:00:01.000Z',
        level: 'info',
        category: 'ollama',
        message: '에이전트 B 응답',
        sessionId: 's-2',
        agentId: 'agent-B',
      },
      db,
    );

    const aLogs = await logsRepo.getLogs({ agentId: 'agent-A' }, db);
    expect(aLogs).toHaveLength(1);
    expect(aLogs[0].agentId).toBe('agent-A');
    expect(aLogs[0].message).toBe('에이전트 A 질문');

    const bLogs = await logsRepo.getLogs({ agentId: 'agent-B' }, db);
    expect(bLogs).toHaveLength(1);
    expect(bLogs[0].agentId).toBe('agent-B');
  });

  it('prunes old logs exceeding maxKeep and age limits', async () => {
    for (let i = 1; i <= 5; i++) {
      await logsRepo.insertLogEntry(
        {
          id: `log-${i}`,
          timestamp: new Date(Date.now() - (6 - i) * 1000).toISOString(),
          level: 'info',
          category: 'chat',
          message: `메시지 ${i}`,
        },
        db,
      );
    }

    const before = await logsRepo.getLogs({}, db);
    expect(before).toHaveLength(5);

    const pruned = await logsRepo.pruneOldLogs({ maxKeep: 3 }, db);
    expect(pruned).toBe(2);

    const after = await logsRepo.getLogs({}, db);
    expect(after).toHaveLength(3);
    expect(after.map((l) => l.id)).toEqual(['log-3', 'log-4', 'log-5']);
  });
});
