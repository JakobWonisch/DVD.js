// Demux DVD SPU (private_stream_1 substreams 0x20–0x3F) from MPEG-PS.

'use strict';

export type SpuPacket = {
  /** Substream id 0x20–0x3F */
  substream: number;
  /** Complete SPU packet bytes (size field inclusive) */
  data: Buffer;
};

/**
 * Collect complete SPU packets from an MPEG program-stream buffer (e.g. one menu cell).
 * Returns the first complete packet per substream (menus usually have one display set).
 */
export function demuxSpuPackets(buf: Buffer): SpuPacket[] {
  const chunks = new Map<number, Buffer[]>();
  let i = 0;

  while (i + 4 < buf.length) {
    if (buf[i] !== 0x00 || buf[i + 1] !== 0x00 || buf[i + 2] !== 0x01) {
      i++;
      continue;
    }

    const streamId = buf[i + 3];

    if (streamId === 0xba) {
      // Pack header
      const isMpeg1 = (buf[i + 4] & 0x40) === 0;
      if (isMpeg1) {
        i += 12;
      } else {
        if (i + 14 > buf.length) break;
        i += 14 + (buf[i + 13] & 0x07);
      }
      continue;
    }

    if (streamId === 0xbd) {
      if (i + 6 > buf.length) break;
      const pesLen = buf.readUInt16BE(i + 4);
      const hdr = i + 6;
      if (hdr + 3 > buf.length) break;
      // MPEG-2 PES: skip flags (2) + header_data_length
      const headerDataLen = buf[hdr + 2];
      const payloadStart = hdr + 3 + headerDataLen;
      const payloadEnd = i + 6 + pesLen;
      if (payloadStart < payloadEnd && payloadEnd <= buf.length) {
        const sub = buf[payloadStart];
        if (sub >= 0x20 && sub <= 0x3f) {
          const payload = buf.subarray(payloadStart + 1, payloadEnd);
          if (!chunks.has(sub)) {
            chunks.set(sub, []);
          }
          chunks.get(sub)!.push(Buffer.from(payload));
        }
      }
      i = payloadEnd;
      continue;
    }

    // Other PES / system header
    if (streamId >= 0xbb) {
      if (i + 6 > buf.length) break;
      const pesLen = buf.readUInt16BE(i + 4);
      i += 6 + pesLen;
      continue;
    }

    i += 4;
  }

  const packets: SpuPacket[] = [];
  for (const [substream, parts] of chunks) {
    const all = Buffer.concat(parts);
    if (all.length < 4) {
      continue;
    }
    const size = all.readUInt16BE(0);
    if (size >= 4 && all.length >= size) {
      packets.push({ substream, data: Buffer.from(all.subarray(0, size)) });
    }
  }

  // Prefer lower substream ids (widescreen/4:3 group order varies; 0x20 is common).
  packets.sort((a, b) => a.substream - b.substream);
  return packets;
}

/**
 * Pick the best SPU packet for a menu cell (first complete, preferably 0x20).
 */
export function pickMenuSpu(buf: Buffer): Buffer | null {
  const packets = demuxSpuPackets(buf);
  return packets.length ? packets[0].data : null;
}
