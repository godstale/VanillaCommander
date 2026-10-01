import { cn } from '@/lib/utils';
import vanillaArt from '../../../design/brand/vanilla-art.png';

export interface AppMarkProps {
  className?: string;
  compact?: boolean;
}

// Vanilla orchid illustration. Source art lives in design/brand/ (DESIGN.md §9).
export function AppMark({ className, compact = false }: AppMarkProps) {
  return (
    <img
      src={vanillaArt}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn('shrink-0 object-contain', compact ? 'h-4 w-4' : 'h-8 w-8', className)}
    />
  );
}

export default AppMark;
