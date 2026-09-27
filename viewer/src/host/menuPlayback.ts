export const TITLE_UNAVAILABLE_MESSAGE =
  'Title video was not included in this archive.';

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
  }>;
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
      'video:not(.dvdjs-menu-video)',
    ) as HTMLVideoElement | null;
    video?.pause();
  } catch {
    // ignore
  }

  if (getComputedStyle(host).position === 'static') {
    host.style.position = 'relative';
  }

  let el = host.querySelector(
    '.dvdjs-title-unavailable',
  ) as HTMLElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'dvdjs-title-unavailable';
    el.setAttribute('role', 'status');
    host.appendChild(el);
  }
  el.textContent = message || TITLE_UNAVAILABLE_MESSAGE;
  el.hidden = false;

  if (typeof host.onmenu === 'function' && !host._dvdjsMenuFallback) {
    host._dvdjsMenuFallback = true;
    setTimeout(() => {
      try {
        host.onmenu?.({});
      } catch (e) {
        console.warn('DVD.js menu fallback failed', e);
      } finally {
        host._dvdjsMenuFallback = false;
      }
    }, 0);
  }
}

export function hideTitleUnavailable(host: HTMLElement): void {
  const el = host.querySelector(
    '.dvdjs-title-unavailable',
  ) as HTMLElement | null;
  if (el) {
    el.hidden = true;
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
    if (i === buttonIndex) {
      buttons[i].classList.add('selected');
    } else {
      buttons[i].classList.remove('selected');
    }
  }
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
      .match(/^(.*\/)menu-\d+-\d+-\d+\.png$/);
    if (m) {
      stillSrc = `${m[1]}menu-${domain}-${opts.cellID}-${opts.vobID}.png`;
      cssHref = `${m[1]}menu-${domain}-${opts.cellID}-${opts.vobID}.css`;
    }
  }
  if (stillSrc && still) {
    still.setAttribute('src', stillSrc);
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

  if (opts.buttons && opts.buttons.length) {
    const existing = menu.querySelectorAll('input.btn');
    for (let i = 0; i < existing.length; i++) {
      existing[i].parentNode?.removeChild(existing[i]);
    }
    for (let b = 0; b < opts.buttons.length; b++) {
      const nav = opts.buttons[b] || {};
      const input = document.createElement('input');
      input.type = 'button';
      input.className = 'btn';
      input.dataset.id = String(b);
      if (nav.up != null) input.dataset.up = String(nav.up);
      if (nav.down != null) input.dataset.down = String(nav.down);
      if (nav.left != null) input.dataset.left = String(nav.left);
      if (nav.right != null) input.dataset.right = String(nav.right);
      if (nav.auto_action_mode) {
        input.dataset.autoAction = String(nav.auto_action_mode);
      }
      menu.appendChild(input);
    }
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
      if (typeof host._dvdjsMenuPost === 'function') {
        const post = host._dvdjsMenuPost;
        host._dvdjsMenuPost = null;
        try {
          post();
        } catch (e) {
          console.warn('DVD.js menu post failed', e);
        }
      }
    }
  };

  if (host._dvdjsMenuTimeUpdate) {
    menuVideo.removeEventListener('timeupdate', host._dvdjsMenuTimeUpdate);
  }
  host._dvdjsMenuTimeUpdate = onTimeUpdate;

  menuVideo.hidden = false;
  menuVideo.style.cssText =
    'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;z-index:0;';
  const still = host._dvdjsActiveMenu?.querySelector(
    'img.menu-still',
  ) as HTMLImageElement | null;
  if (still) {
    still.style.opacity = '0';
  }

  const startPlayback = () => {
    menuVideo.currentTime = start;
    menuVideo.addEventListener('timeupdate', onTimeUpdate);
    const p = menuVideo.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        /* autoplay may fail; still UI remains usable */
      });
    }
    onReady?.();
  };

  if (menuVideo.readyState >= 1) {
    startPlayback();
  } else {
    const onMeta = () => {
      menuVideo.removeEventListener('loadedmetadata', onMeta);
      startPlayback();
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
