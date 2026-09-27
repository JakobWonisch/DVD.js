import { describe, expect, it, vi } from 'vitest';
import { skipPlaybackToEnd } from '../../viewer/src/host/skipToEnd.ts';

function fakeHost(partial: Record<string, unknown> = {}) {
  return {
    playlist: [],
    videoIndex: 0,
    querySelector: () => null,
    ...partial,
  } as any;
}

describe('skipPlaybackToEnd', () => {
  it('finishes an active menu motion segment', () => {
    const finish = vi.fn();
    const menuVideo = {
      currentTime: 1.2,
      pause: vi.fn(),
    };
    const host = fakeHost({
      _dvdjsActiveMenu: { dataset: { domain: '0' } },
      _dvdjsMenuSegmentEnd: 5,
      _dvdjsFinishMenuSegment: finish,
      querySelector: (sel: string) =>
        sel === '#menu-video-0' ? menuVideo : null,
    });

    expect(skipPlaybackToEnd(host)).toBe(true);
    expect(menuVideo.currentTime).toBeCloseTo(4.95, 5);
    expect(finish).toHaveBeenCalledOnce();
  });

  it('is a no-op when the menu segment is already at end', () => {
    const finish = vi.fn();
    const menuVideo = { currentTime: 4.96, pause: vi.fn() };
    const host = fakeHost({
      _dvdjsActiveMenu: { dataset: { domain: '0' } },
      _dvdjsMenuSegmentEnd: 5,
      _dvdjsFinishMenuSegment: finish,
      querySelector: () => menuVideo,
    });

    expect(skipPlaybackToEnd(host)).toBe(false);
    expect(finish).not.toHaveBeenCalled();
  });

  it('fires timed still post() early', () => {
    const post = vi.fn();
    const host = fakeHost({
      _dvdjsStillTimer: setTimeout(() => {}, 60_000),
      _dvdjsMenuPost: post,
    });

    expect(skipPlaybackToEnd(host)).toBe(true);
    expect(post).toHaveBeenCalledOnce();
    expect(host._dvdjsStillTimer).toBeNull();
    expect(host._dvdjsMenuPost).toBeNull();
  });

  it('seeks a playing title clip to near duration', () => {
    const video = {
      paused: false,
      ended: false,
      duration: 30,
      currentTime: 3,
    };
    const host = fakeHost({
      playlist: [{ video }],
      videoIndex: 0,
    });

    expect(skipPlaybackToEnd(host)).toBe(true);
    expect(video.currentTime).toBeCloseTo(29.95, 5);
  });
});
