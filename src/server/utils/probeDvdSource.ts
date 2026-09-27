/**
 * Probe menu VOBs for CSS encryption or unreadable optical media.
 * Plain fs/ffmpeg cannot decrypt CSS — those sources need `dvdbackup` via --rip.
 */

'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';

import * as serverUtils from './index.js';
import { globFiles } from './globFiles.js';

/** High byte entropy with intact pack headers often means CSS still encrypted. */
var CSS_LIKE_ENTROPY = 7.85;

var DVD_VIDEO_LB_LEN = 2048;
var PROBE_BLOCKS = 16;

export type SourceProbeResult = {
  ok: boolean;
  /** Suggested user-facing reason when !ok. */
  message?: string;
  /** True when payload looks CSS-scrambled (readable but encrypted). */
  cssLike?: boolean;
  /** True when reads failed with EIO/EACCES-style errors. */
  ioError?: boolean;
};

/**
 * Check the first menu VOB(s) under dvdPath/VIDEO_TS.
 * Resolves ok:true when readable and not CSS-like.
 */
export function probeDvdSource(dvdPath: string): Promise<SourceProbeResult> {
  var vobGlob = path.join(dvdPath, 'VIDEO_TS', '*.VOB');
  return new Promise(function (resolve) {
    globFiles(vobGlob, function (err, files) {
      if (err) {
        resolve({
          ok: false,
          ioError: true,
          message: 'Cannot list VOBs under ' + dvdPath + ': ' + String(err),
        });
        return;
      }
      var menuVobs = (files || []).filter(serverUtils.isMenuVob);
      if (!menuVobs.length) {
        // No menus — let convert continue (some discs are menu-less).
        resolve({ ok: true });
        return;
      }

      for (var i = 0; i < menuVobs.length; i++) {
        var result = probeVobFile(menuVobs[i]);
        if (!result.ok) {
          resolve(result);
          return;
        }
      }
      resolve({ ok: true });
    });
  });
}

/**
 * Probe a single VOB for I/O failure or CSS-like entropy.
 */
export function probeVobFile(vobPath: string): SourceProbeResult {
  var name = path.basename(vobPath);
  var fd;
  try {
    fd = fs.openSync(vobPath, 'r');
  } catch (e: any) {
    return ioFail(name, e);
  }

  var buf = Buffer.alloc(DVD_VIDEO_LB_LEN * PROBE_BLOCKS);
  var bytesRead = 0;
  try {
    bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
  } catch (e: any) {
    try {
      fs.closeSync(fd);
    } catch (closeErr) {
      // ignore
    }
    return ioFail(name, e);
  }
  try {
    fs.closeSync(fd);
  } catch (e) {
    // ignore
  }

  if (bytesRead < DVD_VIDEO_LB_LEN) {
    // Tiny/empty placeholder — skip CSS check.
    return { ok: true };
  }

  buf = buf.subarray(0, bytesRead);
  var packs = 0;
  for (var i = 0; i + 4 <= buf.length; i += DVD_VIDEO_LB_LEN) {
    if (
      buf[i] === 0 &&
      buf[i + 1] === 0 &&
      buf[i + 2] === 1 &&
      buf[i + 3] === 0xba
    ) {
      packs++;
    }
  }

  var freq = new Map();
  for (var j = 0; j < buf.length; j++) {
    freq.set(buf[j], (freq.get(buf[j]) || 0) + 1);
  }
  var entropy = 0;
  freq.forEach(function (count) {
    var p = count / buf.length;
    entropy -= p * Math.log2(p);
  });

  // Readable sectors with MPEG pack sync but near-random payload → CSS.
  if (packs >= 8 && entropy >= CSS_LIKE_ENTROPY) {
    return {
      ok: false,
      cssLike: true,
      message:
        name +
        ' looks CSS-encrypted (entropy ' +
        entropy.toFixed(2) +
        '). Plain file reads cannot decrypt CSS. Re-run with --rip ' +
        '(dvdbackup + libdvdcss), e.g.:\n' +
        '  pnpm convert -- --rip --work-dir ~/dvd/work <source>',
    };
  }

  return { ok: true };
}

function ioFail(name: string, e: any): SourceProbeResult {
  var code = e && e.code;
  var hint =
    code === 'EIO' || code === 'EACCES' || code === 'EPERM'
      ? ' Optical/CSS-protected discs often return I/O errors when read as plain files. Re-run with --rip.'
      : '';
  return {
    ok: false,
    ioError: true,
    message:
      'Cannot read ' +
      name +
      (code ? ' (' + code + ')' : '') +
      '.' +
      hint +
      '\n  pnpm convert -- --rip --work-dir ~/dvd/work <source>',
  };
}
