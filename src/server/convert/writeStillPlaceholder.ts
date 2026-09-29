/**
 * Gray PNG placeholder when menu still extraction fails.
 * Pure Node (zlib) — no ffmpeg fonts / native image deps.
 */

'use strict';

import * as fs from 'node:fs';
import * as zlib from 'node:zlib';

/** 5×7 glyphs for digits, hyphen, and a few letters (packed as 5-bit rows). */
const GLYPHS: Record<string, number[]> = {
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  '3': [0x0e, 0x11, 0x01, 0x06, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  '-': [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  'm': [0x00, 0x00, 0x1a, 0x15, 0x15, 0x15, 0x15],
  'e': [0x00, 0x00, 0x0e, 0x11, 0x1f, 0x10, 0x0e],
  'n': [0x00, 0x00, 0x1e, 0x11, 0x11, 0x11, 0x11],
  'u': [0x00, 0x00, 0x11, 0x11, 0x11, 0x11, 0x0f],
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
};

const GRAY = 0x80;
const TEXT = 0xf0;

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function drawGlyph(
  px: Buffer,
  width: number,
  x0: number,
  y0: number,
  ch: string,
  scale: number,
): void {
  const rows = GLYPHS[ch] || GLYPHS['-'];
  for (let row = 0; row < 7; row++) {
    const bits = rows[row];
    for (let col = 0; col < 5; col++) {
      if (((bits >> (4 - col)) & 1) === 0) {
        continue;
      }
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const x = x0 + col * scale + dx;
          const y = y0 + row * scale + dy;
          if (x < 0 || y < 0 || x >= width) {
            continue;
          }
          const i = (y * width + x) * 3;
          px[i] = TEXT;
          px[i + 1] = TEXT;
          px[i + 2] = TEXT;
        }
      }
    }
  }
}

/**
 * Build an RGB PNG buffer: flat gray with centered label text.
 */
export function buildStillPlaceholderPng(
  label: string,
  width = 720,
  height = 480,
): Buffer {
  const w = Math.max(16, Math.floor(width));
  const h = Math.max(16, Math.floor(height));
  const px = Buffer.alloc(w * h * 3, GRAY);

  const text = String(label || '?')
    .toLowerCase()
    .replace(/[^0-9a-z\- ]/g, '-');
  const scale = Math.max(2, Math.min(8, Math.floor(Math.min(w, h) / 60)));
  const glyphW = 6 * scale; // 5 px + 1 gap
  const glyphH = 7 * scale;
  const totalW = text.length * glyphW;
  let x = Math.floor((w - totalW) / 2);
  const y = Math.floor((h - glyphH) / 2);
  for (let i = 0; i < text.length; i++) {
    drawGlyph(px, w, x, y, text[i], scale);
    x += glyphW;
  }

  // PNG scanlines: filter byte 0 + RGB row
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let row = 0; row < h; row++) {
    const dest = row * (w * 3 + 1);
    raw[dest] = 0;
    px.copy(raw, dest + 1, row * w * 3, (row + 1) * w * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Write a gray placeholder still PNG labeled with the cell id.
 */
export function writeStillPlaceholder(
  imgFile: string,
  label: string,
  width = 720,
  height = 480,
): void {
  fs.writeFileSync(imgFile, buildStillPlaceholderPng(label, width, height));
}
