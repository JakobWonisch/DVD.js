/**
 * Skip the active menu motion segment, timed still wait, or title clip.
 * Returns true if something was skipped.
 */

export type SkipToEndHost = {
  playlist?: Array<{ video: HTMLVideoElement }>;
  videoIndex?: number;
  querySelector: (selectors: string) => Element | null;
  _dvdjsActiveMenu?: HTMLElement | null;
  _dvdjsMenuSegmentEnd?: number | null;
  _dvdjsFinishMenuSegment?: (() => void) | null;
  _dvdjsStillTimer?: ReturnType<typeof setTimeout> | null;
  _dvdjsMenuPost?: (() => void) | null;
};

function activeMenuVideo(host: SkipToEndHost): HTMLVideoElement | null {
  const menu = host._dvdjsActiveMenu;
  const domain = menu?.dataset?.domain;
  if (domain == null || domain === '') {
    return null;
  }
  return host.querySelector(
    `#menu-video-${String(domain)}`,
  ) as HTMLVideoElement | null;
}

function currentTitleVideo(host: SkipToEndHost): HTMLVideoElement | null {
  const list = host.playlist;
  const idx = host.videoIndex;
  if (!list || idx == null || idx < 0 || idx >= list.length) {
    return null;
  }
  return list[idx]?.video ?? null;
}

export function skipPlaybackToEnd(host: SkipToEndHost): boolean {
  const finish = host._dvdjsFinishMenuSegment;
  const menuVideo = activeMenuVideo(host);
  const segmentEnd = host._dvdjsMenuSegmentEnd;

  if (typeof finish === 'function') {
    if (
      menuVideo &&
      typeof segmentEnd === 'number' &&
      Number.isFinite(segmentEnd) &&
      menuVideo.currentTime >= segmentEnd - 0.05
    ) {
      return false;
    }
    if (
      menuVideo &&
      typeof segmentEnd === 'number' &&
      Number.isFinite(segmentEnd)
    ) {
      try {
        menuVideo.currentTime = Math.max(0, segmentEnd - 0.05);
      } catch {
        // ignore seek errors; finish still advances VM / holds last frame
      }
    }
    finish();
    return true;
  }

  // Timed still menu waiting for post(): skip the wait.
  if (host._dvdjsStillTimer && typeof host._dvdjsMenuPost === 'function') {
    clearTimeout(host._dvdjsStillTimer);
    host._dvdjsStillTimer = null;
    const post = host._dvdjsMenuPost;
    host._dvdjsMenuPost = null;
    try {
      post();
    } catch (e) {
      console.warn('DVD.js menu post failed', e);
    }
    return true;
  }

  const video = currentTitleVideo(host);
  if (
    video &&
    !video.paused &&
    !video.ended &&
    Number.isFinite(video.duration) &&
    video.duration > 0
  ) {
    if (video.currentTime >= video.duration - 0.1) {
      return false;
    }
    try {
      video.currentTime = Math.max(0, video.duration - 0.05);
    } catch {
      return false;
    }
    return true;
  }

  return false;
}
