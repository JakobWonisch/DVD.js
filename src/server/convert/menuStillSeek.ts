/**
 * Resolve where to grab a menu still from a cell VOB.
 *
 * Prefer the authored highlight frame (HLI / btn_ns): skip to that VOBU (I-frame)
 * and decode to hli_s_ptm. No-HLI timed stills use the first frame of the cell —
 * mid-cell seeks land on padding and produce black / empty stills.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { loadJsonFile } from '../utils/loadJson.js';

export const DVD_VIDEO_LB_LEN = 2048;

/** End-of-cell marker in DSI VOBU_SRI (libdvdnav). */
export const SRI_END_OF_CELL = 0x3fffffff;

/**
 * Exact authored frame: one output frame at the resolved timestamp.
 * Decode window must cover -ss so MPEG-2 can reach that frame from the VOBU I-frame.
 */
export const STILL_SEEK_FRAME_CANDIDATES = 1;

/** Minimum decode window after VOBU skip (seconds). */
export const STILL_SEEK_WINDOW_SEC = 1;

export type NavPtsLike = {
  pci?: {
    pci_gi?: {
      vobu_s_ptm?: number;
      vobu_e_ptm?: number;
    };
    hli?: {
      hl_gi?: {
        btn_ns?: number;
        hli_s_ptm?: number;
        hli_e_ptm?: number;
      };
      btnit?: unknown[];
      btn_colit?: unknown;
    };
  };
  dsi?: {
    dsi_gi?: {
      nv_pck_lbn?: number;
      vobu_ea?: number;
    };
    vobu_sri?: {
      next_vobu?: number;
    };
  };
};

export type MenuStillSeek = {
  /** Byte offset into the menu VOB for ffmpeg -skip_initial_bytes. */
  skipBytes: number;
  /** Decode seek after the skip (seconds) — HLI offset within the VOBU. */
  ssSec: number;
  frameCount: number;
  durationSec: number;
  reason: 'hli' | 'start';
};

export type HighlightNavHit = {
  sector: number;
  nav: NavPtsLike;
};

function btnNs(nav: NavPtsLike | null | undefined): number {
  return nav?.pci?.hli?.hl_gi?.btn_ns || 0;
}

function hliStartPts(nav: NavPtsLike): number | null {
  const pts = nav.pci?.hli?.hl_gi?.hli_s_ptm;
  return pts != null ? pts : null;
}

function vobuStartPts(nav: NavPtsLike): number | null {
  const pts = nav.pci?.pci_gi?.vobu_s_ptm;
  return pts != null ? pts : null;
}

/**
 * Relative seconds from a NAV VOBU start to HLI start (clamped ≥ 0).
 */
export function hliOffsetSecFromNav(nav: NavPtsLike): number {
  const hli = hliStartPts(nav);
  const vobu = vobuStartPts(nav);
  if (hli == null || vobu == null) {
    return 0;
  }
  return Math.max(0, (hli - vobu) / 90000);
}

/**
 * Seconds from cell playback start to HLI enable — cell-local, not absolute PTS
 * minus IFO concat startSec (those clocks disagree).
 *
 * Prefer (hli_s_ptm − first cell VOBU PTS) / 90000; fall back to HLI offset
 * within the highlight VOBU when the cell-start NAV is missing.
 */
export function hliDelaySecFromCell(
  cellStartNav: NavPtsLike | null | undefined,
  highlightNav: NavPtsLike | null | undefined,
): number {
  const hli = highlightNav ? hliStartPts(highlightNav) : null;
  const cellPts = cellStartNav ? vobuStartPts(cellStartNav) : null;
  if (hli != null && cellPts != null) {
    return Math.max(0, (hli - cellPts) / 90000);
  }
  if (highlightNav) {
    return hliOffsetSecFromNav(highlightNav);
  }
  return 0;
}

/**
 * Pick the best NAV for stills/buttons: first in [start, last] with buttons,
 * preferring the earliest sector at/after HLI when possible.
 */
export function pickHighlightNav(
  cellStartSector: number,
  cellLastSector: number,
  navBySector: Map<number, NavPtsLike> | Record<number, NavPtsLike>,
): HighlightNavHit | null {
  const get =
    navBySector instanceof Map
      ? (s: number) => navBySector.get(s)
      : (s: number) => navBySector[s];

  const sectors: number[] = [];
  if (navBySector instanceof Map) {
    for (const s of navBySector.keys()) {
      sectors.push(s);
    }
  } else {
    for (const key of Object.keys(navBySector)) {
      sectors.push(Number(key));
    }
  }
  sectors.sort((a, b) => a - b);

  let firstWithButtons: HighlightNavHit | null = null;
  for (const sector of sectors) {
    if (sector < cellStartSector || sector > cellLastSector) {
      continue;
    }
    const nav = get(sector);
    if (!nav || btnNs(nav) <= 0) {
      continue;
    }
    if (!firstWithButtons) {
      firstWithButtons = { sector, nav };
    }
    const hli = hliStartPts(nav);
    const vobu = vobuStartPts(nav);
    // Prefer a VOBU that has already reached HLI (stable interactive frame).
    if (hli != null && vobu != null && vobu >= hli) {
      return { sector, nav };
    }
  }
  return firstWithButtons;
}

/**
 * Whether convert should write a still PNG for this cell.
 * Pure motion transitions (no buttons, still_time 0) get mid-wipe frames that
 * the viewer must not flash — skip those. Timed stills (copyright) and
 * interactive menus still need a PNG.
 */
export function cellNeedsStillPng(opts: {
  highlight?: HighlightNavHit | null;
  still_time?: number | null;
}): boolean {
  const stillTime = opts.still_time != null ? opts.still_time : 0;
  if (stillTime > 0) {
    return true;
  }
  const hit = opts.highlight;
  return !!(hit && btnNs(hit.nav) > 0);
}

/**
 * Compute ffmpeg seek for the authored still frame.
 *
 * Interactive: VOBU that carries HLI + -ss to hli_s_ptm within that VOBU.
 * No-HLI timed still: first frame of the cell (never mid-sector — that is often
 * padding and yields 0 frames / black).
 */
export function resolveMenuStillSeek(opts: {
  cellStartSector: number;
  cellLastSector: number;
  highlight?: HighlightNavHit | null;
  timing?: { startSec?: number; endSec?: number } | null;
}): MenuStillSeek {
  const start = opts.cellStartSector;
  const cellStartBytes = start * DVD_VIDEO_LB_LEN;
  const hit = opts.highlight;

  if (hit && btnNs(hit.nav) > 0) {
    const ssSec = hliOffsetSecFromNav(hit.nav);
    // Decode past the HLI offset so MPEG-2 can emit the target frame.
    const durationSec = Math.max(STILL_SEEK_WINDOW_SEC, ssSec + 0.25);
    return {
      skipBytes: hit.sector * DVD_VIDEO_LB_LEN,
      ssSec,
      frameCount: STILL_SEEK_FRAME_CANDIDATES,
      durationSec,
      reason: 'hli',
    };
  }

  return {
    skipBytes: cellStartBytes,
    ssSec: 0,
    frameCount: STILL_SEEK_FRAME_CANDIDATES,
    durationSec: STILL_SEEK_WINDOW_SEC,
    reason: 'start',
  };
}

/**
 * Byte offset into a cell-clipped VOB slice for ffmpeg `-skip_initial_bytes`.
 * Clipping the cell before decode prevents bleeding into the next cell
 * (Harry Potter: last scene page sits against Special Features).
 */
export function cellRelativeSkipBytes(
  absoluteSkipBytes: number,
  cellStartBytes: number,
  cellEndBytes: number,
): number {
  if (!(cellEndBytes > cellStartBytes)) {
    return 0;
  }
  const rel = absoluteSkipBytes - cellStartBytes;
  if (!Number.isFinite(rel) || rel <= 0) {
    return 0;
  }
  // Leave at least one pack so ffmpeg has something to demux.
  const maxSkip = Math.max(0, cellEndBytes - cellStartBytes - DVD_VIDEO_LB_LEN);
  return Math.min(rel, maxSkip);
}

/**
 * Parse `basename-0xABCD.json` NAV filenames into a sector → path map.
 */
export function listNavSectorsForBasename(
  files: string[],
  basename: string,
): Map<number, string> {
  const prefix = basename + '-';
  const out = new Map<number, string>();
  for (const name of files) {
    if (!name.startsWith(prefix) || !name.endsWith('.json')) {
      continue;
    }
    const hex = name.slice(prefix.length, -'.json'.length);
    if (!/^0x[0-9A-Fa-f]+$/.test(hex)) {
      continue;
    }
    out.set(parseInt(hex, 16), name);
  }
  return out;
}

/**
 * Load all NAV sidecars for a menu VOB basename into a sector → nav map.
 */
export function loadNavBySectorForBasename(
  webPath: string,
  basename: string,
): Map<number, NavPtsLike> {
  const navBySector = new Map<number, NavPtsLike>();
  let names: string[] = [];
  try {
    names = fs.existsSync(webPath) ? fs.readdirSync(webPath) : [];
  } catch {
    return navBySector;
  }
  const index = listNavSectorsForBasename(names, basename);
  for (const [sector, fileName] of index) {
    try {
      navBySector.set(
        sector,
        loadJsonFile(path.join(webPath, fileName)) as NavPtsLike,
      );
    } catch {
      // ignore unreadable NAV sidecars
    }
  }
  return navBySector;
}

/**
 * Highlight NAV for a cell (shared by stills, buttons, SPU, btnCmd).
 */
export function resolveCellHighlightNav(
  webPath: string,
  basename: string,
  cellStartSector: number,
  cellLastSector: number,
  navBySector?: Map<number, NavPtsLike>,
): HighlightNavHit | null {
  const map =
    navBySector || loadNavBySectorForBasename(webPath, basename);
  return pickHighlightNav(cellStartSector, cellLastSector, map);
}

/**
 * True if a PNG buffer looks like a real image (signature + more than a header).
 */
export function isUsableStillPng(filePath: string): boolean {
  try {
    const st = fs.statSync(filePath);
    if (st.size < 33) {
      return false;
    }
    const fd = fs.openSync(filePath, 'r');
    const magic = Buffer.alloc(8);
    fs.readSync(fd, magic, 0, 8, 0);
    fs.closeSync(fd);
    return (
      magic[0] === 0x89 &&
      magic[1] === 0x50 &&
      magic[2] === 0x4e &&
      magic[3] === 0x47
    );
  } catch {
    return false;
  }
}

/**
 * Next VOBU file sector from DSI, using the sector we actually read as base
 * (matches libdvdnav: nv_pck_lbn + (next_vobu & 0x3FFFFFFF)).
 * Returns null at end-of-cell or when the chain cannot advance.
 */
export function nextVobuSectorFromNav(
  fileSector: number,
  nav: NavPtsLike,
): number | null {
  const sri = nav.dsi?.vobu_sri?.next_vobu;
  if (sri != null) {
    const offset = sri & SRI_END_OF_CELL;
    if (offset === SRI_END_OF_CELL) {
      return null;
    }
    if (offset > 0) {
      return fileSector + offset;
    }
  }
  const ea = nav.dsi?.dsi_gi?.vobu_ea;
  if (ea != null && ea >= 0) {
    return fileSector + ea + 1;
  }
  return null;
}
