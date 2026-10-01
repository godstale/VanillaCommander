import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EvalPackManifestSchema,
  EvalSampleSchema,
  SCORER_TYPES,
  type EvalPackManifest,
  type EvalSample,
  type FsExpectation,
} from '../types';
import { getScorer } from '../scorers/index';
import type { ScorerInput } from '../scorers/types';
import {
  COMPACTION_RECALL_KIND,
  compactionRecallSolver,
  localSolverKinds,
  registerCompactionSolver,
} from '../runner/solvers/compactionRecall';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVALS = join(HERE, '..', '..', '..', '..', 'src-tauri', 'resources', 'evals');

interface ReferenceEntry {
  id: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  answer: string;
}

interface LoadedPackFiles {
  manifest: EvalPackManifest;
  samples: EvalSample[];
  reference: ReferenceEntry[];
}

interface PathExpectation {
  path: string;
  contains?: string[];
  notContains?: string[];
}

function asPathExpectation(exp: FsExpectation): PathExpectation | null {
  if (!('path' in exp)) return null;
  return exp as PathExpectation;
}

interface GlobCap {
  glob: string;
  maxFiles?: number;
}

function asGlobCap(exp: FsExpectation): GlobCap | null {
  if (!('glob' in exp)) return null;
  return exp as GlobCap;
}

function readPack(packId: string): LoadedPackFiles {
  const dir = join(EVALS, packId);
  const manifestRaw = readFileSync(join(dir, 'manifest.json'), 'utf8');
  const manifest = EvalPackManifestSchema.parse(JSON.parse(manifestRaw) as unknown);
  const samples = readFileSync(join(dir, 'samples.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => EvalSampleSchema.parse(JSON.parse(line) as unknown));
  const reference = readFileSync(join(dir, 'reference.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const v: unknown = JSON.parse(line);
      if (typeof v !== 'object' || v === null) throw new Error(`bad reference line in ${packId}`);
      const r = v as Record<string, unknown>;
      if (typeof r['id'] !== 'string' || typeof r['answer'] !== 'string' || !Array.isArray(r['toolCalls'])) {
        throw new Error(`bad reference schema in ${packId}: ${JSON.stringify(r['id'])}`);
      }
      for (const tc of r['toolCalls'] as unknown[]) {
        if (typeof tc !== 'object' || tc === null) throw new Error('bad toolCall');
        const t = tc as Record<string, unknown>;
        if (typeof t['name'] !== 'string' || typeof t['args'] !== 'object' || t['args'] === null) {
          throw new Error('bad toolCall shape');
        }
      }
      return v as unknown as ReferenceEntry;
    });
  return { manifest, samples, reference };
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

function countFiles(dir: string): number {
  return walkFiles(dir).length;
}

const fsPack = readPack('fab-fs-tasks');
const skillPack = readPack('fab-skill');
const cpPack = readPack('fab-compaction');

describe('fab-b pack manifests', () => {
  it('fab-fs-tasks manifest is A3/agentic with 8/30/30 tiers', () => {
    const m = fsPack.manifest;
    expect(m.id).toBe('fab-fs-tasks');
    expect(m.version).toBe('1.0.0');
    expect(m.kind).toBe('agentic');
    expect(m.category).toBe('A3');
    expect(m.tiers).toEqual({ smoke: 8, standard: 30, full: 30 });
    expect(m.stratifyBy).toBe('task');
    expect(m.defaults.maxTurns).toBe(12);
    expect(m.defaults.timeoutSec).toBe(300);
    expect(m.requires.toolCalling).toBe(true);
  });
  it('fab-skill manifest is A5/agentic trusted with 5/10/10 tiers', () => {
    const m = skillPack.manifest;
    expect(m.id).toBe('fab-skill');
    expect(m.version).toBe('1.0.0');
    expect(m.kind).toBe('agentic');
    expect(m.category).toBe('A5');
    expect(m.tiers).toEqual({ smoke: 5, standard: 10, full: 10 });
    expect(m.trusted).toBe(true);
  });
  it('fab-compaction manifest is A6/compaction_recall with accuracy + compactionMs metrics', () => {
    const m = cpPack.manifest;
    expect(m.id).toBe('fab-compaction');
    expect(m.version).toBe('1.0.0');
    expect(m.kind).toBe('compaction_recall');
    expect(m.category).toBe('A6');
    expect(m.tiers).toEqual({ smoke: 3, standard: 10, full: 10 });
    const metricIds = m.metrics.map((x) => x.id);
    expect(metricIds).toContain('accuracy');
    const aux = m.metrics.find((x) => x.id === 'compaction-ms');
    expect(aux?.source).toBe('trial_field');
    expect(aux?.field).toBe('extra.compactionMs');
  });
});

describe('fab-b sample identity', () => {
  it.each([
    ['fab-fs-tasks', fsPack, 30],
    ['fab-skill', skillPack, 10],
    ['fab-compaction', cpPack, 10],
  ] as Array<[string, LoadedPackFiles, number]>)(
    '%s has %s unique samples and matching reference ids',
    (_packId, pack, expected) => {
      expect(pack.samples).toHaveLength(expected);
      expect(new Set(pack.samples.map((s) => s.id)).size).toBe(expected);
      expect(new Set(pack.reference.map((r) => r.id)).size).toBe(expected);
      expect([...pack.reference.map((r) => r.id)].sort()).toEqual(
        [...pack.samples.map((s) => s.id)].sort(),
      );
      for (const r of pack.reference) {
        expect(r.answer.length).toBeGreaterThan(0);
      }
    },
  );
});

describe('fab-fs-tasks structure', () => {
  const byTask = (task: string): EvalSample[] =>
    fsPack.samples.filter((s) => (s.metadata?.['task'] as string) === task);

  it('covers 5 tasks with 6/8/6/5/5 samples and difficulty 12/12/6', () => {
    expect(byTask('locate-answer')).toHaveLength(6);
    expect(byTask('edit-single')).toHaveLength(8);
    expect(byTask('create-summary')).toHaveLength(6);
    expect(byTask('multi-file-refactor')).toHaveLength(5);
    expect(byTask('search-aggregate')).toHaveLength(5);
    const diff = [1, 2, 3].map(
      (d) => fsPack.samples.filter((s) => s.metadata?.['difficulty'] === d).length,
    );
    expect(diff).toEqual([12, 12, 6]);
  });

  it('has exactly 5 reliability tags, one per task', () => {
    const tagged = fsPack.samples.filter((s) => s.tags?.includes('reliability'));
    expect(tagged).toHaveLength(5);
    expect(new Set(tagged.map((s) => s.metadata?.['task'] as string)).size).toBe(5);
  });

  it('all samples carry fs_state gate + trajectory maxCalls 20', () => {
    for (const s of fsPack.samples) {
      const types = (s.scorers ?? []).map((x) => x.type);
      expect(types).toContain('fs_state');
      expect(types).toContain('trajectory');
      const gate = s.scorers?.find((x) => x.type === 'fs_state');
      expect(gate?.gate).toBe(true);
      const traj = s.scorers?.find((x) => x.type === 'trajectory');
      expect(traj?.weight).toBe(0.3);
      expect(s.trajectory?.maxCalls).toBe(20);
    }
  });

  it('locate-answer uses includes w0.2 with mustNotCall write/edit', () => {
    for (const s of byTask('locate-answer')) {
      const inc = s.scorers?.find((x) => x.type === 'includes');
      expect(inc?.weight).toBe(0.2);
      expect(s.trajectory?.mustNotCall).toContain('write');
      expect(s.trajectory?.mustNotCall).toContain('edit');
    }
  });

  it('locate targets resolve against fixture files', () => {
    for (const s of byTask('locate-answer')) {
      const target = s.target as string[];
      const dir = join(EVALS, 'fab-fs-tasks', s.fixture?.dir ?? '');
      const content = readFileSync(join(dir, target[0]), 'utf8');
      expect(content).toContain(target[1]);
    }
  });

  it('edit-single notContains strings exist pre-edit', () => {
    for (const s of byTask('edit-single')) {
      const dir = join(EVALS, 'fab-fs-tasks', s.fixture?.dir ?? '');
      for (const exp of s.expectState ?? []) {
        const pathExp = asPathExpectation(exp);
        if (!pathExp || pathExp.notContains === undefined) continue;
        const content = readFileSync(join(dir, pathExp.path), 'utf8');
        for (const old of pathExp.notContains) expect(content).toContain(old);
      }
    }
  });

  it('multi-file-refactor new names are absent and old names present pre-edit', () => {
    for (const s of byTask('multi-file-refactor')) {
      const dir = join(EVALS, 'fab-fs-tasks', s.fixture?.dir ?? '');
      for (const exp of s.expectState ?? []) {
        const pathExp = asPathExpectation(exp);
        if (!pathExp || pathExp.contains === undefined) continue;
        const content = readFileSync(join(dir, pathExp.path), 'utf8');
        for (const fresh of pathExp.contains) expect(content).not.toContain(fresh);
      }
      const allText = (s.expectState ?? [])
        .map((exp) => asPathExpectation(exp))
        .filter((exp): exp is PathExpectation => exp !== null)
        .map((exp) => readFileSync(join(dir, exp.path), 'utf8'))
        .join('\n');
      const oldName = s.id === 'mr-05' ? 'sum' : (s.expectState?.[0] as { notContains?: string[] })?.notContains?.[0] ?? '';
      expect(allText).toContain(oldName);
    }
  });

  it('create-summary keywords are demanded by the prompt and maxFiles matches fixtures', () => {
    for (const s of byTask('create-summary')) {
      const dir = join(EVALS, 'fab-fs-tasks', s.fixture?.dir ?? '');
      expect(readdirSync(dir)).not.toContain('SUMMARY.md');
      for (const exp of s.expectState ?? []) {
        const pathExp = asPathExpectation(exp);
        if (!pathExp || pathExp.contains === undefined) continue;
        for (const kw of pathExp.contains) expect(s.input as string).toContain(kw);
      }
      const cap = (s.expectState ?? [])
        .map((exp) => asGlobCap(exp))
        .find((exp): exp is GlobCap => exp !== null && exp.maxFiles !== undefined);
      expect(cap?.maxFiles).toBe(countFiles(dir) + 1);
    }
  });

  it('search-aggregate targets match recomputed fix counts in CHANGELOG.md', () => {
    const text = readFileSync(
      join(EVALS, 'fab-fs-tasks', 'fixtures', 'docs-mixed', 'CHANGELOG.md'),
      'utf8',
    );
    const sections = text.split(/^## \[/m).slice(1);
    const countFix = (scope: string): number => {
      const want = (v: string): boolean =>
        scope === '1.x'
          ? v.startsWith('1.')
          : scope === '2.x'
            ? v.startsWith('2.')
            : scope.split('+').includes(v);
      let n = 0;
      for (const sec of sections) {
        const version = sec.slice(0, sec.indexOf(']'));
        if (!want(version)) continue;
        for (const line of sec.split('\n')) if (line.includes('fix')) n += 1;
      }
      return n;
    };
    for (const s of byTask('search-aggregate')) {
      expect(s.target).toBe(countFix(s.metadata?.['scope'] as string));
      expect(s.scorers?.some((x) => x.type === 'numeric')).toBe(true);
    }
  });

  it('fs-tasks fixtures stay under the 200KB cap', () => {
    let bytes = 0;
    for (const f of walkFiles(join(EVALS, 'fab-fs-tasks', 'fixtures'))) {
      bytes += readFileSync(f).length;
    }
    expect(bytes).toBeLessThanOrEqual(200 * 1024);
  });

  // P10-11 owns fs_state/trajectory scorer execution: assert only that the
  // spec types exist in the schema. Do NOT resolve them via getScorer here.
  it('fs_state/trajectory scorer execution is deferred to P10-11 (structural only)', () => {
    expect(SCORER_TYPES).toContain('fs_state');
    expect(SCORER_TYPES).toContain('trajectory');
    expect(() => getScorer('includes')).not.toThrow();
    expect(() => getScorer('numeric')).not.toThrow();
  });
});

describe('fab-skill structure', () => {
  const SKILLS = ['release-notes', 'meeting-minutes', 'commit-message'];

  it('SKILL.md files carry Agent Skills frontmatter with matching names', () => {
    for (const name of SKILLS) {
      const text = readFileSync(
        join(EVALS, 'fab-skill', 'fixtures', 'skill-ws', '.agents', 'skills', name, 'SKILL.md'),
        'utf8',
      );
      const match = /^---\nname: (\S+)\ndescription: (.+)\n---\n/s.exec(text);
      expect(match?.[1]).toBe(name);
      expect((match?.[2] ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  it('task prompts state the job without naming the skill mechanism', () => {
    for (const s of skillPack.samples) {
      const input = s.input as string;
      for (const name of SKILLS) expect(input).not.toContain(name);
      expect(input).not.toContain('.agents/skills');
      expect(input).not.toContain('SKILL.md');
    }
  });

  it('every sample requires reading its SKILL.md via trajectory w0.4', () => {
    for (const s of skillPack.samples) {
      const task = s.metadata?.['task'] as string;
      expect(s.trajectory?.mustReadPaths).toEqual([`.agents/skills/${task}/SKILL.md`]);
      const traj = s.scorers?.find((x) => x.type === 'trajectory');
      expect(traj?.weight).toBe(0.4);
    }
    const diff = [1, 2, 3].map(
      (d) => skillPack.samples.filter((s) => s.metadata?.['difficulty'] === d).length,
    );
    expect(diff).toEqual([4, 4, 2]);
  });

  it('commit-message reference answers score 100% with the existing regex scorer', async () => {
    const scorer = getScorer('regex');
    const signal = new AbortController().signal;
    for (const s of skillPack.samples.filter((x) => x.metadata?.['task'] === 'commit-message')) {
      const ref = skillPack.reference.find((r) => r.id === s.id);
      const spec = s.scorers?.find((x) => x.type === 'regex');
      const input: ScorerInput = {
        sample: s,
        pack: skillPack.manifest,
        outputText: ref?.answer ?? '',
        toolCalls: [],
      };
      const result = await scorer.score(input, spec?.options ?? {}, { signal });
      expect(result.value).toBe(1);
    }
  });
});

describe('fab-compaction structure and reference recall', () => {
  function tokensOf(input: EvalSample['input']): number {
    const msgs = Array.isArray(input) ? input : [{ role: 'user' as const, content: input }];
    return msgs.reduce((a, m) => a + Math.ceil(m.content.length / 4), 0);
  }

  it('inputs are 41-59 alternating messages ending with a question', () => {
    for (const s of cpPack.samples) {
      expect(Array.isArray(s.input)).toBe(true);
      const msgs = s.input as Array<{ role: string; content: string }>;
      expect(msgs.length).toBeGreaterThanOrEqual(41);
      expect(msgs.length).toBeLessThanOrEqual(59);
      msgs.forEach((m, i) => {
        expect(m.role).toBe(i % 2 === 0 ? 'user' : 'assistant');
      });
      expect(msgs[msgs.length - 1]?.content.endsWith('?')).toBe(true);
      const tokens = tokensOf(s.input);
      expect(tokens).toBeGreaterThanOrEqual(12000);
      expect(tokens).toBeLessThanOrEqual(20000);
      const quarter = msgs
        .slice(0, Math.floor(msgs.length / 4))
        .map((m) => m.content)
        .join('\n');
      expect(quarter).toContain((s.target as string[])[0]);
    }
  });

  it('reference answers score 100% with the existing includes scorer', async () => {
    const scorer = getScorer('includes');
    const signal = new AbortController().signal;
    let total = 0;
    for (const s of cpPack.samples) {
      const ref = cpPack.reference.find((r) => r.id === s.id);
      const spec = s.scorers?.find((x) => x.type === 'includes');
      const input: ScorerInput = {
        sample: s,
        pack: cpPack.manifest,
        outputText: ref?.answer ?? '',
        toolCalls: [],
      };
      const result = await scorer.score(input, spec?.options ?? {}, { signal });
      expect(result.value).toBe(1);
      total += result.value;
    }
    expect(total).toBe(cpPack.samples.length);
  });
});

describe('fab-b encoding and hygiene', () => {
  it('all pack files are UTF-8 without BOM or CR, with no PII patterns', () => {
    const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
    const phone = /010-\d{4}-\d{4}/;
    for (const packId of ['fab-fs-tasks', 'fab-skill', 'fab-compaction']) {
      for (const f of walkFiles(join(EVALS, packId))) {
        const buf = readFileSync(f);
        expect(buf[0]).not.toBe(0xef);
        expect(buf.includes(0x0d)).toBe(false);
        const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
        expect(text).not.toMatch(email);
        expect(text).not.toMatch(phone);
        expect(text).not.toContain('주민등록');
      }
    }
  });
});

describe('compaction recall solver registration', () => {
  it('registers without touching the P10-10 owned runner index', () => {
    expect(typeof compactionRecallSolver).toBe('function');
    expect(() => registerCompactionSolver()).not.toThrow();
    expect(localSolverKinds()).toContain(COMPACTION_RECALL_KIND);
    expect(COMPACTION_RECALL_KIND).toBe('compaction_recall');
  });
});
