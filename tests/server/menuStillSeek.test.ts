import { describe, expect, it } from 'vitest';
import {
  DVD_VIDEO_LB_LEN,
  SRI_END_OF_CELL,
  cellNeedsStillPng,
  cellRelativeSkipBytes,
  hliOffsetSecFromNav,
  listNavSectorsForBasename,
  nextVobuSectorFromNav,
  pickHighlightNav,
  resolveMenuStillSeek,
  type NavPtsLike,
} from '../../src/server/convert/menuStillSeek.js';

function navWith(opts: {
  btn_ns?: number;
  hli_s_ptm?: number;
  vobu_s_ptm?: number;
  next_vobu?: number;
  vobu_ea?: number;
}): NavPtsLike {
  return {
    pci: {
      pci_gi: { vobu_s_ptm: opts.vobu_s_ptm ?? 0 },
      hli: {
        hl_gi: {
          btn_ns: opts.btn_ns ?? 0,
          hli_s_ptm: opts.hli_s_ptm ?? 0,
        },
      },
    },
    dsi: {
      dsi_gi: { vobu_ea: opts.vobu_ea ?? 10 },
      vobu_sri: {
        next_vobu:
          opts.next_vobu != null ? opts.next_vobu : ((opts.vobu_ea ?? 10) + 1) | 0x80000000,
      },
    },
  };
}

describe('hliOffsetSecFromNav', () => {
  it('returns 0 when HLI starts with the VOBU', () => {
    expect(
      hliOffsetSecFromNav(
        navWith({ btn_ns: 4, hli_s_ptm: 90000, vobu_s_ptm: 90000 }),
      ),
    ).toBe(0);
  });

  it('returns relative seconds when HLI is delayed', () => {
    expect(
      hliOffsetSecFromNav(
        navWith({ btn_ns: 2, hli_s_ptm: 180000, vobu_s_ptm: 90000 }),
      ),
    ).toBe(1);
  });
});

describe('pickHighlightNav', () => {
  it('prefers the first VOBU at/after HLI with buttons', () => {
    const map = new Map<number, NavPtsLike>([
      [100, navWith({ btn_ns: 4, hli_s_ptm: 200000, vobu_s_ptm: 100000 })],
      [120, navWith({ btn_ns: 4, hli_s_ptm: 200000, vobu_s_ptm: 200000 })],
      [140, navWith({ btn_ns: 4, hli_s_ptm: 200000, vobu_s_ptm: 250000 })],
    ]);
    const hit = pickHighlightNav(100, 200, map);
    expect(hit?.sector).toBe(120);
  });

  it('falls back to first button NAV when none have reached HLI yet', () => {
    const map = new Map<number, NavPtsLike>([
      [10, navWith({ btn_ns: 0 })],
      [20, navWith({ btn_ns: 3, hli_s_ptm: 500000, vobu_s_ptm: 100000 })],
    ]);
    expect(pickHighlightNav(10, 50, map)?.sector).toBe(20);
  });
});

describe('resolveMenuStillSeek', () => {
  it('seeks to the HLI VOBU with an exact single frame', () => {
    const seek = resolveMenuStillSeek({
      cellStartSector: 100,
      cellLastSector: 500,
      highlight: {
        sector: 120,
        nav: navWith({ btn_ns: 4, hli_s_ptm: 90000, vobu_s_ptm: 90000 }),
      },
      timing: { startSec: 0, endSec: 10 },
    });
    expect(seek).toMatchObject({
      skipBytes: 120 * DVD_VIDEO_LB_LEN,
      ssSec: 0,
      reason: 'hli',
      frameCount: 1,
    });
    expect(seek.durationSec).toBeGreaterThanOrEqual(1);
  });

  it('uses cell start (not mid) when there is no highlight', () => {
    const seek = resolveMenuStillSeek({
      cellStartSector: 0,
      cellLastSector: 100,
      highlight: null,
      timing: { startSec: 0, endSec: 8 },
    });
    expect(seek).toMatchObject({
      skipBytes: 0,
      ssSec: 0,
      reason: 'start',
      frameCount: 1,
    });
  });

  it('uses cell start for short timed stills without HLI', () => {
    const seek = resolveMenuStillSeek({
      cellStartSector: 1245,
      cellLastSector: 1290,
      highlight: null,
      timing: { startSec: 12, endSec: 12.48 },
    });
    expect(seek).toMatchObject({
      skipBytes: 1245 * DVD_VIDEO_LB_LEN,
      ssSec: 0,
      reason: 'start',
    });
  });
});

describe('nextVobuSectorFromNav', () => {
  it('follows SRI next_vobu from the file sector', () => {
    expect(
      nextVobuSectorFromNav(
        100,
        navWith({ next_vobu: 0x8000000b, vobu_ea: 10 }),
      ),
    ).toBe(111);
  });

  it('returns null at end of cell', () => {
    expect(
      nextVobuSectorFromNav(
        100,
        navWith({ next_vobu: SRI_END_OF_CELL | 0x80000000 }),
      ),
    ).toBeNull();
  });
});

describe('cellRelativeSkipBytes', () => {
  it('converts absolute VOB skips into cell-local offsets', () => {
    const start = 100 * DVD_VIDEO_LB_LEN;
    const end = 200 * DVD_VIDEO_LB_LEN;
    expect(cellRelativeSkipBytes(start, start, end)).toBe(0);
    expect(cellRelativeSkipBytes(start + 10 * DVD_VIDEO_LB_LEN, start, end)).toBe(
      10 * DVD_VIDEO_LB_LEN,
    );
  });

  it('clamps so the skip cannot leave an empty cell slice', () => {
    const start = 39586 * DVD_VIDEO_LB_LEN;
    const end = 39642 * DVD_VIDEO_LB_LEN; // next cell (Special Features) starts here
    const pastEnd = end + 10 * DVD_VIDEO_LB_LEN;
    const rel = cellRelativeSkipBytes(pastEnd, start, end);
    expect(rel).toBeLessThan(end - start);
    expect(rel).toBe(end - start - DVD_VIDEO_LB_LEN);
  });
});

describe('listNavSectorsForBasename', () => {
  it('indexes NAV sidecars by sector', () => {
    const map = listNavSectorsForBasename(
      ['VTS_01_0-0x10.json', 'VTS_01_0-0x0A.json', 'metadata.json', 'VTS_02_0-0x01.json'],
      'VTS_01_0',
    );
    expect([...map.keys()].sort((a, b) => a - b)).toEqual([10, 16]);
    expect(map.get(16)).toBe('VTS_01_0-0x10.json');
  });
});

describe('cellNeedsStillPng', () => {
  it('skips pure motion transitions (no buttons, still_time 0)', () => {
    expect(cellNeedsStillPng({ highlight: null, still_time: 0 })).toBe(false);
    expect(
      cellNeedsStillPng({
        highlight: { sector: 1, nav: navWith({ btn_ns: 0 }) },
        still_time: 0,
      }),
    ).toBe(false);
  });

  it('keeps interactive and timed-still cells', () => {
    expect(
      cellNeedsStillPng({
        highlight: { sector: 1, nav: navWith({ btn_ns: 3 }) },
        still_time: 0,
      }),
    ).toBe(true);
    expect(cellNeedsStillPng({ highlight: null, still_time: 3 })).toBe(true);
    expect(cellNeedsStillPng({ highlight: null, still_time: 255 })).toBe(true);
  });
});
