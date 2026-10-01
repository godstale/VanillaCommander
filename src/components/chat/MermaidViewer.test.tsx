import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { MermaidViewer } from './MermaidViewer';
import { ThemeProvider } from '../../lib/context/ThemeContext';
import mermaid from 'mermaid';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockImplementation((id: string) => {
      return Promise.resolve({ svg: `<svg id="${id}"><text>Flowchart</text></svg>` });
    }),
  },
}));

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive-container">{children}</div>
    ),
  };
});

describe('MermaidViewer', () => {
  it('renders SVG diagram on valid code', async () => {
    const code = 'flowchart TD\nA --> B';
    render(
      <ThemeProvider>
        <MermaidViewer code={code} />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Flowchart')).toBeInTheDocument();
    });
  });

  it('renders error fallback on syntax error', async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('Parse error on line 1'));

    render(
      <ThemeProvider>
        <MermaidViewer code="invalid mermaid code" />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Mermaid Diagram Syntax Error')).toBeInTheDocument();
      expect(screen.getByText('Parse error on line 1')).toBeInTheDocument();
      expect(screen.getByText('invalid mermaid code')).toBeInTheDocument();
    });
  });

  it('renders RechartsViewer when code is chart DSL instead of crashing with mermaid error', () => {
    const chartCode = `line chart title="Stock Trend"\nxKey: "date"\nseries: []`;
    render(
      <ThemeProvider>
        <MermaidViewer code={chartCode} />
      </ThemeProvider>,
    );

    expect(screen.getByText('Stock Trend')).toBeInTheDocument();
  });
});
