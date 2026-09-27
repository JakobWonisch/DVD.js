/**
 * Resolve where to grab a menu still from a cell VOB.
 *
 * Prefer the highlight-active VOBU (HLI / btn_ns) so stills match button + SPU
 * layout. Avoid scanning a long early window and picking the largest PNG —
 * that often lands on transition/wipe frames.
 */

export const DVD_VIDEO_LB_LEN = 2048;

/** Frames to decode around the seek point (quality filter for gray/corrupt). */
export const STILL_SEEK_FRAME_CANDIDATES = 8;

/** Seconds of video to allow while collecting those frames. */
export const STILL_SEEK_WINDOW_SEC = 0.5;

export type NavPtsLike = {
  pci?: {
    pci_gi?: {
      vobu_s_ptm?: number;
    };
    hli?: {
      hl_gi?: {
        btn_ns?: number;
        hli_s_ptm?: number;
      };
    };
  };
};

export type MenuStillSeek = {
  /** Byte offset into the menu VOB for ffmpeg -skip_initial_bytes. */
  skipBytes: number;
  /** Decode seek after the skip (seconds). */
  ssSec: number;
  frameCount: number;
  durationSec: number;
  reason: 'hli' | 'mid' | 'start';
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
 * Pick the best NAV for stills: first in [start, last] with buttons,
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
 * Compute ffmpeg seek for a menu cell still.
 */
export function resolveMenuStillSeek(opts: {
  cellStartSector: number;
  cellLastSector: number;
  highlight?: HighlightNavHit | null;
  timing?: { startSec?: number; endSec?: number } | null;
}): MenuStillSeek {
  const start = opts.cellStartSector;
  const last = opts.cellLastSector;
  const cellStartBytes = start * DVD_VIDEO_LB_LEN;
  const window = {
    frameCount: STILL_SEEK_FRAME_CANDIDATES,
    durationSec: STILL_SEEK_WINDOW_SEC,
  };

  const hit = opts.highlight;
  if (hit && btnNs(hit.nav) > 0) {
    const ssSec = hliOffsetSecFromNav(hit.nav);
    return {
      skipBytes: hit.sector * DVD_VIDEO_LB_LEN,
      ssSec,
      ...window,
      reason: 'hli',
    };
  }

  const duration =
    opts.timing?.endSec != null &&
    opts.timing?.startSec != null &&
    opts.timing.endSec > opts.timing.startSec
      ? opts.timing.endSec - opts.timing.startSec
      : 0;

  if (duration > 1) {
    return {
      skipBytes: cellStartBytes,
      ssSec: duration / 2,
      ...window,
      reason: 'mid',
    };
  }

  if (last > start) {
    const midSector = start + Math.floor((last - start) / 2);
    return {
      skipBytes: midSector * DVD_VIDEO_LB_LEN,
      ssSec: 0,
      ...window,
      reason: 'mid',
    };
  }

  return {
    skipBytes: cellStartBytes,
    ssSec: 0,
    ...window,
    reason: 'start',
  };
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
