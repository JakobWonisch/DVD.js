import { describe, expect, it } from 'vitest';

import {
  TITLE_INCLUDE_MAX_BYTES,
  TITLE_INCLUDE_MAX_SEC,
  isShortTitleCellDuration,
  maxTitlePgcDurationSec,
  shouldIncludeTitleVobGroup,
  shouldKeepTitleVobsForRip,
} from '../../src/server/convert/titleIncludePolicy.js';

/** BCD time helpers — hour/minute/second stored as hex digits (DVD convention). */
function bcdTime(hour: number, minute: number, second: number) {
  return {
    hour: parseInt(String(hour), 16),
    minute: parseInt(String(minute), 16),
    second: parseInt(String(second), 16),
    frame_u: 0x40, // 25 fps marker, 0 frames
  };
}

describe('TITLE_INCLUDE_MAX_SEC', () => {
  it('is 60 seconds', () => {
    expect(TITLE_INCLUDE_MAX_SEC).toBe(60);
  });
});

describe('isShortTitleCellDuration', () => {
  it('accepts positive durations at or under the cap', () => {
    expect(isShortTitleCellDuration(60)).toBe(true);
    expect(isShortTitleCellDuration(0.5)).toBe(true);
  });

  it('rejects zero, negative, and over-cap', () => {
    expect(isShortTitleCellDuration(0)).toBe(false);
    expect(isShortTitleCellDuration(60.1)).toBe(false);
  });
});

describe('maxTitlePgcDurationSec', () => {
  it('returns 0 for missing tables', () => {
    expect(maxTitlePgcDurationSec(null)).toBe(0);
    expect(maxTitlePgcDurationSec({})).toBe(0);
    expect(maxTitlePgcDurationSec({ pgci_srp: [] })).toBe(0);
  });

  it('returns the longest title PGC playback time', () => {
    var sec = maxTitlePgcDurationSec({
      pgci_srp: [
        { pgc: { playback_time: bcdTime(0, 0, 30) } },
        { pgc: { playback_time: bcdTime(0, 1, 30) } },
        { pgc: { playback_time: bcdTime(0, 0, 45) } },
      ],
    });
    expect(sec).toBe(90);
  });
});

describe('shouldIncludeTitleVobGroup', () => {
  it('always includes menu VOBs and --full titles', () => {
    expect(
      shouldIncludeTitleVobGroup({
        full: false,
        isMenuVob: true,
        durationSec: 9999,
      })
    ).toBe(true);
    expect(
      shouldIncludeTitleVobGroup({
        full: true,
        isMenuVob: false,
        durationSec: 9999,
      })
    ).toBe(true);
  });

  it('includes short title sets at or under the cap', () => {
    expect(
      shouldIncludeTitleVobGroup({
        full: false,
        isMenuVob: false,
        durationSec: 60,
      })
    ).toBe(true);
  });

  it('omits long or unknown title sets in menus mode', () => {
    expect(
      shouldIncludeTitleVobGroup({
        full: false,
        isMenuVob: false,
        durationSec: 60.1,
      })
    ).toBe(false);
    expect(
      shouldIncludeTitleVobGroup({
        full: false,
        isMenuVob: false,
        durationSec: 0,
      })
    ).toBe(false);
  });
});

describe('shouldKeepTitleVobsForRip', () => {
  it('keeps title VOBs within the byte budget', () => {
    expect(shouldKeepTitleVobsForRip(1)).toBe(true);
    expect(shouldKeepTitleVobsForRip(TITLE_INCLUDE_MAX_BYTES)).toBe(true);
  });

  it('prunes empty or over-budget groups', () => {
    expect(shouldKeepTitleVobsForRip(0)).toBe(false);
    expect(shouldKeepTitleVobsForRip(TITLE_INCLUDE_MAX_BYTES + 1)).toBe(false);
  });
});
