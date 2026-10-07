/**
 * DVD MPEG-2 → web color normalize + tag helpers.
 *
 * DVD video is BT.601 limited (TV) range.
 *
 * WebM (libvpx): do **not** expand TV→PC before encode. Expanding and tagging
 * `color_range=pc` round-trips ~30% darker through libvpx than leaving limited
 * pixels tagged `tv` (HP main menu: meanRGB 22 vs 31, matching the WebP still).
 * Keep yadif-only + TV-range BT.601 tags so browsers/VLC expand once.
 *
 * Stills (RGB → WebP/PNG): expand TV→PC with `colorspace=…:fast=1` (skip gamma —
 * a full `bt470bg→bt709` transfer crushes PAL midtones) and tag full-range
 * BT.709 / sRGB. libwebp stores YUV limited again; browsers expand on decode.
 */

'use strict';

export type DvdInputColorSpace = 'smpte170m' | 'bt470bg';

type VideoAttr = {
  video_format?: number;
};

type IfoLike = {
  vmgi_mat?: {
    vmgm_video_attr?: VideoAttr;
  };
  vtsi_mat?: {
    vtsm_video_attr?: VideoAttr;
    vts_video_attr?: VideoAttr;
  };
};

/**
 * IFO `video_format`: 0 = NTSC → smpte170m, 1 = PAL → bt470bg.
 * Unknown defaults to NTSC (matches menuFrameHeight default of 480).
 */
export function dvdInputColorSpace(
  videoFormat?: number | null,
): DvdInputColorSpace {
  if (videoFormat === 1) {
    return 'bt470bg';
  }
  return 'smpte170m';
}

/** Menu-domain video_format only (VMGM / VTSM), never title VTS. */
export function menuVideoFormat(
  ifoJson: IfoLike | null | undefined,
): number | null {
  if (!ifoJson) {
    return null;
  }
  const attr =
    ifoJson.vmgi_mat?.vmgm_video_attr ??
    ifoJson.vtsi_mat?.vtsm_video_attr ??
    null;
  if (!attr || attr.video_format === undefined || attr.video_format === null) {
    return null;
  }
  if (attr.video_format === 0 || attr.video_format === 1) {
    return attr.video_format;
  }
  return null;
}

/** Title-domain video_format (`vts_video_attr`). */
export function titleVideoFormat(
  ifoJson: IfoLike | null | undefined,
): number | null {
  const vf = ifoJson?.vtsi_mat?.vts_video_attr?.video_format;
  if (vf === 0 || vf === 1) {
    return vf;
  }
  return null;
}

/**
 * Shared still colorspace body: TV→PC + BT.601→BT.709 matrix, no gamma.
 * `fast=1` is required — without it PAL `bt470bg→bt709` re-applies transfer
 * and darkens menus/titles badly.
 */
function webStillColorSpaceFilterBody(videoFormat?: number | null): string {
  const iall = dvdInputColorSpace(videoFormat);
  return (
    'colorspace=iall=' +
    iall +
    ':all=bt709:irange=tv:range=pc:fast=1'
  );
}

/**
 * Deinterlace only for libvpx WebM — keep limited (TV) range pixels.
 * Optional `tpad` matches prior encode behavior for short still cells.
 */
export function webVideoColorFilter(opts?: {
  videoFormat?: number | null;
  padToDuration?: boolean;
}): string {
  void opts?.videoFormat;
  let vf = 'yadif=0:-1:0,format=yuv420p';
  if (opts?.padToDuration) {
    vf += ',tpad=stop_mode=clone:stop_duration=3600';
  }
  return vf;
}

/** Deinterlace + BT.601 limited → BT.709 full-range RGB for menu/title stills. */
export function webStillColorFilter(opts?: {
  videoFormat?: number | null;
}): string {
  return (
    'yadif=0:-1:0,' +
    webStillColorSpaceFilterBody(opts?.videoFormat) +
    ',format=rgb24'
  );
}

/**
 * WebM colour tags: limited-range BT.601 matching the untouched pixels.
 * Explicit `tv` helps players that honor WebM Colour (avoids “limited as full”).
 */
export function webVideoColorMetadataArgs(opts?: {
  videoFormat?: number | null;
}): string[] {
  const space = dvdInputColorSpace(opts?.videoFormat);
  return [
    '-color_primaries',
    space,
    '-color_trc',
    space,
    '-colorspace',
    space,
    '-color_range',
    'tv',
  ];
}

/** Still encode tags after TV→PC normalize (full-range BT.709 / sRGB TRC). */
export function webStillColorMetadataArgs(): string[] {
  return [
    '-color_primaries',
    'bt709',
    '-color_trc',
    'iec61966-2-1',
    '-colorspace',
    'bt709',
    '-color_range',
    'pc',
  ];
}
