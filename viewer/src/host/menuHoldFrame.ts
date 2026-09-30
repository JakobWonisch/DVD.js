/**
 * Seamless menu handoff: keep a canvas snapshot of the last good frame while
 * the WebM seeks or the next still PNG loads. Invariant: never hide video/still
 * until this hold (or another painted layer) is showing.
 */

export const MENU_HOLD_CLASS = 'dvdjs-menu-hold';

export function ensureMenuHoldCanvas(host: HTMLElement): HTMLCanvasElement {
  let canvas = host.querySelector(
    `:scope > canvas.${MENU_HOLD_CLASS}`,
  ) as HTMLCanvasElement | null;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = MENU_HOLD_CLASS;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.hidden = true;
    host.appendChild(canvas);
  }
  return canvas;
}

export function menuHoldFrameVisible(host: HTMLElement | null | undefined): boolean {
  if (!host) {
    return false;
  }
  const canvas = host.querySelector(
    `:scope > canvas.${MENU_HOLD_CLASS}`,
  ) as HTMLCanvasElement | null;
  return !!(canvas && !canvas.hidden && canvas.width > 0 && canvas.height > 0);
}

export function showMenuHoldFrame(host: HTMLElement): void {
  const canvas = ensureMenuHoldCanvas(host);
  if (canvas.width > 0 && canvas.height > 0) {
    canvas.hidden = false;
    canvas.style.opacity = '';
    canvas.style.display = '';
  }
}

export function hideMenuHoldFrame(host: HTMLElement | null | undefined): void {
  if (!host) {
    return;
  }
  const canvas = host.querySelector(
    `:scope > canvas.${MENU_HOLD_CLASS}`,
  ) as HTMLCanvasElement | null;
  if (canvas) {
    canvas.hidden = true;
  }
}

function sourcePixelSize(
  source: HTMLVideoElement | HTMLImageElement,
): { w: number; h: number } | null {
  // Duck-type: node tests have no HTMLVideoElement global.
  const videoW = (source as HTMLVideoElement).videoWidth;
  const videoH = (source as HTMLVideoElement).videoHeight;
  if (typeof videoW === 'number' && videoW > 0 && videoH > 0) {
    return { w: videoW, h: videoH };
  }
  const w = (source as HTMLImageElement).naturalWidth;
  const h = (source as HTMLImageElement).naturalHeight;
  if (typeof w === 'number' && w > 0 && h > 0) {
    return { w, h };
  }
  return null;
}

/**
 * Snapshot `source` onto the hold canvas.
 * @param show when true (default), make the hold visible immediately.
 * @returns true when a frame was captured (and shown if requested).
 */
export function captureMenuHoldFrame(
  host: HTMLElement,
  source: HTMLVideoElement | HTMLImageElement | null | undefined,
  opts: { show?: boolean } = {},
): boolean {
  const show = opts.show !== false;
  if (!source) {
    if (show && menuHoldFrameVisible(host)) {
      showMenuHoldFrame(host);
      return true;
    }
    return menuHoldFrameVisible(host);
  }
  const size = sourcePixelSize(source);
  if (!size) {
    if (show) {
      return captureMenuHoldFromStageFallback(host);
    }
    return false;
  }
  const canvas = ensureMenuHoldCanvas(host);
  try {
    if (canvas.width !== size.w || canvas.height !== size.h) {
      canvas.width = size.w;
      canvas.height = size.h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return false;
    }
    ctx.drawImage(source, 0, 0, size.w, size.h);
    if (show) {
      canvas.hidden = false;
      canvas.style.opacity = '';
      canvas.style.display = '';
    }
    return true;
  } catch {
    // Cross-origin / empty decode — keep whatever hold we already had.
    if (show) {
      return captureMenuHoldFromStageFallback(host);
    }
    return false;
  }
}

function captureMenuHoldFromStageFallback(host: HTMLElement): boolean {
  const canvas = host.querySelector(
    `:scope > canvas.${MENU_HOLD_CLASS}`,
  ) as HTMLCanvasElement | null;
  if (canvas && canvas.width > 0 && canvas.height > 0) {
    showMenuHoldFrame(host);
    return true;
  }
  return false;
}

/**
 * Capture from the best currently painted layer (visible video, else still).
 * Call this *before* hiding/seeking anything.
 */
export function captureMenuHoldFromStage(
  host: HTMLElement,
  opts: {
    menuVideo?: HTMLVideoElement | null;
    still?: HTMLImageElement | null;
  },
): boolean {
  const video = opts.menuVideo;
  if (
    video &&
    !video.hidden &&
    video.style.opacity !== '0' &&
    video.readyState >= 2 &&
    video.videoWidth > 0
  ) {
    if (captureMenuHoldFrame(host, video)) {
      return true;
    }
  }
  const still = opts.still;
  if (
    still &&
    still.style.display !== 'none' &&
    // Opacity 0 is common as a seek cover — still has the outgoing pixels.
    still.complete &&
    still.naturalWidth > 0
  ) {
    if (captureMenuHoldFrame(host, still)) {
      return true;
    }
  }
  // Re-show a previous capture if we have one.
  if (menuHoldFrameVisible(host)) {
    showMenuHoldFrame(host);
    return true;
  }
  const canvas = host.querySelector(
    `:scope > canvas.${MENU_HOLD_CLASS}`,
  ) as HTMLCanvasElement | null;
  if (canvas && canvas.width > 0 && canvas.height > 0) {
    showMenuHoldFrame(host);
    return true;
  }
  return false;
}
