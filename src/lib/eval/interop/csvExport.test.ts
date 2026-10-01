import { describe, expect, it } from 'vitest';
import { buildTrialsCsv, escapeCsvField } from './csvExport';
import { parseCsv } from '../packs/sources/csv';
import { makeReportData, makeScore, makeTrial } from './testReportData';

describe('escapeCsvField', () => {
  it('escapes quotes, commas and newlines per RFC 4180', () => {
    expect(escapeCsvField('plain')).toBe('plain');
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvField('')).toBe('');
  });
});

describe('buildTrialsCsv', () => {
  it('emits one row per score joined to its trial', () => {
    const data = makeReportData();
    data.trials = [makeTrial({ id: 't1', candidateId: 'cand-a' })];
    data.scores = [
      makeScore({ id: 's1', trialId: 't1', scorerKey: 'exact', value: 1 }),
      makeScore({ id: 's2', trialId: 't1', scorerKey: 'includes', scorerType: 'includes', value: 0.5, verdict: 'partial' }),
    ];
    const csv = buildTrialsCsv(data);
    const { rows } = parseCsv(csv);
    expect(rows[0]).toContain('scorer_key');
    expect(rows).toHaveLength(3);
    expect(rows[1][0]).toBe('run-1');
    expect(rows[1].slice(11, 14)).toEqual(['exact', '1', 'correct']);
    expect(rows[2].slice(11, 14)).toEqual(['includes', '0.5', 'partial']);
  });

  it('emits a row with empty score cells for scoreless trials', () => {
    const data = makeReportData();
    data.scores = [];
    const { rows } = parseCsv(buildTrialsCsv(data));
    expect(rows).toHaveLength(2);
    expect(rows[1].slice(11, 15)).toEqual(['', '', '', '']);
  });

  it('round-trips tricky output text and redacts GPQA rows', () => {
    const data = makeReportData();
    data.trials = [
      makeTrial({ id: 't1', candidateId: 'cand-a', outputText: 'a, "b"\nnewline' }),
      makeTrial({ id: 't2', candidateId: 'cand-a', packId: 'gpqa-diamond', sampleId: 'q1', outputText: 'secret' }),
    ];
    data.scores = [
      makeScore({ id: 's1', trialId: 't1' }),
      makeScore({ id: 's2', trialId: 't2' }),
    ];
    const { rows } = parseCsv(buildTrialsCsv(data));
    expect(rows[1][6]).toBe('a, "b"\nnewline');
    expect(rows[2][6]).toBe('');
    expect(rows[2][15]).toContain('gpqa-license');
  });
});
