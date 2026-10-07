import { describe, expect, it } from 'vitest';
import {
  dvdInputColorSpace,
  menuVideoFormat,
  titleVideoFormat,
  webStillColorFilter,
  webStillColorMetadataArgs,
  webVideoColorFilter,
  webVideoColorMetadataArgs,
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
  it('builds WebM filter as yadif-only limited yuv420p (no TV→PC)', () => {
    expect(webVideoColorFilter({ videoFormat: 0 })).toBe(
      'yadif=0:-1:0,format=yuv420p',
    );
  });

  it('builds WebM filter with optional tpad', () => {
    expect(
      webVideoColorFilter({ videoFormat: 1, padToDuration: true }),
    ).toBe(
      'yadif=0:-1:0,format=yuv420p,tpad=stop_mode=clone:stop_duration=3600',
    );
  });

  it('builds still filter as full-range RGB with fast=1', () => {
    expect(webStillColorFilter({ videoFormat: 1 })).toBe(
      'yadif=0:-1:0,colorspace=iall=bt470bg:all=bt709:irange=tv:range=pc:fast=1,format=rgb24',
    );
  });

  it('tags WebM as limited-range BT.601 matching the disc', () => {
    expect(webVideoColorMetadataArgs({ videoFormat: 1 })).toEqual([
      '-color_primaries',
      'bt470bg',
      '-color_trc',
      'bt470bg',
      '-colorspace',
      'bt470bg',
      '-color_range',
      'tv',
    ]);
    expect(webVideoColorMetadataArgs({ videoFormat: 0 })).toEqual([
      '-color_primaries',
      'smpte170m',
      '-color_trc',
      'smpte170m',
      '-colorspace',
      'smpte170m',
      '-color_range',
      'tv',
    ]);
  });

  it('tags stills as BT.709 full range with sRGB transfer', () => {
    expect(webStillColorMetadataArgs()).toEqual([
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
