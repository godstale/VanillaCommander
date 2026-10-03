import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSafeSettings } from '@/lib/context/SettingsContext';
import { DEFAULT_IMAGE_SETTINGS } from '@/lib/types/imageSettings';

export interface ImageViewerTabProps {
  tab: WorkspaceTab;
}

const ZOOM_MIN = 10;
const ZOOM_MAX = 400;
/** 뷰포트 안쪽 여백(px). 그림자·테두리가 잘리지 않게 한다. */
const FIT_PADDING = 16;

interface Size {
  w: number;
  h: number;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function clampZoom(z: number): number {
  return Math.min(Math.max(z, ZOOM_MIN), ZOOM_MAX);
}

export function ImageViewerTab({ tab }: ImageViewerTabProps) {
  const filePath = (tab.meta?.filePath as string) || tab.id.replace(/^image-viewer:/, '');
  const { t } = useLanguage();
  const { fitOnOpen, step } = useImageViewerSettings();

  const [natural, setNatural] = useState<Size | null>(null);
  const [viewport, setViewport] = useState<Size | null>(null);
  // null이면 "창에 맞춤" 모드다 (뷰포트가 바뀌면 배율도 따라간다).
  const [manualZoom, setManualZoom] = useState<number | null>(fitOnOpen ? null : 100);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      // 숨겨진 탭(display:none)은 0으로 측정되므로 무시해 마지막 유효 크기를 유지한다.
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setViewport({ w: el.clientWidth, h: el.clientHeight });
      }
    };
    measure();
    const ob = new ResizeObserver(measure);
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  const fitZoom =
    natural && viewport
      ? clampZoom(
          Math.min(
            (viewport.w - FIT_PADDING * 2) / natural.w,
            (viewport.h - FIT_PADDING * 2) / natural.h,
          ) * 100,
        )
      : 100;
  const zoom = manualZoom ?? fitZoom;

  const zoomBy = useCallback(
    (delta: number) => setManualZoom((cur) => clampZoom(Math.round((cur ?? fitZoom) + delta))),
    [fitZoom],
  );
  const fit = useCallback(() => setManualZoom(null), []);
  const actualSize = useCallback(() => setManualZoom(100), []);

  // Shift/Alt + (+/-) 확대·축소, Shift/Alt + 0 창에 맞춤.
  // 탭은 숨겨져도 마운트가 유지되므로, 보이는 뷰어에만 반응한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.shiftKey || e.altKey) || e.ctrlKey || e.metaKey) return;
      if (e.shiftKey && e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const root = rootRef.current;
      if (!root || root.offsetParent === null) return;
      if (e.code === 'Equal' || e.code === 'NumpadAdd') {
        e.preventDefault();
        zoomBy(step);
      } else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        zoomBy(-step);
      } else if (e.code === 'Digit0' || e.code === 'Numpad0') {
        e.preventDefault();
        fit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomBy, fit, step]);

  const shownZoom = Math.round(zoom);

  return (
    <div ref={rootRef} className="flex flex-col h-full w-full min-h-0 bg-editor select-none">
      {/* Top status bar */}
      <div className="h-9 shrink-0 flex items-center justify-between px-3 border-b border-border bg-tabbar">
        <span className="text-xs font-mono text-muted-foreground truncate">
          {basename(filePath)}
        </span>
        <div className="text-[11px] text-muted-foreground font-mono">
          {natural ? `${natural.w}×${natural.h} · ` : ''}
          {shownZoom}%
        </div>
      </div>

      {/* Viewport */}
      <div className="relative flex-1 min-h-0 overflow-hidden bg-muted/10">
        <div ref={viewportRef} className="absolute inset-0 overflow-auto flex">
          {/* m-auto: 작을 땐 가운데, 클 땐 좌상단부터 스크롤 (items-center는 위·왼쪽이 잘린다). */}
          <img
            src={convertFileSrc(filePath)}
            alt={basename(filePath)}
            draggable={false}
            onLoad={(e) =>
              setNatural({
                w: e.currentTarget.naturalWidth || 1,
                h: e.currentTarget.naturalHeight || 1,
              })
            }
            className="m-auto shrink-0 max-w-none rounded shadow-md"
            style={
              natural
                ? { width: (natural.w * zoom) / 100, height: (natural.h * zoom) / 100 }
                : { visibility: 'hidden' }
            }
          />
        </div>

        {/* Floating Zoom Controls */}
        <div className="absolute bottom-4 right-4 z-10 flex items-center rounded-lg border border-border bg-card/90 backdrop-blur shadow-md text-xs">
          <button
            type="button"
            onClick={() => zoomBy(-step)}
            title={`${t('image.zoomOut')} (Shift/Alt + -)`}
            className="h-8 w-8 flex items-center justify-center rounded-l-lg hover:bg-accent text-muted-foreground hover:text-foreground"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={actualSize}
            title={t('image.reset')}
            className="h-8 px-2 font-mono tabular-nums text-muted-foreground hover:text-foreground hover:bg-accent border-x border-border flex items-center"
          >
            {shownZoom}%
          </button>
          <button
            type="button"
            onClick={() => zoomBy(step)}
            title={`${t('image.zoomIn')} (Shift/Alt + +)`}
            className="h-8 w-8 flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground border-r border-border"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={fit}
            title={`${t('image.fit')} (Shift/Alt + 0)`}
            className="h-8 w-8 flex items-center justify-center rounded-r-lg hover:bg-accent text-muted-foreground hover:text-foreground"
          >
            <Maximize className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function useImageViewerSettings(): { fitOnOpen: boolean; step: number } {
  const ctx = useSafeSettings();
  const image = ctx?.settings.image ?? DEFAULT_IMAGE_SETTINGS;
  return { fitOnOpen: image.viewerFitOnOpen, step: image.viewerZoomStep };
}

export default ImageViewerTab;
