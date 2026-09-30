/**
 * Menu WebM segment plan: exact cell duration windows on the DVD timeline.
 *
 * Still extraction may seek to a nearby VOBU/I-frame; encode should keep only
 * [startSec, endSec) so playback does not bleed previous/next cell frames.
 */

'use strict';

import * as fs from 'node:fs';
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
  /** Byte offset of the cell start in the menu VOB. */
  skipBytes: number;
  /**
   * Exclusive end byte of the cell in the menu VOB. Encode must clip to this
   * range — `-skip_initial_bytes` + `-t` alone bleeds into the next cell when
   * the IFO duration is longer than the packs (Shrek FP cell → German menu).
   */
  endBytes: number;
  cellId: string;
  vobId: string;
  label: string;
};

/**
 * Cap how many VOB bytes we copy for a cell encode.
 *
 * C_ADT `last_sector` can span the rest of the VOB while IFO playback_time is
 * only a few frames (Shrek VMGM cell 1:3 → ~379MB for 0.04s). Allocating that
 * for a temp clip OOMs / stalls encode; video for `-t duration` lives at the
 * start of the range.
 *
 * ~12 Mbit/s + 128-sector pad covers high-bitrate menu cells without pulling
 * the entire trailing VOB.
 */
export function capMenuEncodeEndBytes(
  startBytes: number,
  cadtEndBytes: number,
  durationSec: number,
): number {
  if (!(startBytes >= 0) || !(cadtEndBytes > startBytes)) {
    return startBytes + DVD_VIDEO_LB_LEN;
  }
  const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 1 / 25;
  const maxBytes =
    Math.ceil(dur * 1.5e6) + 128 * DVD_VIDEO_LB_LEN;
  const capped = startBytes + Math.max(DVD_VIDEO_LB_LEN, maxBytes);
  return Math.min(cadtEndBytes, capped);
}

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
      const lastSector = cell.last_sector;
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
      const skipBytes = startSector * DVD_VIDEO_LB_LEN;
      const cadtEndBytes =
        lastSector != null &&
        Number.isFinite(lastSector) &&
        lastSector >= startSector
          ? (lastSector + 1) * DVD_VIDEO_LB_LEN
          : skipBytes + DVD_VIDEO_LB_LEN;
      const endBytes = capMenuEncodeEndBytes(
        skipBytes,
        cadtEndBytes,
        durationSec,
      );
      out.push({
        startSec,
        endSec,
        durationSec,
        skipBytes,
        endBytes,
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
 * Copy `[startBytes, endBytes)` from a VOB into `outPath` so ffmpeg cannot
 * demux past the cell (same pattern as menu still extraction).
 */
export function clipVobByteRange(
  inputPath: string,
  startBytes: number,
  endBytes: number,
  outPath: string,
): boolean {
  if (
    !(startBytes >= 0) ||
    !(endBytes > startBytes) ||
    !Number.isFinite(startBytes) ||
    !Number.isFinite(endBytes)
  ) {
    return false;
  }
  const length = endBytes - startBytes;
  try {
    const fd = fs.openSync(inputPath, 'r');
    try {
      const buf = Buffer.alloc(length);
      const n = fs.readSync(fd, buf, 0, length, startBytes);
      if (n <= 0) {
        return false;
      }
      fs.writeFileSync(outPath, n === length ? buf : buf.subarray(0, n));
      return true;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
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
