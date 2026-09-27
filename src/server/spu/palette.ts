// DVD PGC palette + button colour-info helpers.

'use strict';

export type Rgba = { r: number; g: number; b: number; a: number };

/**
 * Unpack a PGC palette entry (0x00_Y_Cr_Cb) to 8-bit RGB.
 */
export function ycrcbToRgb(entry: number): { r: number; g: number; b: number } {
  const Y = (entry >>> 16) & 0xff;
  const Cr = (entry >>> 8) & 0xff;
  const Cb = entry & 0xff;
  let r = Y + 1.402 * (Cr - 128);
  let g = Y - 0.34414 * (Cb - 128) - 0.71414 * (Cr - 128);
  let b = Y + 1.772 * (Cb - 128);
  return {
    r: clamp8(r),
    g: clamp8(g),
    b: clamp8(b),
  };
}

/**
 * Unpack btn_coli uint32: [Ci3,Ci2,Ci1,Ci0, A3,A2,A1,A0] nibbles.
 * color[i] / alpha[i] index pixel type i (0=bg … 3=emph2), matching SET_COLOR.
 */
export function unpackBtnColi(word: number): {
  color: number[];
  alpha: number[];
} {
  const nib: number[] = [];
  for (let shift = 28; shift >= 0; shift -= 4) {
    nib.push((word >>> shift) & 0xf);
  }
  return {
    color: [nib[3], nib[2], nib[1], nib[0]],
    alpha: [nib[7], nib[6], nib[5], nib[4]],
  };
}

/**
 * Flattened btn_coli[3][2] array from NAV JSON → select/action maps for btn_coln 1..3.
 */
export function coliForButton(
  btnColi: number[] | undefined,
  btnColn: number
): { color: number[]; alpha: number[] } | null {
  if (!btnColi || !btnColi.length || btnColn < 1 || btnColn > 3) {
    return null;
  }
  // Stored as 6 uint32s: [g0_sel, g0_act, g1_sel, g1_act, g2_sel, g2_act]
  const idx = (btnColn - 1) * 2;
  if (idx >= btnColi.length) {
    return null;
  }
  return unpackBtnColi(btnColi[idx] >>> 0);
}

export function coliActionForButton(
  btnColi: number[] | undefined,
  btnColn: number
): { color: number[]; alpha: number[] } | null {
  if (!btnColi || !btnColi.length || btnColn < 1 || btnColn > 3) {
    return null;
  }
  const idx = (btnColn - 1) * 2 + 1;
  if (idx >= btnColi.length) {
    return null;
  }
  return unpackBtnColi(btnColi[idx] >>> 0);
}

function clamp8(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
