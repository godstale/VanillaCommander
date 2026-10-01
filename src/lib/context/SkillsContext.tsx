import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type { SkillManifest, SkillDiagnostic } from '@/lib/types/skill';
import { scanSkills } from '@/lib/skills/scanner';
import { loadProjectContextFiles, type ContextFileItem } from '@/lib/skills/contextFiles';
import { useWorkspace } from '@/lib/context/WorkspaceContext';

const SKILL_OVERRIDES_KEY = 'fortress_skill_active_overrides';

function getStoredSkillOverrides(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SKILL_OVERRIDES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSkillOverrides(overrides: Record<string, boolean>): void {
  try {
    localStorage.setItem(SKILL_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch {
    // ignore
  }
}

export interface SkillsContextValue {
  skills: SkillManifest[];
  diagnostics: SkillDiagnostic[];
  contextFiles: ContextFileItem[];
  isLoading: boolean;
  activeSkillOverrides: Record<string, boolean>;
  isSkillActive: (name: string) => boolean;
  toggleSkill: (name: string) => void;
  refreshSkills: () => Promise<void>;
  activeSkillsForPrompt: SkillManifest[];
}

const SkillsContext = createContext<SkillsContextValue | null>(null);

export function SkillsProvider({
  children,
  globalDir,
}: {
  children: ReactNode;
  globalDir?: string;
}) {
  const { workspaceRoot, isTrusted } = useWorkspace();
  const [skills, setSkills] = useState<SkillManifest[]>([]);
  const [diagnostics, setDiagnostics] = useState<SkillDiagnostic[]>([]);
  const [contextFiles, setContextFiles] = useState<ContextFileItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [overrides, setOverrides] = useState<Record<string, boolean>>(
    getStoredSkillOverrides,
  );

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      // 1. Scan skills: if trusted, scan workspaceRoot + globalDir. Otherwise ONLY globalDir.
      const scanResult = await scanSkills({
        globalDir,
        workspaceRoot: isTrusted && workspaceRoot ? workspaceRoot : undefined,
      });

      setSkills(scanResult.skills);
      setDiagnostics(scanResult.diagnostics);

      // 2. Load context files (AGENTS.md): only if trusted and workspaceRoot is set
      if (isTrusted && workspaceRoot) {
        const loadedFiles = await loadProjectContextFiles({
          workspaceRoot,
          globalDir,
        });
        setContextFiles(loadedFiles);
      } else {
        setContextFiles([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [workspaceRoot, isTrusted, globalDir]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (active) {
        await loadData();
      }
    })();
    return () => {
      active = false;
    };
  }, [loadData]);

  const toggleSkill = useCallback((name: string) => {
    setOverrides((prev) => {
      const currentVal = prev[name] ?? true;
      const next = { ...prev, [name]: !currentVal };
      saveSkillOverrides(next);
      return next;
    });
  }, []);

  const isSkillActive = useCallback(
    (name: string): boolean => {
      return overrides[name] ?? true;
    },
    [overrides],
  );

  const activeSkillsForPrompt = useMemo(() => {
    return skills.filter((s) => isSkillActive(s.name));
  }, [skills, isSkillActive]);

  const value = useMemo(
    () => ({
      skills,
      diagnostics,
      contextFiles,
      isLoading,
      activeSkillOverrides: overrides,
      isSkillActive,
      toggleSkill,
      refreshSkills: loadData,
      activeSkillsForPrompt,
    }),
    [
      skills,
      diagnostics,
      contextFiles,
      isLoading,
      overrides,
      isSkillActive,
      toggleSkill,
      loadData,
      activeSkillsForPrompt,
    ],
  );

  return (
    <SkillsContext.Provider value={value}>{children}</SkillsContext.Provider>
  );
}

export function useSkills(): SkillsContextValue {
  const ctx = useContext(SkillsContext);
  if (!ctx) {
    throw new Error('useSkills must be used within a SkillsProvider');
  }
  return ctx;
}

export function useSafeSkills(): SkillsContextValue | null {
  return useContext(SkillsContext);
}

