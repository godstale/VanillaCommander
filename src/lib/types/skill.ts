export type SkillSource = 'global' | 'workspace';

export interface SkillManifest {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: SkillSource;
  disableModelInvocation: boolean;
}

export interface SkillDiagnostic {
  level: 'warning' | 'collision';
  message: string;
  path: string;
}
