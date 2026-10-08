import { describe, expect, it, vi } from 'vitest';
import { playWithAutoplayFallback } from '../../viewer/src/host/autoplay.js';
import {
  haltDiscPlayback,
  isDiscPlaybackSuspended,
  resumeDiscPlayback,
  silenceAllDiscMedia,
  suspendDiscPlayback,
  type HaltPlaybackHost,
} from '../../viewer/src/host/haltPlayback.js';

function fakeVideo(overrides: Partial<HTMLVideoElement> = {}): HTMLVideoElement {
  return {
    muted: false,
    volume: 1,
    paused: false,
    hidden: false,
    style: { display: '', opacity: '' } as CSSStyleDeclaration,
    pause: vi.fn(),
    removeAttribute: vi.fn(),
    load: vi.fn(),
    firstChild: null,
    removeChild: vi.fn(),
    ...overrides,
  } as unknown as HTMLVideoElement;
}

function fakeHost(videos: HTMLVideoElement[]): HaltPlaybackHost {
  const host = {
    _dvdjsPlaybackSuspended: false,
    _dvdjsStillTimer: null as ReturnType<typeof setTimeout> | null,
    _dvdjsMenuPost: null as (() => void) | null,
    _dvdjsFinishMenuSegment: null as (() => void) | null,
    _dvdjsMenuPlayGen: 0,
    pause: vi.fn(),
    querySelector() {
      return null;
    },
    querySelectorAll(sel: string) {
      if (sel.includes('video') || sel.includes('audio')) {
        return videos as unknown as NodeListOf<Element>;
      }
      return [] as unknown as NodeListOf<Element>;
    },
  };
  return host as unknown as HaltPlaybackHost;
}

describe('haltPlayback', () => {
  it('silenceAllDiscMedia pauses and mutes every video', () => {
    const v1 = fakeVideo();
    const v2 = fakeVideo();
    const host = fakeHost([v1, v2]);
    silenceAllDiscMedia(host);
    expect(host.pause).toHaveBeenCalledOnce();
    expect(v1.pause).toHaveBeenCalledOnce();
    expect(v2.pause).toHaveBeenCalledOnce();
    expect(v1.muted).toBe(true);
    expect(v1.volume).toBe(0);
    expect(v2.muted).toBe(true);
  });

  it('suspendDiscPlayback sets flag, silences media, keeps still posts', () => {
    const video = fakeVideo();
    const host = fakeHost([video]);
    const post = vi.fn();
    const stillTimer = setTimeout(() => {}, 60_000);
    host._dvdjsMenuPost = post;
    host._dvdjsFinishMenuSegment = vi.fn();
    host._dvdjsStillTimer = stillTimer;
    const genBefore = host._dvdjsMenuPlayGen || 0;

    suspendDiscPlayback(host);

    expect(isDiscPlaybackSuspended(host)).toBe(true);
    expect(host._dvdjsMenuPost).toBe(post);
    expect(host._dvdjsStillTimer).toBe(stillTimer);
    expect(host._dvdjsFinishMenuSegment).toBeNull();
    expect(host._dvdjsMenuPlayGen).toBe(genBefore + 1);
    expect(video.pause).toHaveBeenCalled();
    expect(video.muted).toBe(true);
    clearTimeout(stillTimer);
  });

  it('resumeDiscPlayback clears the suspended flag', () => {
    const host = fakeHost([]);
    suspendDiscPlayback(host);
    resumeDiscPlayback(host);
    expect(isDiscPlaybackSuspended(host)).toBe(false);
  });

  it('haltDiscPlayback with resetVisuals blanks video src', () => {
    const video = fakeVideo();
    const host = fakeHost([video]);
    host._dvdjsActiveMenu = {} as HTMLElement;
    host._dvdjsLastPaintedStillSrc = 'stale.webp';

    haltDiscPlayback(host, { resetVisuals: true });

    expect(video.removeAttribute).toHaveBeenCalledWith('src');
    expect(video.load).toHaveBeenCalledOnce();
    expect(video.hidden).toBe(true);
    expect(host._dvdjsActiveMenu).toBeNull();
    expect(host._dvdjsLastPaintedStillSrc).toBeNull();
  });

  it('playWithAutoplayFallback refuses while suspended', async () => {
    const host = fakeHost([]);
    suspendDiscPlayback(host);
    const video = {
      muted: false,
      volume: 1,
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
    } as unknown as HTMLVideoElement;

    const ok = await playWithAutoplayFallback(video, host as any);
    expect(ok).toBe(false);
    expect(video.play).not.toHaveBeenCalled();
    expect(video.pause).toHaveBeenCalled();
    expect(video.muted).toBe(true);
  });
});
