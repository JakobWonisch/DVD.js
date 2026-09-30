/**
 * Recovery helpers when menu/title media fails or never arrives.
 * Prefer the authored next step (finish segment / onPost); fall back to main menu.
 */

import { goToMainMenu } from './goToMainMenu.js';
import { scheduleMenuPostAfterStill } from './titleUnavailable.js';
import { clearMediaLoad } from './mediaLoadState.js';
import { warn } from './viewerDebug.js';

type RecoverHost = HTMLElement & {
  _dvdjsFinishMenuSegment?: (() => void) | null;
  _dvdjsMenuPost?: (() => void) | null;
  _dvdjsStillTimer?: ReturnType<typeof setTimeout> | null;
  _dvdjsMenuPlayGen?: number;
  goToMainMenu?: () => boolean;
};

/**
 * Advance past a failed/missing segment.
 * Order: active motion finish → PGC/cell onPost → goToMainMenu.
 */
export function recoverAfterMediaFailure(
  host: RecoverHost,
  reason: string,
  details?: unknown,
): void {
  warn('safety', reason, details);
  clearMediaLoad();

  const finish = host._dvdjsFinishMenuSegment;
  if (typeof finish === 'function') {
    try {
      finish();
      return;
    } catch (e) {
      warn('safety', 'finishSegment threw', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const post = host._dvdjsMenuPost;
  if (typeof post === 'function') {
    try {
      scheduleMenuPostAfterStill(host, 0, post);
      return;
    } catch (e) {
      warn('safety', 'onPost threw', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  try {
    if (typeof host.goToMainMenu === 'function') {
      host.goToMainMenu();
    } else {
      goToMainMenu(host as any);
    }
  } catch (e) {
    warn('safety', 'goToMainMenu failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** True when this cell should auto-advance without user input if media fails. */
export function cellShouldAutoAdvanceOnMediaFail(opts: {
  still_time?: number;
  buttons?: unknown[] | null;
}): boolean {
  const stillTime = opts.still_time != null ? opts.still_time : 0;
  if (stillTime === 255) {
    // Infinite still — user must pick a button; keep hold frame.
    return false;
  }
  if (stillTime > 0 && stillTime < 255) {
    // Timed still (copyright / auto page) — must post even without PNG.
    return true;
  }
  // still_time 0: advance when there are no interactive buttons (wipe / dead end).
  return !(opts.buttons && opts.buttons.length > 0);
}
