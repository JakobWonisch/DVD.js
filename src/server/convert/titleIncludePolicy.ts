/**
 * Menus-mode convert encodes short title *cells* (VOB NAV PTS duration ≤
 * TITLE_INCLUDE_MAX_SEC) that belong to fully-short title PGCs — games /
 * brief interactive extras — even when they share a VTS with a long feature.
 */

import { dvdTimeToSeconds } from '../utils/dvdTime.js';

/** Per-cell / per-PGC include cap (seconds). */
export const TITLE_INCLUDE_MAX_SEC = 60;

/**
 * @deprecated Rip no longer size-prunes title VOBs (short cells may live
 * inside large feature VOBs). Kept for tests / callers.
 */
export const TITLE_INCLUDE_MAX_BYTES = TITLE_INCLUDE_MAX_SEC * 2_000_000;

export type TitlePgcPlayback = {
  playback_time?: {
    hour?: number;
    minute?: number;
    second?: number;
    frame_u?: number;
  } | null;
};

export type TitlePgcSrp = {
  pgc?: TitlePgcPlayback | null;
};

export type TitlePgcit = {
  pgci_srp?: TitlePgcSrp[] | null;
} | null;

/**
 * Longest title-domain PGC playback time in a VTS IFO (seconds).
 * Returns 0 when the table is missing or empty.
 */
export function maxTitlePgcDurationSec(vtsPgcit: TitlePgcit): number {
  var srps = vtsPgcit && vtsPgcit.pgci_srp;
  if (!srps || !srps.length) {
    return 0;
  }
  var max = 0;
  for (var i = 0; i < srps.length; i++) {
    var pgc = srps[i] && srps[i].pgc;
    var sec = dvdTimeToSeconds(pgc && pgc.playback_time);
    if (sec > max) {
      max = sec;
    }
  }
  return max;
}

/** True when a measured cell duration is within the include cap. */
export function isShortTitleCellDuration(
  durationSec: number,
  maxSec: number = TITLE_INCLUDE_MAX_SEC,
): boolean {
  return durationSec > 0 && durationSec <= maxSec;
}

/**
 * Whether a title-domain VOB group should be considered under menus mode
 * given a precomputed max duration (legacy whole-VOB gate). Prefer
 * buildShortTitleEncodePlan for cell-level decisions.
 */
export function shouldIncludeTitleVobGroup(options: {
  full: boolean;
  isMenuVob: boolean;
  durationSec: number;
  maxSec?: number;
}): boolean {
  if (options.isMenuVob || options.full) {
    return true;
  }
  return isShortTitleCellDuration(
    options.durationSec,
    typeof options.maxSec === 'number' ? options.maxSec : TITLE_INCLUDE_MAX_SEC,
  );
}

/** @deprecated Rip keeps all title VOBs for short-cell extract. */
export function shouldKeepTitleVobsForRip(totalBytes: number, maxBytes?: number): boolean {
  var cap =
    typeof maxBytes === 'number' ? maxBytes : TITLE_INCLUDE_MAX_BYTES;
  return totalBytes > 0 && totalBytes <= cap;
}
