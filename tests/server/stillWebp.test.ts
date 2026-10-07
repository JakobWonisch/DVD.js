import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  STILL_WEBP_QUALITY,
  isUsableStillWebp,
  stillWebpEncodeArgs,
  writeStillPlaceholderWebp,
} from '../../src/server/convert/stillWebp.js';

function hasFfmpeg(): boolean {
  try {
    child_process.execFileSync('ffmpeg', ['-version'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

describe('stillWebpEncodeArgs', () => {
  it('uses lossy libwebp at archive quality', () => {
    expect(stillWebpEncodeArgs()).toEqual([
      '-c:v',
      'libwebp',
      '-quality',
      String(STILL_WEBP_QUALITY),
      '-compression_level',
      '4',
    ]);
    expect(STILL_WEBP_QUALITY).toBeGreaterThanOrEqual(80);
  });
});

describe.skipIf(!hasFfmpeg())('writeStillPlaceholderWebp', () => {
  it('writes a usable WebP via ffmpeg', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvdjs-webp-'));
    const file = path.join(dir, 'menu-0-1-2.webp');
    const ok = writeStillPlaceholderWebp(file, '0-1-2', 80, 60);
    expect(ok).toBe(true);
    expect(isUsableStillWebp(file)).toBe(true);
    expect(fs.existsSync(file.replace(/\.webp$/i, '.png'))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
