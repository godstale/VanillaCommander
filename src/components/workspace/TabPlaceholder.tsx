import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface TabPlaceholderProps {
  tab: WorkspaceTab;
}

export function TabPlaceholder({ tab }: TabPlaceholderProps) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center h-full w-full p-6 text-center text-muted-foreground select-none">
      <div className="rounded-full bg-accent p-4 mb-3">
        <span className="text-xl font-mono">⚡</span>
      </div>
      <h3 className="text-sm font-semibold text-foreground">{tab.title}</h3>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm">
        {t('tabPlaceholder.type')} <code className="bg-muted px-1 py-0.5 rounded">{tab.type}</code>
      </p>
      <p className="text-[11px] opacity-70 mt-2">
        {t('tabPlaceholder.desc')}
      </p>
    </div>
  );
}

export default TabPlaceholder;
