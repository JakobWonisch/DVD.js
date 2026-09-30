import { describe, expect, it } from 'vitest';
import { menuCellAdrCount } from '../../src/server/convert/menuCellAdrCount.js';
import { buildMenuCellTimingMap } from '../../src/server/convert/buildMenuCellTimingMap.js';

describe('menuCellAdrCount', () => {
  it('uses cell_adr_table length when longer than nr_of_vobs', () => {
    // Multi-cell VOB: nr_of_vobs counts unique VOBs, table has one row per cell.
    expect(
      menuCellAdrCount({
        nr_of_vobs: 2,
        cell_adr_table: [
          { vob_id: 1, cell_id: 1 },
          { vob_id: 1, cell_id: 2 },
          { vob_id: 2, cell_id: 1 },
        ],
      }),
    ).toBe(3);
  });

  it('falls back to nr_of_vobs when table is missing', () => {
    expect(menuCellAdrCount({ nr_of_vobs: 5 })).toBe(5);
    expect(menuCellAdrCount(null)).toBe(0);
  });
});

describe('buildMenuCellTimingMap', () => {
  it('assigns absolute times from cell_adr_table order, not per-PGC', () => {
    const map = buildMenuCellTimingMap({
      menu_c_adt: {
        cell_adr_table: [
          { vob_id: 1, cell_id: 1, start_sector: 0, last_sector: 10 },
          { vob_id: 2, cell_id: 1, start_sector: 11, last_sector: 20 },
          { vob_id: 3, cell_id: 1, start_sector: 21, last_sector: 30 },
        ],
      },
      pgci_ut: {
        lu: [
          {
            pgcit: {
              pgci_srp: [
                // Three separate single-cell PGCs — each would be startSec=0
                // if timed per-PGC (the old bug).
                {
                  pgc: {
                    cell_position: [{ cell_nr: 1, vob_id_nr: 1 }],
                    cell_playback: [
                      {
                        playback_time: {
                          hour: 0,
                          minute: 0,
                          second: 0x10, // BCD 10s
                          frame_u: 0x40, // 25fps marker, 0 frames
                        },
                        still_time: 0,
                        playback_mode: 0,
                      },
                    ],
                  },
                },
                {
                  pgc: {
                    cell_position: [{ cell_nr: 1, vob_id_nr: 2 }],
                    cell_playback: [
                      {
                        playback_time: {
                          hour: 0,
                          minute: 0,
                          second: 0x04,
                          frame_u: 0x40,
                        },
                        still_time: 0,
                        playback_mode: 0,
                      },
                    ],
                  },
                },
                {
                  pgc: {
                    cell_position: [{ cell_nr: 1, vob_id_nr: 3 }],
                    cell_playback: [
                      {
                        playback_time: {
                          hour: 0,
                          minute: 0,
                          second: 0x05,
                          frame_u: 0x40,
                        },
                        still_time: 255,
                        playback_mode: 0,
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    });

    expect(map['1:1']).toMatchObject({ startSec: 0, endSec: 10 });
    expect(map['1:2']).toMatchObject({ startSec: 10, endSec: 14 });
    expect(map['1:3']).toMatchObject({
      startSec: 14,
      endSec: 19,
      still_time: 255,
    });
  });

  it('gives zero-duration cells a one-frame encode window', () => {
    const map = buildMenuCellTimingMap({
      menu_c_adt: {
        cell_adr_table: [
          { vob_id: 1, cell_id: 1, start_sector: 0, last_sector: 4 },
        ],
      },
      pgci_ut: {
        lu: [
          {
            pgcit: {
              pgci_srp: [
                {
                  pgc: {
                    cell_position: [{ cell_nr: 1, vob_id_nr: 1 }],
                    cell_playback: [
                      {
                        playback_time: {
                          hour: 0,
                          minute: 0,
                          second: 0,
                          frame_u: 0,
                        },
                        still_time: 255,
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    });
    expect(map['1:1'].endSec - map['1:1'].startSec).toBeCloseTo(1 / 25, 5);
  });
});
