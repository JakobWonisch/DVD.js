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

export const AUTOPLAY_BLOCKED_EVENT = 'dvd-menu-archive-autoplay-blocked';

export type AutoplayHost = HTMLElement & {
  _dvdjsAudioUnlocked?: boolean;
  /** Set by suspendDiscPlayback while the mobile drawer is collapsed. */
  _dvdjsPlaybackSuspended?: boolean;
};

function hostPlaybackSuspended(host: AutoplayHost | null | undefined): boolean {
  return !!(host && host._dvdjsPlaybackSuspended);
}

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

/** Linear volume ramp after forcing silence on clip start / unmute. */
export const AUDIO_FADE_IN_MS = 50;

const audioFadeTimers = new WeakMap<
  HTMLMediaElement,
  ReturnType<typeof setTimeout>
>();
const preferredVolume = new WeakMap<HTMLMediaElement, number>();

function targetVolumeFor(video: HTMLMediaElement): number {
  const remembered = preferredVolume.get(video);
  if (remembered != null && remembered > 0.05) {
    return remembered;
  }
  if (Number.isFinite(video.volume) && video.volume > 0.05) {
    return video.volume;
  }
  return 1;
}

function rememberPreferredVolume(video: HTMLMediaElement): void {
  if (Number.isFinite(video.volume) && video.volume > 0.05) {
    preferredVolume.set(video, video.volume);
  }
}

/** Stop an in-flight volume ramp (mute / seek cover / new clip). */
export function cancelVideoAudioFade(video: HTMLMediaElement): void {
  const timer = audioFadeTimers.get(video);
  if (timer != null) {
    clearTimeout(timer);
    audioFadeTimers.delete(video);
  }
}

/** Hard-silence a clip (seek cover, segment end). Volume + muted. */
export function silenceVideoAudio(video: HTMLMediaElement): void {
  cancelVideoAudioFade(video);
  rememberPreferredVolume(video);
  video.volume = 0;
  video.muted = true;
}

/**
 * Force volume to 0, unmute, then ramp linearly to full over ~50ms.
 */
export function fadeInVideoAudio(
  video: HTMLMediaElement,
  durationMs: number = AUDIO_FADE_IN_MS,
): void {
  const host =
    typeof (video as HTMLElement).closest === 'function'
      ? ((video as HTMLElement).closest('x-video') as AutoplayHost | null)
      : null;
  if (hostPlaybackSuspended(host)) {
    silenceVideoAudio(video);
    return;
  }
  cancelVideoAudioFade(video);
  const target = targetVolumeFor(video);
  preferredVolume.set(video, target);
  video.volume = 0;
  video.muted = false;
  if (!(durationMs > 0)) {
    video.volume = target;
    return;
  }
  const start = performance.now();
  const stepMs = 10;
  const tick = () => {
    const t = Math.min(1, (performance.now() - start) / durationMs);
    video.volume = target * t;
    if (t < 1) {
      audioFadeTimers.set(video, setTimeout(tick, stepMs));
    } else {
      audioFadeTimers.delete(video);
      video.volume = target;
    }
  };
  // Start the ramp on the next timer tick so volume=0 is committed first.
  audioFadeTimers.set(video, setTimeout(tick, stepMs));
}

/**
 * Try unmuted play; on rejection try muted play and unmute if unlocked.
 * @returns whether playback started
 */
export async function playWithAutoplayFallback(
  video: HTMLVideoElement,
  host: AutoplayHost,
  opts: { startMuted?: boolean } = {},
): Promise<boolean> {
  if (hostPlaybackSuspended(host)) {
    silenceVideoAudio(video);
    try {
      video.pause();
    } catch {
      // ignore
    }
    return false;
  }

  if (opts.startMuted) {
    // Menu seek cover: play under an opaque hold without leaking audio.
    try {
      silenceVideoAudio(video);
      await video.play();
      if (hostPlaybackSuspended(host)) {
        silenceVideoAudio(video);
        try {
          video.pause();
        } catch {
          // ignore
        }
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  try {
    cancelVideoAudioFade(video);
    rememberPreferredVolume(video);
    video.volume = 0;
    video.muted = false;
    await video.play();
    if (hostPlaybackSuspended(host)) {
      silenceVideoAudio(video);
      try {
        video.pause();
      } catch {
        // ignore
      }
      return false;
    }
    fadeInVideoAudio(video);
    return true;
  } catch {
    video.volume = targetVolumeFor(video);
  }

  try {
    silenceVideoAudio(video);
    await video.play();
    if (hostPlaybackSuspended(host)) {
      silenceVideoAudio(video);
      try {
        video.pause();
      } catch {
        // ignore
      }
      return false;
    }
    if (host._dvdjsAudioUnlocked) {
      fadeInVideoAudio(video);
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
