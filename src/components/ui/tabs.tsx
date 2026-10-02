import { cn } from '@/lib/utils';

export interface SegmentedTab {
  value: string;
  label: string;
}

// Pill-shaped segmented control (not Radix Tabs): no panels, just a selection.
function SegmentedTabs({
  tabs,
  value,
  onValueChange,
  label,
  className,
}: {
  tabs: SegmentedTab[];
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('inline-flex gap-1 rounded-full bg-muted p-1', className)}
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          onClick={() => onValueChange(tab.value)}
          className={cn(
            'h-8 rounded-full px-4 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            tab.value === value
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export { SegmentedTabs };
