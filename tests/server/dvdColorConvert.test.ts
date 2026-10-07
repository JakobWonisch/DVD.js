import { describe, expect, it } from 'vitest';
import {
  dvdInputColorSpace,
  menuVideoFormat,
  titleVideoFormat,
  webColorMetadataArgs,
  webStillColorFilter,
  webVideoColorFilter,
} from '../../src/server/convert/dvdColorConvert.js';

describe('dvdInputColorSpace', () => {
  it('maps PAL to bt470bg and NTSC/unknown to smpte170m', () => {
    expect(dvdInputColorSpace(1)).toBe('bt470bg');
    expect(dvdInputColorSpace(0)).toBe('smpte170m');
    expect(dvdInputColorSpace(null)).toBe('smpte170m');
    expect(dvdInputColorSpace(undefined)).toBe('smpte170m');
  });
});

describe('menuVideoFormat / titleVideoFormat', () => {
  it('reads menu attrs and ignores title VTS for menus', () => {
    expect(
      menuVideoFormat({
        vtsi_mat: {
          vtsm_video_attr: { video_format: 1 },
          vts_video_attr: { video_format: 0 },
        },
      }),
    ).toBe(1);
    expect(
      titleVideoFormat({
        vtsi_mat: {
          vtsm_video_attr: { video_format: 1 },
          vts_video_attr: { video_format: 0 },
        },
      }),
    ).toBe(0);
  });

  it('returns null when attrs are missing', () => {
    expect(menuVideoFormat(null)).toBe(null);
    expect(menuVideoFormat({})).toBe(null);
    expect(titleVideoFormat({})).toBe(null);
  });
});

describe('web color filters', () => {
  it('builds NTSC WebM filter with full-range BT.709 (fast, no gamma)', () => {
    expect(webVideoColorFilter({ videoFormat: 0 })).toBe(
      'yadif=0:-1:0,colorspace=iall=smpte170m:all=bt709:irange=tv:range=pc:fast=1:format=yuv420p',
    );
  });

  it('builds PAL WebM filter and optional tpad', () => {
    expect(
      webVideoColorFilter({ videoFormat: 1, padToDuration: true }),
    ).toBe(
      'yadif=0:-1:0,colorspace=iall=bt470bg:all=bt709:irange=tv:range=pc:fast=1:format=yuv420p,tpad=stop_mode=clone:stop_duration=3600',
    );
  });

  it('builds still filter as full-range RGB with fast=1', () => {
    expect(webStillColorFilter({ videoFormat: 1 })).toBe(
      'yadif=0:-1:0,colorspace=iall=bt470bg:all=bt709:irange=tv:range=pc:fast=1,format=rgb24',
    );
  });

  it('tags output as BT.709 full range with sRGB transfer', () => {
    expect(webColorMetadataArgs()).toEqual([
      '-color_primaries',
      'bt709',
      '-color_trc',
      'iec61966-2-1',
      '-colorspace',
      'bt709',
      '-color_range',
      'pc',
    ]);
  });
});
