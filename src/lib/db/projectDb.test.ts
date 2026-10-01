import { describe, it, expect, beforeEach } from 'vitest';
import {
  setDatabase,
  setActiveWorkspaceRoot,
  getActiveWorkspaceRoot,
  getGlobalDatabase,
  getProjectDatabase,
  getDatabase,
} from '@/lib/db/client';
import * as settingsRepo from './repositories/settingsRepo';
import * as sessionsRepo from './repositories/sessionsRepo';

describe('Project DB vs Global DB separation', () => {
  beforeEach(() => {
    setDatabase(null);
    setActiveWorkspaceRoot(null);
    localStorage.clear();
  });

  it('sets and gets active workspace root correctly', () => {
    expect(getActiveWorkspaceRoot()).toBeNull();
    setActiveWorkspaceRoot('/path/to/project-a');
    expect(getActiveWorkspaceRoot()).toBe('/path/to/project-a');
  });

  it('returns global database when no active workspace is set', async () => {
    const globalDb = await getGlobalDatabase();
    const db = await getDatabase();
    expect(db).toBe(globalDb);
  });

  it('returns project database when workspace root is active', async () => {
    setActiveWorkspaceRoot('/path/to/project-a');
    const projectDbA = await getProjectDatabase('/path/to/project-a');
    const currentDb = await getDatabase();
    expect(currentDb).toBe(projectDbA);

    const projectDbB = await getProjectDatabase('/path/to/project-b');
    expect(projectDbB).not.toBe(projectDbA);
  });

  it('isolates sessions between different project workspaces', async () => {
    // Workspace A
    setActiveWorkspaceRoot('/workspace/A');
    const sessionA = await sessionsRepo.createSession({
      id: 'session-a',
      agentId: 'agent-1',
      title: 'Session in A',
      workspaceRoot: '/workspace/A',
    });
    const listA = await sessionsRepo.listSessions();
    expect(listA.map((s) => s.id)).toContain(sessionA.id);

    // Workspace B
    setActiveWorkspaceRoot('/workspace/B');
    const listB = await sessionsRepo.listSessions();
    expect(listB.map((s) => s.id)).not.toContain(sessionA.id);
  });

  it('stores and isolates open_tabs per workspace while sharing global settings', async () => {
    // Set global theme
    await settingsRepo.updateSettings({ theme: 'dark' });

    // Workspace A sets tabs
    setActiveWorkspaceRoot('/workspace/A');
    await settingsRepo.updateSettings({
      openTabs: [{ type: 'chat', id: 'tab-a', title: 'Tab in A' }],
      activeTabId: 'tab-a',
    });

    const settingsA = await settingsRepo.getSettings();
    expect(settingsA.theme).toBe('light');
    expect(settingsA.openTabs).toHaveLength(1);
    expect(settingsA.openTabs[0].id).toBe('tab-a');

    // Workspace B has different tabs
    setActiveWorkspaceRoot('/workspace/B');
    const settingsB = await settingsRepo.getSettings();
    expect(settingsB.theme).toBe('light'); // shared global setting
    expect(settingsB.openTabs).toHaveLength(0); // isolated project tabs

    // Workspace B sets its own tabs
    await settingsRepo.updateSettings({
      openTabs: [{ type: 'chat', id: 'tab-b', title: 'Tab in B' }],
      activeTabId: 'tab-b',
    });

    // Revisit Workspace A
    setActiveWorkspaceRoot('/workspace/A');
    const restoredA = await settingsRepo.getSettings();
    expect(restoredA.openTabs[0].id).toBe('tab-a');
  });
});
