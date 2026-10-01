import * as React from 'react';

import { cn } from '@/lib/utils';

type DivProps = React.HTMLAttributes<HTMLDivElement>;

// "card" = white surface on the grey ground; "well" = inset muted surface.
function Card({ className, ...props }: DivProps) {
  return (
    <div
      className={cn(
        'rounded-card border border-border bg-card p-6 text-card-foreground shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

function Well({ className, ...props }: DivProps) {
  return (
    <div className={cn('rounded-card bg-muted p-6', className)} {...props} />
  );
}

function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-base font-semibold tracking-tight', className)}
      {...props}
    />
  );
}

function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-xs text-muted-foreground', className)} {...props} />
  );
}

export { Card, Well, CardTitle, CardDescription };
