/**
 * DVD MPEG-2 → web color normalize + tag helpers.
 *
 * DVD video is BT.601 limited (TV) range. Untagged limited WebM often looks
 * darker in Chrome (esp. HW decode); untagged PNG stills can look darker in
 * Firefox (color management). Convert expands TV→PC and tags BT.709 / full
 * range so browsers align closer to VLC.
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
 * Deinterlace + BT.601 limited → BT.709 full-range yuv420p for libvpx WebM.
 * Optional `tpad` matches prior encode behavior for short still cells.
 */
export function webVideoColorFilter(opts?: {
  videoFormat?: number | null;
  padToDuration?: boolean;
}): string {
  const iall = dvdInputColorSpace(opts?.videoFormat);
  let vf =
    'yadif=0:-1:0,colorspace=iall=' +
    iall +
    ':all=bt709:irange=tv:range=pc:format=yuv420p';
  if (opts?.padToDuration) {
    vf += ',tpad=stop_mode=clone:stop_duration=3600';
  }
  return vf;
}

/** Deinterlace + BT.601 limited → BT.709 full-range RGB for menu/title still PNGs. */
export function webStillColorFilter(opts?: {
  videoFormat?: number | null;
}): string {
  const iall = dvdInputColorSpace(opts?.videoFormat);
  return (
    'yadif=0:-1:0,colorspace=iall=' +
    iall +
    ':all=bt709:irange=tv:range=pc,format=rgb24'
  );
}

/**
 * ffmpeg output color tags after normalize (full-range BT.709).
 * Apply to WebM and still PNG encodes so browsers stop guessing.
 */
export function webColorMetadataArgs(): string[] {
  return [
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-colorspace',
    'bt709',
    '-color_range',
    'pc',
  ];
}
