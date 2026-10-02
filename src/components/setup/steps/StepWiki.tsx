import { useEffect, useState } from 'react';
import { downloadDir } from '@tauri-apps/api/path';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSettings } from '@/lib/context/SettingsContext';

export function StepWiki({ onApply }: { onApply: (apply: () => Promise<void>) => void }) {
  const { t } = useLanguage();
  const { settings, updateSettings } = useSettings();
  const [watch, setWatch] = useState(settings.wiki.watchEnabled);
  const [move, setMove] = useState(settings.wiki.moveAfterIngest);

  useEffect(() => {
    onApply(async () => {
      let folders = settings.wiki.watchFolders;
      if (watch && folders.length === 0) {
        try {
          folders = [await downloadDir()];
        } catch {
          folders = [];
        }
      }
      await updateSettings({
        wiki: { ...settings.wiki, watchEnabled: watch, moveAfterIngest: move, watchFolders: folders },
      });
    });
  }, [onApply, watch, move, settings.wiki, updateSettings]);

  return (
    <div className="space-y-4 text-xs">
      <div>
        <h3 className="text-sm font-semibold">{t('setup.wiki.title')}</h3>
        <p className="text-xs text-muted-foreground mt-1">{t('setup.wiki.desc')}</p>
      </div>
      <label className="flex items-center justify-between gap-4 cursor-pointer rounded-lg border border-border p-3">
        <span className="font-medium">{t('setup.wiki.watch')}</span>
        <input
          type="checkbox"
          checked={watch}
          onChange={(e) => setWatch(e.target.checked)}
          className="h-4 w-4"
        />
      </label>
      <label className="flex items-center justify-between gap-4 cursor-pointer rounded-lg border border-border p-3">
        <span className="font-medium">{t('setup.wiki.move')}</span>
        <input
          type="checkbox"
          checked={move}
          onChange={(e) => setMove(e.target.checked)}
          className="h-4 w-4"
        />
      </label>
    </div>
  );
}
