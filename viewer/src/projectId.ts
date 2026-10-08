/**
 * Shared project id / CSS / storage keys for the Solid viewer.
 * Mirrors `src/projectId.ts` (viewer cannot import server sources).
 */

export const PROJECT_SLUG = 'dvd-menu-archive';

export const LOG_TAG = PROJECT_SLUG;

export const DEBUG_STORAGE_KEY = 'dvd-menu-archive-debug';
export const DEBUG_STORAGE_KEY_LEGACY = 'dvdjsDebug';
export const DEBUG_QUERY_PARAM = 'dvd-menu-archive-debug';
export const DEBUG_QUERY_PARAM_LEGACY = 'dvdjsDebug';
export const DEBUG_WINDOW_FLAG = 'dvdMenuArchiveDebug';

export const VIRTUAL_REMOTE_STORAGE_KEY = 'dvd-menu-archive-virtual-remote';
export const VIRTUAL_REMOTE_STORAGE_KEY_LEGACY = 'dvdjs-virtual-remote';
/** Per-orientation { left, top } for the virtual remote (px). */
export const VIRTUAL_REMOTE_POS_STORAGE_KEY =
  'dvd-menu-archive-virtual-remote-pos';

export const CRT_STORAGE_KEY = 'dvd-menu-archive-crt';

/** CRT look: none | simple (CSS) | full (WebGL). Legacy `1` → simple. */
export type CrtMode = 'none' | 'simple' | 'full';

export function readCrtMode(): CrtMode {
  try {
    const v = localStorage.getItem(CRT_STORAGE_KEY);
    if (v === 'full') {
      return 'full';
    }
    if (v === 'simple' || v === '1') {
      return 'simple';
    }
    return 'none';
  } catch {
    return 'none';
  }
}

export function writeCrtMode(mode: CrtMode): void {
  writeStorage(CRT_STORAGE_KEY, mode);
}

export const MENU_LANG_STORAGE_KEY = 'dvd-menu-archive.menuLang';
export const MENU_LANG_STORAGE_KEY_LEGACY = 'dvdjs.menuLang';

export const AUTOPLAY_BLOCKED_EVENT = 'dvd-menu-archive-autoplay-blocked';

export const CSS = {
  menuVideo: 'dvd-menu-archive-menu-video',
  menuHold: 'dvd-menu-archive-menu-hold',
  debugHitboxes: 'dvd-menu-archive-debug-hitboxes',
  titleUnavailable: 'dvd-menu-archive-title-unavailable',
  titleUnavailableCard: 'dvd-menu-archive-title-unavailable__card',
  titleUnavailableHeading: 'dvd-menu-archive-title-unavailable__heading',
  titleUnavailableBody: 'dvd-menu-archive-title-unavailable__body',
  titleUnavailableBtn: 'dvd-menu-archive-title-unavailable__btn',
  titleUnavailableHeadingId: 'dvd-menu-archive-title-unavailable-heading',
  titleStub: 'dvd-menu-archive-title-stub',
  titleStubBanner: 'dvd-menu-archive-title-stub__banner',
  startOverlay: 'dvd-menu-archive-start-overlay',
  startOverlayBtn: 'dvd-menu-archive-start-overlay__btn',
  startOverlayHint: 'dvd-menu-archive-start-overlay__hint',
  crtWebgl: 'dvd-menu-archive-crt-webgl',
  crtFull: 'dvd-menu-archive-crt-full',
} as const;

export function readStoragePrefer(
  modern: string,
  legacy: string,
): string | null {
  try {
    var v = localStorage.getItem(modern);
    if (v != null) {
      return v;
    }
    return localStorage.getItem(legacy);
  } catch {
    return null;
  }
}

export function writeStorage(modern: string, value: string): void {
  try {
    localStorage.setItem(modern, value);
  } catch {
    // private mode / quota
  }
}
