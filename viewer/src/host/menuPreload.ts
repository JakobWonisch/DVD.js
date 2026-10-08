import { fadeInVideoAudio, silenceVideoAudio } from './autoplay.js';
import { type DiscMenuCellLookup } from './menuCellVideo.js';

/**
 * Menu asset readiness helpers + selective preload.
 *
 * Stills: warm every other cell in the current PGC that has a still (so button
 * / LinkNext choices can paint immediately). WebM: only the deterministic
 * auto-next clip (one hop; no buttons / cell_cmd divert).
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
  /** Per-cell menu WebM when stamped on the PGC cell (vm.js). */
  video?: string | null;
  /**
   * DVD cell command index (1-based). Non-zero means onPost may divert via
   * cellCmds before the next PGC cell — not a safe auto-next target.
   */
  cell_cmd_nr?: number;
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
  return `${baseDir}menu-${domain}-${cellID}-${vobID}.webp`;
}

/** Invent a still URL; prefer metadata `still`, else WebP (legacy: .png). */
export function resolveMenuStillUrl(opts: {
  baseDir: string | null | undefined;
  domain: string | number | null | undefined;
  cellID: string | number | null | undefined;
  vobID: string | number | null | undefined;
  /** Explicit still from metadata / menuCell. */
  still?: string | null;
  domainMeta?: {
    menuCell?: Record<
      string,
      Record<string, { still?: string | null } | undefined> | undefined
    >;
  } | null;
}): string | null {
  if (typeof opts.still === 'string' && opts.still) {
    return opts.still;
  }
  const domain = opts.domain;
  const cellID = opts.cellID;
  const vobID = opts.vobID;
  if (domain == null || cellID == null || vobID == null) {
    return null;
  }
  const fromMeta =
    opts.domainMeta?.menuCell?.[String(cellID)]?.[String(vobID)]?.still;
  if (typeof fromMeta === 'string' && fromMeta) {
    return fromMeta;
  }
  if (!opts.baseDir) {
    return null;
  }
  return menuStillUrl(opts.baseDir, domain, cellID, vobID);
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

/**
 * Pause / demote other title <video>s so First Play WebMs are not starved by
 * N parallel title fetches + hundreds of menu stills on cold disc mount.
 */
export function prioritizeTitleVideo(
  host: ParentNode,
  active: HTMLVideoElement,
): void {
  const nodes = host.querySelectorAll(
    'video:not(.dvd-menu-archive-menu-video)',
  );
  for (let i = 0; i < nodes.length; i++) {
    const video = nodes[i] as HTMLVideoElement;
    if (video === active) {
      video.preload = 'auto';
      continue;
    }
    try {
      video.pause();
    } catch {
      // ignore
    }
    if (video.preload !== 'none') {
      video.preload = 'none';
    }
  }
}

export type WhenVideoReadyOpts = {
  /** Cap how long we wait for HAVE_CURRENT_DATA / canplay. */
  timeoutMs?: number;
};

/**
 * Ensure a title/menu WebM has buffered enough to paint. Kicks preload=auto
 * and load() when the element was mounted with preload=none.
 * Returns false on error or timeout with no usable data.
 */
export function whenVideoReadyForPlay(
  video: HTMLVideoElement | null | undefined,
  opts: WhenVideoReadyOpts = {},
): Promise<boolean> {
  if (!video) {
    return Promise.resolve(false);
  }
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const src =
    video.getAttribute('src') || video.currentSrc || video.src || '';
  if (!src) {
    return Promise.resolve(false);
  }
  if (video.error) {
    return Promise.resolve(false);
  }
  // HAVE_CURRENT_DATA (2) is enough to paint; HAVE_FUTURE_DATA (3) is nicer.
  if (video.readyState >= 2) {
    return Promise.resolve(true);
  }

  video.preload = 'auto';
  const ns = video.networkState;
  if (
    ns === HTMLMediaElement.NETWORK_EMPTY ||
    (ns === HTMLMediaElement.NETWORK_IDLE && video.readyState === 0)
  ) {
    try {
      video.load();
    } catch {
      // ignore
    }
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onError);
      clearTimeout(timer);
      resolve(ok);
    };
    const onReady = () => {
      if (video.readyState >= 2) {
        finish(true);
      }
    };
    const onError = () => finish(false);
    const timer = setTimeout(() => {
      finish(video.readyState >= 2 && !video.error);
    }, timeoutMs);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('canplay', onReady);
    video.addEventListener('error', onError);
    // Race: data may have arrived between the readyState check and listeners.
    if (video.readyState >= 2) {
      finish(true);
    } else if (video.error) {
      finish(false);
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

/**
 * True when the cell finishes without waiting for user input (wipe / timed
 * still with no buttons). Infinite stills and any buttoned cell can divert.
 */
export function cellWillAutoAdvanceWithoutInput(cell: {
  still_time?: number | null;
  buttons?: unknown[] | null;
} | null | undefined): boolean {
  if (!cell) {
    return false;
  }
  const stillTime = cell.still_time != null ? cell.still_time : 0;
  if (stillTime === 255) {
    return false;
  }
  if (cell.buttons && cell.buttons.length > 0) {
    return false;
  }
  return true;
}

/**
 * When the current cell will auto-advance to exactly one next PGC cell (no
 * buttons, no cell command divert, and a following cell in the same PGC),
 * return that cell. Never looks past one hop; never guesses PGC post().
 */
export function resolveAutoNextMenuCell(
  pgcCells: MenuCellRef[],
  current: {
    cellID?: number | string | null;
    vobID?: number | string | null;
    still_time?: number | null;
    buttons?: unknown[] | null;
    cell_cmd_nr?: number | null;
  } | null | undefined,
): MenuCellRef | null {
  if (!current || !pgcCells.length) {
    return null;
  }
  if (current.cellID == null || current.vobID == null) {
    return null;
  }
  if (!cellWillAutoAdvanceWithoutInput(current)) {
    return null;
  }

  const matches: number[] = [];
  for (let i = 0; i < pgcCells.length; i++) {
    const c = pgcCells[i];
    if (
      c &&
      String(c.cellID) === String(current.cellID) &&
      String(c.vobID) === String(current.vobID)
    ) {
      matches.push(i);
    }
  }
  // Ambiguous or missing — do not guess which occurrence is playing.
  if (matches.length !== 1) {
    return null;
  }
  const idx = matches[0];
  const at = pgcCells[idx];
  const cmdNr =
    current.cell_cmd_nr != null
      ? Number(current.cell_cmd_nr)
      : at?.cell_cmd_nr != null
        ? Number(at.cell_cmd_nr)
        : 0;
  if (Number.isFinite(cmdNr) && cmdNr > 0) {
    return null;
  }
  if (idx + 1 >= pgcCells.length) {
    return null;
  }
  return pgcCells[idx + 1] || null;
}

/** Still URL for preload when the cell actually has a still asset. */
export function stillUrlForCellPreload(opts: {
  baseDir: string | null;
  domain: string | number | null | undefined;
  cell: MenuCellRef | null | undefined;
  domainMeta?: DiscMenuCellLookup | null;
}): string | null {
  const cell = opts.cell;
  if (!cell || cell.cellID == null || cell.vobID == null) {
    return null;
  }
  // Explicit empty still (pure wipe) — never invent a 404 URL.
  if (cell.still === null || cell.still === '') {
    return null;
  }
  const stillTime = cell.still_time != null ? cell.still_time : 0;
  const hasButtons = !!(cell.buttons && cell.buttons.length);
  if (!hasButtons && stillTime === 0 && cell.still == null) {
    // Transition cell with no stamped still — convert omits the file.
    const fromMeta =
      opts.domainMeta?.menuCell?.[String(cell.cellID)]?.[String(cell.vobID)]
        ?.still;
    if (typeof fromMeta !== 'string' || !fromMeta) {
      return null;
    }
  }
  return resolveMenuStillUrl({
    baseDir: opts.baseDir,
    domain: opts.domain,
    cellID: cell.cellID,
    vobID: cell.vobID,
    still: cell.still,
    domainMeta: opts.domainMeta,
  });
}

/** @deprecated Use stillUrlForCellPreload. */
export const stillUrlForAutoNextPreload = stillUrlForCellPreload;

/**
 * Stills that may paint after leaving the current cell: every other cell in
 * the current PGC that has a still (LinkNext/Prev, auto-advance, buttoned
 * pages). Skips the current cell and pure wipes with no still file.
 */
export function collectPreloadStillUrls(opts: {
  baseDir: string | null;
  domain: string | number | null | undefined;
  current?: MenuCellRef | null;
  pgcCells?: MenuCellRef[];
  domainMeta?: DiscMenuCellLookup | null;
  /** Ignored — cross-PGC DOM stills are not speculative-preloaded. */
  linkedStillSrcs?: string[];
}): string[] {
  const urls = new Set<string>();
  const { baseDir, domain, domainMeta } = opts;
  const current = opts.current;
  for (const cell of opts.pgcCells || []) {
    if (!cell || cell.cellID == null || cell.vobID == null) {
      continue;
    }
    if (
      current?.cellID != null &&
      current?.vobID != null &&
      String(cell.cellID) === String(current.cellID) &&
      String(cell.vobID) === String(current.vobID)
    ) {
      continue;
    }
    const url = stillUrlForCellPreload({
      baseDir,
      domain,
      cell,
      domainMeta,
    });
    if (url) {
      urls.add(url);
    }
  }
  return [...urls];
}

/**
 * Preload stills for every other cell in this PGC (choice-safe), and at most
 * one auto-next WebM when advance is deterministic. Does not touch the playing
 * <video> src.
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
    cell_cmd_nr?: number | null;
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
  const pgcCells = parseMenuCellsFromDataset(menu);
  const current = {
    cellID: opts.cellID ?? undefined,
    vobID: opts.vobID ?? undefined,
    still_time: opts.still_time,
    buttons: opts.buttons,
    cell_cmd_nr: opts.cell_cmd_nr,
  };

  const urls = collectPreloadStillUrls({
    baseDir,
    domain,
    current,
    pgcCells,
    domainMeta: opts.domainMeta,
  });
  for (const url of urls) {
    void preloadImageUrl(url);
  }

  // WebM: only the deterministic one-ahead clip (never speculative choice paths).
  const next = resolveAutoNextMenuCell(pgcCells, current);
  if (
    next &&
    !opts.skipPerCellWebmWarm &&
    typeof fetch === 'function'
  ) {
    const fromMeta =
      opts.domainMeta?.menuCell?.[String(next.cellID)]?.[String(next.vobID)]
        ?.video;
    const videoUrl =
      (typeof next.video === 'string' && next.video) ||
      (typeof fromMeta === 'string' && fromMeta) ||
      null;
    if (videoUrl) {
      urls.push(videoUrl);
      void fetch(videoUrl, {
        method: 'GET',
        credentials: 'same-origin',
      }).catch(() => undefined);
    }
  }

  host.querySelectorAll('video.dvd-menu-archive-menu-video').forEach((node) => {
    (node as HTMLVideoElement).loop = false;
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
    return;
  }
  const host =
    typeof menuVideo.closest === 'function'
      ? menuVideo.closest('x-video')
      : null;
  const suspended = !!(host as { _dvdjsPlaybackSuspended?: boolean } | null)
    ?._dvdjsPlaybackSuspended;
  if (suspended || opts.unmute === false) {
    silenceVideoAudio(menuVideo);
    return;
  }
  // Soften cell-boundary / seek-unmute clicks on concat menu WebMs.
  fadeInVideoAudio(menuVideo);
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
      const m = fromImg.match(/^(.*\/)menu-\d+-\d+-\d+\.(?:webp|png)/i);
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
      return menuStillUrl(baseDir, domain, cell, vob);
    }
  }
  return fromImg;
}
