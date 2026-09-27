import { describe, expect, it } from 'vitest';
import {
  menuFrameHeightFromBtnit,
  menuFrameHeightFromIfo,
  menuVideoFormatHeight,
  resolveMenuFrameHeight,
} from '../../src/server/convert/menuFrameHeight.js';

describe('menuFrameHeightFromIfo', () => {
  it('returns 576 for PAL VMGM', () => {
    expect(
      menuFrameHeightFromIfo({
        vmgi_mat: { vmgm_video_attr: { video_format: 1 } },
      }),
    ).toBe(576);
  });

  it('returns 576 for PAL VTSM', () => {
    expect(
      menuFrameHeightFromIfo({
        vtsi_mat: { vtsm_video_attr: { video_format: 1 } },
      }),
    ).toBe(576);
  });

  it('returns 480 for NTSC', () => {
    expect(
      menuFrameHeightFromIfo({
        vmgi_mat: { vmgm_video_attr: { video_format: 0 } },
      }),
    ).toBe(480);
  });

  it('defaults to 480 when IFO attrs are missing', () => {
    expect(menuFrameHeightFromIfo(null)).toBe(480);
    expect(menuFrameHeightFromIfo({})).toBe(480);
  });

  it('uses VTSM not title VTS when formats differ (PAL menus, NTSC titles)', () => {
    expect(
      menuVideoFormatHeight({
        vtsi_mat: {
          vtsm_video_attr: { video_format: 1 },
          vts_video_attr: { video_format: 0 },
        },
      }),
    ).toBe(576);
    expect(
      menuFrameHeightFromIfo({
        vtsi_mat: {
          vtsm_video_attr: { video_format: 1 },
          vts_video_attr: { video_format: 0 },
        },
      }),
    ).toBe(576);
  });

  it('does not treat title-only VTS attr as menu format', () => {
    expect(
      menuVideoFormatHeight({
        vtsi_mat: {
          vts_video_attr: { video_format: 0 },
        },
      }),
    ).toBe(null);
  });
});

describe('menuFrameHeightFromBtnit', () => {
  it('returns 576 when a button bottom is in the PAL band', () => {
    expect(
      menuFrameHeightFromBtnit(
        [{ y_end: 100 }, { y_end: 500 }],
        2,
      ),
    ).toBe(576);
  });

  it('returns null when all buttons fit NTSC', () => {
    expect(
      menuFrameHeightFromBtnit([{ y_end: 200 }, { y_end: 479 }], 2),
    ).toBe(null);
  });
});

describe('resolveMenuFrameHeight', () => {
  it('prefers IFO PAL even when buttons stay under 480', () => {
    expect(
      resolveMenuFrameHeight(
        { vmgi_mat: { vmgm_video_attr: { video_format: 1 } } },
        [{ y_end: 200 }],
        1,
      ),
    ).toBe(576);
  });

  it('bumps NTSC IFO to 576 when buttons extend past 480', () => {
    expect(
      resolveMenuFrameHeight(
        { vmgi_mat: { vmgm_video_attr: { video_format: 0 } } },
        [{ y_end: 520 }],
        1,
      ),
    ).toBe(576);
  });

  it('infers PAL from buttons when IFO menu format is missing', () => {
    expect(
      resolveMenuFrameHeight({}, [{ y_end: 500 }], 1),
    ).toBe(576);
  });

  it('defaults to 480 when nothing indicates PAL', () => {
    expect(resolveMenuFrameHeight({}, [{ y_end: 200 }], 1)).toBe(480);
    expect(resolveMenuFrameHeight(null)).toBe(480);
  });
});
