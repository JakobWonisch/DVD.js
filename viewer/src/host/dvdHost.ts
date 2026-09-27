import { TITLE_UNAVAILABLE_MESSAGE } from './titleUnavailable.js';
import {
  notifyAutoplayBlocked,
  playWithAutoplayFallback,
  type AutoplayHost,
} from './autoplay.js';
import {
  applyDebugHitboxLabels,
  bindMenuKeys,
} from './menuKeys.js';
import { skipPlaybackToEnd } from './skipToEnd.js';

export type MenuCellPlayOpts = {
  menuId?: string;
  domain?: number | string;
  cellID?: number | string;
  vobID?: number | string;
  still_time?: number;
  hli_s_ptm?: number;
  startSec?: number;
  endSec?: number;
  buttons?: Array<{
    up?: number;
    down?: number;
    left?: number;
    right?: number;
    auto_action_mode?: number;
  }>;
  spuSelect?: string[];
  spuActivate?: string[];
  onPost?: () => void;
};

type PlaylistEntry = {
  id: string;
  video: HTMLVideoElement;
  src: string;
  chapterCues: TextTrackCue[];
};

export type XVideoElement = HTMLElement & {
  playlist: PlaylistEntry[];
  videoIndex: number;
  onmenu: ((event: object) => void) | null;
  play: () => Promise<void> | void;
  pause: () => void;
  playByID: (elementID: string) => void;
  playByIndex: (videoIndex: number) => void;
  playChapter: (chapterIndex: number) => void;
  playMenuByID: (elementID: string) => void;
  playMenuCell: (opts: MenuCellPlayOpts) => void;
  /** Jump to the end of the active menu/title clip (Space / toolbar). */
  skipToEnd: () => boolean;
  setMenuHighlight: (menu: Element | null, buttonIndex: number) => void;
  flashMenuActivate: (menu: Element | null, buttonIndex: number) => void;
  setDebugHitboxes: (enabled: boolean) => void;
};

function hideAllMenu(host: HTMLElement) {
  host.querySelectorAll('x-menu').forEach((menu) => {
    const m = menu as HTMLElement & { hide?: () => void };
    if (typeof m.hide === 'function') {
      m.hide();
    } else {
      m.style.display = 'none';
      m.hidden = true;
    }
  });
}

function showTitleUnavailable(host: XVideoElement, message?: string) {
  hideAllMenu(host);
  try {
    host.pause();
  } catch {
    // ignore
  }

  const fromButton = !!(host as any)._dvdjsFromButton;
  (host as any)._dvdjsFromButton = false;

  // Menus-only / FP: missing studio-logo titles should continue via PGC post
  // (e.g. LOTR → VMGM intro). Button-initiated JumpTT keeps the message.
  if (!fromButton) {
    const g = window as any;
    const pgcObj = g.PGCIUT?.[g.domain]?.[g.pgc];
    if (pgcObj && typeof pgcObj.post === 'function') {
      hideTitleUnavailable(host);
      setTimeout(() => {
        try {
          pgcObj.post();
        } catch (e) {
          console.warn('DVD.js missing-title post failed', e);
          if (typeof host.onmenu === 'function') {
            host.onmenu({});
          }
        }
      }, 0);
      return;
    }
  }

  if (getComputedStyle(host).position === 'static') {
    host.style.position = 'relative';
  }

  let el = host.querySelector('.dvdjs-title-unavailable') as HTMLElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'dvdjs-title-unavailable';
    el.setAttribute('role', 'status');
    el.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.85);color:#fff;font:16px/1.4 sans-serif;text-align:center;' +
      'padding:1.5rem;z-index:20;box-sizing:border-box;';
    host.appendChild(el);
  }
  el.textContent = message || TITLE_UNAVAILABLE_MESSAGE;
  el.hidden = false;
  el.style.display = 'flex';

  if (typeof host.onmenu === 'function' && !(host as any)._dvdjsMenuFallback) {
    (host as any)._dvdjsMenuFallback = true;
    setTimeout(() => {
      try {
        host.onmenu?.({});
      } catch (e) {
        console.warn('DVD.js menu fallback failed', e);
      } finally {
        (host as any)._dvdjsMenuFallback = false;
      }
    }, 0);
  }
}

function hideTitleUnavailable(host: HTMLElement) {
  const el = host.querySelector('.dvdjs-title-unavailable') as HTMLElement | null;
  if (el) {
    el.hidden = true;
    el.style.display = 'none';
  }
}

function isTitleMediaMissing(entry: PlaylistEntry | undefined) {
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

function clearDvdjsTimers(host: any) {
  if (host._dvdjsStillTimer) {
    clearTimeout(host._dvdjsStillTimer);
    host._dvdjsStillTimer = null;
  }
  if (host._dvdjsHighlightTimer) {
    clearTimeout(host._dvdjsHighlightTimer);
    host._dvdjsHighlightTimer = null;
  }
}

function resetMenuMotion(
  host: any,
  menuVideo: HTMLVideoElement | null,
  menu: Element | null,
) {
  if (menuVideo) {
    if (host._dvdjsMenuTimeUpdate) {
      menuVideo.removeEventListener('timeupdate', host._dvdjsMenuTimeUpdate);
      host._dvdjsMenuTimeUpdate = null;
    }
    host._dvdjsMenuSegmentEnd = null;
    host._dvdjsFinishMenuSegment = null;
    try {
      menuVideo.pause();
    } catch {
      // ignore
    }
    menuVideo.hidden = true;
    menuVideo.style.cssText = '';
  }
  const hostMenu = menu || host._dvdjsActiveMenu;
  const still = hostMenu && hostMenu.querySelector('img.menu-still');
  if (still) {
    (still as HTMLElement).style.opacity = '';
  }
}

function setMenuButtonsEnabled(menu: Element | null, enabled: boolean) {
  if (!menu) {
    return;
  }
  menu.querySelectorAll('input.btn').forEach((btn) => {
    const input = btn as HTMLInputElement;
    input.disabled = !enabled;
    input.style.pointerEvents = enabled ? '' : 'none';
  });
}

export function highlightMenuButton(
  menu: Element | null,
  buttonIndex: number,
) {
  if (!menu) {
    return;
  }
  menu.querySelectorAll('input.btn').forEach((btn, i) => {
    if (i === buttonIndex) {
      btn.classList.add('selected');
    } else {
      btn.classList.remove('selected');
    }
  });

  const sels = menu.querySelectorAll('img.menu-spu-sel');
  const acts = menu.querySelectorAll('img.menu-spu-act');
  sels.forEach((sel, s) => {
    if (s === buttonIndex) {
      sel.removeAttribute('hidden');
    } else {
      sel.setAttribute('hidden', '');
    }
  });
  acts.forEach((act) => {
    act.setAttribute('hidden', '');
  });
}

export function flashMenuButtonActivate(
  menu: Element | null,
  buttonIndex: number,
  durationMs = 120,
) {
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

function resolveMenuAssetBase(
  menu: HTMLElement,
  domain: string | number | null | undefined,
  opts: MenuCellPlayOpts,
): string | null {
  const fromList = [...(opts.spuSelect || []), ...(opts.spuActivate || [])];
  for (const src of fromList) {
    const m = src && src.match(/^(.*\/)menu-\d+-\d+-\d+/);
    if (m) {
      return m[1];
    }
  }

  const still = menu.querySelector('img.menu-still') as HTMLImageElement | null;
  const stillSrc = still?.getAttribute('src');
  if (stillSrc) {
    const m = stillSrc.match(/^(.*\/)menu-\d+-\d+-\d+\.png/);
    if (m) {
      return m[1];
    }
  }

  const dom = domain != null ? String(domain) : menu.dataset.domain;
  if (dom != null && menu.ownerDocument) {
    const menuVideo = menu.ownerDocument.getElementById(
      `menu-video-${dom}`,
    ) as HTMLVideoElement | null;
    const vsrc =
      menuVideo?.getAttribute('src') || menuVideo?.currentSrc || '';
    const vm = vsrc.match(/^(.*\/)[^/]+$/);
    if (vm) {
      return vm[1];
    }
  }

  // Any still/CSS already on the page for this disc.
  const any = document.querySelector(
    'img.menu-still[src*="menu-"], link[href*="menu-"]',
  ) as HTMLElement | null;
  const href =
    (any as HTMLImageElement)?.src ||
    (any as HTMLLinkElement)?.href ||
    any?.getAttribute('src') ||
    any?.getAttribute('href') ||
    '';
  const am = href.match(/^(.*\/)menu-\d+-\d+-\d+/);
  return am ? am[1] : null;
}

function updateMenuCellVisuals(menu: HTMLElement, opts: MenuCellPlayOpts) {
  if (opts.cellID == null || opts.vobID == null) {
    return;
  }
  const domain =
    opts.domain != null ? opts.domain : menu.dataset.domain;
  const baseDir = resolveMenuAssetBase(menu, domain, opts);
  const prefix =
    domain != null
      ? `menu-${domain}-${opts.cellID}-${opts.vobID}`
      : null;

  let still = menu.querySelector('img.menu-still') as HTMLImageElement | null;
  let cssHref: string | null = null;
  let stillSrc: string | null = null;

  if (baseDir && prefix) {
    stillSrc = `${baseDir}${prefix}.png`;
    cssHref = `${baseDir}${prefix}.css`;
  }

  // Prefer an already-linked stylesheet for this cell when present.
  const links = document.querySelectorAll(
    `link[href*="menu-${domain}-${opts.cellID}-${opts.vobID}"]`,
  );
  if (links.length) {
    cssHref = links[0].getAttribute('href') || cssHref;
  }

  if (stillSrc) {
    if (!still) {
      still = document.createElement('img');
      still.className = 'menu-still';
      still.alt = '';
      menu.insertBefore(still, menu.firstChild);
    }
    still.setAttribute('src', stillSrc);
    still.style.display = '';
    still.onerror = () => {
      // Motion-only cells may lack a still PNG — keep video visible.
      still!.style.display = 'none';
    };
  }

  if (baseDir && prefix) {
    let spu = menu.querySelector('img.menu-spu') as HTMLImageElement | null;
    const spuSrc = `${baseDir}${prefix}-spu.png`;
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

    menu
      .querySelectorAll('img.menu-spu-sel, img.menu-spu-act')
      .forEach((el) => el.remove());

    let selList = opts.spuSelect ? [...opts.spuSelect] : [];
    let actList = opts.spuActivate ? [...opts.spuActivate] : [];
    if (!selList.length && opts.buttons && opts.buttons.length) {
      for (let si = 0; si < opts.buttons.length; si++) {
        selList.push(`${baseDir}${prefix}-spu-sel-${si}.png`);
        actList.push(`${baseDir}${prefix}-spu-act-${si}.png`);
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
  } else if (opts.spuSelect && opts.spuSelect.length) {
    // Absolute SPU URLs without a resolved baseDir (still-less menus).
    menu
      .querySelectorAll('img.menu-spu-sel, img.menu-spu-act')
      .forEach((el) => el.remove());
    for (let sj = 0; sj < opts.spuSelect.length; sj++) {
      const simg = document.createElement('img');
      simg.className = 'menu-spu-sel';
      simg.dataset.id = String(sj);
      simg.hidden = true;
      simg.alt = '';
      simg.setAttribute('aria-hidden', 'true');
      simg.src = opts.spuSelect[sj];
      menu.appendChild(simg);
    }
    const acts = opts.spuActivate || [];
    for (let aj = 0; aj < acts.length; aj++) {
      const aimg = document.createElement('img');
      aimg.className = 'menu-spu-act';
      aimg.dataset.id = String(aj);
      aimg.hidden = true;
      aimg.alt = '';
      aimg.setAttribute('aria-hidden', 'true');
      aimg.src = acts[aj];
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

  if (opts.buttons && opts.buttons.length) {
    menu.querySelectorAll('input.btn').forEach((el) => el.remove());
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
      menu.appendChild(input);
    }
  }
}

function playMenuMotionSegment(
  host: any,
  menuVideo: HTMLVideoElement,
  opts: MenuCellPlayOpts,
  onReady: () => void,
) {
  const start = opts.startSec || 0;
  const end = opts.endSec!;
  host._dvdjsMenuSegmentEnd = end;

  const finishSegment = () => {
    if (host._dvdjsFinishMenuSegment !== finishSegment) {
      return;
    }
    menuVideo.pause();
    menuVideo.removeEventListener('timeupdate', onTimeUpdate);
    menuVideo.removeEventListener('ended', onEnded);
    if (host._dvdjsMenuTimeUpdate === onTimeUpdate) {
      host._dvdjsMenuTimeUpdate = null;
    }
    if (host._dvdjsMenuEnded === onEnded) {
      host._dvdjsMenuEnded = null;
    }
    host._dvdjsMenuSegmentEnd = null;
    host._dvdjsFinishMenuSegment = null;
    // Menu cells with buttons: hold the last frame until the user picks
    // (still_time 0 would otherwise race through and leave a dead end).
    if (opts.buttons && opts.buttons.length > 0) {
      return;
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
  };

  const onTimeUpdate = () => {
    if (menuVideo.currentTime >= end - 0.05) {
      finishSegment();
    }
  };

  // Artifacted / short WebMs may never reach endSec via timeupdate.
  const onEnded = () => {
    finishSegment();
  };

  host._dvdjsFinishMenuSegment = finishSegment;

  if (host._dvdjsMenuTimeUpdate) {
    menuVideo.removeEventListener('timeupdate', host._dvdjsMenuTimeUpdate);
    host._dvdjsMenuTimeUpdate = null;
  }
  if (host._dvdjsMenuEnded) {
    menuVideo.removeEventListener('ended', host._dvdjsMenuEnded);
    host._dvdjsMenuEnded = null;
  }

  // Match still/SPU: fill the DVD stage (letterboxing is on the stage, not here).
  menuVideo.hidden = false;
  menuVideo.style.cssText =
    'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:fill;z-index:0;';
  const still =
    host._dvdjsActiveMenu &&
    host._dvdjsActiveMenu.querySelector('img.menu-still');

  const beginPlayback = () => {
    host._dvdjsMenuTimeUpdate = onTimeUpdate;
    host._dvdjsMenuEnded = onEnded;
    menuVideo.addEventListener('timeupdate', onTimeUpdate);
    menuVideo.addEventListener('ended', onEnded);
    void playWithAutoplayFallback(menuVideo, host as AutoplayHost).then(
      (ok) => {
        if (ok) {
          if (still) {
            (still as HTMLElement).style.opacity = '0';
          }
          onReady();
          return;
        }
        // Autoplay blocked: keep still visible, wait for Start gesture.
        menuVideo.removeEventListener('timeupdate', onTimeUpdate);
        menuVideo.removeEventListener('ended', onEnded);
        if (host._dvdjsMenuTimeUpdate === onTimeUpdate) {
          host._dvdjsMenuTimeUpdate = null;
        }
        if (host._dvdjsMenuEnded === onEnded) {
          host._dvdjsMenuEnded = null;
        }
        host._dvdjsMenuSegmentEnd = null;
        host._dvdjsFinishMenuSegment = null;
        try {
          menuVideo.pause();
        } catch {
          // ignore
        }
        if (still) {
          (still as HTMLElement).style.opacity = '';
        }
        notifyAutoplayBlocked(host as AutoplayHost);
      },
    );
  };

  /** Seek then play — avoids black/skip when re-entering a segment already near end. */
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

function currentVideo(host: XVideoElement): HTMLVideoElement | null {
  const entry = host.playlist[host.videoIndex];
  return entry ? entry.video : null;
}

function buildPlaylist(host: HTMLElement): PlaylistEntry[] {
  return Array.from(host.querySelectorAll(':scope > video'))
    .filter((video) => {
      const el = video as HTMLVideoElement;
      return !el.classList.contains('dvdjs-menu-video');
    })
    .map((video) => {
      const el = video as HTMLVideoElement;
      el.style.display = 'none';
      let chapterCues: TextTrackCue[] = [];
      if (el.textTracks && el.textTracks.length > 0) {
        try {
          chapterCues = Array.from(el.textTracks[0].cues || []);
        } catch {
          chapterCues = [];
        }
      }
      return {
        id: el.id,
        video: el,
        src: el.getAttribute('src') || el.currentSrc || '',
        chapterCues,
      };
    });
}

class XVideo extends HTMLElement implements XVideoElement {
  playlist: PlaylistEntry[] = [];
  videoIndex = 0;
  onmenu: ((event: object) => void) | null = null;
  #unbindKeys: (() => void) | null = null;

  connectedCallback() {
    if (getComputedStyle(this).position === 'static') {
      this.style.position = 'relative';
    }
    this.style.display = 'block';
    this.style.margin = '0 auto';
    this.style.background = '#000';
    this.style.overflow = 'hidden';
    this.tabIndex = 0;

    this.#unbindKeys = bindMenuKeys(this);

    // Defer until Solid finishes painting children.
    queueMicrotask(() => this.#refreshPlaylist());
  }

  disconnectedCallback() {
    this.#unbindKeys?.();
    this.#unbindKeys = null;
  }

  #refreshPlaylist() {
    this.playlist = buildPlaylist(this);
    this.playlist.forEach((entry, i) => {
      entry.video.style.display = i === this.videoIndex ? 'block' : 'none';
      entry.video.style.width = '100%';
      entry.video.style.height = 'auto';
    });
  }

  play() {
    this.#refreshPlaylist();
    const video = currentVideo(this);
    if (!video) {
      return;
    }
    this.playlist.forEach((entry, i) => {
      entry.video.style.display = i === this.videoIndex ? 'block' : 'none';
    });
    hideAllMenu(this);
    return video.play();
  }

  pause() {
    const video = currentVideo(this);
    if (video) {
      video.pause();
    }
    const menuVideos = this.querySelectorAll(
      'video.dvdjs-menu-video',
    ) as NodeListOf<HTMLVideoElement>;
    menuVideos.forEach((v) => {
      try {
        v.pause();
      } catch {
        // ignore
      }
    });
  }

  /**
   * Jump to the end of the active menu motion segment, timed still, or title
   * clip. Used by Space and the toolbar button.
   */
  skipToEnd(): boolean {
    return skipPlaybackToEnd(this);
  }

  playByIndex(videoIndex: number) {
    if (
      typeof videoIndex !== 'number' ||
      videoIndex < 0 ||
      videoIndex >= this.playlist.length
    ) {
      console.error('Video requested out of bound');
      return;
    }
    this.#refreshPlaylist();
    this.videoIndex = videoIndex;
    hideAllMenu(this);
    this.play();
  }

  playByID(elementID: string) {
    if (elementID === undefined) {
      console.error('Missing element ID');
      return;
    }
    const id = String(elementID);
    this.#refreshPlaylist();

    const targetElementIndex = this.playlist.findIndex(
      (entry) => entry.id === id,
    );

    if (targetElementIndex < 0) {
      if (/^video-/.test(id)) {
        showTitleUnavailable(this);
        return;
      }
      console.error('Unknown element ID');
      return;
    }

    if (isTitleMediaMissing(this.playlist[targetElementIndex])) {
      showTitleUnavailable(this);
      return;
    }

    hideTitleUnavailable(this);
    this.videoIndex = targetElementIndex;
    hideAllMenu(this);

    const video = this.playlist[this.videoIndex].video;
    const onMediaError = () => {
      video.removeEventListener('error', onMediaError);
      showTitleUnavailable(this);
    };
    video.addEventListener('error', onMediaError);
    if (video.error) {
      onMediaError();
      return;
    }
    this.play();
  }

  playChapter(chapterIndex: number) {
    if (typeof chapterIndex !== 'number') {
      console.error('Invalid chapter number');
      return;
    }
    this.#refreshPlaylist();
    const current = this.playlist[this.videoIndex];
    if (
      isTitleMediaMissing(current) ||
      !current.chapterCues ||
      chapterIndex < 0 ||
      chapterIndex >= current.chapterCues.length
    ) {
      showTitleUnavailable(this);
      return;
    }
    hideTitleUnavailable(this);
    const cue = current.chapterCues[chapterIndex] as TextTrackCue & {
      startTime: number;
    };
    current.video.currentTime = cue.startTime;
    this.play();
  }

  playMenuByID(elementID: string) {
    if (elementID === undefined) {
      console.error('Missing element ID');
      return;
    }
    const menu = this.querySelector(`#${CSS.escape(String(elementID))}`) as
      | (HTMLElement & { show?: () => void })
      | null;
    if (!menu) {
      console.error('Unknown element ID');
      return;
    }

    hideTitleUnavailable(this);
    this.pause();
    hideAllMenu(this);
    clearDvdjsTimers(this);
    const domainVideo = this.querySelector(
      `#menu-video-${menu.dataset.domain != null ? menu.dataset.domain : ''}`,
    ) as HTMLVideoElement | null;
    resetMenuMotion(this, domainVideo, menu);
    (this as any)._dvdjsActiveMenu = menu;
    if (typeof menu.show === 'function') {
      menu.show();
    } else {
      menu.style.display = 'flex';
    }
    const hl =
      Math.floor(
        ((window as any).sprm && (window as any).sprm.HL_BTNN
          ? (window as any).sprm.HL_BTNN
          : 0x0400) / 0x0400,
      ) - 1;
    highlightMenuButton(menu, hl);
  }

  playMenuCell(opts: MenuCellPlayOpts = {}) {
    const menu = (
      opts.menuId
        ? this.querySelector(`#${CSS.escape(opts.menuId)}`)
        : (this as any)._dvdjsActiveMenu
    ) as (HTMLElement & { show?: () => void }) | null;

    if (!menu) {
      console.error('playMenuCell: unknown menu', opts.menuId);
      return;
    }

    hideTitleUnavailable(this);
    clearDvdjsTimers(this);
    (this as any)._dvdjsActiveMenu = menu;
    (this as any)._dvdjsMenuPost =
      typeof opts.onPost === 'function' ? opts.onPost : null;

    if (opts.cellID != null) {
      menu.dataset.cell = String(opts.cellID);
    }
    if (opts.vobID != null) {
      menu.dataset.vob = String(opts.vobID);
    }
    if (opts.domain != null) {
      menu.dataset.domain = String(opts.domain);
    }

    updateMenuCellVisuals(menu, opts);

    hideAllMenu(this);
    this.pause();
    if (typeof menu.show === 'function') {
      menu.show();
    } else {
      menu.style.display = 'flex';
    }

    const btnIndex =
      Math.floor(
        ((window as any).sprm && (window as any).sprm.HL_BTNN
          ? (window as any).sprm.HL_BTNN
          : 0x0400) / 0x0400,
      ) - 1;
    const enableButtons = () => {
      highlightMenuButton(menu, btnIndex);
      setMenuButtonsEnabled(menu, true);
      if (this.classList.contains('dvdjs-debug-hitboxes')) {
        applyDebugHitboxLabels(menu);
      }
      try {
        this.focus({ preventScroll: true });
      } catch {
        // ignore
      }
    };

    setMenuButtonsEnabled(menu, false);

    let hliDelay = 0;
    if (opts.hli_s_ptm != null && opts.hli_s_ptm > 0) {
      const cellStart = opts.startSec != null ? opts.startSec : 0;
      hliDelay = Math.max(0, opts.hli_s_ptm / 90000 - cellStart);
    }

    const stillTime = opts.still_time != null ? opts.still_time : 0;
    const hasMotion =
      opts.startSec != null &&
      opts.endSec != null &&
      opts.endSec > opts.startSec &&
      stillTime !== 255;

    const menuVideo = this.querySelector(
      `#menu-video-${opts.domain != null ? opts.domain : menu.dataset.domain}`,
    ) as HTMLVideoElement | null;

    if (hasMotion && menuVideo && menuVideo.src) {
      playMenuMotionSegment(this, menuVideo, opts, () => {
        if (hliDelay > 0) {
          (this as any)._dvdjsHighlightTimer = setTimeout(
            enableButtons,
            hliDelay * 1000,
          );
        } else {
          enableButtons();
        }
      });
      return;
    }

    resetMenuMotion(this, menuVideo, menu);

    if (hliDelay > 0) {
      (this as any)._dvdjsHighlightTimer = setTimeout(
        enableButtons,
        hliDelay * 1000,
      );
    } else {
      enableButtons();
    }

    if (stillTime > 0 && stillTime < 255 && typeof opts.onPost === 'function') {
      (this as any)._dvdjsStillTimer = setTimeout(() => {
        const post = (this as any)._dvdjsMenuPost;
        (this as any)._dvdjsMenuPost = null;
        if (post) {
          post();
        }
      }, stillTime * 1000);
    }
  }

  setMenuHighlight(menu: Element | null, buttonIndex: number) {
    const target = (menu || (this as any)._dvdjsActiveMenu) as HTMLElement | null;
    highlightMenuButton(target, buttonIndex);
    if (this.classList.contains('dvdjs-debug-hitboxes')) {
      applyDebugHitboxLabels(target);
    }
  }

  flashMenuActivate(menu: Element | null, buttonIndex: number) {
    flashMenuButtonActivate(
      menu || (this as any)._dvdjsActiveMenu,
      buttonIndex,
      120,
    );
  }

  /** Toggle green hitbox chrome + B0..Bn labels on menu buttons. */
  setDebugHitboxes(enabled: boolean) {
    this.classList.toggle('dvdjs-debug-hitboxes', enabled);
    if (enabled) {
      applyDebugHitboxLabels((this as any)._dvdjsActiveMenu);
    } else {
      const menu = (this as any)._dvdjsActiveMenu as HTMLElement | null;
      menu?.querySelectorAll('input.btn').forEach((btn) => {
        (btn as HTMLInputElement).value = '';
      });
    }
  }
}

class XMenu extends HTMLElement {
  connectedCallback() {
    this.style.display = 'none';
    this.hidden = true;
    this.style.position = 'absolute';
    this.style.inset = '0';
    this.style.zIndex = '1';
    this.style.alignItems = 'stretch';
    this.style.justifyContent = 'stretch';
  }

  show() {
    this.hidden = false;
    this.style.display = 'flex';
  }

  hide() {
    this.style.display = 'none';
    this.hidden = true;
  }
}

let registered = false;

/** Register native `<x-video>` / `<x-menu>` (vm.js contract, no x-tag). */
export function registerDvdHostElements() {
  if (registered || typeof customElements === 'undefined') {
    return;
  }
  if (!customElements.get('x-menu')) {
    customElements.define('x-menu', XMenu);
  }
  if (!customElements.get('x-video')) {
    customElements.define('x-video', XVideo);
  }
  registered = true;
}
