import * as React from 'react';

import { cn } from '@/lib/utils';

const Table = ({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) => (
  <table
    className={cn('w-full border-collapse text-[13px]', className)}
    {...props}
  />
);

const Th = ({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={cn(
      'border-b border-border px-3 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-wider text-subtle',
      className,
    )}
    {...props}
  />
);

const Td = ({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td
    className={cn('border-b border-border px-3 py-3.5', className)}
    {...props}
  />
);

export { Table, Th, Td };
