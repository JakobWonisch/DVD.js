/**
 * Lossy WebP stills for menu / title-stub frames (not SPU overlays, not cover.jpg).
 */

'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import * as os from 'node:os';

import { writeStillPlaceholder } from './writeStillPlaceholder.js';

var spawn = child_process.spawn;

/** High-quality lossy WebP — DVD stills stay sharp; much smaller than PNG. */
export const STILL_WEBP_QUALITY = 90;

/** Filename extension for menu / title-stub stills. */
export const MENU_STILL_EXT = 'webp';

/** True if a WebP buffer looks like a real image (RIFF….WEBP). */
export function isUsableStillWebp(filePath: string): boolean {
  try {
    const st = fs.statSync(filePath);
    if (st.size < 20) {
      return false;
    }
    const fd = fs.openSync(filePath, 'r');
    const magic = Buffer.alloc(12);
    fs.readSync(fd, magic, 0, 12, 0);
    fs.closeSync(fd);
    return (
      magic[0] === 0x52 &&
      magic[1] === 0x49 &&
      magic[2] === 0x46 &&
      magic[3] === 0x46 &&
      magic[8] === 0x57 &&
      magic[9] === 0x45 &&
      magic[10] === 0x42 &&
      magic[11] === 0x50
    );
  } catch {
    return false;
  }
}

/**
 * ffmpeg libwebp args for lossy stills (single frame).
 */
export function stillWebpEncodeArgs(): string[] {
  return [
    '-c:v',
    'libwebp',
    '-quality',
    String(STILL_WEBP_QUALITY),
    '-compression_level',
    '4',
  ];
}

/**
 * Encode an existing PNG (or any ffmpeg-readable image) to lossy WebP.
 */
export function pngToStillWebp(
  inputPath: string,
  outWebp: string,
  done: (ok: boolean) => void,
): void {
  const cmd = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-frames:v',
    '1',
    ...stillWebpEncodeArgs(),
    '-y',
    outWebp,
  ];
  const child = spawn('ffmpeg', cmd);
  child.on('error', function () {
    done(false);
  });
  child.on('close', function (code) {
    done(code === 0 && isUsableStillWebp(outWebp));
  });
}

/**
 * Write a gray placeholder as lossy WebP (PNG via Node, then ffmpeg sync).
 * Returns false if ffmpeg fails (caller may leave no still file).
 */
export function writeStillPlaceholderWebp(
  webpFile: string,
  label: string,
  width: number,
  height: number,
): boolean {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'dvd-menu-archive-still-ph-'),
  );
  const pngPath = path.join(tmpDir, 'ph.png');
  try {
    writeStillPlaceholder(pngPath, label, width, height);
    child_process.execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        pngPath,
        '-frames:v',
        '1',
        ...stillWebpEncodeArgs(),
        '-y',
        webpFile,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    unlinkStaleStillPng(webpFile);
    return isUsableStillWebp(webpFile);
  } catch {
    return false;
  } finally {
    cleanupDir(tmpDir);
  }
}

/** Drop a stale PNG sibling when writing the WebP still (reconvert cleanup). */
export function unlinkStaleStillPng(webpFile: string): void {
  if (!/\.webp$/i.test(webpFile)) {
    return;
  }
  const png = webpFile.replace(/\.webp$/i, '.png');
  try {
    if (fs.existsSync(png)) {
      fs.unlinkSync(png);
    }
  } catch {
    // ignore
  }
}

function cleanupDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
