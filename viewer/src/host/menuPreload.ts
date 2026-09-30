import { fadeInVideoAudio, silenceVideoAudio } from './autoplay.js';
import { type DiscMenuCellLookup } from './menuCellVideo.js';

/**
 * Warm menu stills / WebMs so motion→still handoffs do not flash black or
 * frame 0 while the next PNG is still fetching.
 *
 * Principle: keep the last painted frame until the next asset has real pixels
 * (or the WebM is inside its segment). Never pretend a timed-out load is ready.
 */

export type MenuCellRef = {
  cellID?: number | string;
  vobID?: number | string;
  still_time?: number;
  buttons?: unknown[];
  /** Convert-emitted still URL when present. */
  still?: string | null;
};

/** Parse `data-cells` on `<x-menu>` (URI-encoded JSON from the Solid tree). */
export function parseMenuCellsFromDataset(
  menu: HTMLElement | null | undefined,
): MenuCellRef[] {
  if (!menu) {
    return [];
  }
  const raw = menu.dataset.cells;
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

export function menuStillUrl(
  baseDir: string,
  domain: string | number,
  cellID: string | number,
  vobID: string | number,
): string {
  return `${baseDir}menu-${domain}-${cellID}-${vobID}.png`;
}

export function imageHasPixels(
  img: HTMLImageElement | null | undefined,
): boolean {
  return !!(img && img.complete && img.naturalWidth > 0);
}

/** Fire-and-forget image warm into the browser cache. */
export function preloadImageUrl(url: string): Promise<void> {
  if (!url || typeof Image === 'undefined') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
    if (img.complete) {
      resolve();
    }
  });
}

export type WhenImageReadyOpts = {
  /** Cap how long we wait; on timeout resolve false unless pixels already exist. */
  timeoutMs?: number;
  /** Ignore load events for a different src (stale cell). */
  expectedSrc?: string | null;
};

/**
 * Resolve when an <img> has decoded pixels for the expected src.
 * Returns true only when pixels are present — never treats a blind timeout as ready.
 */
export function whenImageReady(
  img: HTMLImageElement | null | undefined,
  timeoutOrOpts: number | WhenImageReadyOpts = 30_000,
): Promise<boolean> {
  const opts: WhenImageReadyOpts =
    typeof timeoutOrOpts === 'number'
      ? { timeoutMs: timeoutOrOpts }
      : timeoutOrOpts || {};
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const expectedSrc = opts.expectedSrc;

  if (!img) {
    return Promise.resolve(false);
  }
  const srcAttr = img.getAttribute('src');
  if (!srcAttr) {
    return Promise.resolve(false);
  }
  if (expectedSrc != null && srcAttr !== expectedSrc) {
    return Promise.resolve(false);
  }
  if (imageHasPixels(img)) {
    return Promise.resolve(true);
  }
  // Already failed (complete, no pixels) — do not wait/retry.
  if (img.complete) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) {
        return;
      }
      done = true;
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
      resolve(ok);
    };
    const matchesExpected = () => {
      const src = img.getAttribute('src');
      if (!src) {
        return false;
      }
      if (expectedSrc != null && src !== expectedSrc) {
        return false;
      }
      return true;
    };
    const onLoad = () => {
      if (!matchesExpected()) {
        finish(false);
        return;
      }
      finish(imageHasPixels(img));
    };
    const onError = () => {
      // Failed decode — caller must keep the previous cover.
      finish(false);
    };
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);
    setTimeout(() => {
      if (done) {
        return;
      }
      if (matchesExpected() && imageHasPixels(img)) {
        finish(true);
        return;
      }
      finish(false);
    }, timeoutMs);
  });
}

export function collectPreloadStillUrls(opts: {
  baseDir: string | null;
  domain: string | number | null | undefined;
  current?: MenuCellRef | null;
  pgcCells?: MenuCellRef[];
  /** Existing stills already in the disc DOM (other PGCs / button targets). */
  linkedStillSrcs?: string[];
}): string[] {
  const urls = new Set<string>();
  const { baseDir, domain } = opts;
  if (baseDir && domain != null && domain !== '') {
    const addCell = (cell: MenuCellRef | null | undefined) => {
      if (cell?.cellID == null || cell?.vobID == null) {
        return;
      }
      // Pure wipe/transition cells intentionally have no PNG — skip preload
      // so we do not spam 404s (and CSS nosniff noise for companion sheets).
      const stillTime = cell.still_time != null ? cell.still_time : 0;
      const hasButtons = !!(cell.buttons && cell.buttons.length);
      if (cell.still === null || cell.still === '') {
        return;
      }
      if (!hasButtons && stillTime === 0 && cell.still == null) {
        return;
      }
      if (typeof cell.still === 'string' && cell.still) {
        urls.add(cell.still);
        return;
      }
      urls.add(menuStillUrl(baseDir, domain, cell.cellID, cell.vobID));
    };
    addCell(opts.current);
    for (const cell of opts.pgcCells || []) {
      addCell(cell);
    }
  }
  for (const src of opts.linkedStillSrcs || []) {
    if (src) {
      urls.add(src);
    }
  }
  return [...urls];
}

/**
 * Preload stills for the current PGC cells + any menu still already referenced
 * on the disc, and bump menu WebMs to `preload=auto` (never loop).
 */
export function preloadLinkedMenuAssets(
  host: ParentNode,
  menu: HTMLElement,
  opts: {
    domain?: string | number | null;
    cellID?: string | number | null;
    vobID?: string | number | null;
    still_time?: number;
    buttons?: unknown[];
    baseDir?: string | null;
    domainMeta?: DiscMenuCellLookup | null;
    /** Force-skip menu-*.webm fetch (tests / callers that already know). */
    skipPerCellWebmWarm?: boolean;
  },
): string[] {
  const domain =
    opts.domain != null && opts.domain !== ''
      ? opts.domain
      : menu.dataset.domain;
  const baseDir = opts.baseDir ?? null;
  const linkedStillSrcs = [
    ...host.querySelectorAll('img.menu-still[src]'),
  ].map((el) => (el as HTMLImageElement).getAttribute('src') || '');

  const urls = collectPreloadStillUrls({
    baseDir,
    domain,
    current: {
      cellID: opts.cellID ?? undefined,
      vobID: opts.vobID ?? undefined,
      still_time: opts.still_time,
      buttons: opts.buttons,
    },
    pgcCells: parseMenuCellsFromDataset(menu),
    linkedStillSrcs,
  });

  for (const url of urls) {
    void preloadImageUrl(url);
  }

  // Warm per-cell WebMs only when this cell was stamped. Never invent
  // menu-d-c-v.webm for skipped encode cells (404 spam).
  const cellVideoStamp =
    opts.domainMeta?.menuCell?.[String(opts.cellID)]?.[String(opts.vobID)]
      ?.video;
  const shouldWarmCellWebm =
    baseDir &&
    domain != null &&
    domain !== '' &&
    opts.cellID != null &&
    opts.vobID != null &&
    typeof fetch === 'function' &&
    !opts.skipPerCellWebmWarm &&
    typeof cellVideoStamp === 'string' &&
    cellVideoStamp.length > 0;
  if (shouldWarmCellWebm) {
    void fetch(cellVideoStamp, {
      method: 'GET',
      credentials: 'same-origin',
    }).catch(() => undefined);
  }

  host.querySelectorAll('video.dvd-menu-archive-menu-video').forEach((node) => {
    const video = node as HTMLVideoElement;
    video.loop = false;
    if (video.getAttribute('preload') !== 'auto') {
      video.preload = 'auto';
    }
    // Only kick a cold element. load() on an already-buffered menu WebM resets
    // currentTime and causes multi-second stalls before the next seek/play.
  });

  return urls;
}

/**
 * Pause at the end of a motion segment without seeking.
 *
 * Menu WebMs only guarantee keyframes at cell starts. Seeking to `end - ε`
 * often snaps back to the wipe's first frame — the flash users see at the end
 * of transitions. If the browser already reset to 0 via `ended`, hide the
 * element instead of reseeking (caller should keep a still cover painted).
 *
 * @returns true when the end frame was lost and video opacity was cleared.
 */
export function freezeMenuVideoAtEnd(
  menuVideo: HTMLVideoElement,
  start: number,
  end: number,
): boolean {
  menuVideo.loop = false;
  silenceVideoAudio(menuVideo);
  try {
    menuVideo.pause();
  } catch {
    // ignore
  }
  const t = menuVideo.currentTime;
  const lostEndFrame =
    menuVideo.ended ||
    !Number.isFinite(t) ||
    t < start + 0.05 ||
    t < end - 1.5 ||
    t >= end; // already into the next concat cell
  if (lostEndFrame) {
    menuVideo.style.opacity = '0';
    return true;
  }
  return false;
}

/** Hide the menu WebM while seeking so sparse-keyframe snaps stay invisible.
 * Also mute while covered — play() during seek must not leak the next cell's audio.
 */
export function setMenuVideoSeekCover(
  menuVideo: HTMLVideoElement,
  covering: boolean,
  opts: { unmute?: boolean } = {},
): void {
  menuVideo.style.opacity = covering ? '0' : '';
  if (covering) {
    silenceVideoAudio(menuVideo);
  } else if (opts.unmute !== false) {
    // Soften cell-boundary / seek-unmute clicks on concat menu WebMs.
    fadeInVideoAudio(menuVideo);
  }
}

/**
 * Finish motion slightly before EOF so we pause on a decoded frame, but never
 * before the segment has meaningfully started (short cells used to finish
 * immediately when `end - 0.15 <= start`).
 *
 * Long cells finish ~250ms early so sparse `timeupdate` / decoder lag cannot
 * overrun into the next concat cell (audio/frame bleed at wipe end).
 */
export function motionSegmentFinishAt(start: number, end: number): number {
  const duration = end - start;
  if (!(duration > 0) || !Number.isFinite(duration)) {
    return end;
  }
  const early = Math.min(0.25, Math.max(0, duration * 0.25));
  const minPlay = Math.min(0.02, duration / 2);
  return Math.max(start + minPlay, end - early);
}

/**
 * Prefer the still that is actually decoded on the outgoing menu (including an
 * opacity:0 seek cover left from the previous segment). Falling back to the
 * dataset cell URL would flash a transition cell's mid-wipe PNG on loops.
 */
export function stillCoverUrlFromMenu(
  menu: HTMLElement | null | undefined,
  lastPaintedStillSrc?: string | null,
): string | null {
  if (!menu) {
    return lastPaintedStillSrc || null;
  }
  const still = menu.querySelector(
    'img.menu-still',
  ) as HTMLImageElement | null;
  const fromImg = still?.getAttribute('src') || null;
  if (imageHasPixels(still) && fromImg) {
    return fromImg;
  }
  if (lastPaintedStillSrc) {
    return lastPaintedStillSrc;
  }
  const domain = menu.dataset.domain;
  const cell = menu.dataset.cell;
  const vob = menu.dataset.vob;
  if (domain != null && cell != null && vob != null) {
    let baseDir: string | null = null;
    if (fromImg) {
      const m = fromImg.match(/^(.*\/)menu-\d+-\d+-\d+\.png/);
      if (m) {
        baseDir = m[1];
      }
    }
    if (!baseDir) {
      const video = menu.ownerDocument?.getElementById(
        `menu-video-${domain}`,
      ) as HTMLVideoElement | null;
      const vsrc = video?.getAttribute('src') || video?.currentSrc || '';
      const vm = vsrc.match(/^(.*\/)[^/]+$/);
      if (vm) {
        baseDir = vm[1];
      }
    }
    if (baseDir) {
      return `${baseDir}menu-${domain}-${cell}-${vob}.png`;
    }
  }
  return fromImg;
}
