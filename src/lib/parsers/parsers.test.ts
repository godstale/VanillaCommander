import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EXTERNAL_PARSER_PRESETS,
  splitCommand,
  substituteTokens,
} from './external';
import { parseDocument, ParseError } from './index';
import { parseBuiltinDocument } from './builtin';
import { runIntegrationCli } from '@/lib/integrations/cliRunner';

vi.mock('./builtin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./builtin')>();
  return {
    ...actual,
    parseBuiltinDocument: vi.fn(),
  };
});

vi.mock('@/lib/integrations/cliRunner', () => ({
  runIntegrationCli: vi.fn(),
}));

vi.mock('@/lib/commander/ipc', () => ({
  fcReadFileBytes: vi.fn(),
  fcOfficeText: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === 'find_executable') return 'C:/tools/pandoc.exe';
    throw new Error(`unexpected invoke: ${cmd}`);
  }),
}));

const mockedBuiltin = vi.mocked(parseBuiltinDocument);
const mockedCli = vi.mocked(runIntegrationCli);

describe('external parser helpers', () => {
  it('exposes one preset per supported tool', () => {
    const ids = EXTERNAL_PARSER_PRESETS.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(['markitdown', 'docling', 'pandoc', 'libreoffice']),
    );
    for (const p of EXTERNAL_PARSER_PRESETS) {
      expect(p.command).toContain('{input}');
      expect(['stdout', 'file']).toContain(p.outputMode);
    }
  });

  it('splits commands while keeping quoted segments', () => {
    expect(splitCommand('pandoc "{input}" -t markdown')).toEqual([
      'pandoc',
      '{input}',
      '-t',
      'markdown',
    ]);
    expect(
      splitCommand('soffice --headless --convert-to "txt:Text (encoded):UTF8" --outdir "{outputDir}"'),
    ).toEqual([
      'soffice',
      '--headless',
      '--convert-to',
      'txt:Text (encoded):UTF8',
      '--outdir',
      '{outputDir}',
    ]);
    expect(splitCommand('  ')).toEqual([]);
  });

  it('substitutes input/output tokens', () => {
    expect(
      substituteTokens(['{input}', '--outdir', '{outputDir}', '{output}'], {
        input: 'C:/a/b.pdf',
        output: 'C:/w/out.txt',
        outputDir: 'C:/w',
      }),
    ).toEqual(['C:/a/b.pdf', '--outdir', 'C:/w', 'C:/w/out.txt']);
  });
});

describe('parseDocument dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers the configured external parser', async () => {
    mockedCli.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '# Converted',
      stderr: '',
      timedOut: false,
    });
    const out = await parseDocument('C:/docs/a.pdf', {
      parsers: {
        overrides: {
          pdf: { command: 'pandoc "{input}" -t markdown', outputMode: 'stdout' },
        },
      },
    });
    expect(out.method).toBe('external:pandoc');
    expect(out.text).toBe('# Converted');
    expect(mockedBuiltin).not.toHaveBeenCalled();
    expect(mockedCli).toHaveBeenCalledWith(
      expect.objectContaining({
        executablePath: 'C:/tools/pandoc.exe',
        args: ['C:/docs/a.pdf', '-t', 'markdown'],
      }),
    );
  });

  it('falls back to builtin when the external parser fails', async () => {
    mockedCli.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'boom',
      timedOut: false,
    });
    mockedBuiltin.mockResolvedValueOnce({
      text: 'builtin text',
      truncated: false,
      method: 'text',
    });
    const out = await parseDocument('C:/docs/a.pdf', {
      parsers: {
        overrides: { pdf: { command: 'pandoc "{input}"', outputMode: 'stdout' } },
      },
    });
    expect(out.text).toBe('builtin text');
    expect(mockedBuiltin).toHaveBeenCalledWith('C:/docs/a.pdf');
  });

  it('reports scanned PDFs as failures needing OCR/vision', async () => {
    mockedBuiltin.mockResolvedValueOnce({
      text: '   ',
      truncated: false,
      method: 'pdfjs',
      pages: 3,
    });
    await expect(parseDocument('C:/docs/scan.pdf')).rejects.toMatchObject({
      name: 'ParseError',
      reason: 'scanned-pdf',
    } satisfies { name: string; reason: string });
  });

  it('accepts short but real PDF text', async () => {
    mockedBuiltin.mockResolvedValueOnce({
      text: '[page 1]\nhello world, this is a real short document with enough words.',
      truncated: false,
      method: 'pdfjs',
      pages: 1,
    });
    const out = await parseDocument('C:/docs/short.pdf');
    expect(out.method).toBe('pdfjs');
  });

  it('rejects binary content for unknown extensions', async () => {
    mockedBuiltin.mockResolvedValueOnce({
      text: 'MZ\0binary',
      truncated: false,
      method: 'text',
    });
    const err = await parseDocument('C:/bin/tool.exe').catch((e) => e);
    expect(err).toBeInstanceOf(ParseError);
    expect((err as ParseError).reason).toBe('unsupported');
  });

  it('wraps builtin read failures', async () => {
    mockedBuiltin.mockRejectedValueOnce(new Error('denied'));
    const err = await parseDocument('C:/docs/a.pdf').catch((e) => e);
    expect(err).toBeInstanceOf(ParseError);
    expect((err as ParseError).reason).toBe('read-failed');
  });
});
