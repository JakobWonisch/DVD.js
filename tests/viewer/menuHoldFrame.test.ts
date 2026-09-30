import { describe, expect, it, vi } from 'vitest';
import {
  captureMenuHoldFrame,
  captureMenuHoldFromStage,
  ensureMenuHoldCanvas,
  hideMenuHoldFrame,
  MENU_HOLD_CLASS,
  menuHoldFrameVisible,
  showMenuHoldFrame,
} from '../../viewer/src/host/menuHoldFrame.ts';

/** Minimal host for node env (no happy-dom) — mirrors other viewer tests. */
function fakeHost(existing?: HTMLCanvasElement | null) {
  let canvas = existing ?? null;
  const host = {
    querySelector(sel: string) {
      if (
        sel === `:scope > canvas.${MENU_HOLD_CLASS}` ||
        sel === `canvas.${MENU_HOLD_CLASS}`
      ) {
        return canvas;
      }
      return null;
    },
    appendChild(node: HTMLCanvasElement) {
      canvas = node;
      return node;
    },
  } as unknown as HTMLElement;
  return { host, getCanvas: () => canvas };
}

describe('menuHoldFrame', () => {
  it('creates a hidden canvas on the host', () => {
    const created: HTMLCanvasElement[] = [];
    const orig = globalThis.document;
    (globalThis as any).document = {
      createElement(tag: string) {
        if (tag !== 'canvas') {
          throw new Error(`unexpected ${tag}`);
        }
        const el = {
          className: '',
          hidden: false,
          width: 0,
          height: 0,
          style: { opacity: '', display: '' },
          setAttribute: vi.fn(),
          getContext: vi.fn(() => null),
        };
        created.push(el as unknown as HTMLCanvasElement);
        return el;
      },
    };
    try {
      const { host, getCanvas } = fakeHost();
      const canvas = ensureMenuHoldCanvas(host);
      expect(canvas.className).toBe(MENU_HOLD_CLASS);
      expect(canvas.hidden).toBe(true);
      expect(getCanvas()).toBe(canvas);
      expect(created).toHaveLength(1);
    } finally {
      (globalThis as any).document = orig;
    }
  });

  it('show/hide toggles visibility when bitmap exists', () => {
    const canvas = {
      className: MENU_HOLD_CLASS,
      hidden: true,
      width: 8,
      height: 8,
      style: { opacity: '', display: '' },
      setAttribute: vi.fn(),
      getContext: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const { host } = fakeHost(canvas);

    showMenuHoldFrame(host);
    expect(menuHoldFrameVisible(host)).toBe(true);
    hideMenuHoldFrame(host);
    expect(menuHoldFrameVisible(host)).toBe(false);
    showMenuHoldFrame(host);
    expect(menuHoldFrameVisible(host)).toBe(true);
  });

  it('captureMenuHoldFrame draws from an image and can stay hidden', () => {
    const drawImage = vi.fn();
    const canvas = {
      className: MENU_HOLD_CLASS,
      hidden: true,
      width: 0,
      height: 0,
      style: { opacity: '', display: '' },
      setAttribute: vi.fn(),
      getContext: vi.fn(() => ({ drawImage })),
    } as unknown as HTMLCanvasElement;
    const { host } = fakeHost(canvas);
    const img = {
      naturalWidth: 16,
      naturalHeight: 9,
    } as HTMLImageElement;

    expect(captureMenuHoldFrame(host, img, { show: false })).toBe(true);
    expect(drawImage).toHaveBeenCalled();
    expect(canvas.width).toBe(16);
    expect(canvas.height).toBe(9);
    expect(canvas.hidden).toBe(true);

    expect(captureMenuHoldFrame(host, img, { show: true })).toBe(true);
    expect(menuHoldFrameVisible(host)).toBe(true);
  });

  it('captureMenuHoldFromStage prefers a visible video frame', () => {
    const drawImage = vi.fn();
    const canvas = {
      className: MENU_HOLD_CLASS,
      hidden: true,
      width: 0,
      height: 0,
      style: { opacity: '', display: '' },
      setAttribute: vi.fn(),
      getContext: vi.fn(() => ({ drawImage })),
    } as unknown as HTMLCanvasElement;
    const { host } = fakeHost(canvas);
    const video = {
      hidden: false,
      style: { opacity: '' },
      readyState: 2,
      videoWidth: 32,
      videoHeight: 24,
    } as unknown as HTMLVideoElement;

    expect(
      captureMenuHoldFromStage(host, { menuVideo: video, still: null }),
    ).toBe(true);
    expect(drawImage).toHaveBeenCalled();
    expect(menuHoldFrameVisible(host)).toBe(true);
  });

  it('captureMenuHoldFromStage falls back to a prior bitmap', () => {
    const canvas = {
      className: MENU_HOLD_CLASS,
      hidden: true,
      width: 4,
      height: 4,
      style: { opacity: '', display: '' },
      setAttribute: vi.fn(),
      getContext: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const { host } = fakeHost(canvas);

    expect(
      captureMenuHoldFromStage(host, { menuVideo: null, still: null }),
    ).toBe(true);
    expect(menuHoldFrameVisible(host)).toBe(true);
  });
});
