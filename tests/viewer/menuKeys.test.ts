import { describe, expect, it } from 'vitest';
import { findSpatialNeighbor } from '../../viewer/src/host/menuKeys.ts';

function fakeButton(top: number, left = 100): HTMLInputElement {
  const btn = {
    getBoundingClientRect: () => ({
      left,
      top,
      width: 200,
      height: 40,
      right: left + 200,
      bottom: top + 40,
      x: left,
      y: top,
      toJSON() {
        return {};
      },
    }),
  } as unknown as HTMLInputElement;
  return btn;
}

describe('findSpatialNeighbor', () => {
  const buttons = [
    fakeButton(100),
    fakeButton(160),
    fakeButton(220),
    fakeButton(280),
  ];

  it('walks down a vertical stack', () => {
    expect(findSpatialNeighbor(buttons, 0, 'down')).toBe(1);
    expect(findSpatialNeighbor(buttons, 1, 'down')).toBe(2);
    expect(findSpatialNeighbor(buttons, 2, 'down')).toBe(3);
    expect(findSpatialNeighbor(buttons, 3, 'down')).toBe(null);
  });

  it('walks up a vertical stack', () => {
    expect(findSpatialNeighbor(buttons, 3, 'up')).toBe(2);
    expect(findSpatialNeighbor(buttons, 0, 'up')).toBe(null);
  });
});
