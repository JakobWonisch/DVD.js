import { describe, expect, it } from 'vitest';

import {
  buildShortTitleEncodePlan,
  listTitleCellsFromIfo,
  resolveLogicalSector,
  buildVobExtents,
} from '../../src/server/convert/titleCellSegments.js';
import { TITLE_INCLUDE_MAX_SEC } from '../../src/server/convert/titleIncludePolicy.js';

/** BCD time — decimal digits stored so dvdTimeToSeconds recovers them. */
function bcdTime(hour: number, minute: number, second: number) {
  return {
    hour: parseInt(String(hour), 16),
    minute: parseInt(String(minute), 16),
    second: parseInt(String(second), 16),
    frame_u: 0x40,
  };
}

function titleIfo(pgcs: Array<Array<{ durSec: number; start: number; last: number }>>) {
  return {
    vts_pgcit: {
      pgci_srp: pgcs.map(function (cells) {
        return {
          pgc: {
            cell_position: cells.map(function (_c, i) {
              return { cell_nr: i + 1, vob_id_nr: 1 };
            }),
            cell_playback: cells.map(function (c) {
              var m = Math.floor(c.durSec / 60);
              var s = Math.floor(c.durSec % 60);
              return {
                playback_time: bcdTime(0, m, s),
                first_sector: c.start,
                last_sector: c.last,
              };
            }),
          },
        };
      }),
    },
  };
}

describe('listTitleCellsFromIfo', () => {
  it('lists cells with sector ranges and IFO durations', () => {
    var cells = listTitleCellsFromIfo(
      titleIfo([
        [
          { durSec: 30, start: 0, last: 100 },
          { durSec: 90, start: 101, last: 5000 },
        ],
      ]),
    );
    expect(cells).toHaveLength(2);
    expect(cells[0].pgcIndex).toBe(1);
    expect(cells[0].ifoDurationSec).toBe(30);
    expect(cells[1].ifoDurationSec).toBe(90);
  });
});

describe('buildShortTitleEncodePlan', () => {
  it('includes only PGCs whose every cell is ≤ cap (IFO when VOB absent)', () => {
    // No real VOB files — probe returns 0, falls back to IFO durations.
    var plan = buildShortTitleEncodePlan(
      titleIfo([
        [{ durSec: 25, start: 0, last: 50 }],
        [
          { durSec: 10, start: 51, last: 60 },
          { durSec: 120, start: 61, last: 9000 },
        ],
        [
          { durSec: 20, start: 10000, last: 10040 },
          { durSec: 30, start: 10041, last: 10080 },
        ],
      ]),
      [],
      TITLE_INCLUDE_MAX_SEC,
    );
    // Empty vobFiles → empty plan (cannot resolve inputs).
    expect(plan.segments).toHaveLength(0);
  });

  it('marks fully-short PGCs when extents resolve (synthetic empty files skipped)', () => {
    // With empty extents, resolveLogicalSector fails → segments dropped.
    var plan = buildShortTitleEncodePlan(
      titleIfo([[{ durSec: 15, start: 0, last: 10 }]]),
      ['/nonexistent/VTS_01_1.VOB'],
      TITLE_INCLUDE_MAX_SEC,
    );
    expect(plan.titlePgcMedia.includedPgcs).toEqual([]);
    expect(plan.segments).toHaveLength(0);
  });
});

describe('resolveLogicalSector', () => {
  it('maps across multi-file extents', () => {
    var extents = [
      { path: '/a.VOB', sectorCount: 100 },
      { path: '/b.VOB', sectorCount: 50 },
    ];
    expect(resolveLogicalSector(extents, 0)).toEqual({
      path: '/a.VOB',
      sectorInFile: 0,
    });
    expect(resolveLogicalSector(extents, 99)).toEqual({
      path: '/a.VOB',
      sectorInFile: 99,
    });
    expect(resolveLogicalSector(extents, 100)).toEqual({
      path: '/b.VOB',
      sectorInFile: 0,
    });
    expect(resolveLogicalSector(extents, 200)).toBeNull();
  });
});

describe('buildVobExtents', () => {
  it('returns zero sectorCount for missing files', () => {
    var extents = buildVobExtents(['/no/such/file.VOB']);
    expect(extents).toEqual([{ path: '/no/such/file.VOB', sectorCount: 0 }]);
  });
});
