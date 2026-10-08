/**
 * Stop disc media when the viewer is dismissed, suspended (mobile drawer),
 * or swapped to another disc — never leave WebM audio running off-screen.
 */

import { silenceVideoAudio } from './autoplay.js';
import { hideMenuHoldFrame } from './menuHoldFrame.js';
import { clearMediaLoad } from './mediaLoadState.js';

export type HaltPlaybackHost = HTMLElement & {
  pause?: () => void;
  querySelectorAll: typeof HTMLElement.prototype.querySelectorAll;
  _dvdjsPlaybackSuspended?: boolean;
  _dvdjsStillTimer?: ReturnType<typeof setTimeout> | null;
  _dvdjsHighlightTimer?: ReturnType<typeof setTimeout> | null;
  _dvdjsMotionWatchdog?: ReturnType<typeof setTimeout> | null;
  _dvdjsRevealRetryTimer?: ReturnType<typeof setTimeout> | null;
  _dvdjsMotionRaf?: number | null;
  _dvdjsMenuPost?: (() => void) | null;
  _dvdjsFinishMenuSegment?: (() => void) | null;
  _dvdjsMenuSegmentEnd?: number | null;
  _dvdjsMenuSegmentStart?: number | null;
  _dvdjsMenuMotionVideo?: HTMLVideoElement | null;
  _dvdjsMenuSeeked?: ((this: HTMLVideoElement, ev: Event) => void) | null;
  _dvdjsMenuLoadedMeta?: ((this: HTMLVideoElement, ev: Event) => void) | null;
  _dvdjsMenuTimeUpdate?: ((this: HTMLVideoElement, ev: Event) => void) | null;
  _dvdjsMenuEnded?: ((this: HTMLVideoElement, ev: Event) => void) | null;
  _dvdjsMenuRevealTimeUpdate?:
    | ((this: HTMLVideoElement, ev: Event) => void)
    | null;
  _dvdjsMenuMediaError?: ((this: HTMLVideoElement, ev: Event) => void) | null;
  _dvdjsMenuPlayGen?: number;
  _dvdjsMediaLoadToken?: unknown;
  _dvdjsActiveMenu?: HTMLElement | null;
  _dvdjsLastPaintedStillSrc?: string | null;
};

function clearAdvanceTimers(host: HaltPlaybackHost): void {
  if (host._dvdjsStillTimer) {
    clearTimeout(host._dvdjsStillTimer);
    host._dvdjsStillTimer = null;
  }
  if (host._dvdjsHighlightTimer) {
    clearTimeout(host._dvdjsHighlightTimer);
    host._dvdjsHighlightTimer = null;
  }
  if (host._dvdjsMotionWatchdog) {
    clearTimeout(host._dvdjsMotionWatchdog);
    host._dvdjsMotionWatchdog = null;
  }
  if (host._dvdjsRevealRetryTimer) {
    clearTimeout(host._dvdjsRevealRetryTimer);
    host._dvdjsRevealRetryTimer = null;
  }
  if (host._dvdjsMotionRaf) {
    cancelAnimationFrame(host._dvdjsMotionRaf);
    host._dvdjsMotionRaf = null;
  }
}

function detachMenuMotionListeners(host: HaltPlaybackHost): void {
  const video = (host._dvdjsMenuMotionVideo || null) as HTMLVideoElement | null;
  if (video) {
    if (host._dvdjsMenuSeeked) {
      video.removeEventListener('seeked', host._dvdjsMenuSeeked);
    }
    if (host._dvdjsMenuLoadedMeta) {
      video.removeEventListener('loadedmetadata', host._dvdjsMenuLoadedMeta);
    }
    if (host._dvdjsMenuTimeUpdate) {
      video.removeEventListener('timeupdate', host._dvdjsMenuTimeUpdate);
    }
    if (host._dvdjsMenuEnded) {
      video.removeEventListener('ended', host._dvdjsMenuEnded);
    }
    if (host._dvdjsMenuRevealTimeUpdate) {
      video.removeEventListener('timeupdate', host._dvdjsMenuRevealTimeUpdate);
    }
    if (host._dvdjsMenuMediaError) {
      video.removeEventListener('error', host._dvdjsMenuMediaError);
    }
  }
  host._dvdjsMenuSeeked = null;
  host._dvdjsMenuLoadedMeta = null;
  host._dvdjsMenuTimeUpdate = null;
  host._dvdjsMenuEnded = null;
  host._dvdjsMenuRevealTimeUpdate = null;
  host._dvdjsMenuMediaError = null;
  host._dvdjsFinishMenuSegment = null;
  host._dvdjsMenuSegmentEnd = null;
  host._dvdjsMenuSegmentStart = null;
  host._dvdjsMenuMotionVideo = null;
  host._dvdjsMenuPost = null;
  host._dvdjsMediaLoadToken = null;
  host._dvdjsMenuPlayGen = (host._dvdjsMenuPlayGen || 0) + 1;
}

/** Pause + hard-silence every media element under the host. */
export function silenceAllDiscMedia(host: HaltPlaybackHost): void {
  try {
    host.pause?.();
  } catch {
    // ignore
  }
  host.querySelectorAll('video, audio').forEach((node) => {
    const media = node as HTMLMediaElement;
    try {
      silenceVideoAudio(media);
      media.pause();
    } catch {
      // ignore
    }
  });
}

function hideAllMenus(host: HaltPlaybackHost): void {
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

function blankAllVideos(host: HaltPlaybackHost): void {
  host.querySelectorAll('video').forEach((node) => {
    const v = node as HTMLVideoElement;
    try {
      silenceVideoAudio(v);
      v.pause();
    } catch {
      // ignore
    }
    v.removeAttribute('src');
    while (v.firstChild) {
      v.removeChild(v.firstChild);
    }
    try {
      v.load();
    } catch {
      // ignore
    }
    v.style.display = 'none';
    v.hidden = true;
    v.style.opacity = '0';
  });
}

/**
 * Full stop for eject / disc switch / PlayDisc unmount.
 * Cancels VM advance timers and optionally blanks painted layers.
 */
export function haltDiscPlayback(
  host: HaltPlaybackHost | null | undefined,
  opts: { resetVisuals?: boolean } = {},
): void {
  if (!host) {
    return;
  }
  clearAdvanceTimers(host);
  detachMenuMotionListeners(host);
  clearMediaLoad();
  silenceAllDiscMedia(host);
  if (opts.resetVisuals) {
    hideAllMenus(host);
    hideMenuHoldFrame(host);
    blankAllVideos(host);
    host._dvdjsActiveMenu = null;
    host._dvdjsLastPaintedStillSrc = null;
  }
}

/** True while the mobile drawer (or similar) has backgrounded the player. */
export function isDiscPlaybackSuspended(
  host: HaltPlaybackHost | null | undefined,
): boolean {
  return !!(host && host._dvdjsPlaybackSuspended);
}

/**
 * Drawer collapsed / viewer hidden: keep VM DOM but never play audio/video.
 * Cancels in-flight motion unmute/finish; leaves still_time posts so a timed
 * still can advance under the drawer (play paths no-op audio while suspended).
 */
export function suspendDiscPlayback(
  host: HaltPlaybackHost | null | undefined,
): void {
  if (!host) {
    return;
  }
  host._dvdjsPlaybackSuspended = true;
  // Drop motion seek/finish/reveal only — keep `_dvdjsStillTimer` /
  // `_dvdjsMenuPost` (Resume should not freeze a copyright still forever).
  const menuPost = host._dvdjsMenuPost;
  detachMenuMotionListeners(host);
  host._dvdjsMenuPost = menuPost;
  if (host._dvdjsMotionWatchdog) {
    clearTimeout(host._dvdjsMotionWatchdog);
    host._dvdjsMotionWatchdog = null;
  }
  if (host._dvdjsRevealRetryTimer) {
    clearTimeout(host._dvdjsRevealRetryTimer);
    host._dvdjsRevealRetryTimer = null;
  }
  if (host._dvdjsMotionRaf) {
    cancelAnimationFrame(host._dvdjsMotionRaf);
    host._dvdjsMotionRaf = null;
  }
  clearMediaLoad();
  silenceAllDiscMedia(host);
}

/** Drawer reopened — allow the next playMenuCell / title play to start media. */
export function resumeDiscPlayback(
  host: HaltPlaybackHost | null | undefined,
): void {
  if (!host) {
    return;
  }
  host._dvdjsPlaybackSuspended = false;
}

/** Active `<x-video>` inside the archive viewer chrome, if any. */
export function findArchiveViewerHost(): HaltPlaybackHost | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const root = document.getElementById('archive-viewer');
  const host = root?.querySelector('x-video');
  return (host as HaltPlaybackHost | null) || null;
}
