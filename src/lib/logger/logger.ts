import { insertLogEntry, getLogs, clearLogs } from '@/lib/db/repositories/logsRepo';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory =
  | 'agent'
  | 'chat'
  | 'session'
  | 'context'
  | 'skills'
  | 'tools'
  | 'approval'
  | 'ollama'
  | 'system';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  details?: unknown;
  sessionId?: string;
  agentId?: string;
}

type LogListener = (entry: LogEntry) => void;

class AppLogger {
  private entries: LogEntry[] = [];
  private maxEntries = 2000;
  private listeners: Set<LogListener> = new Set();

  public log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    details?: unknown,
    sessionId?: string,
    agentId?: string,
  ): LogEntry {
    const entry: LogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      details,
      sessionId,
      agentId,
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }

    // Persist to SQLite asynchronously so logs survive app restart or chat clear
    void insertLogEntry(entry).catch((err) => {
      console.warn('Failed to persist log entry to SQLite:', err);
    });

    // Mirror to browser console for Developer Tools inspection
    const prefix = `[Fortress][${category.toUpperCase()}]`;
    const consoleArgs: unknown[] = [
      `%c${prefix} ${message}`,
      level === 'error'
        ? 'color: #ef4444; font-weight: bold;'
        : level === 'warn'
        ? 'color: #f59e0b; font-weight: bold;'
        : level === 'info'
        ? 'color: #3b82f6;'
        : 'color: #9ca3af;',
    ];
    if (details !== undefined) {
      consoleArgs.push(details);
    }

    if (level === 'error') {
      console.error(...consoleArgs);
    } else if (level === 'warn') {
      console.warn(...consoleArgs);
    } else if (level === 'info') {
      console.info(...consoleArgs);
    } else {
      console.debug(...consoleArgs);
    }

    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch (err) {
        console.error('Error in log listener:', err);
      }
    }

    return entry;
  }

  public debug(
    category: LogCategory,
    message: string,
    details?: unknown,
    sessionId?: string,
    agentId?: string,
  ) {
    return this.log('debug', category, message, details, sessionId, agentId);
  }

  public info(
    category: LogCategory,
    message: string,
    details?: unknown,
    sessionId?: string,
    agentId?: string,
  ) {
    return this.log('info', category, message, details, sessionId, agentId);
  }

  public warn(
    category: LogCategory,
    message: string,
    details?: unknown,
    sessionId?: string,
    agentId?: string,
  ) {
    return this.log('warn', category, message, details, sessionId, agentId);
  }

  public error(
    category: LogCategory,
    message: string,
    details?: unknown,
    sessionId?: string,
    agentId?: string,
  ) {
    return this.log('error', category, message, details, sessionId, agentId);
  }

  public getEntries(): LogEntry[] {
    return [...this.entries];
  }

  public getSessionLogs(sessionId: string): LogEntry[] {
    return this.entries.filter((e) => e.sessionId === sessionId);
  }

  public getAgentLogs(agentId: string): LogEntry[] {
    return this.entries.filter((e) => e.agentId === agentId);
  }

  /**
   * Loads persisted logs from SQLite for the given agent, merges with in-memory logs,
   * and updates cache.
   */
  public async loadAgentLogs(agentId: string, limit?: number): Promise<LogEntry[]> {
    try {
      const persisted = await getLogs({ agentId, limit });
      const mergedMap = new Map<string, LogEntry>();
      for (const p of persisted) {
        mergedMap.set(p.id, p);
      }
      for (const m of this.entries) {
        if (m.agentId === agentId) {
          mergedMap.set(m.id, m);
        }
      }
      const combined = Array.from(mergedMap.values()).sort((a, b) =>
        a.timestamp.localeCompare(b.timestamp),
      );
      return limit && combined.length > limit ? combined.slice(-limit) : combined;
    } catch (err) {
      console.warn('Failed to load agent logs from SQLite:', err);
      return this.getAgentLogs(agentId);
    }
  }

  /**
   * Loads persisted logs from SQLite for the given session, merges with in-memory logs,
   * and updates cache.
   */
  public async loadSessionLogs(sessionId: string): Promise<LogEntry[]> {
    try {
      const persisted = await getLogs({ sessionId });
      const mergedMap = new Map<string, LogEntry>();
      for (const p of persisted) {
        mergedMap.set(p.id, p);
      }
      for (const m of this.entries) {
        if (!m.sessionId || m.sessionId === sessionId) {
          mergedMap.set(m.id, m);
        }
      }
      const combined = Array.from(mergedMap.values()).sort((a, b) =>
        a.timestamp.localeCompare(b.timestamp),
      );
      return combined;
    } catch (err) {
      console.warn('Failed to load session logs from SQLite:', err);
      return this.getSessionLogs(sessionId);
    }
  }

  /**
   * Loads all persisted logs from SQLite across all sessions.
   */
  public async loadAllLogs(limit?: number): Promise<LogEntry[]> {
    try {
      const persisted = await getLogs({ limit });
      const mergedMap = new Map<string, LogEntry>();
      for (const p of persisted) {
        mergedMap.set(p.id, p);
      }
      for (const m of this.entries) {
        mergedMap.set(m.id, m);
      }
      const combined = Array.from(mergedMap.values()).sort((a, b) =>
        a.timestamp.localeCompare(b.timestamp),
      );
      return limit && combined.length > limit ? combined.slice(-limit) : combined;
    } catch (err) {
      console.warn('Failed to load all logs from SQLite:', err);
      return [...this.entries];
    }
  }

  /**
   * Clears persistent and in-memory logs (explicit user action).
   */
  public async clearSessionLogs(sessionId?: string): Promise<void> {
    try {
      await clearLogs(sessionId);
    } catch (err) {
      console.warn('Failed to clear logs in SQLite:', err);
    }
    if (sessionId) {
      this.entries = this.entries.filter((e) => e.sessionId !== sessionId);
    } else {
      this.entries = [];
    }
  }

  /**
   * Clears persistent and in-memory logs for a specific agent.
   */
  public async clearAgentLogs(agentId: string): Promise<void> {
    try {
      await clearLogs(undefined, undefined, agentId);
    } catch (err) {
      console.warn('Failed to clear agent logs in SQLite:', err);
    }
    this.entries = this.entries.filter((e) => e.agentId !== agentId);
  }

  public clear(): void {
    this.entries = [];
  }

  public subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public exportLogsAsJson(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  public exportLogsAsText(): string {
    return this.entries
      .map((e) => {
        const detailsStr = e.details
          ? `\n  Details: ${typeof e.details === 'object' ? JSON.stringify(e.details) : e.details}`
          : '';
        return `[${e.timestamp}] [${e.level.toUpperCase()}] [${e.category}] ${e.message}${detailsStr}`;
      })
      .join('\n');
  }
}

export const appLogger = new AppLogger();
