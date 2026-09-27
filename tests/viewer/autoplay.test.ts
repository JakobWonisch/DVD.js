import { describe, expect, it, vi } from 'vitest';
import {
  AUTOPLAY_BLOCKED_EVENT,
  notifyAutoplayBlocked,
  pageHasUserGesture,
  playWithAutoplayFallback,
  unlockDvdAudio,
  type AutoplayHost,
} from '../../viewer/src/host/autoplay.js';

function fakeHost(): AutoplayHost {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    _dvdjsAudioUnlocked: false,
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    dispatchEvent(ev: Event) {
      for (const fn of listeners.get(ev.type) || []) {
        fn(ev);
      }
      return true;
    },
  } as unknown as AutoplayHost;
}

describe('autoplay helpers', () => {
  it('pageHasUserGesture reads sticky userActivation when present', () => {
    const nav = globalThis.navigator as Navigator & {
      userActivation?: { hasBeenActive: boolean };
    };
    const prev = nav.userActivation;
    Object.defineProperty(nav, 'userActivation', {
      configurable: true,
      value: { hasBeenActive: true, isActive: false },
    });
    expect(pageHasUserGesture()).toBe(true);
    Object.defineProperty(nav, 'userActivation', {
      configurable: true,
      value: { hasBeenActive: false, isActive: false },
    });
    expect(pageHasUserGesture()).toBe(false);
    Object.defineProperty(nav, 'userActivation', {
      configurable: true,
      value: prev,
    });
  });

  it('notifies via CustomEvent', () => {
    const host = fakeHost();
    const spy = vi.fn();
    host.addEventListener(AUTOPLAY_BLOCKED_EVENT, spy);
    notifyAutoplayBlocked(host);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('plays unmuted when allowed', async () => {
    const host = fakeHost();
    const video = {
      muted: true,
      play: vi.fn(async () => undefined),
    } as unknown as HTMLVideoElement;
    const ok = await playWithAutoplayFallback(video, host);
    expect(ok).toBe(true);
    expect(video.muted).toBe(false);
    expect(video.play).toHaveBeenCalledOnce();
  });

  it('falls back to muted play then unmutes when unlocked', async () => {
    const host = fakeHost();
    unlockDvdAudio(host);
    let calls = 0;
    const video = {
      muted: false,
      play: vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          throw new DOMException('blocked', 'NotAllowedError');
        }
      }),
    } as unknown as HTMLVideoElement;
    const ok = await playWithAutoplayFallback(video, host);
    expect(ok).toBe(true);
    expect(video.play).toHaveBeenCalledTimes(2);
    expect(video.muted).toBe(false);
  });

  it('returns false when all play attempts fail', async () => {
    const host = fakeHost();
    const video = {
      muted: false,
      play: vi.fn(async () => {
        throw new DOMException('blocked', 'NotAllowedError');
      }),
    } as unknown as HTMLVideoElement;
    const ok = await playWithAutoplayFallback(video, host);
    expect(ok).toBe(false);
  });
});
