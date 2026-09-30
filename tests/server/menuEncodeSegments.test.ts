import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildMenuEncodeSegments,
  capMenuEncodeEndBytes,
  clipVobByteRange,
  menuForceKeyFrameTimes,
} from '../../src/server/convert/menuEncodeSegments.js';
import { DVD_VIDEO_LB_LEN } from '../../src/server/convert/menuStillSeek.js';

describe('capMenuEncodeEndBytes', () => {
  it('caps absurd C_ADT spans for short cells', () => {
    const start = 78 * DVD_VIDEO_LB_LEN;
    const cadtEnd = (185226 + 1) * DVD_VIDEO_LB_LEN;
    const end = capMenuEncodeEndBytes(start, cadtEnd, 0.04);
    expect(end).toBeGreaterThan(start);
    expect(end - start).toBeLessThan(2 * 1024 * 1024);
    expect(end).toBeLessThan(cadtEnd);
  });

  it('keeps full span when it fits the duration budget', () => {
    const start = 0;
    const cadtEnd = 100 * DVD_VIDEO_LB_LEN;
    expect(capMenuEncodeEndBytes(start, cadtEnd, 10)).toBe(cadtEnd);
  });
});

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
      endBytes: 100 * DVD_VIDEO_LB_LEN,
    });
    expect(segments[1]).toMatchObject({
      label: '2:1',
      startSec: 10,
      endSec: 14,
      durationSec: 4,
      skipBytes: 100 * DVD_VIDEO_LB_LEN,
      endBytes: 201 * DVD_VIDEO_LB_LEN,
    });
  });

  it('caps endBytes when last_sector dwarfs playback duration', () => {
    const segments = buildMenuEncodeSegments({
      '1': {
        '3': {
          startSec: 2.48,
          endSec: 2.52,
          start_sector: 78,
          last_sector: 185226,
        },
      },
    });
    expect(segments).toHaveLength(1);
    expect(segments[0].endBytes - segments[0].skipBytes).toBeLessThan(
      2 * 1024 * 1024,
    );
  });

  it('returns empty when menuCell missing', () => {
    expect(buildMenuEncodeSegments(null)).toEqual([]);
    expect(buildMenuEncodeSegments(undefined)).toEqual([]);
  });
});

describe('clipVobByteRange', () => {
  it('copies only the requested byte window', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvd-menu-archive-clip-'));
    const src = path.join(dir, 'src.vob');
    const out = path.join(dir, 'out.vob');
    const buf = Buffer.alloc(10 * DVD_VIDEO_LB_LEN, 0);
    buf[2 * DVD_VIDEO_LB_LEN] = 0xaa;
    buf[3 * DVD_VIDEO_LB_LEN + 1] = 0xbb;
    fs.writeFileSync(src, buf);
    expect(
      clipVobByteRange(src, 2 * DVD_VIDEO_LB_LEN, 4 * DVD_VIDEO_LB_LEN, out),
    ).toBe(true);
    const clipped = fs.readFileSync(out);
    expect(clipped.length).toBe(2 * DVD_VIDEO_LB_LEN);
    expect(clipped[0]).toBe(0xaa);
    expect(clipped[DVD_VIDEO_LB_LEN + 1]).toBe(0xbb);
    fs.rmSync(dir, { recursive: true, force: true });
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
          endBytes: 2048,
          cellId: '1',
          vobId: '1',
          label: '1:1',
        },
        {
          startSec: 5.25,
          endSec: 9,
          durationSec: 3.75,
          skipBytes: 2048,
          endBytes: 4096,
          cellId: '2',
          vobId: '1',
          label: '2:1',
        },
      ]),
    ).toEqual([0, 5.25]);
  });
});
