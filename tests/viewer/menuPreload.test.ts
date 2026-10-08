import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cellWillAutoAdvanceWithoutInput,
  collectPreloadStillUrls,
  freezeMenuVideoAtEnd,
  imageHasPixels,
  menuStillUrl,
  motionSegmentFinishAt,
  parseMenuCellsFromDataset,
  preloadLinkedMenuAssets,
  prioritizeTitleVideo,
  resolveAutoNextMenuCell,
  whenVideoReadyForPlay,
  stillCoverUrlFromMenu,
  whenImageReady,
} from '../../viewer/src/host/menuPreload.ts';

describe('menuStillUrl', () => {
  it('builds the convert still path', () => {
    expect(menuStillUrl('/web/Disc/', 1, 2, 3)).toBe(
      '/web/Disc/menu-1-2-3.webp',
    );
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

describe('cellWillAutoAdvanceWithoutInput', () => {
  it('rejects infinite stills and buttoned cells', () => {
    expect(
      cellWillAutoAdvanceWithoutInput({ still_time: 255, buttons: [] }),
    ).toBe(false);
    expect(
      cellWillAutoAdvanceWithoutInput({ still_time: 0, buttons: [{}] }),
    ).toBe(false);
    expect(
      cellWillAutoAdvanceWithoutInput({ still_time: 5, buttons: [{}] }),
    ).toBe(false);
  });

  it('accepts buttonless timed / wipe cells', () => {
    expect(
      cellWillAutoAdvanceWithoutInput({ still_time: 0, buttons: [] }),
    ).toBe(true);
    expect(
      cellWillAutoAdvanceWithoutInput({ still_time: 3, buttons: [] }),
    ).toBe(true);
  });
});

describe('resolveAutoNextMenuCell', () => {
  const chain = [
    { cellID: 1, vobID: 6, still_time: 0, buttons: [], cell_cmd_nr: 0 },
    {
      cellID: 1,
      vobID: 7,
      still_time: 0,
      buttons: [],
      cell_cmd_nr: 0,
      video: '/d/menu-4-1-7.webm',
      still: '/d/menu-4-1-7.webp',
    },
    { cellID: 1, vobID: 8, still_time: 255, buttons: [{}], cell_cmd_nr: 0 },
  ];

  it('returns only the immediate next cell in a wipe chain', () => {
    expect(
      resolveAutoNextMenuCell(chain, {
        cellID: 1,
        vobID: 6,
        still_time: 0,
        buttons: [],
      }),
    ).toEqual(chain[1]);
  });

  it('does not look past one hop', () => {
    const next = resolveAutoNextMenuCell(chain, {
      cellID: 1,
      vobID: 6,
      still_time: 0,
      buttons: [],
    });
    expect(next?.vobID).toBe(7);
    expect(
      resolveAutoNextMenuCell(chain, {
        cellID: 1,
        vobID: 7,
        still_time: 0,
        buttons: [],
      }),
    ).toEqual(chain[2]);
  });

  it('skips when cell_cmd_nr can divert', () => {
    expect(
      resolveAutoNextMenuCell(
        [
          { cellID: 1, vobID: 12, still_time: 0, buttons: [], cell_cmd_nr: 1 },
          { cellID: 1, vobID: 13, still_time: 0, buttons: [] },
        ],
        { cellID: 1, vobID: 12, still_time: 0, buttons: [] },
      ),
    ).toBeNull();
  });

  it('skips buttoned / infinite cells and last-in-PGC (post unknown)', () => {
    expect(
      resolveAutoNextMenuCell(chain, {
        cellID: 1,
        vobID: 8,
        still_time: 255,
        buttons: [{}],
      }),
    ).toBeNull();
    expect(
      resolveAutoNextMenuCell(chain.slice(0, 2), {
        cellID: 1,
        vobID: 7,
        still_time: 0,
        buttons: [],
      }),
    ).toBeNull();
  });

  it('skips ambiguous duplicate cell identities', () => {
    expect(
      resolveAutoNextMenuCell(
        [
          { cellID: 1, vobID: 1, still_time: 0, buttons: [] },
          { cellID: 1, vobID: 1, still_time: 0, buttons: [] },
          { cellID: 2, vobID: 1, still_time: 0, buttons: [] },
        ],
        { cellID: 1, vobID: 1, still_time: 0, buttons: [] },
      ),
    ).toBeNull();
  });
});

describe('collectPreloadStillUrls', () => {
  it('includes all other PGC stills even when the user has a choice', () => {
    const urls = collectPreloadStillUrls({
      baseDir: '/d/',
      domain: 0,
      current: { cellID: 1, vobID: 1, still_time: 255, buttons: [{}] },
      pgcCells: [
        { cellID: 1, vobID: 1, still_time: 255, buttons: [{}] },
        { cellID: 2, vobID: 1, still: '/d/menu-0-2-1.png', buttons: [{}] },
        { cellID: 3, vobID: 1, still: '/d/menu-0-3-1.png', buttons: [{}] },
      ],
      linkedStillSrcs: ['/d/menu-1-9-1.png', ''],
    });
    expect(urls.sort()).toEqual(
      ['/d/menu-0-2-1.png', '/d/menu-0-3-1.png'].sort(),
    );
  });

  it('skips the current cell and pure transition cells with no still', () => {
    expect(
      collectPreloadStillUrls({
        baseDir: '/d/',
        domain: 1,
        current: { cellID: 1, vobID: 2, still_time: 0, buttons: [] },
        pgcCells: [
          { cellID: 1, vobID: 2, still_time: 0, buttons: [], cell_cmd_nr: 0 },
          { cellID: 2, vobID: 2, still_time: 0, buttons: [] },
          { cellID: 3, vobID: 2, still: '/d/menu-1-3-2.webp', buttons: [{}] },
        ],
      }),
    ).toEqual(['/d/menu-1-3-2.webp']);
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

describe('prioritizeTitleVideo', () => {
  it('promotes the active title and demotes siblings', () => {
    const active = {
      preload: 'none',
      pause: vi.fn(),
    } as unknown as HTMLVideoElement;
    const other = {
      preload: 'auto',
      pause: vi.fn(),
    } as unknown as HTMLVideoElement;
    const host = {
      querySelectorAll: () => [active, other],
    } as unknown as ParentNode;
    prioritizeTitleVideo(host, active);
    expect(active.preload).toBe('auto');
    expect(other.preload).toBe('none');
    expect(other.pause).toHaveBeenCalledOnce();
    expect(active.pause).not.toHaveBeenCalled();
  });
});

describe('whenVideoReadyForPlay', () => {
  beforeEach(() => {
    vi.stubGlobal('HTMLMediaElement', {
      NETWORK_EMPTY: 0,
      NETWORK_IDLE: 1,
      NETWORK_LOADING: 2,
      NETWORK_NO_SOURCE: 3,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves true immediately when readyState already has data', async () => {
    const video = {
      readyState: 2,
      networkState: 1,
      error: null,
      preload: 'none',
      getAttribute: () => '/disc/VTS_12_1.webm',
      currentSrc: '/disc/VTS_12_1.webm',
      src: '/disc/VTS_12_1.webm',
      load: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLVideoElement;
    await expect(whenVideoReadyForPlay(video)).resolves.toBe(true);
    expect(video.load).not.toHaveBeenCalled();
  });

  it('resolves false when src is missing', async () => {
    const video = {
      readyState: 0,
      networkState: 0,
      error: null,
      preload: 'none',
      getAttribute: () => '',
      currentSrc: '',
      src: '',
      load: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLVideoElement;
    await expect(whenVideoReadyForPlay(video)).resolves.toBe(false);
  });
});

describe('preloadLinkedMenuAssets', () => {
  it('preloads all other PGC stills plus only the auto-next WebM', () => {
    const fetchMock = vi.fn(() => Promise.resolve());
    vi.stubGlobal('fetch', fetchMock);

    const video = {
      className: 'dvd-menu-archive-menu-video',
      loop: true,
      preload: 'none',
      paused: true,
      readyState: 0,
      getAttribute: (name: string) =>
        name === 'src'
          ? '/web/menu-4-1-6.webm'
          : name === 'preload'
            ? 'none'
            : null,
      load: vi.fn(),
    };

    const menu = {
      dataset: {
        domain: '4',
        cells: encodeURIComponent(
          JSON.stringify([
            {
              cellID: 1,
              vobID: 6,
              still_time: 0,
              buttons: [],
              cell_cmd_nr: 0,
              video: '/web/menu-4-1-6.webm',
            },
            {
              cellID: 1,
              vobID: 7,
              still_time: 0,
              buttons: [],
              cell_cmd_nr: 0,
              video: '/web/menu-4-1-7.webm',
              still: '/web/menu-4-1-7.webp',
            },
            {
              cellID: 1,
              vobID: 8,
              still_time: 255,
              buttons: [{}],
              still: '/web/menu-4-1-8.webp',
            },
          ]),
        ),
      },
    } as unknown as HTMLElement;

    const host = {
      querySelectorAll: (sel: string) => {
        if (sel === 'video.dvd-menu-archive-menu-video') {
          return [video];
        }
        return [];
      },
    } as unknown as ParentNode;

    const urls = preloadLinkedMenuAssets(host, menu, {
      domain: 4,
      cellID: 1,
      vobID: 6,
      still_time: 0,
      buttons: [],
      baseDir: '/web/',
    });

    expect(video.loop).toBe(false);
    expect(video.preload).toBe('none');
    expect(video.load).not.toHaveBeenCalled();
    expect(urls.sort()).toEqual(
      [
        '/web/menu-4-1-7.webp',
        '/web/menu-4-1-8.webp',
        '/web/menu-4-1-7.webm',
      ].sort(),
    );
    expect(fetchMock).toHaveBeenCalledWith('/web/menu-4-1-7.webm', {
      method: 'GET',
      credentials: 'same-origin',
    });
    // Second-hop WebM must not be fetched.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('still preloads choice stills but not WebM when cell_cmd can divert', () => {
    const fetchMock = vi.fn(() => Promise.resolve());
    vi.stubGlobal('fetch', fetchMock);

    const menu = {
      dataset: {
        domain: '4',
        cells: encodeURIComponent(
          JSON.stringify([
            {
              cellID: 1,
              vobID: 12,
              still_time: 0,
              buttons: [],
              cell_cmd_nr: 1,
              video: '/web/menu-4-1-12.webm',
            },
            {
              cellID: 1,
              vobID: 13,
              still_time: 255,
              buttons: [{}],
              still: '/web/menu-4-1-13.webp',
              video: '/web/menu-4-1-13.webm',
            },
          ]),
        ),
      },
    } as unknown as HTMLElement;

    const host = {
      querySelectorAll: () => [],
    } as unknown as ParentNode;

    expect(
      preloadLinkedMenuAssets(host, menu, {
        domain: 4,
        cellID: 1,
        vobID: 12,
        still_time: 0,
        buttons: [],
        baseDir: '/web/',
      }),
    ).toEqual(['/web/menu-4-1-13.webp']);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
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
    expect(stillCoverUrlFromMenu(menu)).toBe('/web/menu-1-2-1.webp');
  });
});
