import { describe, expect, it } from 'vitest';
import {
  convertHfMcqJsonl,
  hfFileUrl,
  importHfDataset,
  mapHfRecords,
  presetToHfInput,
  type HfImportDeps,
} from './hfImport';
import { IMPORT_PRESETS } from './importPresets';

function makeDeps(initial: Record<string, string>): HfImportDeps & { written: Map<string, Array<{ relPath: string; content: string }>>; removed: string[] } {
  const store = new Map(Object.entries(initial));
  const written = new Map<string, Array<{ relPath: string; content: string }>>();
  const removed: string[] = [];
  return {
    written,
    removed,
    downloadFile: async (_url, _scope, packId, relPath) => {
      store.set(`${packId}/${relPath}`, initial.source ?? '');
      return 42;
    },
    readPack: async (_scope, packId, relPath) => {
      const text = store.get(`${packId}/${relPath}`);
      if (text === undefined) throw new Error('not found');
      return text;
    },
    writePack: async (_scope, packId, files) => {
      written.set(packId, files);
      for (const f of files) store.set(`${packId}/${f.relPath}`, f.content);
    },
    removePack: async (_scope, packId) => {
      removed.push(packId);
      for (const key of [...store.keys()]) {
        if (key.startsWith(`${packId}/`)) store.delete(key);
      }
    },
  };
}

describe('convertHfMcqJsonl', () => {
  it('maps question/choices/answer with index answers to letters', () => {
    const text = [
      JSON.stringify({ question: 'Q1?', choices: ['a', 'b', 'c', 'd'], answer: 1 }),
      JSON.stringify({ question: 'Q2?', options: ['w', 'x', 'y', 'z'], answer: 'D' }),
    ].join('\n');
    const { samples, warnings } = convertHfMcqJsonl(text, {}, { packId: 'hf-mcq' });
    expect(warnings).toEqual([]);
    expect(samples[0]).toMatchObject({ input: 'Q1?', choices: ['a', 'b', 'c', 'd'], target: 'B' });
    expect(samples[1]).toMatchObject({ target: 'D', choices: ['w', 'x', 'y', 'z'] });
  });

  it('supports 1-based index answers', () => {
    const text = JSON.stringify({ question: 'Q?', choices: ['a', 'b'], answer: 2 });
    const { samples } = convertHfMcqJsonl(
      text,
      {},
      { packId: 'hf-mcq1', mcqAnswer: 'index1' },
    );
    expect(samples[0].target).toBe('B');
  });
});

describe('mapHfRecords', () => {
  it('splits delimited choice strings and passes metadata', () => {
    const warnings: string[] = [];
    const samples = mapHfRecords(
      [{ q: 'Pick?', opts: 'a|b|c', ans: 'b', subject: 'demo' }],
      { input: 'q', choices: 'opts', target: 'ans', metadata: 'subject' },
      { warnings },
    );
    expect(samples).toEqual([
      { id: 'hf-1', input: 'Pick?', choices: ['a', 'b', 'c'], target: 'b', metadata: { subject: 'demo' } },
    ]);
    expect(warnings).toEqual([]);
  });
});

describe('presetToHfInput', () => {
  it('reuses P10-24 HF preset descriptors', () => {
    const gpqa = IMPORT_PRESETS.find((p) => p.id === 'gpqa');
    expect(gpqa).toBeDefined();
    const input = presetToHfInput(gpqa!, {
      format: 'jsonl',
      fieldMap: { input: 'question', choices: 'choices', target: 'answer' },
      packId: 'gpqa-user',
    });
    expect(input?.repo).toBe('Idavidrein/gpqa');
    expect(input?.licenseId).toContain('gated');
  });

  it('returns null for non-HF presets', () => {
    const click = IMPORT_PRESETS.find((p) => p.id === 'click');
    expect(
      presetToHfInput(click!, {
        format: 'csv',
        fieldMap: { input: 'q' },
        packId: 'click-user',
      }),
    ).toBeNull();
  });
});

describe('hfFileUrl', () => {
  it('builds a resolve URL', () => {
    expect(hfFileUrl('org/ds', 'data/test.jsonl', 'main')).toBe(
      'https://huggingface.co/datasets/org/ds/resolve/main/data/test.jsonl',
    );
  });
});

describe('importHfDataset', () => {
  it('downloads to a staging pack, writes the user pack, and cleans up', async () => {
    const source = [
      JSON.stringify({ question: 'Q1?', choices: ['a', 'b'], answer: 0 }),
      JSON.stringify({ question: 'Q2?', choices: ['c', 'd'], answer: 1 }),
    ].join('\n');
    const deps = makeDeps({ source });
    const result = await importHfDataset(
      {
        repo: 'org/ds',
        path: 'data.jsonl',
        revision: 'main',
        format: 'jsonl',
        fieldMap: { input: 'question', choices: 'choices', target: 'answer' },
        mcqAnswer: 'index0',
        packId: 'hf-pack',
        licenseId: 'test-license',
      },
      deps,
    );
    expect(result).toMatchObject({ packId: 'hf-pack', sampleCount: 2 });
    const files = deps.written.get('hf-pack');
    expect(files?.map((f) => f.relPath).sort()).toEqual(['manifest.json', 'samples.jsonl']);
    const manifest = JSON.parse(files?.find((f) => f.relPath === 'manifest.json')?.content ?? '{}') as {
      trusted: boolean;
      category: string;
      license: { id: string };
    };
    expect(manifest.trusted).toBe(false);
    expect(manifest.category).toBe('Q9');
    expect(manifest.license.id).toBe('test-license');
    expect(deps.removed).toContain('hf-pack--import-tmp');
  });

  it('rejects parquet with a clear error', async () => {
    const deps = makeDeps({});
    await expect(
      importHfDataset(
        {
          repo: 'org/ds',
          path: 'data.parquet',
          format: 'parquet',
          fieldMap: { input: 'q' },
          packId: 'hf-pq',
        },
        deps,
      ),
    ).rejects.toThrow(/parquet is not supported/);
  });

  it('rejects invalid pack ids before downloading', async () => {
    const deps = makeDeps({});
    await expect(
      importHfDataset(
        { repo: 'org/ds', path: 'f.jsonl', format: 'jsonl', fieldMap: { input: 'q' }, packId: 'Bad_ID!' },
        deps,
      ),
    ).rejects.toThrow(/invalid pack id/);
  });
});
