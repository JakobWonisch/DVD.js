/**
 * Rip / decrypt a DVD source into a writable VIDEO_TS tree.
 *
 * CSS decryption belongs only here (via dvdbackup + libdvdcss), never in
 * encode/convert/upload. Linux first (`/dev/sr*`, system/Nix dvdbackup);
 * Windows/macOS device paths and binary lookup come later.
 *
 * @see AGENTS.md — Standalone converter app → Where CSS decryption sits
 */

'use strict';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as child_process from 'node:child_process';

/** Options for a decrypting rip. */
export type RipOptions = {
  /** Optical device, ISO path, or mount point / VIDEO_TS parent. */
  source: string;
  /** Writable directory that will contain the ripped disc folder. */
  workDir: string;
  /**
   * When true, after a full mirror remove title VOBs (VTS_*_[1-9].VOB) to
   * save space. Menu IFOs/VOBs are kept. dvdbackup has no menus-only flag.
   */
  menusOnly?: boolean;
};

/** Result of a rip attempt. */
export type RipResult = {
  ok: boolean;
  /** Path to the disc root that contains VIDEO_TS (when ok). */
  dvdPath?: string;
  message: string;
};

/**
 * Decrypt and copy a disc/ISO into workDir using dvdbackup (libdvdcss).
 *
 * @param {RipOptions} options
 * @returns {Promise<RipResult>}
 */
export default async function ripDisc(options: RipOptions): Promise<RipResult> {
  var source = path.resolve(options.source);
  var workDir = path.resolve(options.workDir);

  if (!fs.existsSync(source)) {
    return {
      ok: false,
      message: 'Rip source does not exist: ' + source,
    };
  }

  var dvdbackupBin = findBinary('dvdbackup');
  if (!dvdbackupBin) {
    return {
      ok: false,
      message:
        'dvdbackup not found on PATH. Enter the Nix devShell (`nix develop`) or install dvdbackup + libdvdcss.',
    };
  }

  try {
    fs.mkdirSync(workDir, { recursive: true });
  } catch (e) {
    return {
      ok: false,
      message: 'Cannot create work dir ' + workDir + ': ' + String(e),
    };
  }

  var cacheDir =
    process.env.DVDCSS_CACHE ||
    path.join(
      process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'),
      'dvdcss',
    );
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch (e) {
    // non-fatal — libdvdcss may still work without a cache
  }

  var before = listImmediateSubdirs(workDir);

  var ripInput = resolveRipInput(source);
  var args = ['-i', ripInput.input, '-o', workDir, '-M'];
  if (ripInput.titleName) {
    // Required when -i is a directory (mounted disc / VIDEO_TS on disk).
    args.push('-n', ripInput.titleName);
  }

  process.stdout.write(
    'Ripping (dvdbackup -M) from ' +
      ripInput.input +
      (ripInput.input !== source ? ' (from mount ' + source + ')' : '') +
      ' → ' +
      workDir +
      (ripInput.titleName ? ' [name=' + ripInput.titleName + ']' : '') +
      '\n'
  );

  var code = await runDvdbackup(dvdbackupBin, args, cacheDir);
  if (code !== 0) {
    return {
      ok: false,
      message:
        'dvdbackup exited with code ' +
        code +
        '. Check device permissions (ACL/`cdrom` group) and that libdvdcss is available.',
    };
  }

  var dvdPath = findNewVideoTsRoot(workDir, before);
  if (!dvdPath) {
    // Mirror into an existing volume folder name; scan whole workDir.
    dvdPath = findVideoTsRoot(workDir);
  }
  if (!dvdPath) {
    return {
      ok: false,
      message:
        'dvdbackup finished but no VIDEO_TS tree was found under ' + workDir,
    };
  }

  if (options.menusOnly) {
    pruneTitleVobs(path.join(dvdPath, 'VIDEO_TS'));
  }

  return {
    ok: true,
    dvdPath: dvdPath,
    message: 'Ripped decrypted disc to ' + dvdPath,
  };
}

/**
 * True when convert should rip before reading VOBs (block device or ISO).
 */
export function sourceNeedsRip(sourcePath: string): boolean {
  var resolved = path.resolve(sourcePath);
  if (/\.iso$/i.test(resolved)) {
    return true;
  }
  try {
    var st = fs.statSync(resolved);
    if (st.isBlockDevice()) {
      return true;
    }
  } catch (e) {
    return false;
  }
  // /dev/sr0 etc. even if stat quirks
  if (/^\/dev\/(sr|cdrom|dvd|sg)/i.test(resolved)) {
    return true;
  }
  return false;
}

function findBinary(name: string): string | null {
  var pathEnv = process.env.PATH || '';
  var parts = pathEnv.split(path.delimiter);
  for (var i = 0; i < parts.length; i++) {
    var candidate = path.join(parts[i], name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (e) {
      // continue
    }
  }
  return null;
}

/**
 * Prefer the underlying block device for mounts (better CSS auth), and always
 * supply -n when the user path is a directory (dvdbackup requires a title).
 */
export function resolveRipInput(source: string): {
  input: string;
  titleName: string | null;
} {
  var titleFromPath = sanitizeTitleName(path.basename(source));
  try {
    var st = fs.statSync(source);
    if (st.isDirectory()) {
      var device = findMountDevice(source);
      if (device) {
        return { input: device, titleName: titleFromPath };
      }
      return { input: source, titleName: titleFromPath };
    }
    if (st.isBlockDevice()) {
      return { input: source, titleName: null };
    }
  } catch (e) {
    // fall through
  }
  if (/\.iso$/i.test(source)) {
    return { input: source, titleName: titleFromPath };
  }
  return { input: source, titleName: null };
}

/** dvdbackup -n: letters, digits, underscore; max ~32 is safe. */
export function sanitizeTitleName(name: string): string {
  var cleaned = name
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleaned) {
    cleaned = 'DVD';
  }
  return cleaned.slice(0, 32);
}

/**
 * Resolve mountpoint → /dev/sr* via findmnt, else /proc/mounts.
 */
function findMountDevice(mountPath: string): string | null {
  var resolved = path.resolve(mountPath);
  var findmnt = findBinary('findmnt');
  if (findmnt) {
    try {
      var out = child_process.execFileSync(
        findmnt,
        ['-n', '-o', 'SOURCE', '--target', resolved],
        { encoding: 'utf8' },
      );
      var device = out.trim().split(/\s+/)[0];
      if (device && fs.existsSync(device)) {
        return device;
      }
    } catch (e) {
      // fall through to /proc/mounts
    }
  }

  try {
    var mounts = fs.readFileSync('/proc/mounts', 'utf8').split('\n');
    var best: string | null = null;
    var bestLen = -1;
    for (var i = 0; i < mounts.length; i++) {
      var parts = mounts[i].split(' ');
      if (parts.length < 2) {
        continue;
      }
      var dev = parts[0];
      var mnt = parts[1].replace(/\\040/g, ' ');
      if (
        (resolved === mnt || resolved.startsWith(mnt + '/')) &&
        mnt.length > bestLen
      ) {
        best = dev;
        bestLen = mnt.length;
      }
    }
    if (best && fs.existsSync(best)) {
      return best;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

function runDvdbackup(
  bin: string,
  args: string[],
  cacheDir: string,
): Promise<number> {
  return new Promise(function (resolve) {
    var child = child_process.spawn(bin, args, {
      env: Object.assign({}, process.env, {
        DVDCSS_CACHE: cacheDir,
      }),
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('error', function (err) {
      console.error(err);
      resolve(1);
    });
    child.on('close', function (code) {
      resolve(code === null ? 1 : code);
    });
  });
}

function listImmediateSubdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(function (d) {
        return d.isDirectory();
      })
      .map(function (d) {
        return d.name;
      });
  } catch (e) {
    return [];
  }
}

function findNewVideoTsRoot(workDir: string, before: string[]): string | null {
  var after = listImmediateSubdirs(workDir);
  var created = after.filter(function (name) {
    return before.indexOf(name) === -1;
  });
  for (var i = 0; i < created.length; i++) {
    var root = path.join(workDir, created[i]);
    if (hasVideoTs(root)) {
      return root;
    }
  }
  return null;
}

function findVideoTsRoot(workDir: string): string | null {
  if (hasVideoTs(workDir)) {
    return workDir;
  }
  var subdirs = listImmediateSubdirs(workDir);
  for (var i = 0; i < subdirs.length; i++) {
    var root = path.join(workDir, subdirs[i]);
    if (hasVideoTs(root)) {
      return root;
    }
  }
  return null;
}

function hasVideoTs(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, 'VIDEO_TS')) ||
    fs.existsSync(path.join(dir, 'video_ts'))
  );
}

/**
 * Remove title-domain VOBs; keep VIDEO_TS.VOB and VTS_*_0.VOB (menus).
 */
function pruneTitleVobs(videoTsDir: string) {
  var entries;
  try {
    entries = fs.readdirSync(videoTsDir);
  } catch (e) {
    return;
  }
  for (var i = 0; i < entries.length; i++) {
    var name = entries[i];
    if (/^VTS_\d{1,2}_[1-9]\d*\.VOB$/i.test(name)) {
      var full = path.join(videoTsDir, name);
      try {
        fs.unlinkSync(full);
        process.stdout.write('Pruned title VOB: ' + name + '\n');
      } catch (e) {
        console.error('Could not prune ' + full + ':', e);
      }
    }
  }
}
