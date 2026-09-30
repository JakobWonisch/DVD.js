/**
 * Per-cell menu WebMs (`menu-{domain}-{cell}-{vob}.webm`) vs legacy concat
 * domain files (`VIDEO_TS.webm` / `VTS_*_0.webm`) that seek by startSec.
 */

export type MenuCellVideoOpts = {
  domain?: number | string | null;
  cellID?: number | string | null;
  vobID?: number | string | null;
  /** Explicit URL from vm.js / metadata.menuCell.video. */
  video?: string | null;
  startSec?: number;
  endSec?: number;
};

export type DiscMenuCellLookup = {
  menuCell?: Record<
    string,
    Record<string, { video?: string | null } | undefined> | undefined
  >;
  /** Domain menu WebMs from metadata.index (legacy concat archives). */
  index?: string[] | null;
};

/** Same naming as still PNGs: menu-{domain}-{cell}-{vob}.webm */
export function menuCellVideoUrl(
  baseDir: string,
  domain: string | number,
  cellID: string | number,
  vobID: string | number,
): string {
  return `${baseDir}menu-${domain}-${cellID}-${vobID}.webm`;
}

/** True when src is a domain-wide concat menu WebM (pre–per-cell archives). */
export function isLegacyConcatMenuWebm(
  src: string | null | undefined,
): boolean {
  if (!src) {
    return false;
  }
  const path = src.split('?')[0];
  const base = path.slice(path.lastIndexOf('/') + 1);
  return /^(VIDEO_TS|VTS_\d+_0)\.webm$/i.test(base);
}

/** True when convert stamped at least one menuCell.video (per-cell package). */
export function domainHasPerCellMenuVideos(
  domainMeta?: DiscMenuCellLookup | null,
): boolean {
  const mc = domainMeta?.menuCell;
  if (!mc) {
    return false;
  }
  for (const cellId of Object.keys(mc)) {
    const vobs = mc[cellId];
    if (!vobs) {
      continue;
    }
    for (const vobId of Object.keys(vobs)) {
      if (vobs[vobId]?.video) {
        return true;
      }
    }
  }
  return false;
}

/** Legacy domain concat URL from metadata.index, if any. */
export function domainLegacyConcatMenuSrc(
  domainMeta?: DiscMenuCellLookup | null,
): string | null {
  const index = domainMeta?.index;
  if (!Array.isArray(index)) {
    return null;
  }
  for (let i = 0; i < index.length; i++) {
    if (isLegacyConcatMenuWebm(index[i])) {
      return index[i];
    }
  }
  return null;
}

/**
 * Resolve the WebM to play for a menu cell.
 * Prefer explicit opts.video → metadata.menuCell.video → constructed path
 * when this domain is a per-cell package. Never invent menu-*.webm for
 * legacy concat archives (Harry Potter pre–per-cell) — that 404s forever.
 */
export function resolveMenuCellVideoUrl(
  opts: MenuCellVideoOpts,
  ctx: {
    baseDir?: string | null;
    domainMeta?: DiscMenuCellLookup | null;
    /** Current <video> src — used only to decide legacy fallback. */
    currentSrc?: string | null;
  } = {},
): string | null {
  if (opts.video) {
    return opts.video;
  }
  const domain = opts.domain;
  const cellID = opts.cellID;
  const vobID = opts.vobID;
  if (domain == null || domain === '' || cellID == null || vobID == null) {
    return null;
  }
  const fromMeta =
    ctx.domainMeta?.menuCell?.[String(cellID)]?.[String(vobID)]?.video;
  if (fromMeta) {
    return fromMeta;
  }
  if (isLegacyConcatMenuWebm(ctx.currentSrc)) {
    return null;
  }
  // metadata.index still names VTS_*_0.webm / VIDEO_TS.webm and no cell was
  // stamped with .video → seek on the concat file (do not GET menu-d-c-v.webm).
  if (
    domainLegacyConcatMenuSrc(ctx.domainMeta) &&
    !domainHasPerCellMenuVideos(ctx.domainMeta)
  ) {
    return null;
  }
  if (!ctx.baseDir) {
    return null;
  }
  return menuCellVideoUrl(ctx.baseDir, domain, cellID, vobID);
}

/**
 * Map playMenuCell start/end onto the media timeline.
 * Per-cell clips play [0, duration); legacy concat keeps absolute times.
 */
export function menuMotionPlaybackWindow(
  opts: MenuCellVideoOpts,
  cellVideoUrl: string | null,
): { start: number; end: number; perCell: boolean } {
  const absStart = opts.startSec != null && Number.isFinite(opts.startSec)
    ? opts.startSec
    : 0;
  const absEnd =
    opts.endSec != null && Number.isFinite(opts.endSec) ? opts.endSec : absStart;
  const duration = absEnd > absStart ? absEnd - absStart : 0;
  if (cellVideoUrl) {
    return {
      start: 0,
      end: duration > 0 ? duration : absEnd,
      perCell: true,
    };
  }
  return { start: absStart, end: absEnd, perCell: false };
}
