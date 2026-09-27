/**
 * Browser autoplay policy helpers for menu / title video.
 *
 * Hard refresh / async VM boot has no user gesture, so unmuted play() is
 * rejected. After the user presses Start we mark audio unlocked; delayed
 * setTimeout chains (fp_pgc) may still need a muted→unmute fallback.
 *
 * Navigating from the catalogue with a click sets sticky userActivation, so
 * we can auto-start without a Start overlay (and only show it if play is still
 * blocked).
 */

export const AUTOPLAY_BLOCKED_EVENT = 'dvdjs-autoplay-blocked';

export type AutoplayHost = HTMLElement & {
  _dvdjsAudioUnlocked?: boolean;
};

/** True after any click/key/tap on this document (Chrome/Firefox/Safari sticky flag). */
export function pageHasUserGesture(): boolean {
  try {
    return !!navigator.userActivation?.hasBeenActive;
  } catch {
    return false;
  }
}

export function unlockDvdAudio(host: AutoplayHost) {
  host._dvdjsAudioUnlocked = true;
}

/**
 * Try unmuted play; on rejection try muted play and unmute if unlocked.
 * @returns whether playback started
 */
export async function playWithAutoplayFallback(
  video: HTMLVideoElement,
  host: AutoplayHost,
): Promise<boolean> {
  try {
    video.muted = false;
    await video.play();
    return true;
  } catch {
    // fall through
  }

  try {
    video.muted = true;
    await video.play();
    if (host._dvdjsAudioUnlocked) {
      video.muted = false;
    }
    return true;
  } catch {
    return false;
  }
}

export function notifyAutoplayBlocked(host: AutoplayHost) {
  host.dispatchEvent(
    new CustomEvent(AUTOPLAY_BLOCKED_EVENT, { bubbles: true }),
  );
}
