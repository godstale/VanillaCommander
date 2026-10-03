// 설정 > 이미지: 이미지 앨범(썸네일)과 이미지 뷰어 설정.
import { Image as ImageIcon, ScanSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/lib/context/SettingsContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { ImageSettings } from '@/lib/db/repositories/settingsRepo';
import { cn } from '@/lib/utils';

const ZOOM_STEPS = [5, 10, 25];
const THUMB_WIDTHS = [160, 240, 320, 480];
const MAX_JOBS = [2, 4, 8];

function OptionRow<T extends number>({
  value,
  options,
  format,
  onPick,
}: {
  value: T;
  options: T[];
  format: (v: T) => string;
  onPick: (v: T) => void;
}) {
  return (
    <div className="flex gap-2 mt-2 flex-wrap">
      {options.map((opt) => (
        <Button
          key={opt}
          variant={value === opt ? 'default' : 'outline'}
          size="sm"
          onClick={() => onPick(opt)}
          className={cn('text-xs', value !== opt && 'text-muted-foreground')}
        >
          {format(opt)}
        </Button>
      ))}
    </div>
  );
}

export function SettingsImage() {
  const { t } = useLanguage();
  const { settings, updateSettings } = useSettings();
  const image = settings.image;
  const patch = (next: Partial<ImageSettings>) =>
    void updateSettings({ image: { ...image, ...next } });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">{t('settingsImage.title')}</h2>
        <p className="text-xs text-muted-foreground mt-1">{t('settingsImage.desc')}</p>
      </div>

      <div className="border border-border rounded-xl p-5 bg-card/40 space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <ScanSearch className="h-4 w-4 text-primary" />
          {t('settingsImage.viewer')}
        </h3>
        <div>
          <label className="text-xs font-medium">{t('settingsImage.fitOnOpen')}</label>
          <p className="text-xs text-muted-foreground mt-0.5">{t('settingsImage.fitOnOpenDesc')}</p>
          <OptionRow
            value={image.viewerFitOnOpen ? 1 : 0}
            options={[1, 0]}
            format={(v) => (v ? t('settingsImage.fit') : t('settingsImage.actual'))}
            onPick={(v) => patch({ viewerFitOnOpen: v === 1 })}
          />
        </div>
        <div>
          <label className="text-xs font-medium">{t('settingsImage.zoomStep')}</label>
          <p className="text-xs text-muted-foreground mt-0.5">{t('settingsImage.zoomStepDesc')}</p>
          <OptionRow
            value={image.viewerZoomStep}
            options={ZOOM_STEPS}
            format={(v) => `${v}%`}
            onPick={(v) => patch({ viewerZoomStep: v })}
          />
        </div>
      </div>

      <div className="border border-border rounded-xl p-5 bg-card/40 space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <ImageIcon className="h-4 w-4 text-primary" />
          {t('settingsImage.album')}
        </h3>
        <div>
          <label className="text-xs font-medium">{t('settingsImage.thumbWidth')}</label>
          <p className="text-xs text-muted-foreground mt-0.5">{t('settingsImage.thumbWidthDesc')}</p>
          <OptionRow
            value={image.albumThumbWidth}
            options={THUMB_WIDTHS}
            format={(v) => `${v}px`}
            onPick={(v) => patch({ albumThumbWidth: v })}
          />
        </div>
        <div>
          <label className="text-xs font-medium">{t('settingsImage.maxJobs')}</label>
          <p className="text-xs text-muted-foreground mt-0.5">{t('settingsImage.maxJobsDesc')}</p>
          <OptionRow
            value={image.albumMaxJobs}
            options={MAX_JOBS}
            format={(v) => String(v)}
            onPick={(v) => patch({ albumMaxJobs: v })}
          />
        </div>
      </div>
    </div>
  );
}

export default SettingsImage;
