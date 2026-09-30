import { describe, expect, it, vi } from 'vitest';
import { goToMainMenu } from '../../viewer/src/host/goToMainMenu.ts';

function fakeHost(partial: Record<string, unknown> = {}) {
  return {
    querySelector: () => null,
    ...partial,
  } as any;
}

describe('goToMainMenu', () => {
  it('returns false when onmenu is missing', () => {
    expect(goToMainMenu(fakeHost())).toBe(false);
  });

  it('cancels still wait without running post, then calls onmenu', () => {
    const post = vi.fn();
    const onmenu = vi.fn();
    const host = fakeHost({
      onmenu,
      _dvdjsStillTimer: setTimeout(() => {}, 60_000),
      _dvdjsMenuPost: post,
    });

    expect(goToMainMenu(host)).toBe(true);
    expect(post).not.toHaveBeenCalled();
    expect(host._dvdjsStillTimer).toBeNull();
    expect(host._dvdjsMenuPost).toBeNull();
    expect(onmenu).toHaveBeenCalledOnce();
  });

  it('drops pending motion finish without running it', () => {
    const finish = vi.fn();
    const onmenu = vi.fn();
    const host = fakeHost({
      onmenu,
      _dvdjsFinishMenuSegment: finish,
      _dvdjsMenuSegmentEnd: 12,
    });

    expect(goToMainMenu(host)).toBe(true);
    expect(finish).not.toHaveBeenCalled();
    expect(host._dvdjsFinishMenuSegment).toBeNull();
    expect(host._dvdjsMenuSegmentEnd).toBeNull();
    expect(onmenu).toHaveBeenCalledOnce();
  });

  it('hides the title-unavailable overlay', () => {
    const overlay = {
      hidden: false,
      style: { display: 'flex' },
    };
    const onmenu = vi.fn();
    const host = fakeHost({
      onmenu,
      querySelector: (sel: string) =>
        sel === '.dvd-menu-archive-title-unavailable' ? overlay : null,
    });

    expect(goToMainMenu(host)).toBe(true);
    expect(overlay.hidden).toBe(true);
    expect(overlay.style.display).toBe('none');
  });
});
