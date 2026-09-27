/**
 * DVD menu frame height from IFO video_attr (NTSC 480 / PAL 576).
 * Prefer this over SPU display.y2 heuristics so stills, buttons, and SPU share one grid.
 */

'use strict';

type VideoAttr = {
  video_format?: number;
};

type IfoLike = {
  vmgi_mat?: {
    vmgm_video_attr?: VideoAttr;
  };
  vtsi_mat?: {
    vtsm_video_attr?: VideoAttr;
    /** Title domain — must not drive menu hitboxes (can differ from VTSM). */
    vts_video_attr?: VideoAttr;
  };
};

type BtnLike = {
  y_end?: number;
};

/**
 * Menu-domain video_attr only (VMGM / VTSM). Never use title `vts_video_attr`:
 * some discs flag titles NTSC while menus are PAL (or the reverse).
 *
 * @returns 576 for PAL, 480 for NTSC, or `null` when unspecified.
 */
export function menuVideoFormatHeight(
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
  // video_format: 0 = NTSC, 1 = PAL (libdvdread / ifo_types).
  if (attr.video_format === 1) {
    return 576;
  }
  if (attr.video_format === 0) {
    return 480;
  }
  return null;
}

/**
 * @returns 576 for PAL, 480 for NTSC (default when IFO attrs are missing).
 */
export function menuFrameHeightFromIfo(
  ifoJson: IfoLike | null | undefined,
): number {
  return menuVideoFormatHeight(ifoJson) ?? 480;
}

/**
 * Infer frame height from PCI button bottoms when IFO menu format is unknown.
 * @returns 576 if any button reaches the PAL band, otherwise `null`.
 */
export function menuFrameHeightFromBtnit(
  btnit: BtnLike[] | null | undefined,
  btnNs: number,
): number | null {
  if (!btnit || btnNs <= 0) {
    return null;
  }
  let maxY = 0;
  for (let i = 0; i < btnNs; i++) {
    const y = btnit[i]?.y_end;
    if (typeof y === 'number' && y > maxY) {
      maxY = y;
    }
  }
  // PCI y is inclusive; values in [480, 575] only exist on a 576-line grid.
  if (maxY >= 480) {
    return 576;
  }
  return null;
}

/**
 * Frame height for menu button CSS / SPU: IFO menu format first, then btnit,
 * with a safety bump if buttons extend past a claimed NTSC height.
 */
export function resolveMenuFrameHeight(
  ifoJson: IfoLike | null | undefined,
  btnit?: BtnLike[] | null,
  btnNs?: number,
): number {
  const fromIfo = menuVideoFormatHeight(ifoJson);
  const fromBtn =
    btnNs != null ? menuFrameHeightFromBtnit(btnit, btnNs) : null;
  if (fromIfo === 576 || fromBtn === 576) {
    return 576;
  }
  if (fromIfo === 480) {
    return 480;
  }
  return 480;
}
