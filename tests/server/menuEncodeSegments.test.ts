import { describe, expect, it } from 'vitest';
import {
  buildMenuEncodeSegments,
  menuForceKeyFrameTimes,
} from '../../src/server/convert/menuEncodeSegments.js';
import { DVD_VIDEO_LB_LEN } from '../../src/server/convert/menuStillSeek.js';

describe('buildMenuEncodeSegments', () => {
  it('orders cells by timeline and skips zero-duration', () => {
    const segments = buildMenuEncodeSegments({
      '2': {
        '1': {
          startSec: 10,
          endSec: 14,
          start_sector: 100,
          last_sector: 200,
        },
      },
      '1': {
        '1': {
          startSec: 0,
          endSec: 10,
          start_sector: 0,
          last_sector: 99,
        },
        '2': {
          startSec: 14,
          endSec: 14,
          start_sector: 201,
          last_sector: 201,
        },
      },
    });

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      label: '1:1',
      startSec: 0,
      endSec: 10,
      durationSec: 10,
      skipBytes: 0,
    });
    expect(segments[1]).toMatchObject({
      label: '2:1',
      startSec: 10,
      endSec: 14,
      durationSec: 4,
      skipBytes: 100 * DVD_VIDEO_LB_LEN,
    });
  });

  it('returns empty when menuCell missing', () => {
    expect(buildMenuEncodeSegments(null)).toEqual([]);
    expect(buildMenuEncodeSegments(undefined)).toEqual([]);
  });
});

describe('menuForceKeyFrameTimes', () => {
  it('includes 0 and each cell start', () => {
    expect(
      menuForceKeyFrameTimes([
        {
          startSec: 0,
          endSec: 5,
          durationSec: 5,
          skipBytes: 0,
          cellId: '1',
          vobId: '1',
          label: '1:1',
        },
        {
          startSec: 5.25,
          endSec: 9,
          durationSec: 3.75,
          skipBytes: 2048,
          cellId: '2',
          vobId: '1',
          label: '2:1',
        },
      ]),
    ).toEqual([0, 5.25]);
  });
});
