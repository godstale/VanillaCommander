import * as React from 'react';

import { cn } from '@/lib/utils';

export interface SwitchProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange'
> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function Switch({
  checked,
  onCheckedChange,
  className,
  ...props
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        checked ? 'bg-primary' : 'bg-input',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'absolute left-[3px] top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-transform dark:bg-background',
          checked && 'translate-x-4',
        )}
      />
    </button>
  );
}

export { Switch };
