import { describe, expect, it } from 'vitest';
import { unpackBtnColi, ycrcbToRgb } from '../../src/server/spu/palette.js';
import { demuxSpuPackets, pickMenuSpu } from '../../src/server/spu/demux.js';
import { decodeSpu } from '../../src/server/spu/decode.js';
import { encodeRgbaPng } from '../../src/server/spu/pngEncode.js';
import {
  renderBaseSpuPng,
  renderSelectSpuPng,
} from '../../src/server/spu/render.js';

describe('SPU palette helpers', () => {
  it('unpacks btn_coli nibbles in DVD order', () => {
    // 0x54570B00 → Ci3..Ci0 = 5,4,5,7 and A3..A0 = 0,11,0,0
    const u = 0x54570b00;
    const map = unpackBtnColi(u);
    expect(map.color).toEqual([7, 5, 4, 5]);
    expect(map.alpha).toEqual([0, 0, 11, 0]);
  });

  it('converts YCrCb palette entries to RGB', () => {
    const rgb = ycrcbToRgb(0x00808080); // mid gray-ish
    expect(rgb.r).toBeGreaterThanOrEqual(0);
    expect(rgb.r).toBeLessThanOrEqual(255);
    expect(rgb.g).toBeGreaterThanOrEqual(0);
    expect(rgb.b).toBeGreaterThanOrEqual(0);
  });
});

describe('SPU PNG encoder', () => {
  it('writes a valid PNG signature and IHDR', () => {
    const rgba = Buffer.alloc(2 * 2 * 4, 0);
    rgba[0] = 255;
    rgba[3] = 255;
    const png = encodeRgbaPng(rgba, 2, 2);
    expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(
      true
    );
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(2);
  });
});

/**
 * Build a minimal synthetic SPU: 8x2 display, solid pixel-type 1 run.
 * DCSQ at end with SET_COLOR/CONTR/DAREA/DSPXA.
 */
function buildToySpu(): Buffer {
  // Pixel data: one line of width 8, color 1 (nibble encoding: run=8,color=1 → val=0x21)
  // Even field only for y=0; odd field empty line for y=1.
  // Keep it simple: top field at offset 4, bottom at same with empty-ish data.
  const pixel = Buffer.from([0x21, 0x00]); // one run of 8 of color 1, pad
  // We'll craft manually with known-good structure from a real packet is better —
  // instead test demux framing with a fake PES.
  return pixel;
}

describe('SPU demux', () => {
  it('extracts private_stream_1 SPU payloads from MPEG-PS', () => {
    // Minimal pack + PES private_stream_1 with substream 0x20 and a tiny SPU header.
    // SPU size=6, dataSize=6 (empty DCSQ edge) — just enough for demux size trim.
    const spuBody = Buffer.from([0x00, 0x06, 0x00, 0x06, 0x00, 0x00]);
    const pesPayload = Buffer.concat([Buffer.from([0x20]), spuBody]);

    // PES: 00 00 01 BD, length, flags, hdrlen=0, payload
    const pesLen = 3 + pesPayload.length; // flags(2)+hdrlen(1)+payload
    const pes = Buffer.alloc(6 + pesLen);
    pes[0] = 0;
    pes[1] = 0;
    pes[2] = 1;
    pes[3] = 0xbd;
    pes.writeUInt16BE(pesLen, 4);
    pes[6] = 0x80; // mpeg2 marker
    pes[7] = 0x00; // no PTS
    pes[8] = 0x00; // header data len
    pesPayload.copy(pes, 9);

    // Pack header mpeg2: 00 00 01 BA + 10 bytes + stuffing length nibble
    const pack = Buffer.from([
      0x00, 0x00, 0x01, 0xba, 0x44, 0x00, 0x04, 0x00, 0x04, 0x01, 0x01, 0x89,
      0xc3, 0xf8, // stuffing_length = 0 in low 3 bits of last before... wait
    ]);
    // Standard short pack: bytes 4-13 are SCR etc; byte 13 low 3 bits = stuffing.
    // Our buffer above is 14 bytes (0..13). Good.
    const buf = Buffer.concat([pack, pes]);
    const packets = demuxSpuPackets(buf);
    expect(packets.length).toBe(1);
    expect(packets[0].substream).toBe(0x20);
    expect(packets[0].data.readUInt16BE(0)).toBe(6);
    expect(pickMenuSpu(buf)!.equals(packets[0].data)).toBe(true);
  });
});

describe('SPU decode + highlight render', () => {
  it('decodes a handcrafted SPU and remaps select colours', () => {
    // Construct SPU:
    // size / data_size | RLE | DCSQ
    // Display 8x2 at (0,0). Top field offset 4, bottom offset after top data.
    // Line width 8: encode as val with run=0 (to EOL) color=1 → need 4 nibbles of 0 then color in low bits...
    // Simpler: val = (8<<2)|1 = 0x21 as single nibble pair — wait 0x21 is two nibbles 2,1 → val=0x21, run=8,color=1. Perfect one byte if we start with nibble 2 then 1 — one byte 0x21.
    const topRle = Buffer.from([0x21, 0x00]); // line + byte align pad
    const botRle = Buffer.from([0x21, 0x00]);
    const pixelData = Buffer.concat([topRle, botRle]); // offsets 4 and 6
    const topOffset = 4;
    const bottomOffset = 4 + topRle.length;

    // DCSQ: delay=0, next=self, FSTA, SET_COLOR 10 23, SET_CONTR FF FF, SET_DAREA, SET_DSPXA, END
    const dcsq: number[] = [];
    const dcsqStart = 4 + pixelData.length;
    // delay
    dcsq.push(0x00, 0x00);
    // next = dcsqStart (loop)
    dcsq.push((dcsqStart >> 8) & 0xff, dcsqStart & 0xff);
    dcsq.push(0x00); // FSTA_DSP
    dcsq.push(0x03, 0x10, 0x23); // SET_COLOR
    dcsq.push(0x04, 0xff, 0xff); // SET_CONTR full
    // SET_DAREA 0,7,0,1
    dcsq.push(0x05, 0x00, 0x00, 0x07, 0x00, 0x00, 0x01);
    dcsq.push(0x06, (topOffset >> 8) & 0xff, topOffset & 0xff, (bottomOffset >> 8) & 0xff, bottomOffset & 0xff);
    dcsq.push(0xff);

    const body = Buffer.concat([pixelData, Buffer.from(dcsq)]);
    const size = 4 + body.length;
    const packet = Buffer.alloc(size);
    packet.writeUInt16BE(size, 0);
    packet.writeUInt16BE(dcsqStart, 2);
    body.copy(packet, 4);

    const decoded = decodeSpu(packet);
    expect(decoded).not.toBeNull();
    expect(decoded!.width).toBe(8);
    expect(decoded!.height).toBe(2);
    expect(decoded!.indices[0]).toBe(1);

    const palette = new Array(16).fill(0);
    palette[0] = 0x00108080; // dark
    palette[1] = 0x00eb8080; // bright
    palette[2] = 0x00808080;
    palette[3] = 0x00408080;
    // SET_COLOR 10 23 → color[0]=3,color[1]=2,color[2]=0,color[3]=1

    const base = renderBaseSpuPng(decoded!, palette);
    expect(base[0]).toBe(137); // PNG sig

    const btnColi = [0x54570b00, 0x54570b00, 0, 0, 0, 0];
    const sel = renderSelectSpuPng(
      decoded!,
      palette,
      { x_start: 0, y_start: 0, x_end: 7, y_end: 1, btn_coln: 1 },
      btnColi
    );
    expect(sel.length).toBeGreaterThan(100);
  });
});
