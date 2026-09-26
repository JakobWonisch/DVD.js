import { describe, expect, it } from 'vitest';

import { isMenuVob } from '../../src/server/utils/index.ts';

describe('isMenuVob', () => {
  it('accepts VIDEO_TS.VOB and VTS_*_0.VOB', () => {
    expect(isMenuVob('/disc/VIDEO_TS/VIDEO_TS.VOB')).toBe(true);
    expect(isMenuVob('/disc/VIDEO_TS/VTS_01_0.VOB')).toBe(true);
    expect(isMenuVob('/disc/VIDEO_TS/VTS_12_0.vob')).toBe(true);
  });

  it('rejects title VOBs', () => {
    expect(isMenuVob('/disc/VIDEO_TS/VTS_01_1.VOB')).toBe(false);
    expect(isMenuVob('/disc/VIDEO_TS/VTS_01_9.VOB')).toBe(false);
  });
});
