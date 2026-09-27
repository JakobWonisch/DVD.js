import { TITLE_UNAVAILABLE_MESSAGE } from './titleUnavailable.js';

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
  setMenuHighlight: (menu: Element | null, buttonIndex: number) => void;
};

function hideAllMenu(host: HTMLElement) {
  host.querySelectorAll('x-menu').forEach((menu) => {
    const m = menu as HTMLElement & { hide?: () => void };
    if (typeof m.hide === 'function') {
      m.hide();
    } else {
      m.style.display = 'none';
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

function updateMenuCellVisuals(menu: HTMLElement, opts: MenuCellPlayOpts) {
  if (opts.cellID == null || opts.vobID == null) {
    return;
  }
  const domain =
    opts.domain != null ? opts.domain : menu.dataset.domain;
  const still = menu.querySelector('img.menu-still') as HTMLImageElement | null;
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

  let baseDir: string | null = null;
  if (stillSrc) {
    const bm = stillSrc.match(/^(.*\/)menu-\d+-\d+-\d+\.png$/);
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

    menu
      .querySelectorAll('img.menu-spu-sel, img.menu-spu-act')
      .forEach((el) => el.remove());

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
  const still =
    host._dvdjsActiveMenu &&
    host._dvdjsActiveMenu.querySelector('img.menu-still');
  if (still) {
    (still as HTMLElement).style.opacity = '0';
  }

  const startPlayback = () => {
    menuVideo.currentTime = start;
    menuVideo.addEventListener('timeupdate', onTimeUpdate);
    const p = menuVideo.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        /* autoplay may fail */
      });
    }
    onReady();
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

  connectedCallback() {
    if (getComputedStyle(this).position === 'static') {
      this.style.position = 'relative';
    }
    this.style.display = 'block';
    this.style.width = '100%';
    this.style.maxWidth = '720px';
    this.style.aspectRatio = '720 / 480';
    this.style.margin = '0 auto';
    this.style.background = '#000';
    this.style.overflow = 'hidden';

    // Defer until Solid finishes painting children.
    queueMicrotask(() => this.#refreshPlaylist());
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
    highlightMenuButton(
      menu || (this as any)._dvdjsActiveMenu,
      buttonIndex,
    );
  }
}

class XMenu extends HTMLElement {
  connectedCallback() {
    this.style.display = 'none';
    this.style.position = 'absolute';
    this.style.inset = '0';
    this.style.zIndex = '1';
    this.style.alignItems = 'stretch';
    this.style.justifyContent = 'stretch';
  }

  show() {
    this.style.display = 'flex';
    this.hidden = false;
  }

  hide() {
    this.style.display = 'none';
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
