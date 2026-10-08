/**
 * Per-cell menu WebMs (`menu-{domain}-{cell}-{vob}.webm`).
 * Domain concat files (`VIDEO_TS.webm` / `VTS_*_0.webm`) are not produced or
 * sought — convert stamps menuCell[].video and the viewer plays each clip
 * from t=0.
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
    Record<
      string,
      { video?: string | null; still?: string | null } | undefined
    > | undefined
  >;
  /** Unused for menus (per-cell only); kept for DiscMetadata shape. */
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

/**
 * Resolve the WebM to play for a menu cell.
 * Prefer explicit opts.video → metadata.menuCell.video only.
 * Never invent menu-*.webm paths — missing stamps mean still-only / skipped cell.
 */
export function resolveMenuCellVideoUrl(
  opts: MenuCellVideoOpts,
  ctx: {
    baseDir?: string | null;
    domainMeta?: DiscMenuCellLookup | null;
    /** Kept for call-site compat; unused. */
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
  return null;
}

/**
 * Map playMenuCell start/end onto the per-cell media timeline [0, duration).
 * Without a cell WebM URL there is no motion window.
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
  if (!cellVideoUrl) {
    return { start: 0, end: 0, perCell: false };
  }
  return {
    start: 0,
    end: duration > 0 ? duration : 0,
    perCell: true,
  };
}
