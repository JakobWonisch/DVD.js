// Render decoded SPU index maps to RGBA frames (base + highlight remaps).

'use strict';

import { encodeRgbaPng } from './pngEncode.js';
import {
  coliActionForButton,
  coliForButton,
  ycrcbToRgb,
} from './palette.js';
import type { DecodedSpu } from './decode.js';

export type ButtonRect = {
  x_start: number;
  y_start: number;
  x_end: number;
  y_end: number;
  btn_coln: number;
};

/**
 * Render the base SPU overlay (DCSQ colours/alphas) as a full-frame PNG.
 */
export function renderBaseSpuPng(
  decoded: DecodedSpu,
  palette: number[]
): Buffer {
  const rgba = renderWithMap(
    decoded,
    palette,
    decoded.display.color,
    decoded.display.alpha,
    null
  );
  return encodeRgbaPng(rgba, decoded.frameWidth, decoded.frameHeight);
}

/**
 * Render a select-state overlay: only the given button rect is opaque
 * (using btn_coli select colours); the rest of the frame is transparent.
 */
export function renderSelectSpuPng(
  decoded: DecodedSpu,
  palette: number[],
  button: ButtonRect,
  btnColi: number[]
): Buffer {
  const map = coliForButton(btnColi, button.btn_coln || 1);
  const color = map ? map.color : decoded.display.color;
  const alpha = map ? map.alpha : decoded.display.alpha;
  const rgba = renderWithMap(decoded, palette, color, alpha, button);
  return encodeRgbaPng(rgba, decoded.frameWidth, decoded.frameHeight);
}

/**
 * Render an activate-state overlay for a button.
 */
export function renderActivateSpuPng(
  decoded: DecodedSpu,
  palette: number[],
  button: ButtonRect,
  btnColi: number[]
): Buffer {
  const map = coliActionForButton(btnColi, button.btn_coln || 1);
  const color = map ? map.color : decoded.display.color;
  const alpha = map ? map.alpha : decoded.display.alpha;
  const rgba = renderWithMap(decoded, palette, color, alpha, button);
  return encodeRgbaPng(rgba, decoded.frameWidth, decoded.frameHeight);
}

function renderWithMap(
  decoded: DecodedSpu,
  palette: number[],
  color: number[],
  alpha: number[],
  clip: ButtonRect | null
): Buffer {
  const { frameWidth: fw, frameHeight: fh, display, indices, width, height } =
    decoded;
  const rgba = Buffer.alloc(fw * fh * 4);
  const clut = palette.map((e) => ycrcbToRgb(e >>> 0));

  const x0 = clip ? clip.x_start : display.x1;
  const y0 = clip ? clip.y_start : display.y1;
  const x1 = clip ? clip.x_end : display.x2;
  const y1 = clip ? clip.y_end : display.y2;

  for (let y = y0; y <= y1; y++) {
    if (y < display.y1 || y > display.y2 || y < 0 || y >= fh) {
      continue;
    }
    for (let x = x0; x <= x1; x++) {
      if (x < display.x1 || x > display.x2 || x < 0 || x >= fw) {
        continue;
      }
      const lx = x - display.x1;
      const ly = y - display.y1;
      if (lx < 0 || ly < 0 || lx >= width || ly >= height) {
        continue;
      }
      const pixType = indices[ly * width + lx];
      const palIdx = color[pixType] & 0xf;
      const a4 = alpha[pixType] & 0xf;
      if (a4 === 0) {
        continue;
      }
      const rgb = clut[palIdx] || { r: 0, g: 0, b: 0 };
      const o = (y * fw + x) * 4;
      rgba[o] = rgb.r;
      rgba[o + 1] = rgb.g;
      rgba[o + 2] = rgb.b;
      rgba[o + 3] = Math.round((a4 / 15) * 255);
    }
  }

  return rgba;
}
