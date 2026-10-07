import { describe, expect, it } from 'vitest';
import {
  MIN_COVER_STILL_BYTES,
  listMainMenuCandidates,
  orderMenuLangs,
  parseMenuStillName,
  pickCoverStill,
  scoreMainMenuCellStill,
  type CoverStillFile,
} from '../../src/server/convert/pickCoverStill.ts';

function still(
  domain: number,
  cellID: number,
  vobID: number,
  size: number,
): CoverStillFile {
  const name = 'menu-' + domain + '-' + cellID + '-' + vobID + '.webp';
  return {
    name,
    full: '/tmp/' + name,
    size,
    domain,
    cellID,
    vobID,
  };
}

describe('orderMenuLangs', () => {
  it('prefers en then default', () => {
    expect(orderMenuLangs(['de', 'en', 'fr', 'default'])).toEqual([
      'en',
      'default',
      'de',
      'fr',
    ]);
  });
});

describe('parseMenuStillName', () => {
  it('parses domain-cell-vob webp and legacy png', () => {
    expect(
      parseMenuStillName('menu-0-2-1.webp', '/x/menu-0-2-1.webp', 99),
    ).toEqual({
      name: 'menu-0-2-1.webp',
      full: '/x/menu-0-2-1.webp',
      size: 99,
      domain: 0,
      cellID: 2,
      vobID: 1,
    });
    expect(
      parseMenuStillName('menu-0-2-1.png', '/x/menu-0-2-1.png', 99),
    ).toMatchObject({ domain: 0, cellID: 2, vobID: 1 });
  });

  it('rejects non-menu stills', () => {
    expect(parseMenuStillName('cover.jpg', '/x/cover.jpg', 99)).toBeNull();
  });
});

describe('listMainMenuCandidates', () => {
  it('orders VMGM Title before Root before other Title', () => {
    const metadata = [
      {
        menu: {
          en: [
            {
              pgc: 1,
              entry: 0x82, // Title
              cells: [{ cellID: 1, vobID: 1, still_time: 255 }],
            },
          ],
        },
      },
      {
        menu: {
          en: [
            {
              pgc: 1,
              entry: 0x83, // Root
              cells: [{ cellID: 2, vobID: 1, still_time: 255 }],
            },
            {
              pgc: 2,
              entry: 0x82, // Title in VTS
              cells: [{ cellID: 3, vobID: 1, still_time: 255 }],
            },
          ],
        },
      },
    ];
    const cands = listMainMenuCandidates(metadata);
    expect(cands.map((c) => [c.priority, c.domain, c.menuKind, c.pgc.pgc])).toEqual(
      [
        [0, 0, 'title', 1],
        [1, 1, 'root', 1],
        [2, 1, 'title', 2],
      ],
    );
  });

  it('skips empty stub Root PGCs', () => {
    const cands = listMainMenuCandidates([
      {
        menu: {
          en: [{ pgc: 1, entry: 0x83, cells: [] }],
        },
      },
    ]);
    expect(cands).toEqual([]);
  });
});

describe('pickCoverStill', () => {
  it('prefers VMGM Title still over a larger copyright still', () => {
    const pick = pickCoverStill({
      stills: [
        still(0, 1, 1, 200_000), // copyright / first play — larger
        still(0, 5, 1, 80_000), // Title menu
      ],
      metadata: [
        {
          menu: {
            en: [
              {
                pgc: 3,
                entry: 0, // non-entry
                cells: [{ cellID: 1, vobID: 1, still_time: 5 }],
              },
              {
                pgc: 4,
                entry: 0x82, // Title
                cells: [{ cellID: 5, vobID: 1, still_time: 255 }],
              },
            ],
          },
        },
      ],
    });
    expect(pick?.name).toBe('menu-0-5-1.webp');
    expect(pick?.reason).toContain('title menu domain 0');
  });

  it('falls back to VTS Root when VMGM has no Title', () => {
    const pick = pickCoverStill({
      stills: [
        still(0, 1, 1, 90_000),
        still(1, 2, 1, 70_000),
      ],
      metadata: [
        {
          menu: {
            // VMGM only has a non-entry / First-Play-ish PGC
            en: [
              {
                pgc: 1,
                entry: 0,
                cells: [{ cellID: 1, vobID: 1, still_time: 3 }],
              },
            ],
          },
        },
        {
          menu: {
            en: [
              {
                pgc: 1,
                entry: 0x83,
                cells: [{ cellID: 2, vobID: 1, still_time: 255 }],
              },
            ],
          },
        },
      ],
    });
    expect(pick?.name).toBe('menu-1-2-1.webp');
    expect(pick?.reason).toContain('root menu domain 1');
  });

  it('within a Title PGC prefers the later interactive still over intro', () => {
    const pick = pickCoverStill({
      stills: [
        still(0, 1, 1, 100_000), // intro cell
        still(0, 2, 1, 90_000), // main still
      ],
      metadata: [
        {
          menu: {
            en: [
              {
                pgc: 1,
                entry: 0x82,
                cells: [
                  { cellID: 1, vobID: 1, still_time: 0 },
                  { cellID: 2, vobID: 1, still_time: 255 },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(pick?.name).toBe('menu-0-2-1.webp');
  });

  it('falls back to largest VMGM still without metadata', () => {
    const pick = pickCoverStill({
      stills: [still(1, 1, 1, 200_000), still(0, 3, 1, 50_000)],
      metadata: null,
    });
    expect(pick?.name).toBe('menu-0-3-1.webp');
    expect(pick?.reason).toContain('no main-menu match');
  });

  it('prefers a play-title cell on the Title menu over intro cells', () => {
    const pick = pickCoverStill({
      stills: [
        still(0, 1, 1, 200_000), // copyright / larger
        still(0, 5, 1, 80_000), // Title menu with Play
      ],
      metadata: [
        {
          menu: {
            en: [
              {
                pgc: 4,
                entry: 0x82,
                cells: [{ cellID: 5, vobID: 1, still_time: 255 }],
              },
            ],
          },
        },
      ],
      playTitleCells: [
        {
          domain: 0,
          cellID: 5,
          vobID: 1,
          reason: 'play title 1 via btn 0 LinkPGCN 3',
        },
      ],
    });
    expect(pick?.name).toBe('menu-0-5-1.webp');
    expect(pick?.reason).toContain('play title');
  });

  it('uses a non-Title play-title cell before generic Title fallback', () => {
    const pick = pickCoverStill({
      stills: [
        still(0, 1, 1, 90_000), // Title menu without Play
        still(1, 2, 4, 70_000), // Play trampoline
      ],
      metadata: [
        {
          menu: {
            en: [
              {
                pgc: 1,
                entry: 0x82,
                cells: [{ cellID: 1, vobID: 1, still_time: 255 }],
              },
            ],
          },
        },
      ],
      playTitleCells: [
        {
          domain: 1,
          cellID: 2,
          vobID: 4,
          reason: 'play title 1 via btn 0 LinkPGCN 8',
        },
      ],
    });
    expect(pick?.name).toBe('menu-1-2-4.webp');
  });

  it('ignores stills below the size floor', () => {
    const pick = pickCoverStill({
      stills: [still(0, 1, 1, MIN_COVER_STILL_BYTES - 1)],
      metadata: [
        {
          menu: {
            en: [
              {
                pgc: 1,
                entry: 0x82,
                cells: [{ cellID: 1, vobID: 1, still_time: 255 }],
              },
            ],
          },
        },
      ],
    });
    expect(pick).toBeNull();
  });
});

describe('scoreMainMenuCellStill', () => {
  it('ranks infinite still above timed still above motion', () => {
    const base = still(0, 1, 1, 40_000);
    const infinite = scoreMainMenuCellStill(base, { still_time: 255 }, 0);
    const timed = scoreMainMenuCellStill(base, { still_time: 5 }, 0);
    const motion = scoreMainMenuCellStill(base, { still_time: 0 }, 0);
    expect(infinite).toBeGreaterThan(timed);
    expect(timed).toBeGreaterThan(motion);
  });
});
