import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted text-foreground',
        primary: 'border-primary/30 bg-primary/10 text-primary',
        success: 'border-success/30 bg-success/10 text-success',
        info: 'border-info/30 bg-info/10 text-info',
        warning: 'border-warning/30 bg-warning/10 text-warning',
        destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && <i className="h-[7px] w-[7px] rounded-full bg-current" />}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
