import { describe, expect, it } from 'vitest';
import {
  DVD_VIDEO_LB_LEN,
  hliOffsetSecFromNav,
  listNavSectorsForBasename,
  pickHighlightNav,
  resolveMenuStillSeek,
  type NavPtsLike,
} from '../../src/server/convert/menuStillSeek.js';

function navWith(opts: {
  btn_ns?: number;
  hli_s_ptm?: number;
  vobu_s_ptm?: number;
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
  it('seeks to the HLI VOBU with a short window', () => {
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
    });
    expect(seek.durationSec).toBeLessThanOrEqual(1);
    expect(seek.frameCount).toBeLessThanOrEqual(16);
  });

  it('uses mid-cell time when there is no highlight', () => {
    const seek = resolveMenuStillSeek({
      cellStartSector: 0,
      cellLastSector: 100,
      highlight: null,
      timing: { startSec: 0, endSec: 8 },
    });
    expect(seek).toMatchObject({
      skipBytes: 0,
      ssSec: 4,
      reason: 'mid',
    });
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
