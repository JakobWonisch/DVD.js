/**
 * Menu WebM segment plan: exact cell duration windows on the DVD timeline.
 *
 * Still extraction may seek to a nearby VOBU/I-frame; encode should keep only
 * [startSec, endSec) so playback does not bleed previous/next cell frames.
 */

'use strict';

import { DVD_VIDEO_LB_LEN } from './menuStillSeek.js';

export type MenuCellLike = {
  startSec?: number;
  endSec?: number;
  start_sector?: number;
  last_sector?: number;
};

export type MenuEncodeSegment = {
  /** Absolute timeline start (matches menuCell / vm.js). */
  startSec: number;
  endSec: number;
  durationSec: number;
  skipBytes: number;
  cellId: string;
  vobId: string;
  label: string;
};

/**
 * Build encode segments from menuCell metadata, ordered by timeline.
 * Skips zero-duration / missing-sector cells.
 */
export function buildMenuEncodeSegments(
  menuCell: Record<string, Record<string, MenuCellLike>> | null | undefined,
): MenuEncodeSegment[] {
  if (!menuCell) {
    return [];
  }

  const out: MenuEncodeSegment[] = [];
  for (const cellId of Object.keys(menuCell)) {
    const vobs = menuCell[cellId];
    if (!vobs) {
      continue;
    }
    for (const vobId of Object.keys(vobs)) {
      const cell = vobs[vobId];
      if (!cell) {
        continue;
      }
      const startSec = cell.startSec;
      const endSec = cell.endSec;
      const startSector = cell.start_sector;
      if (
        startSec == null ||
        endSec == null ||
        endSec <= startSec ||
        startSector == null ||
        !Number.isFinite(startSector)
      ) {
        continue;
      }
      const durationSec = endSec - startSec;
      if (!(durationSec > 0)) {
        continue;
      }
      out.push({
        startSec,
        endSec,
        durationSec,
        skipBytes: startSector * DVD_VIDEO_LB_LEN,
        cellId: String(cellId),
        vobId: String(vobId),
        label: cellId + ':' + vobId,
      });
    }
  }

  out.sort(function (a, b) {
    if (a.startSec !== b.startSec) {
      return a.startSec - b.startSec;
    }
    return a.skipBytes - b.skipBytes;
  });
  return out;
}

/**
 * Keyframe timestamps for a single-file menu encode (cell starts + 0).
 */
export function menuForceKeyFrameTimes(segments: MenuEncodeSegment[]): number[] {
  const times = new Set<number>([0]);
  for (const seg of segments) {
    if (seg.startSec > 0) {
      times.add(Number(seg.startSec.toFixed(3)));
    }
  }
  return [...times].sort(function (a, b) {
    return a - b;
  });
}
