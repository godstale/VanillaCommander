import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getImportPreset, IMPORT_PRESETS } from '../interop/importPresets';
import type { EvalPackManifest, EvalSample } from '../types';
import { createMemoryPackFs } from './packFs';
import { loadPack, listPacks } from './packLoader';

const PACKS_ROOT = join(process.cwd(), 'src-tauri', 'resources', 'evals');

interface PackExpect {
  id: string;
  samples: number;
  category: string;
  kind: string;
  lang: string[];
  license: string;
  tiers: { smoke: number; standard: number; full: number | 'all' };
  stratifyBy?: string;
}

// Expected bundle sizes recorded at build time (2026-09-25).
const PACKS: PackExpect[] = [
  { id: 'gsm8k', samples: 1319, category: 'Q2', kind: 'single_turn', lang: ['en'], license: 'MIT', tiers: { smoke: 20, standard: 100, full: 'all' } },
  { id: 'gsm8k-perturb', samples: 100, category: 'Q2', kind: 'single_turn', lang: ['en'], license: 'MIT', tiers: { smoke: 20, standard: 100, full: 100 } },
  { id: 'mmlu-pro', samples: 1400, category: 'Q1', kind: 'single_turn', lang: ['en'], license: 'MIT', tiers: { smoke: 28, standard: 140, full: 'all' }, stratifyBy: 'category' },
  { id: 'ifeval', samples: 541, category: 'Q3', kind: 'single_turn', lang: ['en'], license: 'Apache-2.0', tiers: { smoke: 20, standard: 100, full: 'all' } },
  { id: 'ko-ifeval', samples: 342, category: 'Q3', kind: 'single_turn', lang: ['ko'], license: 'Apache-2.0', tiers: { smoke: 20, standard: 100, full: 'all' } },
  { id: 'kmmlu', samples: 35030, category: 'Q1', kind: 'single_turn', lang: ['ko'], license: 'CC-BY-ND-4.0', tiers: { smoke: 45, standard: 450, full: 2250 }, stratifyBy: 'subject' },
  { id: 'kobest', samples: 1000, category: 'Q1', kind: 'single_turn', lang: ['ko'], license: 'CC-BY-SA-4.0', tiers: { smoke: 25, standard: 250, full: 'all' }, stratifyBy: 'task' },
  { id: 'humaneval-plus', samples: 164, category: 'Q5', kind: 'single_turn', lang: ['en'], license: 'Apache-2.0', tiers: { smoke: 10, standard: 50, full: 'all' } },
  { id: 'bfcl', samples: 500, category: 'A1', kind: 'tool_call', lang: ['en'], license: 'Apache-2.0', tiers: { smoke: 20, standard: 100, full: 500 }, stratifyBy: 'subtype' },
];

// sha256 of the 45 unmodified KMMLU origin CSVs, recorded at download time.
const KMMLU_HASHES: Record<string, string> = {
  'data/Accounting-test.csv': '57f9ad22a932fdcf8891f32ab15f3651f28af951681a82ab78a3763f3ec58730',
  'data/Agricultural-Sciences-test.csv': '3ba04eee8e5738d3fd8416d3f87d93a7e3b85b90165049cfbcd32d4e190ea7e2',
  'data/Aviation-Engineering-and-Maintenance-test.csv': '6be70548311599cc9e657931369e22d0eaef49dc2a86572b61463350be61c696',
  'data/Biology-test.csv': '024b729adabc6316e5109fd218bb72d255990239a7614c15bf1fead5e2fe94d7',
  'data/Chemical-Engineering-test.csv': 'd663acd53b86caa55a4c3d8fa3b63b78670622b50bd1e02e0366a1a439f38412',
  'data/Chemistry-test.csv': '6fcb111504024f9e5cfd4af994ac39747466bca27434726faa696209689b9d6f',
  'data/Civil-Engineering-test.csv': 'ace4a1b7b943c74b99b08c11d2e2fd2195d26b7acec51974ff91837494776d43',
  'data/Computer-Science-test.csv': '1f4ea55c56b0045f3cbbb1934f52f80d0890b9750438502e48cb74f8ddbc1c32',
  'data/Construction-test.csv': '283007f0fb2847c094e409dcc233c6500d104a7baa85249957480c9ad25c58d9',
  'data/Criminal-Law-test.csv': '997d867568fb7f12486d938645e2a95fe1f541c591a426cbd16b2dbf6fb5c601',
  'data/Ecology-test.csv': '9393f1e0fd85732366dba000b63f88d8bf6c9f08d8bcf192de0c5b9d9e750c0c',
  'data/Economics-test.csv': '5dd198f9aea4b9131ee2532c7daa0e861ccf24d61add29822683d5aec2ad54bb',
  'data/Education-test.csv': '7c75aafb5ae29f42294b9be600c0db7df1aa003f9005198624d696d18b1a5b17',
  'data/Electrical-Engineering-test.csv': '0425e8e56bde00ea81b895179663629f81a49970f6ad09c1a3b11315a990aa9a',
  'data/Electronics-Engineering-test.csv': 'd10d9a2158c60379ecadb299939f92feec17c615811773c6882138d5b07df885',
  'data/Energy-Management-test.csv': 'be658506ed332d17f8ef3909f0795a083c768f52b94d56d80d90e12d909fccc0',
  'data/Environmental-Science-test.csv': '0d0bccb6a823b4c7e8bdbf9232034176fd00185e4e2a14dcb769100f19628adf',
  'data/Fashion-test.csv': 'a2d654566f485d63246fab0fe9dc9e6884935c4146d0512a9aa6cefd2b7d8250',
  'data/Food-Processing-test.csv': '4c8b43760631fd8ce5436015baa939004da5d661778903d7008c3dd44e69ced9',
  'data/Gas-Technology-and-Engineering-test.csv': '3e51efdffe7ec98bd756a8001ed80ef6e675d287cbd72481752bc862afcd0f48',
  'data/Geomatics-test.csv': 'e9b7e5119f2b1eb555b6b93b0b61b5dcf500ce5d9978677e5c166d4c70b81365',
  'data/Health-test.csv': '88814c54e05aab2d99519d211c672efbb2daff3acc337d315d4a398a63f5da07',
  'data/Industrial-Engineer-test.csv': 'ae20b5ee0687f8bce947ec161e4fa3a81bcba56de6605977bac8a8aaa78ec2cf',
  'data/Information-Technology-test.csv': '44576d84cf99731cabbcf826a5476622a67d47c6619bb9c2230d6ef3d89ffc09',
  'data/Interior-Architecture-and-Design-test.csv': 'ad211ff9d8447f0dc35856fa28848df28fced19d4252ecb1dc175d11895e1dae',
  'data/Law-test.csv': 'dfd473e541ebffe09e1257ee1d9d4a5aa2dab1c26c09710757e870b8c81c862d',
  'data/Machine-Design-and-Manufacturing-test.csv': '4c454b6a9bf02730a453ae9b433b3086ef005812e19267d051a47b9ef35eba4c',
  'data/Management-test.csv': 'ccf0b3ab0aec012225d61fed7b35ed94b1b5020bf851309b6cfd4406ce604693',
  'data/Maritime-Engineering-test.csv': '837c27023bea505e16b0fd568d494ff261e0cf008630c3b6b237dc45458973ec',
  'data/Marketing-test.csv': 'a4958fe910b4415e3f5893ccc767558ba1b7641e705a3089b419be5126d66a29',
  'data/Materials-Engineering-test.csv': '04cc20ab3f6da895e62db01a0312ee719c94d628969a4db0999abf10e57d0745',
  'data/Mechanical-Engineering-test.csv': 'ddeec8f94d4e5a1e9c6d4c0f09d6c9163383c2907475194d9f7ac4564826051e',
  'data/Nondestructive-Testing-test.csv': 'acab3a30ab9c184b6780f805c262289d99cd8d30467cc846d9094309f7e3e97e',
  'data/Patent-test.csv': 'a220242616aca2c110303f78dafc7996f5683cf6c7f8a5e1df46c7fe4840894e',
  'data/Political-Science-and-Sociology-test.csv': 'e4ca34705fa5a2846dd3b3c297736f19065293c495929aa45e287c2d3e1c1034',
  'data/Psychology-test.csv': '625ed34880528dda3b43bcc8e67b067aa9ba4d0df24c14a983adf555b4be16e0',
  'data/Public-Safety-test.csv': '0a8a26de738adbf0be1aa8c24c3daf8a36f543b65bc616812f606618284e4806',
  'data/Railway-and-Automotive-Engineering-test.csv': 'f6ff7b40ce388ef7c8913c99304f508266a9f711c49204598288cda279d1c77d',
  'data/Real-Estate-test.csv': '29a6cb8f8eb2a6ba49bc9801506625c0b7b7898c6e186186e10ff63989eedfc5',
  'data/Refrigerating-Machinery-test.csv': '459769c594fb4c32db593f1e87b2f2ba47cbabe94cab10f954de4b222d7058de',
  'data/Social-Welfare-test.csv': 'fd957f11e87848b7e83a9f2997cfbe4df8c1aaa0b22af10a6243758a61465204',
  'data/Taxation-test.csv': 'dcfbd0393cb7556d838c93b3dac32007747a81c616fb7c73a7dedc6e31716af3',
  'data/Telecommunications-and-Wireless-Technology-test.csv': 'c732e5b12a931e1cc7f187d11306e92729516b74f0ff3ac775d2f6a231a3d46d',
  'data/korean-history-test.csv': 'd7ed0a2d581f754462248fea8aa8379df67de6c34b95c1eecc7705182426ed4a',
  'data/math-test.csv': '11ac1c99414f4b583f611e849df4842f1a61a212b2525b79dd9c355294850fd4',
}

function readPackFiles(packId: string): Record<string, string> {
  const manifestText = readFileSync(join(PACKS_ROOT, packId, 'manifest.json'), 'utf8');
  const files: Record<string, string> = { 'manifest.json': manifestText };
  const manifest = JSON.parse(manifestText) as { source: { type: string; file?: string; files?: string[] } };
  if (manifest.source.type === 'jsonl' && manifest.source.file) {
    files[manifest.source.file] = readFileSync(join(PACKS_ROOT, packId, manifest.source.file), 'utf8');
  }
  if (manifest.source.type === 'kmmlu-csv' && manifest.source.files) {
    for (const f of manifest.source.files) {
      files[f] = readFileSync(join(PACKS_ROOT, packId, f), 'utf8');
    }
  }
  return files;
}

async function loadPublicPack(packId: string): Promise<{ manifest: EvalPackManifest; samples: EvalSample[]; diagnostics: { sampleId: string | null; message: string }[] }> {
  const fs = createMemoryPackFs({ builtin: { [packId]: readPackFiles(packId) } });
  const { refs, errors } = await listPacks(fs);
  expect(errors).toEqual([]);
  const ref = refs.find((r) => r.manifest.id === packId);
  expect(ref).toBeDefined();
  const pack = await loadPack(fs, ref!);
  return { manifest: pack.manifest, samples: pack.samples, diagnostics: pack.diagnostics };
}

function spotIndices(n: number): number[] {
  return [0, Math.floor(n / 2), n - 1];
}

function countBy<T>(items: T[], key: (t: T) => string | number | boolean | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const item of items) {
    const k = String(key(item) ?? '__missing__');
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

describe('public packs', () => {
  for (const exp of PACKS) {
    describe(exp.id, () => {
      it('manifest is zod-valid with expected tiers/category/kind', async () => {
        const { manifest } = await loadPublicPack(exp.id);
        expect(manifest.id).toBe(exp.id);
        expect(manifest.version).toBe('1.0.0');
        expect(manifest.schemaVersion).toBe('1.0');
        expect(manifest.category).toBe(exp.category);
        expect(manifest.kind).toBe(exp.kind);
        expect(manifest.lang).toEqual(exp.lang);
        expect(manifest.license.id).toBe(exp.license);
        expect(manifest.tiers.smoke).toBe(exp.tiers.smoke);
        expect(manifest.tiers.standard).toBe(exp.tiers.standard);
        expect(manifest.tiers.full).toBe(exp.tiers.full);
        expect(manifest.stratifyBy).toBe(exp.stratifyBy);
        expect(manifest.metrics.length).toBeGreaterThan(0);
        expect(manifest.scorers.length).toBeGreaterThan(0);
      });

      it('samples load via loader with unique ids and sane counts', async () => {
        const { samples, diagnostics, manifest } = await loadPublicPack(exp.id);
        expect(samples.length).toBe(exp.samples);
        expect(samples.length).toBeGreaterThan(manifest.tiers.smoke);
        expect(diagnostics.filter((d) => d.message.includes('duplicate sample id'))).toEqual([]);
      });

      it('exactly 10 fixed-seed samples carry the reliability tag', async () => {
        const { samples } = await loadPublicPack(exp.id);
        const tagged = samples.filter((s) => s.tags?.includes('reliability'));
        expect(tagged).toHaveLength(10);
        expect(new Set(tagged.map((s) => s.id)).size).toBe(10);
      });

      it('stratify key present on every sample', async () => {
        if (!exp.stratifyBy) return;
        const { samples } = await loadPublicPack(exp.id);
        for (const s of samples) {
          expect(s.metadata?.[exp.stratifyBy!]).toBeDefined();
        }
      });
    });
  }

  describe('choice packs (mmlu-pro, kmmlu, kobest)', () => {
    for (const packId of ['mmlu-pro', 'kmmlu', 'kobest']) {
      it(`${packId}: spot-check choices+target`, async () => {
        const { samples } = await loadPublicPack(packId);
        for (const i of spotIndices(samples.length)) {
          const s = samples[i];
          expect(s.choices!.length).toBeGreaterThanOrEqual(2);
          expect(typeof s.target).toBe('string');
          expect('ABCDEFGHIJ'.slice(0, s.choices!.length)).toContain(s.target as string);
        }
      });
    }

    it('mmlu-pro: 100 per category x 14', async () => {
      const { samples } = await loadPublicPack('mmlu-pro');
      const byCat = countBy(samples, (s) => s.metadata?.['category']);
      expect(byCat.size).toBe(14);
      for (const [, n] of byCat) expect(n).toBe(100);
    });

    it('kobest: 200 per task x 5', async () => {
      const { samples } = await loadPublicPack('kobest');
      const byTask = countBy(samples, (s) => s.metadata?.['task']);
      expect([...byTask.keys()].sort()).toEqual(['boolq', 'copa', 'hellaswag', 'sentineg', 'wic']);
      for (const [, n] of byTask) expect(n).toBe(200);
    });

    it('kmmlu: 45 subjects covered', async () => {
      const { samples } = await loadPublicPack('kmmlu');
      const bySubject = countBy(samples, (s) => s.metadata?.['subject']);
      expect(bySubject.size).toBe(45);
    });
  });

  describe('numeric packs (gsm8k, gsm8k-perturb)', () => {
    for (const packId of ['gsm8k', 'gsm8k-perturb']) {
      it(`${packId}: spot-check numeric target, no solution text`, async () => {
        const { samples } = await loadPublicPack(packId);
        for (const i of spotIndices(samples.length)) {
          const s = samples[i];
          expect(typeof s.target).toBe('number');
          expect(Number.isFinite(s.target as number)).toBe(true);
          expect(s.reference).toBeUndefined();
          expect(String(s.input)).not.toContain('####');
        }
      });
    }
  });

  describe('ifeval packs', () => {
    for (const packId of ['ifeval', 'ko-ifeval']) {
      it(`${packId}: spot-check ifeval[] entries`, async () => {
        const { samples } = await loadPublicPack(packId);
        for (const i of spotIndices(samples.length)) {
          const s = samples[i];
          expect(s.ifeval!.length).toBeGreaterThan(0);
          for (const ins of s.ifeval!) {
            expect(typeof ins.id).toBe('string');
            expect(ins.id.length).toBeGreaterThan(0);
            expect(typeof ins.kwargs).toBe('object');
          }
        }
      });

      it(`${packId}: strict+loose scorers and metrics declared`, async () => {
        const { manifest } = await loadPublicPack(packId);
        const modes = manifest.scorers
          .filter((s) => s.type === 'ifeval')
          .map((s) => (s.options as { mode?: string }).mode)
          .sort();
        expect(modes).toEqual(['loose', 'strict']);
        expect(manifest.metrics.map((m) => m.id).sort()).toEqual(['prompt-loose', 'prompt-strict']);
      });
    }
  });

  describe('humaneval-plus', () => {
    it('spot-check code payload (python + entryPoint + check call)', async () => {
      const { samples } = await loadPublicPack('humaneval-plus');
      for (const i of spotIndices(samples.length)) {
        const s = samples[i];
        expect(s.code?.language).toBe('python');
        expect(s.code?.entryPoint.length).toBeGreaterThan(0);
        expect(s.code?.tests).toContain(`check(${s.code?.entryPoint})`);
        expect(typeof s.reference).toBe('string');
      }
    });

    it('declares python codeRuntime requirement', async () => {
      const { manifest } = await loadPublicPack('humaneval-plus');
      expect(manifest.requires?.codeRuntime).toBe('python');
    });
  });

  describe('bfcl', () => {
    it('100 per subtype x 5; irrelevance has no expectedToolCalls', async () => {
      const { samples } = await loadPublicPack('bfcl');
      const bySubtype = countBy(samples, (s) => s.metadata?.['subtype']);
      expect([...bySubtype.keys()].sort()).toEqual([
        'irrelevance', 'multiple', 'parallel', 'parallel_multiple', 'simple',
      ]);
      for (const [, n] of bySubtype) expect(n).toBe(100);
      const irr = samples.filter((s) => s.metadata?.['subtype'] === 'irrelevance');
      expect(irr.length).toBe(100);
      for (const s of irr.slice(0, 3)) {
        expect(s.tools!.length).toBeGreaterThan(0);
        expect(s.expectedToolCalls).toBeUndefined();
        expect(s.scorers?.[0]?.type).toBe('no_tool_call');
      }
      const live = samples.filter((s) => s.metadata?.['subtype'] !== 'irrelevance');
      for (const s of [live[0], live[Math.floor(live.length / 2)], live[live.length - 1]]) {
        expect(s.tools!.length).toBeGreaterThan(0);
        expect(s.expectedToolCalls!.length).toBeGreaterThan(0);
        for (const call of s.expectedToolCalls!) {
          for (const vals of Object.values(call.args)) {
            expect(Array.isArray(vals)).toBe(true);
          }
        }
        expect(s.scorers?.[0]?.type).toBe('tool_call_ast');
      }
    });

    it('declares toolCalling requirement', async () => {
      const { manifest } = await loadPublicPack('bfcl');
      expect(manifest.requires?.toolCalling).toBe(true);
    });
  });

  describe('kmmlu origin integrity', () => {
    it('45 data files byte-identical to download (sha256 re-read)', async () => {
      const { manifest } = await loadPublicPack('kmmlu');
      const files = manifest.source.type === 'kmmlu-csv' ? manifest.source.files : [];
      expect(files).toHaveLength(45);
      expect(Object.keys(KMMLU_HASHES)).toHaveLength(45);
      const onDisk = readdirSync(join(PACKS_ROOT, 'kmmlu', 'data')).sort();
      expect(onDisk).toHaveLength(45);
      for (const f of files) {
        const bytes = readFileSync(join(PACKS_ROOT, 'kmmlu', f));
        const sha = createHash('sha256').update(bytes).digest('hex');
        expect(sha).toBe(KMMLU_HASHES[f]);
      }
    });

    it('records the upstream math-test.csv header swap without editing origins', async () => {
      const math = readFileSync(join(PACKS_ROOT, 'kmmlu', 'data', 'math-test.csv'), 'utf8');
      const firstLine = math.slice(0, math.indexOf('\n')).trim();
      expect(firstLine).toBe('question,answer,A,B,C,D,Human Accuracy,Category');
      const hist = readFileSync(join(PACKS_ROOT, 'kmmlu', 'data', 'korean-history-test.csv'), 'utf8');
      expect(hist.slice(0, hist.indexOf('\n')).trim()).toBe(
        'question,answer,A,B,C,D,Category,Human Accuracy',
      );
      // The loader still yields math samples thanks to name-based mapping.
      const { samples } = await loadPublicPack('kmmlu');
      const mathSamples = samples.filter((s) => s.metadata?.['subject'] === 'math');
      expect(mathSamples.length).toBeGreaterThan(0);
      expect(mathSamples[0].target).toMatch(/^[A-D]$/);
    });
  });

  describe('import presets (non-bundled)', () => {
    it('exposes hae-rae/gpqa/click/logickor descriptors only', () => {
      expect(IMPORT_PRESETS.map((p) => p.id).sort()).toEqual(['click', 'gpqa', 'hae-rae', 'logickor']);
      for (const p of IMPORT_PRESETS) {
        expect(p.reason.length).toBeGreaterThan(0);
        expect(p.license.length).toBeGreaterThan(0);
        expect(p.importAs.length).toBeGreaterThan(0);
        expect(p.notes.length).toBeGreaterThan(0);
      }
      expect(getImportPreset('gpqa')?.source.kind).toBe('hf');
      const logic = getImportPreset('logickor');
      expect(logic?.source.kind).toBe('github-raw');
      if (logic?.source.kind === 'github-raw') {
        expect(logic.source.path).toBe('questions.jsonl');
      }
    });
  });
});
