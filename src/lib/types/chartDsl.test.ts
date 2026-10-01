import { describe, it, expect } from 'vitest';
import { isChartDsl, parseAndNormalizeChartDsl } from './chartDsl';

describe('isChartDsl', () => {
  it('identifies pseudo-DSL line chart headers', () => {
    const code = `line chart title="2026 년 9 월 셋째주 KOSPI & KOSDAQ 동향"
xKey: "날짜"
series: []`;
    expect(isChartDsl(code)).toBe(true);
  });

  it('identifies bar, area, pie chart pseudo-headers', () => {
    expect(isChartDsl('bar chart\ndata: []')).toBe(true);
    expect(isChartDsl('area chart title="Trend"')).toBe(true);
    expect(isChartDsl('pie chart')).toBe(true);
  });

  it('identifies YAML-like xKey and series blocks', () => {
    const code = `xKey: "date"\nseries:\n  - key: "val"`;
    expect(isChartDsl(code)).toBe(true);
  });

  it('identifies JSON chart DSL blocks', () => {
    const code = JSON.stringify({
      type: 'line',
      data: [{ x: 1, y: 10 }],
      series: [{ key: 'y' }],
    });
    expect(isChartDsl(code)).toBe(true);
  });

  it('rejects mermaid flowchart and sequence diagrams', () => {
    expect(isChartDsl('flowchart TD\nA --> B')).toBe(false);
    expect(isChartDsl('sequenceDiagram\nAlice->>Bob: Hello')).toBe(false);
    expect(isChartDsl('classDiagram\nclass Animal')).toBe(false);
    expect(isChartDsl('erDiagram\nCUSTOMER ||--o{ ORDER : places')).toBe(false);
    expect(isChartDsl('invalid mermaid code')).toBe(false);
    expect(isChartDsl('')).toBe(false);
  });
});

describe('parseAndNormalizeChartDsl', () => {
  it('parses standard valid JSON DSL', () => {
    const json = JSON.stringify({
      type: 'bar',
      title: 'Monthly Revenue',
      data: [
        { month: 'Jan', revenue: 100 },
        { month: 'Feb', revenue: 200 },
      ],
      xKey: 'month',
      series: [{ key: 'revenue', label: 'Revenue ($)' }],
    });

    const parsed = parseAndNormalizeChartDsl(json);
    expect(parsed.type).toBe('bar');
    expect(parsed.title).toBe('Monthly Revenue');
    expect(parsed.xKey).toBe('month');
    expect(parsed.data).toHaveLength(2);
    expect(parsed.series).toHaveLength(1);
    expect(parsed.series[0].key).toBe('revenue');
  });

  it('parses and normalizes pseudo-DSL with nested series data (user bug report case)', () => {
    const pseudoDsl = `line chart title="2026 년 9 월 셋째주 KOSPI & KOSDAQ 동향"
xKey: "날짜"
series: [
  { 
    "key": "KOSPI", 
    "label": "코스피 (p)", 
    "color": "#3b82f6",
    "data": [
      {"category": "9/14(월)", "val1": 7050, "val2": null},
      {"category": "9/15(화)", "val1": 7080, "val2": null},
      {"category": "9/16(수)", "val1": 7120, "val2": null},
      {"category": "9/17(목)", "val1": 7150, "val2": null},
      {"category": "9/18(금)", "val1": 7130, "val2": null}
    ] 
  },
  { 
    "key": "KOSDAQ", 
    "label": "코스닥 (p)", 
    "color": "#10b981",
    "data": [
      {"category": "9/14(월)", "val1": 820, "val2": null},
      {"category": "9/15(화)", "val1": 835, "val2": null},
      {"category": "9/16(수)", "val1": 848, "val2": null},
      {"category": "9/17(목)", "val1": 860, "val2": null},
      {"category": "9/18(금)", "val1": 853, "val2": null}
    ] 
  }
]`;

    const parsed = parseAndNormalizeChartDsl(pseudoDsl);
    expect(parsed.type).toBe('line');
    expect(parsed.title).toBe('2026 년 9 월 셋째주 KOSPI & KOSDAQ 동향');
    expect(parsed.xKey).toBe('날짜');
    expect(parsed.series).toHaveLength(2);
    expect(parsed.series[0]).toEqual({
      key: 'KOSPI',
      label: '코스피 (p)',
      color: '#3b82f6',
    });
    expect(parsed.series[1]).toEqual({
      key: 'KOSDAQ',
      label: '코스닥 (p)',
      color: '#10b981',
    });

    // Verify pivoted data
    expect(parsed.data).toHaveLength(5);
    expect(parsed.data[0]).toEqual({
      날짜: '9/14(월)',
      KOSPI: 7050,
      KOSDAQ: 820,
    });
    expect(parsed.data[4]).toEqual({
      날짜: '9/18(금)',
      KOSPI: 7130,
      KOSDAQ: 853,
    });
  });

  it('handles relaxed JSON with trailing commas and unquoted keys', () => {
    const relaxed = `{
      type: "area",
      title: "Active Users",
      xKey: "day",
      data: [
        { day: "Mon", users: 100, },
        { day: "Tue", users: 150, },
      ],
      series: [
        { key: "users", label: "Users", },
      ],
    }`;

    const parsed = parseAndNormalizeChartDsl(relaxed);
    expect(parsed.type).toBe('area');
    expect(parsed.title).toBe('Active Users');
    expect(parsed.data).toHaveLength(2);
    expect(parsed.series[0].key).toBe('users');
  });

  it('auto-detects series and xKey if missing from flat data', () => {
    const raw = {
      type: 'line',
      data: [
        { date: '2026-01-01', temp: 5, humidity: 60 },
        { date: '2026-01-02', temp: 7, humidity: 55 },
      ],
    };

    const parsed = parseAndNormalizeChartDsl(raw);
    expect(parsed.xKey).toBe('date');
    expect(parsed.series.map((s) => s.key)).toEqual(['temp', 'humidity']);
  });

  it('throws error for invalid chart syntax', () => {
    expect(() => parseAndNormalizeChartDsl('random nonsense text')).toThrow();
  });
});
