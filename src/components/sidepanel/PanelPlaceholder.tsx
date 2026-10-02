import type { LucideIcon } from 'lucide-react';

export interface PanelPlaceholderProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

// P11-01: 위키·매크로 패널이 오기 전까지 SidePanel 스위치를 확정하기 위한 임시 표시.
export function PanelPlaceholder({ icon: Icon, title, description }: PanelPlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full w-full text-center text-muted-foreground gap-2 p-4">
      <Icon className="h-8 w-8 opacity-30" />
      <p className="text-xs font-medium text-foreground">{title}</p>
      <p className="text-[11px]">{description}</p>
    </div>
  );
}
