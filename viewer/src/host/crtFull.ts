/**
 * WebGL CRT (“Full”) — composite the active domain’s picture (+ SPU) into a
 * scratch canvas, then run npm `@glowbox/crt` (barrel, scanlines, phosphor
 * mask, vignette, RGB convergence ≈ chromatic aberration, light persistence).
 *
 * Always resolve `#menu-video-{domain}` for the active menu — never the first
 * `.menu-video` in the DOM (stale paused VTS frames).
 */

import { createCrtScreen, type CrtScreen } from '@glowbox/crt';
import { CSS } from '../projectId.js';
import { MENU_HOLD_CLASS } from './menuHoldFrame.js';

export const CRT_WEBGL_CLASS = 'dvd-menu-archive-crt-webgl';
export const CRT_FULL_SURFACE_CLASS = 'dvd-menu-archive-crt-full';

/** Desktop Full CRT defaults — fine enough on a large CSS box. */
const CRT_DESKTOP = {
  pixelRatio: 1.5,
  scanlines: 0.65,
  mask: 0.35,
} as const;

type CrtLook = {
  pixelRatio: number;
  scanlines: number;
  mask: number;
};

/**
 * Cap CRT internal resolution + soften the phosphor mask on narrow / high-DPR
 * surfaces. Scanlines are ~1 row per output pixel and the RGB mask is
 * `mod(frag.x, 3)` — on phone CSS boxes those patterns beat against the
 * display grid and read as moiré. Lower pixelRatio stretches coarser stripes;
 * a weaker mask removes the worst interferer.
 */
export function crtLookForSurface(cssWidth: number, dpr = 1): CrtLook {
  const w = Math.max(0, cssWidth);
  const ratio = Math.max(1, dpr);
  // Phone / drawer player (~full-bleed portrait width under 860px chrome).
  if (w > 0 && w < 520) {
    return { pixelRatio: 1, scanlines: 0.5, mask: 0.12 };
  }
  // Compact landscape / high-DPR tablets: still coarse enough to avoid stripes.
  if (w < 720 || ratio >= 2.25) {
    return { pixelRatio: 1.15, scanlines: 0.55, mask: 0.2 };
  }
  return { ...CRT_DESKTOP };
}

type CrtSource = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement;

function isLaidOut(el: Element | null | undefined): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) {
    return false;
  }
  if (el.hidden || el.hasAttribute('hidden')) {
    return false;
  }
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function intentionallyHidden(el: HTMLElement): boolean {
  return el.style.opacity === '0';
}

function videoHasFrame(v: HTMLVideoElement): boolean {
  return v.readyState >= 2 && v.videoWidth > 0;
}

function videoIsPlaying(v: HTMLVideoElement): boolean {
  return !v.paused && !v.ended && videoHasFrame(v);
}

function activeMenu(host: HTMLElement): HTMLElement | null {
  const menus = host.querySelectorAll('x-menu');
  for (let i = 0; i < menus.length; i++) {
    const menu = menus[i] as HTMLElement;
    if (isLaidOut(menu)) {
      return menu;
    }
  }
  return null;
}

function activeMenuVideo(host: HTMLElement): HTMLVideoElement | null {
  const menu = activeMenu(host);
  const domain = menu?.dataset?.domain;
  if (domain != null && domain !== '') {
    const byId = host.querySelector(
      `#menu-video-${domain}`,
    ) as HTMLVideoElement | null;
    if (byId) {
      return byId;
    }
  }
  const all = host.querySelectorAll(
    `video.${CSS.menuVideo}`,
  ) as NodeListOf<HTMLVideoElement>;
  for (let i = 0; i < all.length; i++) {
    if (isLaidOut(all[i]) && videoIsPlaying(all[i])) {
      return all[i];
    }
  }
  for (let i = 0; i < all.length; i++) {
    if (isLaidOut(all[i]) && videoHasFrame(all[i])) {
      return all[i];
    }
  }
  return null;
}

function holdLayer(host: HTMLElement): HTMLCanvasElement | null {
  const hold = host.querySelector(
    `:scope > canvas.${MENU_HOLD_CLASS}`,
  ) as HTMLCanvasElement | null;
  if (
    hold &&
    isLaidOut(hold) &&
    !intentionallyHidden(hold) &&
    hold.width > 0 &&
    hold.height > 0
  ) {
    return hold;
  }
  return null;
}

function stillLayer(host: HTMLElement): HTMLImageElement | null {
  const menu = activeMenu(host);
  if (!menu) {
    return null;
  }
  const still = menu.querySelector('img.menu-still') as HTMLImageElement | null;
  if (
    still &&
    isLaidOut(still) &&
    !intentionallyHidden(still) &&
    still.complete &&
    still.naturalWidth > 0
  ) {
    return still;
  }
  return null;
}

function pickBaseLayer(host: HTMLElement): CrtSource | null {
  const menuVideo = activeMenuVideo(host);

  if (
    menuVideo &&
    isLaidOut(menuVideo) &&
    !intentionallyHidden(menuVideo) &&
    videoIsPlaying(menuVideo)
  ) {
    return menuVideo;
  }

  const hold = holdLayer(host);
  if (hold) {
    return hold;
  }

  const still = stillLayer(host);
  if (still) {
    return still;
  }

  if (
    menuVideo &&
    isLaidOut(menuVideo) &&
    !intentionallyHidden(menuVideo) &&
    videoHasFrame(menuVideo)
  ) {
    return menuVideo;
  }

  const titles = host.querySelectorAll(
    `video:not(.${CSS.menuVideo})`,
  ) as NodeListOf<HTMLVideoElement>;
  for (let i = 0; i < titles.length; i++) {
    const v = titles[i];
    if (isLaidOut(v) && !intentionallyHidden(v) && videoIsPlaying(v)) {
      return v;
    }
  }
  for (let i = 0; i < titles.length; i++) {
    const v = titles[i];
    if (isLaidOut(v) && !intentionallyHidden(v) && videoHasFrame(v)) {
      return v;
    }
  }

  if (menuVideo && isLaidOut(menuVideo) && videoIsPlaying(menuVideo)) {
    return menuVideo;
  }

  return null;
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  src: CrtSource,
  w: number,
  h: number,
): boolean {
  try {
    ctx.drawImage(src, 0, 0, w, h);
    return true;
  } catch {
    return false;
  }
}

function drawSpuLayers(
  host: HTMLElement,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  const menu = activeMenu(host);
  if (!menu) {
    return;
  }
  const imgs = menu.querySelectorAll(
    'img.menu-spu, img.menu-spu-sel, img.menu-spu-act',
  ) as NodeListOf<HTMLImageElement>;
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    if (
      !isLaidOut(img) ||
      intentionallyHidden(img) ||
      !img.complete ||
      img.naturalWidth <= 0
    ) {
      continue;
    }
    if (img.style.display === 'none') {
      continue;
    }
    drawCover(ctx, img, w, h);
  }
}

function compositeFrame(
  host: HTMLElement,
  scratch: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): boolean {
  const base = pickBaseLayer(host);
  if (!base) {
    return false;
  }
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  if (!drawCover(ctx, base, w, h)) {
    return false;
  }
  drawSpuLayers(host, ctx, w, h);
  return true;
}

/**
 * Start Full CRT on `host` (`x-video`). Returns dispose, or null if WebGL is
 * unavailable.
 */
export function startCrtFull(host: HTMLElement): (() => void) | null {
  const scratch = document.createElement('canvas');
  const scratchCtx = scratch.getContext('2d', { alpha: false });
  if (!scratchCtx) {
    return null;
  }

  const initialLook = crtLookForSurface(
    host.clientWidth || 0,
    window.devicePixelRatio || 1,
  );

  let screen: CrtScreen | null = null;
  try {
    screen = createCrtScreen(scratch, {
      // Mild tube; earlier 0.3 clipped menus too hard.
      curvature: 0.14,
      scanlines: initialLook.scanlines,
      mask: initialLook.mask,
      vignette: 0.4,
      // RGB gun misalignment ≈ chromatic aberration.
      convergence: 0.45,
      persistence: 0.28,
      flicker: 0.04,
      band: 0.06,
      noise: 0.03,
      // Compensate mask/scanline light loss (reads a bit like phosphor glow).
      gain: 1.12,
      events: false,
      pixelRatio: initialLook.pixelRatio,
      background: '#000',
    });
  } catch {
    return null;
  }
  if (!screen) {
    return null;
  }

  const out = screen.canvas;
  out.className = CRT_WEBGL_CLASS;
  out.setAttribute('aria-hidden', 'true');
  host.appendChild(out);

  let raf = 0;
  let vfc = 0;
  let alive = true;
  let lastBw = 0;
  let lastBh = 0;
  let lastLook: CrtLook = initialLook;
  let watchedVideo: HTMLVideoElement | null = null;

  const cancelVfc = () => {
    if (
      watchedVideo &&
      vfc &&
      typeof watchedVideo.cancelVideoFrameCallback === 'function'
    ) {
      try {
        watchedVideo.cancelVideoFrameCallback(vfc);
      } catch {
        // ignore
      }
    }
    vfc = 0;
    watchedVideo = null;
  };

  const paintOnce = () => {
    if (!alive) {
      return;
    }
    const cssW = Math.max(1, host.clientWidth || 0);
    const cssH = Math.max(1, host.clientHeight || 0);
    const deviceDpr = window.devicePixelRatio || 1;
    const look = crtLookForSurface(cssW, deviceDpr);
    const dpr = Math.min(deviceDpr, look.pixelRatio);
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    const lookChanged =
      look.pixelRatio !== lastLook.pixelRatio ||
      look.scanlines !== lastLook.scanlines ||
      look.mask !== lastLook.mask;
    if (lookChanged) {
      lastLook = look;
      try {
        screen!.setOptions({
          pixelRatio: look.pixelRatio,
          scanlines: look.scanlines,
          mask: look.mask,
        });
      } catch {
        // context loss
      }
    }
    const resized = scratch.width !== bw || scratch.height !== bh;
    if (!compositeFrame(host, scratch, scratchCtx, bw, bh)) {
      return;
    }
    if (resized || lookChanged || lastBw !== bw || lastBh !== bh) {
      lastBw = bw;
      lastBh = bh;
      try {
        screen!.resize();
      } catch {
        // context loss
      }
    }
  };

  const armVideoFrameCallback = () => {
    cancelVfc();
    const base = pickBaseLayer(host);
    if (!(base instanceof HTMLVideoElement) || !videoIsPlaying(base)) {
      return;
    }
    if (typeof base.requestVideoFrameCallback !== 'function') {
      return;
    }
    watchedVideo = base;
    const onFrame = () => {
      if (!alive || watchedVideo !== base) {
        return;
      }
      paintOnce();
      if (alive && watchedVideo === base && videoIsPlaying(base)) {
        vfc = base.requestVideoFrameCallback(onFrame);
      } else {
        vfc = 0;
        watchedVideo = null;
      }
    };
    vfc = base.requestVideoFrameCallback(onFrame);
  };

  const tick = () => {
    if (!alive) {
      return;
    }
    paintOnce();
    if (!watchedVideo || !videoIsPlaying(watchedVideo)) {
      armVideoFrameCallback();
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    cancelVfc();
    try {
      screen!.dispose();
    } catch {
      // ignore
    }
    if (out.parentNode) {
      out.parentNode.removeChild(out);
    }
  };
}
