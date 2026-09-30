import { describe, expect, it } from 'vitest';
import {
  isLegacyConcatMenuWebm,
  menuCellVideoUrl,
  menuMotionPlaybackWindow,
  resolveMenuCellVideoUrl,
} from '../../viewer/src/host/menuCellVideo.ts';

describe('menuCellVideoUrl', () => {
  it('matches still PNG naming with .webm', () => {
    expect(menuCellVideoUrl('/d/', 1, 2, 3)).toBe('/d/menu-1-2-3.webm');
  });
});

describe('isLegacyConcatMenuWebm', () => {
  it('detects domain concat files', () => {
    expect(isLegacyConcatMenuWebm('/Shrek/VIDEO_TS.webm')).toBe(true);
    expect(isLegacyConcatMenuWebm('/Shrek/VTS_01_0.webm')).toBe(true);
    expect(isLegacyConcatMenuWebm('/Shrek/menu-1-2-19.webm')).toBe(false);
    expect(isLegacyConcatMenuWebm(null)).toBe(false);
  });
});

describe('resolveMenuCellVideoUrl', () => {
  it('prefers explicit opts.video', () => {
    expect(
      resolveMenuCellVideoUrl(
        { video: '/d/menu-0-1-1.webm', domain: 0, cellID: 1, vobID: 1 },
        { currentSrc: '/d/VIDEO_TS.webm' },
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
          currentSrc: '/d/VTS_01_0.webm',
        },
      ),
    ).toBe('/d/menu-1-2-19.webm');
  });

  it('stays on legacy concat seek when no per-cell stamp', () => {
    expect(
      resolveMenuCellVideoUrl(
        { domain: 0, cellID: 1, vobID: 1, startSec: 0, endSec: 2 },
        { baseDir: '/d/', currentSrc: '/d/VIDEO_TS.webm' },
      ),
    ).toBeNull();
  });

  it('stays on legacy concat when index lists VTS_*_0 even if currentSrc is empty', () => {
    expect(
      resolveMenuCellVideoUrl(
        { domain: 1, cellID: 2, vobID: 1 },
        {
          baseDir: '/Harry/',
          currentSrc: '',
          domainMeta: {
            index: ['/Harry/VTS_01_0.webm'],
            menuCell: { '2': { '1': { video: null } } },
          },
        },
      ),
    ).toBeNull();
  });

  it('constructs per-cell URL when domain video is not a concat archive', () => {
    expect(
      resolveMenuCellVideoUrl(
        { domain: 0, cellID: 1, vobID: 3 },
        { baseDir: '/d/', currentSrc: '' },
      ),
    ).toBe('/d/menu-0-1-3.webm');
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

  it('keeps absolute times for legacy concat', () => {
    expect(
      menuMotionPlaybackWindow(
        { startSec: 729.32, endSec: 751.12 },
        null,
      ),
    ).toEqual({ start: 729.32, end: 751.12, perCell: false });
  });
});
