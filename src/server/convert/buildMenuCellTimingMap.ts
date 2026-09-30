import { dvdTimeToSeconds } from '../../server/utils/dvdTime.js';

export type MenuCellTiming = {
  startSec: number;
  endSec: number;
  still_time?: number;
  playback_mode?: number;
};

type CellAdr = {
  cell_id: number;
  vob_id: number;
  start_sector?: number;
  last_sector?: number;
};

type CellPlayback = {
  playback_time?: {
    hour: number;
    minute: number;
    second: number;
    frame_u: number;
  };
  still_time?: number;
  playback_mode?: number;
  first_sector?: number;
  last_sector?: number;
};

type IfoLike = {
  menu_c_adt?: {
    cell_adr_table?: CellAdr[] | null;
  } | null;
  pgci_ut?: {
    lu?: Array<{
      pgcit?: {
        pgci_srp?: Array<{
          pgc?: {
            cell_position?: Array<{ cell_nr: number; vob_id_nr: number }>;
            cell_playback?: CellPlayback[];
          } | null;
        }>;
      } | null;
    }>;
  } | null;
};

/**
 * Map cellID:vobID → start/end seconds on the encoded menu VOB timeline.
 *
 * Times follow menu_c_adt.cell_adr_table order (sector order), not per-PGC
 * playback order. Per-PGC relative times are wrong once many single-cell PGCs
 * share one WebM (every cell would look like startSec=0).
 */
export function buildMenuCellTimingMap(json: IfoLike): Record<string, MenuCellTiming> {
  const map: Record<string, MenuCellTiming> = {};
  const durations: Record<
    string,
    { duration: number; still_time: number; playback_mode: number }
  > = {};

  const lus = json.pgci_ut?.lu;
  if (lus) {
    for (let i = 0; i < lus.length; i++) {
      const srps = lus[i].pgcit?.pgci_srp;
      if (!srps) {
        continue;
      }
      for (let j = 0; j < srps.length; j++) {
        const pgc = srps[j].pgc;
        if (!pgc?.cell_position || !pgc.cell_playback) {
          continue;
        }
        for (let c = 0; c < pgc.cell_position.length; c++) {
          const pos = pgc.cell_position[c];
          const playback = pgc.cell_playback[c];
          const key = pos.cell_nr + ':' + pos.vob_id_nr;
          if (durations[key]) {
            continue;
          }
          durations[key] = {
            duration: playback
              ? dvdTimeToSeconds(playback.playback_time)
              : 0,
            still_time: playback ? playback.still_time || 0 : 0,
            playback_mode: playback ? playback.playback_mode || 0 : 0,
          };
        }
      }
    }
  }

  const table = json.menu_c_adt?.cell_adr_table;
  if (table && table.length) {
    let t = 0;
    for (let i = 0; i < table.length; i++) {
      const cell = table[i];
      const key = cell.cell_id + ':' + cell.vob_id;
      if (map[key]) {
        continue;
      }
      const info = durations[key] || {
        duration: 0,
        still_time: 0,
        playback_mode: 0,
      };
      // IFO playback_time can be 0 for still-only cells; encode still needs a
      // positive window. Use one PAL frame as a minimum when the cell has packs.
      let duration = info.duration;
      const sectorSpan =
        cell.last_sector != null &&
        cell.start_sector != null &&
        cell.last_sector >= cell.start_sector
          ? cell.last_sector - cell.start_sector + 1
          : 0;
      if (!(duration > 0) && sectorSpan > 0) {
        duration = 1 / 25;
      }
      map[key] = {
        startSec: t,
        endSec: t + duration,
        still_time: info.still_time,
        playback_mode: info.playback_mode,
      };
      t += duration;
    }
    return map;
  }

  // No C_ADT: fall back to first-seen PGC-relative times.
  for (const key of Object.keys(durations)) {
    const info = durations[key];
    map[key] = {
      startSec: 0,
      endSec: info.duration,
      still_time: info.still_time,
      playback_mode: info.playback_mode,
    };
  }
  return map;
}
