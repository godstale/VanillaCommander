import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import type { FcEntry } from '@/lib/commander/types';
import { AlbumView } from './AlbumView';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
}));

const dirUp: FcEntry = {
  name: '..',
  path: 'C:/pics/..',
  kind: 'dir',
  size: 0,
  modified_ms: null,
  hidden: false,
  readonly: false,
  symlink: false,
  warning: false,
};

function photoEntry(name: string): FcEntry {
  return {
    name,
    path: `C:/pics/${name}`,
    kind: 'file',
    size: 17_000_000,
    modified_ms: 1000,
    hidden: false,
    readonly: false,
    symlink: false,
    warning: false,
  };
}

function renderAlbum(names: string[]) {
  return render(
    <AlbumView
      entries={[dirUp, ...names.map(photoEntry)]}
      selected={new Set()}
      activePath={null}
      onSelect={() => {}}
      onOpen={() => {}}
      onContextMenu={() => {}}
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AlbumView thumbnails', () => {
  it('falls back to the direct asset image without createImageBitmap (jsdom)', () => {
    renderAlbum(['fallback.png']);
    const thumb = screen.getByAltText('fallback.png') as HTMLImageElement;
    expect(thumb.src).toContain('asset://');
  });

  it('uses a downscaled blob thumbnail when the pipeline succeeds', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['img'])) }),
    );
    vi.stubGlobal('createImageBitmap', () =>
      Promise.resolve({ width: 320, height: 213, close: () => {} }),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => {},
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      cb: BlobCallback,
    ) {
      cb(new Blob(['thumb'], { type: 'image/jpeg' }));
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumb-downscaled');

    renderAlbum(['downscaled.png']);
    await waitFor(() => {
      const thumb = screen.getByAltText('downscaled.png') as HTMLImageElement;
      expect(thumb.src).toBe('blob:thumb-downscaled');
    });
  });

  it('falls back to the direct asset image when thumbnail generation fails', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('blocked')));
    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('no decode')));

    renderAlbum(['direct.png']);
    await waitFor(() => {
      const thumb = screen.getByAltText('direct.png') as HTMLImageElement;
      expect(thumb.src).toContain('asset://');
    });
  });
});
