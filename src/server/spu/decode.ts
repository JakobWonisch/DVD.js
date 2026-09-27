// DVD SPU (subpicture) RLE + DCSQ decoder.

'use strict';

export type SpuDisplay = {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  /** Pixel-type → CLUT index (0..15), length 4 */
  color: number[];
  /** Pixel-type → alpha 0..15, length 4 */
  alpha: number[];
  topOffset: number;
  bottomOffset: number;
};

export type DecodedSpu = {
  display: SpuDisplay;
  /** width * height pixel types 0..3 within the display area */
  indices: Uint8Array;
  width: number;
  height: number;
  /** Suggested frame height (480 NTSC / 576 PAL) */
  frameHeight: number;
  frameWidth: number;
};

/**
 * Decode a complete SPU packet into a pixel-type index map and display params.
 * Uses the first DCSQ that configures the display (typically delay 0).
 */
export function decodeSpu(packet: Buffer): DecodedSpu | null {
  if (!packet || packet.length < 4) {
    return null;
  }

  const size = packet.readUInt16BE(0);
  const dataSize = packet.readUInt16BE(2);
  if (size > packet.length || dataSize >= size || dataSize < 4) {
    return null;
  }

  const display = parseFirstDisplay(packet, size, dataSize);
  if (!display) {
    return null;
  }

  const width = display.x2 - display.x1 + 1;
  const height = display.y2 - display.y1 + 1;
  if (width <= 0 || height <= 0 || width > 720 || height > 576) {
    return null;
  }

  const indices = new Uint8Array(width * height);
  decodeField(packet, display.topOffset, 0, width, height, indices);
  decodeField(packet, display.bottomOffset, 1, width, height, indices);

  const frameHeight = display.y2 >= 480 ? 576 : 480;

  return {
    display,
    indices,
    width,
    height,
    frameHeight,
    frameWidth: 720,
  };
}

function parseFirstDisplay(
  packet: Buffer,
  size: number,
  dataSize: number
): SpuDisplay | null {
  const display: SpuDisplay = {
    x1: 0,
    x2: 719,
    y1: 0,
    y2: 479,
    color: [0, 1, 2, 3],
    alpha: [0, 0, 0, 0],
    topOffset: 4,
    bottomOffset: 4,
  };

  let next = dataSize;
  const seen = new Set<number>();
  let configured = false;

  for (let guard = 0; guard < 32; guard++) {
    if (seen.has(next) || next < dataSize || next + 4 > size) {
      break;
    }
    seen.add(next);

    let i = next;
    i += 2; // delay
    const nextOff = packet.readUInt16BE(i);
    i += 2;

    while (i < size) {
      const cmd = packet[i++];
      if (cmd === 0xff) {
        break;
      }
      if (cmd === 0x00 || cmd === 0x01 || cmd === 0x02) {
        // FSTA_DSP / STA_DSP / STP_DSP
        continue;
      }
      if (cmd === 0x03) {
        if (i + 2 > size) break;
        const b0 = packet[i++];
        const b1 = packet[i++];
        // ffmpeg dvdsub: color[3]=(b0>>4), [2]=b0&0xf, [1]=(b1>>4), [0]=b1&0xf
        display.color = [b1 & 0xf, (b1 >> 4) & 0xf, b0 & 0xf, (b0 >> 4) & 0xf];
        configured = true;
        continue;
      }
      if (cmd === 0x04) {
        if (i + 2 > size) break;
        const b0 = packet[i++];
        const b1 = packet[i++];
        display.alpha = [
          b1 & 0xf,
          (b1 >> 4) & 0xf,
          b0 & 0xf,
          (b0 >> 4) & 0xf,
        ];
        configured = true;
        continue;
      }
      if (cmd === 0x05) {
        if (i + 6 > size) break;
        display.x1 = (packet[i] << 4) | (packet[i + 1] >> 4);
        display.x2 = ((packet[i + 1] & 0xf) << 8) | packet[i + 2];
        display.y1 = (packet[i + 3] << 4) | (packet[i + 4] >> 4);
        display.y2 = ((packet[i + 4] & 0xf) << 8) | packet[i + 5];
        i += 6;
        configured = true;
        continue;
      }
      if (cmd === 0x06) {
        if (i + 4 > size) break;
        display.topOffset = packet.readUInt16BE(i);
        display.bottomOffset = packet.readUInt16BE(i + 2);
        i += 4;
        configured = true;
        continue;
      }
      if (cmd === 0x07) {
        if (i + 2 > size) break;
        const sz = packet.readUInt16BE(i);
        i += 2 + sz;
        continue;
      }
      // Unknown command — stop this sequence
      break;
    }

    if (configured) {
      return display;
    }

    if (nextOff === next || nextOff === 0) {
      break;
    }
    next = nextOff;
  }

  return configured ? display : display;
}

function decodeField(
  packet: Buffer,
  byteOffset: number,
  field: number,
  width: number,
  height: number,
  indices: Uint8Array
) {
  let bitPos = byteOffset * 8;
  const getNibble = () => {
    const bytePos = bitPos >> 3;
    if (bytePos >= packet.length) {
      bitPos += 4;
      return 0;
    }
    const n =
      (bitPos & 4) === 0
        ? (packet[bytePos] >> 4) & 0xf
        : packet[bytePos] & 0xf;
    bitPos += 4;
    return n;
  };

  for (let y = field; y < height; y += 2) {
    let x = 0;
    while (x < width) {
      let val = getNibble();
      if (val < 0x04) {
        val = (val << 4) | getNibble();
        if (val < 0x10) {
          val = (val << 4) | getNibble();
          if (val < 0x40) {
            val = (val << 4) | getNibble();
          }
        }
      }
      let run = val >> 2;
      const color = val & 3;
      if (run === 0) {
        run = width - x;
      }
      while (run-- > 0 && x < width) {
        indices[y * width + x] = color;
        x++;
      }
    }
    // Byte-align at end of line
    if (bitPos & 7) {
      bitPos = (bitPos + 7) & ~7;
    }
  }
}
