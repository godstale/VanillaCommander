import { useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface ImageViewerTabProps {
  tab: WorkspaceTab;
}

const ZOOM_MIN = 25;
const ZOOM_MAX = 400;
const ZOOM_STEP = 25;

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function ImageViewerTab({ tab }: ImageViewerTabProps) {
  const filePath = (tab.meta?.filePath as string) || tab.id.replace(/^image-viewer:/, '');
  const [zoom, setZoom] = useState(100);
  const { t } = useLanguage();

  const zoomIn = () => setZoom((z) => Math.min(z + ZOOM_STEP, ZOOM_MAX));
  const zoomOut = () => setZoom((z) => Math.max(z - ZOOM_STEP, ZOOM_MIN));
  const resetZoom = () => setZoom(100);

  return (
    <div className="flex flex-col h-full w-full min-h-0 bg-background select-none">
      {/* Top status bar */}
      <div className="h-9 shrink-0 flex items-center justify-between px-3 border-b border-border bg-card/30">
        <span className="text-xs font-mono text-muted-foreground truncate">
          {basename(filePath)}
        </span>
        <div className="text-[11px] text-muted-foreground font-mono">
          {zoom}%
        </div>
      </div>

      {/* Viewport */}
      <div className="relative flex-1 min-h-0 overflow-hidden bg-muted/10">
        <div className="absolute inset-0 overflow-auto flex items-center justify-center p-4">
          <img
            src={convertFileSrc(filePath)}
            alt={basename(filePath)}
            className="max-w-none transition-transform duration-100 ease-out rounded shadow-md"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'center center',
            }}
          />
        </div>

        {/* Floating Zoom Controls */}
        <div className="absolute bottom-4 right-4 z-10 flex items-center rounded-lg border border-border bg-card/90 backdrop-blur shadow-md text-xs">
          <button
            type="button"
            onClick={zoomOut}
            title={t('image.zoomOut')}
            className="h-8 w-8 flex items-center justify-center rounded-l-lg hover:bg-accent text-muted-foreground hover:text-foreground"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={resetZoom}
            title={t('image.reset')}
            className="h-8 px-2 font-mono tabular-nums text-muted-foreground hover:text-foreground hover:bg-accent border-x border-border flex items-center gap-1"
          >
            <RotateCcw className="h-3 w-3" />
            <span>{zoom}%</span>
          </button>
          <button
            type="button"
            onClick={zoomIn}
            title={t('image.zoomIn')}
            className="h-8 w-8 flex items-center justify-center rounded-r-lg hover:bg-accent text-muted-foreground hover:text-foreground"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImageViewerTab;
