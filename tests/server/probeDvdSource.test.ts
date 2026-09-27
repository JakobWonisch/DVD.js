import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { probeVobFile } from '../../src/server/utils/probeDvdSource.js';

describe('probeVobFile', () => {
  it('accepts a tiny placeholder file', () => {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvdjs-probe-'));
    var vob = path.join(dir, 'VIDEO_TS.VOB');
    fs.writeFileSync(vob, Buffer.alloc(100));
    expect(probeVobFile(vob).ok).toBe(true);
  });

  it('flags high-entropy pack-synced buffers as CSS-like', () => {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvdjs-probe-'));
    var vob = path.join(dir, 'VTS_01_0.VOB');
    var blocks = 16;
    var buf = Buffer.alloc(2048 * blocks);
    for (var b = 0; b < blocks; b++) {
      var off = b * 2048;
      buf[off] = 0;
      buf[off + 1] = 0;
      buf[off + 2] = 1;
      buf[off + 3] = 0xba;
      for (var i = 4; i < 2048; i++) {
        buf[off + i] = (b * 31 + i * 17 + (i % 251)) & 0xff;
      }
    }
    fs.writeFileSync(vob, buf);
    var result = probeVobFile(vob);
    expect(result.ok).toBe(false);
    expect(result.cssLike).toBe(true);
    expect(result.message).toMatch(/--rip/);
  });
});
