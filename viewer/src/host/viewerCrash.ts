/**
 * Uncaught JS safety net while a disc is playing: sticky dialog with
 * Report (same POST /api/reports path) + Go back (VM undo / resume snap).
 */

import { pushSessionLog } from './sessionLog.js';
import { restoreLastVmNav, type VmUndoHost } from './vmUndo.js';
import { goToMainMenu } from './goToMainMenu.js';
import {
  resolveTitleUnavailableRoot,
  type TitleUnavailableMountHost,
} from './titleUnavailable.js';

export const VIEWER_CRASH_HEADING = 'Viewer crashed';
export const VIEWER_CRASH_BODY =
  'Something went wrong in the menu player. You can send a diagnostic report, then go back to the previous menu state.';
export const VIEWER_CRASH_REPORT_LABEL = 'Report a problem';
export const VIEWER_CRASH_BACK_LABEL = 'Go back';

type CrashDismiss = () => void;

export type ViewerCrashHost = TitleUnavailableMountHost &
  VmUndoHost & {
    _dvdjsViewerCrashDismiss?: CrashDismiss | null;
    _dvdjsViewerCrashKeyHandler?: ((ev: KeyboardEvent) => void) | null;
    goToMainMenu?: () => boolean;
    /** Set by PlayDisc — same path as toolbar “Report a problem”. */
    _dvdjsOnReportProblem?: () => void | Promise<void>;
  };

function unbindCrashKeys(host: ViewerCrashHost): void {
  const handler = host._dvdjsViewerCrashKeyHandler;
  if (handler && typeof document !== 'undefined') {
    document.removeEventListener('keydown', handler, true);
    host._dvdjsViewerCrashKeyHandler = null;
  }
}

/** True while the crash dialog is visible. */
export function isViewerCrashOpen(host: TitleUnavailableMountHost): boolean {
  try {
    const root = resolveTitleUnavailableRoot(host);
    const qs =
      typeof root.querySelector === 'function'
        ? root.querySelector.bind(root)
        : typeof host.querySelector === 'function'
          ? host.querySelector.bind(host)
          : null;
    if (!qs) {
      return false;
    }
    const el = qs('.dvd-menu-archive-viewer-crash') as HTMLElement | null;
    if (!el) {
      return false;
    }
    return !el.hidden && el.style?.display !== 'none';
  } catch {
    return false;
  }
}

export function hideViewerCrashOverlay(host: ViewerCrashHost): void {
  unbindCrashKeys(host);
  host._dvdjsViewerCrashDismiss = null;
  const root = resolveTitleUnavailableRoot(host);
  const el =
    (root.querySelector('.dvd-menu-archive-viewer-crash') as HTMLElement | null) ||
    (host.querySelector('.dvd-menu-archive-viewer-crash') as HTMLElement | null);
  if (el) {
    el.hidden = true;
    el.style.display = 'none';
  }
}

export function showViewerCrashOverlay(
  host: ViewerCrashHost,
  opts: {
    message?: string;
    detail?: string;
    onReport?: () => void | Promise<void>;
    onGoBack?: () => void;
  } = {},
): void {
  if (isViewerCrashOpen(host)) {
    return;
  }

  const root = resolveTitleUnavailableRoot(host);
  unbindCrashKeys(host);

  let el = root.querySelector(
    '.dvd-menu-archive-viewer-crash',
  ) as HTMLElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'dvd-menu-archive-viewer-crash';
    if (typeof root.appendChild === 'function') {
      root.appendChild(el);
    } else if (host instanceof HTMLElement) {
      host.appendChild(el);
    }
  }

  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'dvd-menu-archive-viewer-crash-heading');
  el.innerHTML =
    '<div class="dvd-menu-archive-viewer-crash__card">' +
    '<p class="dvd-menu-archive-viewer-crash__heading" id="dvd-menu-archive-viewer-crash-heading"></p>' +
    '<p class="dvd-menu-archive-viewer-crash__body"></p>' +
    '<p class="dvd-menu-archive-viewer-crash__detail" hidden></p>' +
    '<div class="dvd-menu-archive-viewer-crash__actions">' +
    '<button type="button" class="dvd-menu-archive-viewer-crash__btn dvd-menu-archive-viewer-crash__btn--report"></button>' +
    '<button type="button" class="dvd-menu-archive-viewer-crash__btn dvd-menu-archive-viewer-crash__btn--back"></button>' +
    '</div>' +
    '<p class="dvd-menu-archive-viewer-crash__status" role="status" hidden></p>' +
    '</div>';

  const heading = el.querySelector(
    '.dvd-menu-archive-viewer-crash__heading',
  ) as HTMLElement;
  const body = el.querySelector(
    '.dvd-menu-archive-viewer-crash__body',
  ) as HTMLElement;
  const detail = el.querySelector(
    '.dvd-menu-archive-viewer-crash__detail',
  ) as HTMLElement;
  const reportBtn = el.querySelector(
    '.dvd-menu-archive-viewer-crash__btn--report',
  ) as HTMLButtonElement;
  const backBtn = el.querySelector(
    '.dvd-menu-archive-viewer-crash__btn--back',
  ) as HTMLButtonElement;
  const status = el.querySelector(
    '.dvd-menu-archive-viewer-crash__status',
  ) as HTMLElement;

  heading.textContent = VIEWER_CRASH_HEADING;
  body.textContent = opts.message || VIEWER_CRASH_BODY;
  reportBtn.textContent = VIEWER_CRASH_REPORT_LABEL;
  backBtn.textContent = VIEWER_CRASH_BACK_LABEL;

  if (opts.detail) {
    detail.hidden = false;
    detail.textContent = opts.detail.slice(0, 280);
  } else {
    detail.hidden = true;
    detail.textContent = '';
  }

  const goBack = () => {
    hideViewerCrashOverlay(host);
    try {
      if (opts.onGoBack) {
        opts.onGoBack();
        return;
      }
      const g =
        typeof window !== 'undefined' ? (window as any) : ({} as object);
      if (!restoreLastVmNav(host, g)) {
        if (typeof host.goToMainMenu === 'function') {
          host.goToMainMenu();
        } else {
          goToMainMenu(host as any);
        }
      }
    } catch (e) {
      console.warn('dvd-menu-archive crash go-back failed', e);
      try {
        goToMainMenu(host as any);
      } catch {
        // ignore
      }
    }
  };

  host._dvdjsViewerCrashDismiss = goBack;

  const reportFn = opts.onReport || host._dvdjsOnReportProblem;

  reportBtn.addEventListener('click', () => {
    void (async () => {
      if (!reportFn) {
        status.hidden = false;
        status.textContent = 'Reporting is unavailable.';
        return;
      }
      reportBtn.disabled = true;
      status.hidden = false;
      status.textContent = 'Sending…';
      try {
        await reportFn();
        status.textContent = 'Thanks — report sent.';
      } catch (e) {
        status.textContent =
          e instanceof Error ? e.message : 'Could not send report.';
      } finally {
        reportBtn.disabled = false;
      }
    })();
  });

  backBtn.addEventListener('click', goBack);

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    goBack();
  };
  host._dvdjsViewerCrashKeyHandler = onKey;
  document.addEventListener('keydown', onKey, true);

  el.hidden = false;
  el.style.display = 'flex';
  try {
    backBtn.focus({ preventScroll: true });
  } catch {
    // ignore
  }
}

function errorDetail(err: unknown): string {
  if (err instanceof Error) {
    return err.stack || err.message || String(err);
  }
  return String(err);
}

export type InstallViewerCrashGuardOpts = {
  getHost: () => ViewerCrashHost | null;
  /** False while Start overlay / decompress — ignore stray errors. */
  isActive?: () => boolean;
  onReport?: () => void | Promise<void>;
};

/**
 * window error + unhandledrejection → crash dialog (once until dismissed).
 * Returns a dispose function.
 */
export function installViewerCrashGuard(
  opts: InstallViewerCrashGuardOpts,
): () => void {
  let handling = false;

  const present = (err: unknown, source: string) => {
    if (handling) {
      return;
    }
    if (opts.isActive && !opts.isActive()) {
      return;
    }
    const host = opts.getHost();
    if (!host) {
      return;
    }
    if (isViewerCrashOpen(host)) {
      return;
    }
    handling = true;
    const detail = errorDetail(err);
    pushSessionLog('error', 'crash', `uncaught ${source}`, {
      detail: detail.slice(0, 1500),
    });
    try {
      showViewerCrashOverlay(host, {
        detail: detail.split('\n')[0] || detail,
        onReport: opts.onReport,
      });
    } finally {
      // Allow a later crash after dismiss.
      queueMicrotask(() => {
        handling = false;
      });
    }
  };

  const onError = (ev: ErrorEvent) => {
    // Resource load errors (img/script src) have no error object — skip.
    if (!ev.error && !ev.message) {
      return;
    }
    // Chrome fires this as a window error during layout thrash (e.g. mobile↔desktop
    // drawer ResizeObserver). Benign — not a real player crash.
    const msg =
      (ev.message && String(ev.message)) ||
      (ev.error instanceof Error ? ev.error.message : '') ||
      '';
    if (/ResizeObserver loop/i.test(msg)) {
      return;
    }
    present(ev.error || ev.message, 'error');
  };
  const onRejection = (ev: PromiseRejectionEvent) => {
    const reason = ev.reason;
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : '';
    if (/ResizeObserver loop/i.test(msg)) {
      return;
    }
    present(reason, 'unhandledrejection');
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    const host = opts.getHost();
    if (host) {
      hideViewerCrashOverlay(host);
    }
  };
}

/** Run a user button cmd; on throw, show crash dialog instead of dying silently. */
export function runUserVmCommand(
  host: ViewerCrashHost,
  cmd: () => void,
  opts?: { onReport?: () => void | Promise<void> },
): boolean {
  try {
    cmd();
    return true;
  } catch (e) {
    pushSessionLog('error', 'crash', 'button command threw', {
      detail: errorDetail(e).slice(0, 1500),
    });
    showViewerCrashOverlay(host, {
      detail: errorDetail(e).split('\n')[0],
      onReport: opts?.onReport,
    });
    return false;
  }
}
