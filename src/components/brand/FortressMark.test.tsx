import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { FortressMark } from './FortressMark';

describe('FortressMark', () => {
  it('is decorative by default and labelled when given a title', () => {
    const { container, rerender } = render(<FortressMark />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    rerender(<FortressMark title="Fortress" />);
    expect(screen.getByRole('img', { name: 'Fortress' })).toBeInTheDocument();
  });

  it('gives every instance its own gate mask so marks on one page do not collide', () => {
    const { container } = render(
      <>
        <FortressMark />
        <FortressMark compact />
      </>,
    );
    const ids = Array.from(container.querySelectorAll('mask')).map((m) => m.id);
    expect(new Set(ids).size).toBe(2);
    container.querySelectorAll('g[mask]').forEach((g, i) => {
      expect(g.getAttribute('mask')).toBe(`url(#${ids[i]})`);
    });
  });

  it('draws seven logs, or five in compact mode', () => {
    const { container, rerender } = render(<FortressMark />);
    expect(container.querySelectorAll('polygon')).toHaveLength(7);
    rerender(<FortressMark compact />);
    expect(container.querySelectorAll('polygon')).toHaveLength(5);
  });
});
