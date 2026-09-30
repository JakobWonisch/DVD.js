/**
 * Opt-in viewer console diagnostics for production black-screen / extract issues.
 *
 * Enable any of:
 *   ?dvd-menu-archive-debug=1
 *   localStorage['dvd-menu-archive-debug'] = '1'
 *   window.dvdMenuArchiveDebug = true
 *   toolbar “Console debug”
 *
 * Legacy: ?dvdjsDebug=1 / localStorage.dvdjsDebug
 */

import {
  DEBUG_QUERY_PARAM,
  DEBUG_QUERY_PARAM_LEGACY,
  DEBUG_STORAGE_KEY,
  DEBUG_STORAGE_KEY_LEGACY,
  DEBUG_WINDOW_FLAG,
  LOG_TAG,
  CSS,
  readStoragePrefer,
  writeStorage,
} from '../projectId.js';
import { pushSessionLog } from './sessionLog.js';

export function isViewerDebug(): boolean {
  try {
    if (typeof window === 'undefined') {
      return false;
    }
    if ((window as any)[DEBUG_WINDOW_FLAG] === true) {
      return true;
    }
    if (readStoragePrefer(DEBUG_STORAGE_KEY, DEBUG_STORAGE_KEY_LEGACY) === '1') {
      return true;
    }
    const params = new URLSearchParams(window.location.search);
    const q =
      params.get(DEBUG_QUERY_PARAM) || params.get(DEBUG_QUERY_PARAM_LEGACY);
    if (q === '1' || q === 'true') {
      return true;
    }
  } catch {
    // private mode / non-browser
  }
  return false;
}

export function setViewerDebug(on: boolean): void {
  writeStorage(DEBUG_STORAGE_KEY, on ? '1' : '0');
  try {
    (window as any)[DEBUG_WINDOW_FLAG] = on;
  } catch {
    // ignore
  }
}

function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

export function log(scope: string, message: string, data?: unknown): void {
  pushSessionLog('log', scope, message, data);
  if (!isViewerDebug()) {
    return;
  }
  const tag = `[${LOG_TAG}:${scope} ${stamp()}]`;
  if (data !== undefined) {
    console.log(tag, message, data);
  } else {
    console.log(tag, message);
  }
}

export function warn(scope: string, message: string, data?: unknown): void {
  pushSessionLog('warn', scope, message, data);
  if (!isViewerDebug()) {
    return;
  }
  const tag = `[${LOG_TAG}:${scope} ${stamp()}]`;
  if (data !== undefined) {
    console.warn(tag, message, data);
  } else {
    console.warn(tag, message);
  }
}

/** @deprecated use {@link log} */
export const dvdjsLog = log;
/** @deprecated use {@link warn} */
export const dvdjsWarn = warn;

/** Media error / network snapshot for black-screen diagnosis. */
export function videoDebugInfo(
  video: HTMLVideoElement | null | undefined,
): Record<string, unknown> | null {
  if (!video) {
    return null;
  }
  const err = video.error;
  return {
    src: video.currentSrc || video.getAttribute('src') || null,
    errorCode: err ? err.code : null,
    errorMessage:
      err && 'message' in err ? String((err as any).message || '') : null,
    networkState: video.networkState,
    readyState: video.readyState,
    currentTime: Number.isFinite(video.currentTime)
      ? +video.currentTime.toFixed(3)
      : null,
    duration: Number.isFinite(video.duration)
      ? +video.duration.toFixed(3)
      : null,
    paused: video.paused,
    muted: video.muted,
    hidden: video.hidden,
    opacity: video.style.opacity || null,
    display: video.style.display || null,
  };
}

/** Still / hold / video layer visibility — useful when the stage goes black. */
export function menuLayerDebugInfo(
  host: HTMLElement,
  menu?: HTMLElement | null,
): Record<string, unknown> {
  const active =
    menu ||
    ((host as any)._dvdjsActiveMenu as HTMLElement | null | undefined) ||
    null;
  const still = active?.querySelector(
    'img.menu-still',
  ) as HTMLImageElement | null;
  const hold = host.querySelector(
    `canvas.${CSS.menuHold}`,
  ) as HTMLCanvasElement | null;
  const menuVideo = host.querySelector(
    `video.${CSS.menuVideo}:not([hidden])`,
  ) as HTMLVideoElement | null;
  return {
    menuId: active?.id || null,
    domain: active?.dataset?.domain || null,
    cell: active?.dataset?.cell || null,
    vob: active?.dataset?.vob || null,
    still: still
      ? {
          src: still.getAttribute('src'),
          complete: still.complete,
          naturalWidth: still.naturalWidth,
          opacity: still.style.opacity || null,
          display: still.style.display || null,
        }
      : null,
    hold: hold
      ? {
          display: hold.style.display || null,
          opacity: hold.style.opacity || null,
          w: hold.width,
          h: hold.height,
        }
      : null,
    video: videoDebugInfo(menuVideo),
    playGen: (host as any)._dvdjsMenuPlayGen ?? null,
  };
}

/** HEAD-probe a menu asset URL (404 / auth / extract race). */
export async function probeAsset(
  url: string | null | undefined,
  label: string,
): Promise<void> {
  if (!isViewerDebug() || !url) {
    return;
  }
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    const info = {
      url,
      status: res.status,
      contentType: res.headers.get('content-type'),
      contentLength: res.headers.get('content-length'),
    };
    if (res.ok) {
      log('asset', `${label} OK`, info);
    } else {
      warn('asset', `${label} HTTP ${res.status}`, info);
    }
  } catch (e) {
    warn('asset', `${label} HEAD failed`, {
      url,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** @deprecated use {@link probeAsset} */
export const dvdjsProbeAsset = probeAsset;
