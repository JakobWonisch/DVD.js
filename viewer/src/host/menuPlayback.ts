import {
  notifyAutoplayBlocked,
  playWithAutoplayFallback,
  type AutoplayHost,
} from './autoplay.js';
import {
  applyMenuButtonGeometry,
  stampHitboxStylesFromStylesheet,
} from './menuButtonHitboxes.js';
import { runTitlePgcPostWithLangFallback } from './titleUnavailable.js';

export const TITLE_UNAVAILABLE_MESSAGE =
  'This title was intentionally left out of this archive. Only menus were converted.';

export interface PlayMenuCellOpts {
  menuId?: string;
  domain?: number | string;
  cellID?: number | string;
  vobID?: number | string;
  still_time?: number;
  hli_s_ptm?: number;
  hli_e_ptm?: number;
  startSec?: number;
  endSec?: number;
  buttons?: Array<{
    up?: number;
    down?: number;
    left?: number;
    right?: number;
    auto_action_mode?: number;
    css?: string;
  }>;
  spuSelect?: string[];
  spuActivate?: string[];
  onPost?: () => void;
}

export interface PlaylistEntry {
  id: string;
  video: HTMLVideoElement;
  src: string;
  chapterCues?: TextTrackCueList | null;
}

type DvdjsHost = HTMLElement & {
  _dvdjsStillTimer?: ReturnType<typeof setTimeout> | null;
  _dvdjsHighlightTimer?: ReturnType<typeof setTimeout> | null;
  _dvdjsMenuTimeUpdate?: ((this: HTMLVideoElement, ev: Event) => void) | null;
  _dvdjsActiveMenu?: HTMLElement | null;
  _dvdjsMenuPost?: (() => void) | null;
  _dvdjsMenuFallback?: boolean;
  onmenu?: ((event: object) => void) | null;
};

export function clearDvdjsTimers(host: DvdjsHost): void {
  if (host._dvdjsStillTimer) {
    clearTimeout(host._dvdjsStillTimer);
    host._dvdjsStillTimer = null;
  }
  if (host._dvdjsHighlightTimer) {
    clearTimeout(host._dvdjsHighlightTimer);
    host._dvdjsHighlightTimer = null;
  }
}

export function hideAllMenus(host: HTMLElement): void {
  const menus = host.querySelectorAll('x-menu');
  for (let i = 0; i < menus.length; i++) {
    const menu = menus[i] as HTMLElement & { hide?: () => void };
    if (typeof menu.hide === 'function') {
      menu.hide();
    } else {
      menu.style.display = 'none';
      menu.hidden = true;
    }
  }
}

export function showTitleUnavailable(
  host: DvdjsHost,
  message?: string,
): void {
  hideAllMenus(host);
  try {
    const video = host.querySelector(
      'video:not(.dvd-menu-archive-menu-video)',
    ) as HTMLVideoElement | null;
    video?.pause();
  } catch {
    // ignore
  }

  const fromButton = !!(host as any)._dvdjsFromButton;
  (host as any)._dvdjsFromButton = false;

  if (!fromButton) {
    const g = window as any;
    const pgcObj = g.PGCIUT?.[g.domain]?.[g.pgc];
    if (pgcObj && typeof pgcObj.post === 'function') {
      hideTitleUnavailable(host);
      setTimeout(() => {
        if (!runTitlePgcPostWithLangFallback(g, () => pgcObj.post())) {
          host.onmenu?.({});
        }
      }, 0);
      return;
    }
  }

  if (getComputedStyle(host).position === 'static') {
    host.style.position = 'relative';
  }

  let el = host.querySelector(
    '.dvd-menu-archive-title-unavailable',
  ) as HTMLElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'dvd-menu-archive-title-unavailable';
    el.setAttribute('role', 'status');
    host.appendChild(el);
  }
  el.textContent = message || TITLE_UNAVAILABLE_MESSAGE;
  el.hidden = false;
  el.style.display = 'flex';

  if (typeof host.onmenu === 'function' && !host._dvdjsMenuFallback) {
    host._dvdjsMenuFallback = true;
    setTimeout(() => {
      try {
        host.onmenu?.({});
      } catch (e) {
        console.warn('dvd-menu-archive menu fallback failed', e);
      } finally {
        host._dvdjsMenuFallback = false;
      }
    }, 0);
  }
}

export function hideTitleUnavailable(host: HTMLElement): void {
  const el = host.querySelector(
    '.dvd-menu-archive-title-unavailable',
  ) as HTMLElement | null;
  if (el) {
    el.hidden = true;
    el.style.display = 'none';
  }
}

export function isTitleMediaMissing(entry: PlaylistEntry | undefined): boolean {
  if (!entry) {
    return true;
  }
  const src =
    entry.src ||
    entry.video.currentSrc ||
    entry.video.getAttribute('src') ||
    '';
  return !src;
}

export function highlightMenuButton(
  menu: HTMLElement | null | undefined,
  buttonIndex: number,
): void {
  if (!menu) {
    return;
  }
  const buttons = menu.querySelectorAll('input.btn');
  for (let i = 0; i < buttons.length; i++) {
    const el = buttons[i] as HTMLElement;
    if (i === buttonIndex) {
      el.classList.add('selected');
      el.dataset.selected = '1';
    } else {
      el.classList.remove('selected');
      delete el.dataset.selected;
    }
  }

  const sels = menu.querySelectorAll('img.menu-spu-sel');
  const acts = menu.querySelectorAll('img.menu-spu-act');
  for (let s = 0; s < sels.length; s++) {
    if (s === buttonIndex) {
      sels[s].removeAttribute('hidden');
    } else {
      sels[s].setAttribute('hidden', '');
    }
  }
  for (let a = 0; a < acts.length; a++) {
    acts[a].setAttribute('hidden', '');
  }
}

export function flashMenuButtonActivate(
  menu: HTMLElement | null | undefined,
  buttonIndex: number,
  durationMs = 120,
): void {
  if (!menu) {
    return;
  }
  const act = menu.querySelector(
    `img.menu-spu-act[data-id="${buttonIndex}"]`,
  ) as HTMLImageElement | null;
  const sel = menu.querySelector(
    `img.menu-spu-sel[data-id="${buttonIndex}"]`,
  ) as HTMLImageElement | null;
  if (!act) {
    return;
  }
  if (sel) {
    sel.setAttribute('hidden', '');
  }
  act.removeAttribute('hidden');
  setTimeout(() => {
    act.setAttribute('hidden', '');
    if (sel) {
      sel.removeAttribute('hidden');
    }
  }, durationMs);
}

export function setMenuButtonsEnabled(
  menu: HTMLElement | null | undefined,
  enabled: boolean,
): void {
  if (!menu) {
    return;
  }
  const buttons = menu.querySelectorAll('input.btn');
  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i] as HTMLInputElement;
    btn.disabled = !enabled;
    btn.style.pointerEvents = enabled ? '' : 'none';
  }
}

export function resetMenuMotion(
  host: DvdjsHost,
  menuVideo: HTMLVideoElement | null,
  menu: HTMLElement | null,
): void {
  if (menuVideo) {
    if (host._dvdjsMenuTimeUpdate) {
      menuVideo.removeEventListener('timeupdate', host._dvdjsMenuTimeUpdate);
      host._dvdjsMenuTimeUpdate = null;
    }
    try {
      menuVideo.pause();
    } catch {
      // ignore
    }
    menuVideo.hidden = true;
    menuVideo.style.cssText = '';
  }
  const hostMenu = menu || host._dvdjsActiveMenu;
  const still = hostMenu?.querySelector(
    'img.menu-still',
  ) as HTMLImageElement | null;
  if (still) {
    still.style.opacity = '';
  }
}

export function updateMenuCellVisuals(
  menu: HTMLElement,
  opts: PlayMenuCellOpts,
): void {
  if (opts.cellID == null || opts.vobID == null) {
    return;
  }
  const domain =
    opts.domain != null ? opts.domain : menu.dataset.domain;
  const still = menu.querySelector(
    'img.menu-still',
  ) as HTMLImageElement | null;
  let cssHref: string | null = null;
  let stillSrc: string | null = null;

  const links = document.querySelectorAll(
    `link[href*="menu-${domain}-${opts.cellID}-${opts.vobID}"]`,
  );
  if (links.length) {
    cssHref = links[0].getAttribute('href');
  }
  const imgs = document.querySelectorAll(
    `img.menu-still[src*="menu-${domain}-${opts.cellID}-${opts.vobID}"]`,
  );
  if (imgs.length) {
    stillSrc = imgs[0].getAttribute('src');
  }
  if (!stillSrc && still?.getAttribute('src')) {
    const m = still
      .getAttribute('src')!
      .match(/^(.*\/)menu-\d+-\d+-\d+\.(webp|png)$/i);
    if (m) {
      stillSrc = `${m[1]}menu-${domain}-${opts.cellID}-${opts.vobID}.${m[2]}`;
      cssHref = `${m[1]}menu-${domain}-${opts.cellID}-${opts.vobID}.css`;
    }
  }
  if (stillSrc && still) {
    still.setAttribute('src', stillSrc);
    still.style.display = '';
    still.style.opacity = '';
  }

  let baseDir: string | null = null;
  if (stillSrc) {
    const bm = stillSrc.match(/^(.*\/)menu-\d+-\d+-\d+\.(?:webp|png)$/i);
    if (bm) {
      baseDir = bm[1];
    }
  }
  if (baseDir) {
    let spu = menu.querySelector('img.menu-spu') as HTMLImageElement | null;
    const spuSrc = `${baseDir}menu-${domain}-${opts.cellID}-${opts.vobID}-spu.png`;
    if (spu) {
      spu.setAttribute('src', spuSrc);
    } else {
      spu = document.createElement('img');
      spu.className = 'menu-spu';
      spu.alt = '';
      spu.setAttribute('aria-hidden', 'true');
      spu.src = spuSrc;
      if (still?.nextSibling) {
        menu.insertBefore(spu, still.nextSibling);
      } else {
        menu.appendChild(spu);
      }
    }

    const oldSel = menu.querySelectorAll('img.menu-spu-sel, img.menu-spu-act');
    for (let os = 0; os < oldSel.length; os++) {
      oldSel[os].parentNode?.removeChild(oldSel[os]);
    }

    let selList = opts.spuSelect ? [...opts.spuSelect] : [];
    let actList = opts.spuActivate ? [...opts.spuActivate] : [];
    if (!selList.length && opts.buttons && opts.buttons.length) {
      for (let si = 0; si < opts.buttons.length; si++) {
        selList.push(
          `${baseDir}menu-${domain}-${opts.cellID}-${opts.vobID}-spu-sel-${si}.png`,
        );
        actList.push(
          `${baseDir}menu-${domain}-${opts.cellID}-${opts.vobID}-spu-act-${si}.png`,
        );
      }
    }
    for (let sj = 0; sj < selList.length; sj++) {
      const simg = document.createElement('img');
      simg.className = 'menu-spu-sel';
      simg.dataset.id = String(sj);
      simg.hidden = true;
      simg.alt = '';
      simg.setAttribute('aria-hidden', 'true');
      simg.src = selList[sj];
      menu.appendChild(simg);
    }
    for (let aj = 0; aj < actList.length; aj++) {
      const aimg = document.createElement('img');
      aimg.className = 'menu-spu-act';
      aimg.dataset.id = String(aj);
      aimg.hidden = true;
      aimg.alt = '';
      aimg.setAttribute('aria-hidden', 'true');
      aimg.src = actList[aj];
      menu.appendChild(aimg);
    }
  }

  if (cssHref) {
    let link = menu.querySelector(
      'link[rel="stylesheet"]',
    ) as HTMLLinkElement | null;
    if (link) {
      link.href = cssHref;
    } else {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cssHref;
      menu.insertBefore(link, menu.firstChild);
    }
  }

  const existing = menu.querySelectorAll('input.btn');
  for (let i = 0; i < existing.length; i++) {
    existing[i].parentNode?.removeChild(existing[i]);
  }
  if (opts.buttons && opts.buttons.length) {
    const hasSpuHighlight =
      (opts.spuSelect && opts.spuSelect.length > 0) ||
      !!menu.querySelector('img.menu-spu-sel');
    for (let b = 0; b < opts.buttons.length; b++) {
      const nav = opts.buttons[b] || {};
      const input = document.createElement('input');
      input.type = 'button';
      input.className = hasSpuHighlight ? 'btn btn-spu' : 'btn';
      input.dataset.id = String(b);
      if (nav.up != null) input.dataset.up = String(nav.up);
      if (nav.down != null) input.dataset.down = String(nav.down);
      if (nav.left != null) input.dataset.left = String(nav.left);
      if (nav.right != null) input.dataset.right = String(nav.right);
      if (nav.auto_action_mode) {
        input.dataset.autoAction = String(nav.auto_action_mode);
      }
      applyMenuButtonGeometry(input, nav);
      menu.appendChild(input);
    }
    stampHitboxStylesFromStylesheet(
      menu,
      menu.querySelector('link[rel="stylesheet"]') as HTMLLinkElement | null,
    );
  }
}

export function playMenuMotionSegment(
  host: DvdjsHost,
  menuVideo: HTMLVideoElement,
  opts: PlayMenuCellOpts,
  onReady?: () => void,
): void {
  const start = opts.startSec || 0;
  const end = opts.endSec ?? start;

  const onTimeUpdate = () => {
    if (menuVideo.currentTime >= end - 0.05) {
      menuVideo.pause();
      menuVideo.removeEventListener('timeupdate', onTimeUpdate);
      if (host._dvdjsMenuTimeUpdate === onTimeUpdate) {
        host._dvdjsMenuTimeUpdate = null;
      }
      if (opts.buttons && opts.buttons.length > 0) {
        return;
      }
      if (typeof host._dvdjsMenuPost === 'function') {
        const post = host._dvdjsMenuPost;
        host._dvdjsMenuPost = null;
        try {
          post();
        } catch (e) {
          console.warn('dvd-menu-archive menu post failed', e);
        }
      }
    }
  };

  if (host._dvdjsMenuTimeUpdate) {
    menuVideo.removeEventListener('timeupdate', host._dvdjsMenuTimeUpdate);
    host._dvdjsMenuTimeUpdate = null;
  }

  menuVideo.hidden = false;
  menuVideo.style.cssText =
    'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:fill;z-index:0;';
  const still = host._dvdjsActiveMenu?.querySelector(
    'img.menu-still',
  ) as HTMLImageElement | null;

  const beginPlayback = () => {
    host._dvdjsMenuTimeUpdate = onTimeUpdate;
    menuVideo.addEventListener('timeupdate', onTimeUpdate);
    void playWithAutoplayFallback(menuVideo, host as AutoplayHost).then(
      (ok) => {
        if (host._dvdjsMenuTimeUpdate !== onTimeUpdate) {
          return;
        }
        if (ok) {
          if (still) {
            still.style.opacity = '0';
          }
          onReady?.();
          return;
        }
        menuVideo.removeEventListener('timeupdate', onTimeUpdate);
        if (host._dvdjsMenuTimeUpdate === onTimeUpdate) {
          host._dvdjsMenuTimeUpdate = null;
        }
        try {
          menuVideo.pause();
        } catch {
          // ignore
        }
        if (still) {
          still.style.opacity = '';
        }
        notifyAutoplayBlocked(host as AutoplayHost);
      },
    );
  };

  const seekThenPlay = () => {
    const onSeeked = () => {
      menuVideo.removeEventListener('seeked', onSeeked);
      beginPlayback();
    };
    if (Math.abs(menuVideo.currentTime - start) < 0.04) {
      beginPlayback();
      return;
    }
    menuVideo.addEventListener('seeked', onSeeked);
    try {
      menuVideo.currentTime = start;
    } catch {
      menuVideo.removeEventListener('seeked', onSeeked);
      beginPlayback();
    }
  };

  if (menuVideo.readyState >= 1) {
    seekThenPlay();
  } else {
    const onMeta = () => {
      menuVideo.removeEventListener('loadedmetadata', onMeta);
      seekThenPlay();
    };
    menuVideo.addEventListener('loadedmetadata', onMeta);
    menuVideo.load();
  }
}

declare global {
  interface Window {
    sprm?: { HL_BTNN?: number };
  }
}

export function currentHighlightIndex(): number {
  const raw = window.sprm?.HL_BTNN ?? 0x0400;
  return Math.floor(raw / 0x0400) - 1;
}
