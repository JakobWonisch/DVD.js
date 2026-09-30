import { describe, expect, it, vi } from 'vitest';
import {
  collectPreloadStillUrls,
  freezeMenuVideoAtEnd,
  imageHasPixels,
  menuStillUrl,
  motionSegmentFinishAt,
  parseMenuCellsFromDataset,
  preloadLinkedMenuAssets,
  stillCoverUrlFromMenu,
  whenImageReady,
} from '../../viewer/src/host/menuPreload.ts';

describe('menuStillUrl', () => {
  it('builds the convert still path', () => {
    expect(menuStillUrl('/web/Disc/', 1, 2, 3)).toBe('/web/Disc/menu-1-2-3.png');
  });
});

describe('parseMenuCellsFromDataset', () => {
  it('returns empty when missing', () => {
    expect(parseMenuCellsFromDataset(null)).toEqual([]);
    expect(
      parseMenuCellsFromDataset({ dataset: {} } as HTMLElement),
    ).toEqual([]);
  });

  it('parses URI-encoded JSON cells', () => {
    const el = {
      dataset: {
        cells: encodeURIComponent(
          JSON.stringify([{ cellID: 1, vobID: 2 }, { cellID: 3, vobID: 2 }]),
        ),
      },
    } as unknown as HTMLElement;
    expect(parseMenuCellsFromDataset(el)).toEqual([
      { cellID: 1, vobID: 2 },
      { cellID: 3, vobID: 2 },
    ]);
  });
});

describe('collectPreloadStillUrls', () => {
  it('includes current + PGC cells + linked DOM stills', () => {
    const urls = collectPreloadStillUrls({
      baseDir: '/d/',
      domain: 0,
      current: { cellID: 1, vobID: 1 },
      pgcCells: [
        { cellID: 1, vobID: 1 },
        { cellID: 2, vobID: 1 },
      ],
      linkedStillSrcs: ['/d/menu-1-9-1.png', ''],
    });
    expect(urls.sort()).toEqual(
      ['/d/menu-0-1-1.png', '/d/menu-0-2-1.png', '/d/menu-1-9-1.png'].sort(),
    );
  });
});

describe('motionSegmentFinishAt', () => {
  it('finishes ~250ms early on long cells', () => {
    expect(motionSegmentFinishAt(10, 12.5)).toBeCloseTo(12.25, 5);
  });

  it('never finishes at or before start on short cells', () => {
    const finish = motionSegmentFinishAt(1, 1.1);
    expect(finish).toBeGreaterThan(1);
    expect(finish).toBeLessThanOrEqual(1.1);
  });

  it('handles zero-length safely', () => {
    expect(motionSegmentFinishAt(5, 5)).toBe(5);
  });
});

describe('freezeMenuVideoAtEnd', () => {
  it('pauses without seeking when already near the end', () => {
    const video = {
      loop: true,
      ended: false,
      muted: false,
      currentTime: 12.47,
      style: { opacity: '' },
      pause: vi.fn(),
    } as unknown as HTMLVideoElement;

    expect(freezeMenuVideoAtEnd(video, 10, 12.5)).toBe(false);

    expect(video.loop).toBe(false);
    expect(video.muted).toBe(true);
    expect(video.currentTime).toBeCloseTo(12.47, 5);
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.style.opacity).toBe('');
  });

  it('hides the video when ended snapped to frame 0 (no reseek)', () => {
    const video = {
      loop: false,
      ended: true,
      muted: false,
      currentTime: 0,
      style: { opacity: '' },
      pause: vi.fn(),
    } as unknown as HTMLVideoElement;

    expect(freezeMenuVideoAtEnd(video, 10, 12.5)).toBe(true);
    expect(video.currentTime).toBe(0);
    expect(video.muted).toBe(true);
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.style.opacity).toBe('0');
  });

  it('hides the video when currentTime overran into the next concat cell', () => {
    const video = {
      loop: false,
      ended: false,
      muted: false,
      currentTime: 12.6,
      style: { opacity: '' },
      pause: vi.fn(),
    } as unknown as HTMLVideoElement;

    expect(freezeMenuVideoAtEnd(video, 10, 12.5)).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.style.opacity).toBe('0');
  });
});

describe('whenImageReady', () => {
  it('resolves true immediately for a complete image', async () => {
    const img = {
      complete: true,
      naturalWidth: 32,
      getAttribute: () => '/x.png',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLImageElement;

    await expect(whenImageReady(img, 50)).resolves.toBe(true);
    expect(img.addEventListener).not.toHaveBeenCalled();
  });

  it('resolves true on load', async () => {
    const listeners: Record<string, () => void> = {};
    const img = {
      complete: false,
      naturalWidth: 0,
      getAttribute: () => '/x.png',
      addEventListener: (type: string, fn: () => void) => {
        listeners[type] = fn;
      },
      removeEventListener: vi.fn(),
    } as unknown as HTMLImageElement;

    const p = whenImageReady(img, 5000);
    Object.defineProperty(img, 'complete', { value: true });
    Object.defineProperty(img, 'naturalWidth', { value: 64 });
    listeners.load?.();
    await expect(p).resolves.toBe(true);
  });

  it('resolves false on timeout without pixels (keep last cover)', async () => {
    const img = {
      complete: false,
      naturalWidth: 0,
      getAttribute: () => '/x.png',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLImageElement;

    await expect(whenImageReady(img, 20)).resolves.toBe(false);
  });

  it('resolves false for a completed failed image', async () => {
    const img = {
      complete: true,
      naturalWidth: 0,
      getAttribute: () => '/missing.png',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLImageElement;

    await expect(whenImageReady(img, 50)).resolves.toBe(false);
    expect(img.addEventListener).not.toHaveBeenCalled();
  });
});

describe('imageHasPixels', () => {
  it('requires complete + naturalWidth', () => {
    expect(
      imageHasPixels({
        complete: true,
        naturalWidth: 10,
      } as HTMLImageElement),
    ).toBe(true);
    expect(
      imageHasPixels({
        complete: true,
        naturalWidth: 0,
      } as HTMLImageElement),
    ).toBe(false);
  });
});

describe('preloadLinkedMenuAssets', () => {
  it('sets menu videos to preload=auto and loop=false without load()', () => {
    const video = {
      className: 'dvdjs-menu-video',
      loop: true,
      preload: 'metadata',
      paused: true,
      readyState: 0,
      getAttribute: (name: string) =>
        name === 'src' ? '/web/VTS_01_0.webm' : name === 'preload' ? 'metadata' : null,
      load: vi.fn(),
    };

    const still = {
      getAttribute: (name: string) => (name === 'src' ? '/web/menu-1-9-2.png' : null),
    };

    const menu = {
      dataset: {
        domain: '1',
        cells: encodeURIComponent(JSON.stringify([{ cellID: 4, vobID: 1 }])),
      },
    } as unknown as HTMLElement;

    const host = {
      querySelectorAll: (sel: string) => {
        if (sel === 'img.menu-still[src]') {
          return [still];
        }
        if (sel === 'video.dvdjs-menu-video') {
          return [video];
        }
        return [];
      },
    } as unknown as ParentNode;

    const urls = preloadLinkedMenuAssets(host, menu, {
      domain: 1,
      cellID: 1,
      vobID: 1,
      baseDir: '/web/',
    });

    expect(video.loop).toBe(false);
    expect(video.preload).toBe('auto');
    expect(video.load).not.toHaveBeenCalled();
    expect(urls).toContain('/web/menu-1-1-1.png');
    expect(urls).toContain('/web/menu-1-4-1.png');
    expect(urls).toContain('/web/menu-1-9-2.png');
  });
});

describe('stillCoverUrlFromMenu', () => {
  it('prefers a decoded still src over the dataset cell URL', () => {
    const menu = {
      dataset: { domain: '1', cell: '2', vob: '1' },
      querySelector: () => ({
        complete: true,
        naturalWidth: 720,
        getAttribute: () => '/web/menu-1-9-1.png',
      }),
      ownerDocument: null,
    } as unknown as HTMLElement;
    // Outgoing transition cell is 2/1; painted cover is the prior interactive still.
    expect(stillCoverUrlFromMenu(menu)).toBe('/web/menu-1-9-1.png');
  });

  it('falls back to lastPaintedStillSrc when still has no pixels', () => {
    const menu = {
      dataset: { domain: '1', cell: '2', vob: '1' },
      querySelector: () => ({
        complete: false,
        naturalWidth: 0,
        getAttribute: () => '/web/menu-1-2-1.png',
      }),
      ownerDocument: null,
    } as unknown as HTMLElement;
    expect(stillCoverUrlFromMenu(menu, '/web/menu-1-9-1.png')).toBe(
      '/web/menu-1-9-1.png',
    );
  });

  it('builds still URL from dataset when nothing is painted', () => {
    const menu = {
      dataset: { domain: '1', cell: '2', vob: '1' },
      querySelector: () => ({
        complete: false,
        naturalWidth: 0,
        getAttribute: () => '/web/menu-1-1-1.png',
      }),
      ownerDocument: null,
    } as unknown as HTMLElement;
    expect(stillCoverUrlFromMenu(menu)).toBe('/web/menu-1-2-1.png');
  });
});
