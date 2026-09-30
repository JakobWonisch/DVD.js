import { describe, expect, it } from 'vitest';
import {
  menuCellVideoUrl,
  menuMotionPlaybackWindow,
  resolveMenuCellVideoUrl,
} from '../../viewer/src/host/menuCellVideo.ts';

describe('menuCellVideoUrl', () => {
  it('matches still PNG naming with .webm', () => {
    expect(menuCellVideoUrl('/d/', 1, 2, 3)).toBe('/d/menu-1-2-3.webm');
  });
});

describe('resolveMenuCellVideoUrl', () => {
  it('prefers explicit opts.video', () => {
    expect(
      resolveMenuCellVideoUrl(
        { video: '/d/menu-0-1-1.webm', domain: 0, cellID: 1, vobID: 1 },
      ),
    ).toBe('/d/menu-0-1-1.webm');
  });

  it('uses metadata.menuCell.video', () => {
    expect(
      resolveMenuCellVideoUrl(
        { domain: 1, cellID: 2, vobID: 19 },
        {
          domainMeta: {
            menuCell: { '2': { '19': { video: '/d/menu-1-2-19.webm' } } },
          },
        },
      ),
    ).toBe('/d/menu-1-2-19.webm');
  });

  it('returns null when nothing is stamped', () => {
    expect(
      resolveMenuCellVideoUrl(
        { domain: 0, cellID: 1, vobID: 1, startSec: 0, endSec: 2 },
        { baseDir: '/d/' },
      ),
    ).toBeNull();
  });

  it('does not invent menu-*.webm when only some cells are stamped', () => {
    expect(
      resolveMenuCellVideoUrl(
        { domain: 0, cellID: 2, vobID: 1 },
        {
          baseDir: '/d/',
          domainMeta: {
            menuCell: { '1': { '1': { video: '/d/menu-0-1-1.webm' } } },
          },
        },
      ),
    ).toBeNull();
  });
});

describe('menuMotionPlaybackWindow', () => {
  it('maps absolute times to [0, duration) for per-cell clips', () => {
    const w = menuMotionPlaybackWindow(
      { startSec: 729.32, endSec: 751.12 },
      '/d/menu-1-1-228.webm',
    );
    expect(w.perCell).toBe(true);
    expect(w.start).toBe(0);
    expect(w.end).toBeCloseTo(21.8, 5);
  });

  it('uses 0 end when per-cell duration is unknown', () => {
    expect(
      menuMotionPlaybackWindow({ startSec: 10, endSec: 10 }, '/d/menu-0-1-1.webm'),
    ).toEqual({ start: 0, end: 0, perCell: true });
  });

  it('returns an empty window without a cell WebM', () => {
    expect(
      menuMotionPlaybackWindow({ startSec: 729.32, endSec: 751.12 }, null),
    ).toEqual({ start: 0, end: 0, perCell: false });
  });
});
