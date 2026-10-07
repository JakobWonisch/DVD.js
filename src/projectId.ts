/**
 * Project identifier for env vars, log prefixes, storage keys, CSS, and
 * on-disk cache markers. Legacy `dvdjs` / `DVDJS_*` names are still accepted
 * where noted (archives, older deploys). Host/vm properties `_dvdjs*` stay
 * unchanged so existing generated `vm.js` keeps working.
 */

export const PROJECT_SLUG = 'dvd-menu-archive';

/** Env prefix: DVD_MENU_ARCHIVE_WEB_FOLDER, … */
export const ENV_PREFIX = 'DVD_MENU_ARCHIVE_';

/** Older deploys / docs used DVDJS_*. */
export const ENV_PREFIX_LEGACY = 'DVDJS_';

export const LOG_TAG = PROJECT_SLUG;

export const DEBUG_STORAGE_KEY = 'dvd-menu-archive-debug';
export const DEBUG_STORAGE_KEY_LEGACY = 'dvdjsDebug';
export const DEBUG_QUERY_PARAM = 'dvd-menu-archive-debug';
export const DEBUG_QUERY_PARAM_LEGACY = 'dvdjsDebug';
export const DEBUG_WINDOW_FLAG = 'dvdMenuArchiveDebug';

export const VIRTUAL_REMOTE_STORAGE_KEY = 'dvd-menu-archive-virtual-remote';
export const VIRTUAL_REMOTE_STORAGE_KEY_LEGACY = 'dvdjs-virtual-remote';

export const CRT_STORAGE_KEY = 'dvd-menu-archive-crt';

export const MENU_LANG_STORAGE_KEY = 'dvd-menu-archive.menuLang';
export const MENU_LANG_STORAGE_KEY_LEGACY = 'dvdjs.menuLang';

export const AUTOPLAY_BLOCKED_EVENT = 'dvd-menu-archive-autoplay-blocked';

/** CSS / DOM class prefix (e.g. dvd-menu-archive-menu-video). */
export const CSS_PREFIX = 'dvd-menu-archive';

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
} as const;

/** On-disk markers inside unpacked disc folders. */
export const MARKER = {
  accessed: '.dvd-menu-archive-accessed',
  accessedLegacy: '.dvdjs-accessed',
  archiveMtime: '.dvd-menu-archive-archive-mtime',
  archiveMtimeLegacy: '.dvdjs-archive-mtime',
  converting: '.dvd-menu-archive-converting',
  convertingLegacy: '.dvdjs-converting',
} as const;

export function envName(suffix: string): string {
  return ENV_PREFIX + suffix;
}

export function envNameLegacy(suffix: string): string {
  return ENV_PREFIX_LEGACY + suffix;
}

/** Prefer new env key, then legacy DVDJS_*. */
export function envRaw(suffix: string): string | undefined {
  var modern = process.env[envName(suffix)];
  if (modern !== undefined && modern !== '') {
    return modern;
  }
  var legacy = process.env[envNameLegacy(suffix)];
  if (legacy !== undefined && legacy !== '') {
    return legacy;
  }
  return undefined;
}
