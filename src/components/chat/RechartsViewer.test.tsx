import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { RechartsViewer } from './RechartsViewer';

// Mock ResponsiveContainer for JSDOM
import { vi } from 'vitest';
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive-container" style={{ width: 500, height: 300 }}>
        {children}
      </div>
    ),
  };
});

describe('RechartsViewer', () => {
  it('renders a valid bar chart with title', () => {
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

    render(<RechartsViewer code={json} />);

    expect(screen.getByText('Monthly Revenue')).toBeInTheDocument();
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });

  it('renders line, area, and pie chart configurations without crashing', () => {
    const lineJson = JSON.stringify({
      type: 'line',
      data: [{ x: 1, y: 10 }],
      series: [{ key: 'y' }],
    });
    const { unmount: unmountLine } = render(<RechartsViewer code={lineJson} />);
    expect(screen.getByText('line chart')).toBeInTheDocument();
    unmountLine();

    const areaJson = JSON.stringify({
      type: 'area',
      data: [{ x: 1, y: 10 }],
      series: [{ key: 'y' }],
    });
    const { unmount: unmountArea } = render(<RechartsViewer code={areaJson} />);
    expect(screen.getByText('area chart')).toBeInTheDocument();
    unmountArea();

    const pieJson = JSON.stringify({
      type: 'pie',
      data: [{ name: 'A', value: 10 }],
      series: [{ key: 'value' }],
    });
    const { unmount: unmountPie } = render(<RechartsViewer code={pieJson} />);
    expect(screen.getByText('pie chart')).toBeInTheDocument();
    unmountPie();
  });

  it('displays error fallback on invalid JSON DSL syntax or schema', () => {
    const invalidJson = `{ "type": "unknown_type", "data": "not an array" }`;

    render(<RechartsViewer code={invalidJson} />);

    expect(screen.getByText('Invalid Recharts JSON DSL')).toBeInTheDocument();
    expect(screen.getByText(invalidJson)).toBeInTheDocument();
  });

  it('renders pseudo-DSL chart with title and nested series data without crashing', () => {
    const pseudoDsl = `line chart title="2026 년 9 월 셋째주 KOSPI & KOSDAQ 동향"
xKey: "날짜"
series: [
  { 
    "key": "KOSPI", 
    "label": "코스피 (p)", 
    "color": "#3b82f6",
    "data": [
      {"category": "9/14(월)", "val1": 7050, "val2": null},
      {"category": "9/15(화)", "val1": 7080, "val2": null}
    ] 
  }
]`;

    render(<RechartsViewer code={pseudoDsl} />);

    expect(screen.getByText('2026 년 9 월 셋째주 KOSPI & KOSDAQ 동향')).toBeInTheDocument();
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });
});
