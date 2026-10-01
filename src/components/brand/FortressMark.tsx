import { useId } from 'react';
import { cn } from '@/lib/utils';

export interface FortressMarkProps {
  className?: string;
  /** Fewer, wider logs that stay legible at 16–24 px. */
  compact?: boolean;
  title?: string;
}

// Geometry mirrors design/brand/build-brand.mjs so the in-app mark matches the exported SVGs.
const LOGS = { w: 7.4, gap: 0.8, x0: 3.7, apex: [5, 12, 10, 8, 10, 12, 5], rail: [23, 3.5] };
const COMPACT_LOGS = { w: 10, gap: 1.6, x0: 3.2, apex: [5, 12, 9, 12, 5], rail: [23, 4.5] };
const GATE = 'M24.5 58V46.5a7.5 7.5 0 0 1 15 0V58Z';

function stakePoints(x: number, w: number, apex: number) {
  const r = (n: number) => +n.toFixed(2);
  const shoulder = apex + w * 0.95;
  return `${r(x)},${r(shoulder)} ${r(x + w / 2)},${apex} ${r(x + w)},${r(shoulder)} ${r(x + w)},58 ${r(x)},58`;
}

export function FortressMark({ className, compact = false, title }: FortressMarkProps) {
  // The gate is a mask cut-out; ids must be unique when several marks share a page.
  const maskId = `fortress-gate-${useId().replace(/:/g, '')}`;
  const logs = compact ? COMPACT_LOGS : LOGS;
  return (
    <svg
      viewBox="0 0 64 64"
      fill="currentColor"
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <mask id={maskId}>
        <rect width="64" height="64" fill="#fff" />
        <path d={GATE} fill="#000" />
      </mask>
      <g mask={`url(#${maskId})`}>
        {logs.apex.map((apex, i) => (
          <polygon key={i} points={stakePoints(logs.x0 + i * (logs.w + logs.gap), logs.w, apex)} />
        ))}
        <rect x="1.5" y={logs.rail[0]} width="61" height={logs.rail[1]} rx="1.2" />
      </g>
    </svg>
  );
}
