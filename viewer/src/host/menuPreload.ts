/**
 * Warm menu stills / WebMs so motion→still handoffs do not flash black or
 * frame 0 while the next PNG is still fetching.
 */

export type MenuCellRef = {
  cellID?: number | string;
  vobID?: number | string;
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
 * Resolve when an <img> has pixels (or fails / times out). Used to keep the
 * menu WebM painted until the replacement still is ready.
 */
export function whenImageReady(
  img: HTMLImageElement | null | undefined,
  timeoutMs = 400,
): Promise<void> {
  if (!img || !img.getAttribute('src')) {
    return Promise.resolve();
  }
  if (img.complete && img.naturalWidth > 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      img.removeEventListener('load', finish);
      img.removeEventListener('error', finish);
      resolve();
    };
    img.addEventListener('load', finish);
    img.addEventListener('error', finish);
    setTimeout(finish, timeoutMs);
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
    baseDir?: string | null;
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
    current: { cellID: opts.cellID ?? undefined, vobID: opts.vobID ?? undefined },
    pgcCells: parseMenuCellsFromDataset(menu),
    linkedStillSrcs,
  });

  for (const url of urls) {
    void preloadImageUrl(url);
  }

  host.querySelectorAll('video.dvdjs-menu-video').forEach((node) => {
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
 * element instead of reseeking.
 */
export function freezeMenuVideoAtEnd(
  menuVideo: HTMLVideoElement,
  start: number,
  end: number,
): void {
  menuVideo.loop = false;
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
    t < end - 1.5;
  if (lostEndFrame) {
    menuVideo.style.opacity = '0';
  }
}

/** Hide the menu WebM while seeking so sparse-keyframe snaps stay invisible. */
export function setMenuVideoSeekCover(
  menuVideo: HTMLVideoElement,
  covering: boolean,
): void {
  menuVideo.style.opacity = covering ? '0' : '';
}

/** Prefer the outgoing cell's still (dataset) over a stale cover src on the img. */
export function stillCoverUrlFromMenu(
  menu: HTMLElement | null | undefined,
): string | null {
  if (!menu) {
    return null;
  }
  const still = menu.querySelector(
    'img.menu-still',
  ) as HTMLImageElement | null;
  const fromImg = still?.getAttribute('src') || null;
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
