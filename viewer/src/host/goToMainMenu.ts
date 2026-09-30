/**
 * Escape broken / stuck menus by jumping to the VMGM Title menu.
 * Cancels pending still waits and motion-segment finish without advancing the VM.
 * Forces domain 0 so onmenu does not re-enter a VTS Root stub (Avatar domain 5).
 */

import {
  clearUserButtonNav,
  escapeToVmgmTitleMenu,
  hideTitleUnavailableOverlay,
} from './titleUnavailable.js';
import { hideMenuHoldFrame } from './menuHoldFrame.js';

export type GoToMainMenuHost = {
  onmenu?: ((event: object) => void) | null;
  querySelector: (selectors: string) => Element | null;
  closest?: (selectors: string) => Element | null;
  _dvdjsFromButton?: boolean;
  _dvdjsMenuResume?: unknown;
  _dvdjsStillTimer?: ReturnType<typeof setTimeout> | null;
  _dvdjsHighlightTimer?: ReturnType<typeof setTimeout> | null;
  _dvdjsMotionWatchdog?: ReturnType<typeof setTimeout> | null;
  _dvdjsMenuPost?: (() => void) | null;
  _dvdjsFinishMenuSegment?: (() => void) | null;
  _dvdjsMenuSegmentEnd?: number | null;
  _dvdjsMenuTimeUpdate?: ((this: HTMLVideoElement, ev: Event) => void) | null;
  _dvdjsActiveMenu?: HTMLElement | null;
  _dvdjsLastPaintedStillSrc?: string | null;
  _dvdjsTitleUnavailableDismiss?: (() => void) | null;
  _dvdjsTitleUnavailableKeyHandler?: ((ev: KeyboardEvent) => void) | null;
};

function cancelPendingMenuAdvance(host: GoToMainMenuHost): void {
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
  // Drop post/finish without running them — caller wants escape, not advance.
  host._dvdjsMenuPost = null;
  host._dvdjsFinishMenuSegment = null;
  host._dvdjsMenuSegmentEnd = null;

  const menu = host._dvdjsActiveMenu;
  const domain = menu?.dataset?.domain;
  const menuVideo =
    domain != null && domain !== ''
      ? (host.querySelector(
          `#menu-video-${String(domain)}`,
        ) as HTMLVideoElement | null)
      : null;
  const video =
    menuVideo ||
    ((host as any)._dvdjsMenuMotionVideo as HTMLVideoElement | null);
  if (video) {
    if (host._dvdjsMenuTimeUpdate) {
      video.removeEventListener('timeupdate', host._dvdjsMenuTimeUpdate);
    }
    if ((host as any)._dvdjsMenuEnded) {
      video.removeEventListener('ended', (host as any)._dvdjsMenuEnded);
      (host as any)._dvdjsMenuEnded = null;
    }
    if ((host as any)._dvdjsMenuSeeked) {
      video.removeEventListener('seeked', (host as any)._dvdjsMenuSeeked);
      (host as any)._dvdjsMenuSeeked = null;
    }
    if ((host as any)._dvdjsMenuLoadedMeta) {
      video.removeEventListener(
        'loadedmetadata',
        (host as any)._dvdjsMenuLoadedMeta,
      );
      (host as any)._dvdjsMenuLoadedMeta = null;
    }
  }
  host._dvdjsMenuTimeUpdate = null;
}

/**
 * Jump to the disc VMGM Title menu. Returns true if a menu run was invoked.
 */
export function goToMainMenu(host: GoToMainMenuHost): boolean {
  cancelPendingMenuAdvance(host);
  hideTitleUnavailableOverlay(host);
  clearUserButtonNav(host);
  // Drop previous-language still/hold so the next playMenuCell does not cover
  // with a stale English (etc.) frame during LU switches.
  host._dvdjsLastPaintedStillSrc = null;
  hideMenuHoldFrame(host as HTMLElement);
  try {
    const g =
      typeof globalThis !== 'undefined' && (globalThis as any).window
        ? (globalThis as any).window
        : typeof globalThis !== 'undefined'
          ? (globalThis as any)
          : {};
    return escapeToVmgmTitleMenu(host, g);
  } catch (e) {
    console.warn('DVD.js goToMainMenu failed', e);
    return false;
  }
}
