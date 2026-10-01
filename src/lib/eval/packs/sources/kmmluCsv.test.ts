import { describe, expect, it } from 'vitest';
import { convertKmmluCsv } from './kmmluCsv';

const HEADER = 'question,answer,A,B,C,D,Category,Human Accuracy';
const ROW = '한국의 수도는?,"1",서울,부산,대구,인천,지리,0.95';

describe('kmmlu csv adapter', () => {
  it('converts 3 sample rows', () => {
    const csv = [HEADER, ROW, ROW.replace('수도', '화폐'), ROW.replace('수도', '국화')].join('\n');
    const { samples, diagnostics } = convertKmmluCsv('history-test.csv', csv);
    expect(diagnostics).toHaveLength(0);
    expect(samples).toHaveLength(3);
    expect(samples[0]).toMatchObject({
      id: 'history-test.csv#1',
      input: '한국의 수도는?',
      choices: ['서울', '부산', '대구', '인천'],
      target: 'A',
      metadata: { subject: 'history', category: '지리' },
    });
  });

  it('maps answer index 2-4 to letters and skips bad rows', () => {
    const csv = [
      HEADER,
      'q1,2,a,b,c,d,cat,0.5',
      'q2,9,a,b,c,d,cat,0.5',
      'q3,1,a,b',
    ].join('\n');
    const { samples, diagnostics } = convertKmmluCsv('s-test.csv', csv);
    expect(samples).toHaveLength(1);
    expect(samples[0].target).toBe('B');
    expect(diagnostics.length).toBe(2);
  });

  it('rejects unexpected headers without touching rows', () => {
    const { samples, diagnostics } = convertKmmluCsv('x-test.csv', 'a,b,c\n1,2,3');
    expect(samples).toHaveLength(0);
    expect(diagnostics[0].message).toContain('unexpected header');
  });
});
