import { describe, it, expect } from 'vitest';
import {
  loadContextFileFromDir,
  loadProjectContextFiles,
  getAncestorDirectories,
  type ReadFileFn,
} from './contextFiles';

describe('contextFiles', () => {
  it('splits ancestors from root down to workspaceRoot', () => {
    const dirs = getAncestorDirectories('C:/Users/dev/workspace/repo');
    expect(dirs).toEqual([
      'C:',
      'C:/Users',
      'C:/Users/dev',
      'C:/Users/dev/workspace',
      'C:/Users/dev/workspace/repo',
    ]);
  });

  it('prioritizes AGENTS.override.md over AGENTS.md in a directory', async () => {
    const mockFiles: Record<string, string> = {
      'C:/project/AGENTS.override.md': 'Override Content',
      'C:/project/AGENTS.md': 'Regular Content',
    };

    const mockReadFile: ReadFileFn = async (p: string) => {
      if (mockFiles[p]) return mockFiles[p];
      throw new Error('Not found');
    };

    const file = await loadContextFileFromDir('C:/project', mockReadFile);
    expect(file).toBeDefined();
    expect(file?.path).toBe('C:/project/AGENTS.override.md');
    expect(file?.content).toBe('Override Content');
  });

  it('collects nested ancestors in root-to-child order and deduplicates', async () => {
    const mockFiles: Record<string, string> = {
      '/global/AGENTS.md': 'Global Agent Rules',
      '/workspace/AGENTS.md': 'Root Level Rules',
      '/workspace/apps/AGENTS.md': 'App Level Rules',
      '/workspace/apps/web/AGENTS.override.md': 'Web Override Rules',
    };

    const mockReadFile: ReadFileFn = async (p: string) => {
      if (mockFiles[p]) return mockFiles[p];
      throw new Error('Not found');
    };

    const result = await loadProjectContextFiles({
      workspaceRoot: '/workspace/apps/web',
      globalDir: '/global',
      readFileFn: mockReadFile,
    });

    expect(result).toHaveLength(4);
    // 1. Global
    expect(result[0].path).toBe('/global/AGENTS.md');
    expect(result[0].content).toBe('Global Agent Rules');
    // 2. Root ancestor
    expect(result[1].path).toBe('/workspace/AGENTS.md');
    // 3. Parent ancestor
    expect(result[2].path).toBe('/workspace/apps/AGENTS.md');
    // 4. Target child
    expect(result[3].path).toBe('/workspace/apps/web/AGENTS.override.md');
  });

  it('returns empty array if no context files exist', async () => {
    const mockReadFile: ReadFileFn = async () => {
      throw new Error('Not found');
    };

    const result = await loadProjectContextFiles({
      workspaceRoot: '/empty/project',
      readFileFn: mockReadFile,
    });

    expect(result).toEqual([]);
  });
});
