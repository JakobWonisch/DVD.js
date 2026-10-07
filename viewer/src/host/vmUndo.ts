/**
 * User-facing undo stack for menu/VM navigation.
 *
 * Each entry is a MenuResumeSnapshot (~1–2 KB): GPRM/SPRM + nav + menu id.
 * Default cap 64 ≈ 64–128 KB — enough for a long browse; “infinite” undos
 * (e.g. 10k clicks) would still only be tens of MB and is fine in a tab,
 * but a hard cap avoids growth if something loops.
 */

import {
  applyMenuResumeSnapshot,
  buildMenuResumeSnapshot,
  type MenuResumeSnapshot,
  type MissingTitleSkipHost,
} from './titleUnavailable.js';
import { clearMediaLoad } from './mediaLoadState.js';

/** Reasonable default: ~100 KB worst-case, plenty of button undos. */
export const VM_UNDO_MAX = 64;

export type VmUndoHost = MissingTitleSkipHost & {
  _dvdjsVmUndo?: MenuResumeSnapshot[];
  _dvdjsStillTimer?: ReturnType<typeof setTimeout> | null;
  _dvdjsHighlightTimer?: ReturnType<typeof setTimeout> | null;
  _dvdjsMotionWatchdog?: ReturnType<typeof setTimeout> | null;
  _dvdjsMenuPost?: (() => void) | null;
  _dvdjsFinishMenuSegment?: (() => void) | null;
  _dvdjsMenuPlayGen?: number;
  _dvdjsRevealRetryTimer?: ReturnType<typeof setTimeout> | null;
  _dvdjsMotionRaf?: number | null;
  querySelectorAll?: (selectors: string) => NodeListOf<Element> | Element[];
};

function stack(host: VmUndoHost): MenuResumeSnapshot[] {
  if (!host._dvdjsVmUndo) {
    host._dvdjsVmUndo = [];
  }
  return host._dvdjsVmUndo;
}

export function clearVmUndo(host: VmUndoHost): void {
  if (host._dvdjsVmUndo) {
    host._dvdjsVmUndo.length = 0;
  }
}

export function vmUndoDepth(host: VmUndoHost): number {
  return host._dvdjsVmUndo?.length ?? 0;
}

export function canVmUndo(host: VmUndoHost): boolean {
  return vmUndoDepth(host) > 0;
}

/** Estimate bytes for diagnostics (JSON of stack). */
export function estimateVmUndoBytes(host: VmUndoHost): number {
  try {
    return JSON.stringify(host._dvdjsVmUndo || []).length;
  } catch {
    return vmUndoDepth(host) * 1500;
  }
}

/**
 * Push current VM/menu state. Called before user-initiated nav (button,
 * Main menu). Caps at VM_UNDO_MAX (drops oldest).
 */
export function pushVmUndo(
  host: VmUndoHost,
  g: Parameters<typeof buildMenuResumeSnapshot>[1] = typeof window !==
  'undefined'
    ? (window as any)
    : {},
  max = VM_UNDO_MAX,
): MenuResumeSnapshot {
  const snap = buildMenuResumeSnapshot(host, g);
  const s = stack(host);
  s.push(snap);
  while (s.length > max) {
    s.shift();
  }
  return snap;
}

function cancelHostMenuAdvance(host: VmUndoHost): void {
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
  host._dvdjsMenuPost = null;
  host._dvdjsFinishMenuSegment = null;
  host._dvdjsMenuPlayGen = (host._dvdjsMenuPlayGen || 0) + 1;
  clearMediaLoad();
  // Title WebMs sit above menus in the DOM — hide them when restoring a menu.
  if (typeof host.querySelectorAll === 'function') {
    try {
      host.querySelectorAll('video[id^="video-"]').forEach((node) => {
        const v = node as HTMLVideoElement;
        try {
          v.pause();
        } catch {
          // ignore
        }
        v.style.display = 'none';
        v.hidden = true;
      });
    } catch {
      // ignore
    }
  }
}

/**
 * Pop and restore the previous user nav state.
 * Returns true when a snapshot was applied.
 */
export function undoVmNav(
  host: VmUndoHost,
  g: Parameters<typeof applyMenuResumeSnapshot>[2] = typeof window !==
  'undefined'
    ? (window as any)
    : {},
): boolean {
  const s = stack(host);
  const snap = s.pop();
  if (!snap) {
    return false;
  }
  cancelHostMenuAdvance(host);
  host._dvdjsFromButton = false;
  host._dvdjsMenuResume = null;
  applyMenuResumeSnapshot(host, snap, g);
  return true;
}

/**
 * Restore without popping (crash “go back” may re-use the same entry if
 * undo already matches the pre-crash latch). Prefers stack top, else
 * host._dvdjsMenuResume.
 */
export function restoreLastVmNav(
  host: VmUndoHost,
  g: Parameters<typeof applyMenuResumeSnapshot>[2] = typeof window !==
  'undefined'
    ? (window as any)
    : {},
): boolean {
  const s = stack(host);
  const fromStack = s.length ? s[s.length - 1]! : null;
  const snap = fromStack || host._dvdjsMenuResume || null;
  if (!snap) {
    return false;
  }
  cancelHostMenuAdvance(host);
  if (fromStack) {
    s.pop();
  }
  host._dvdjsFromButton = false;
  host._dvdjsMenuResume = null;
  applyMenuResumeSnapshot(host, snap, g);
  return true;
}
