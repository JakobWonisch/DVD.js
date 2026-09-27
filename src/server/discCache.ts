/**
 * Compressed-at-rest disc packages with a short-lived decompressed cache.
 *
 * At rest: webFolder/<discId>.tar.gz (+ optional <discId>.cover.jpg).
 * On first access: extract to webFolder/<discId>/.
 * Optional production eviction (config.evictDiscCache): remove the folder after
 * CACHE_TTL_MS idle, leaving only the archive.
 */

'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(child_process.execFile);

/** How long a decompressed disc stays on disk after last access. */
export const CACHE_TTL_MS = 60 * 60 * 1000;

/** Marker file written inside a decompressed disc folder. */
const ACCESS_MARKER = '.dvdjs-accessed';

/** Safe disc folder / archive stem (no path separators). */
const DISC_ID_RE = /^[A-Za-z0-9._-]+$/;

const inflight = new Map<string, Promise<void>>();

export type DiscReadyStatus = 'ready' | 'decompressing' | 'missing';

export function isSafeDiscId(discId: string): boolean {
  return DISC_ID_RE.test(discId);
}

export function archivePath(webFolder: string, discId: string): string {
  return path.join(webFolder, discId + '.tar.gz');
}

export function coverSidecarPath(webFolder: string, discId: string): string {
  return path.join(webFolder, discId + '.cover.jpg');
}

export function discDirPath(webFolder: string, discId: string): string {
  return path.join(webFolder, discId);
}

function accessMarkerPath(webFolder: string, discId: string): string {
  return path.join(discDirPath(webFolder, discId), ACCESS_MARKER);
}

function stagingPath(webFolder: string, discId: string): string {
  return path.join(webFolder, '.' + discId + '.extracting');
}

export function hasArchive(webFolder: string, discId: string): boolean {
  return fs.existsSync(archivePath(webFolder, discId));
}

/** True when metadata.json is present (usable by the viewer). */
export function isDiscReady(webFolder: string, discId: string): boolean {
  return fs.existsSync(
    path.join(discDirPath(webFolder, discId), 'metadata.json'),
  );
}

export function touchAccess(webFolder: string, discId: string): void {
  var marker = accessMarkerPath(webFolder, discId);
  var dir = discDirPath(webFolder, discId);
  if (!fs.existsSync(dir)) {
    return;
  }
  fs.writeFileSync(marker, String(Date.now()) + '\n');
}

function lastAccessMs(webFolder: string, discId: string): number {
  var marker = accessMarkerPath(webFolder, discId);
  try {
    var raw = fs.readFileSync(marker, 'utf8').trim();
    var n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  } catch {
    // fall through to directory mtime
  }
  try {
    return fs.statSync(discDirPath(webFolder, discId)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Pack a converted disc folder into <discId>.tar.gz, keep cover.jpg as a
 * sidecar for the catalogue, and remove the folder.
 */
export async function packDiscArchive(
  webFolder: string,
  discId: string,
): Promise<void> {
  if (!isSafeDiscId(discId)) {
    throw new Error('Invalid disc id: ' + discId);
  }
  var dir = discDirPath(webFolder, discId);
  if (!fs.existsSync(path.join(dir, 'metadata.json'))) {
    throw new Error('Cannot pack ' + discId + ': missing metadata.json');
  }

  var coverSrc = path.join(dir, 'cover.jpg');
  var coverDst = coverSidecarPath(webFolder, discId);
  if (fs.existsSync(coverSrc)) {
    await fs.promises.copyFile(coverSrc, coverDst);
  }

  // Drop access marker so it is not archived.
  try {
    await fs.promises.unlink(accessMarkerPath(webFolder, discId));
  } catch {
    // ignore
  }

  var outArchive = archivePath(webFolder, discId);
  var tmpArchive = outArchive + '.partial';
  try {
    await execFile('tar', ['-czf', tmpArchive, '-C', webFolder, discId]);
    await fs.promises.rename(tmpArchive, outArchive);
  } catch (err) {
    try {
      await fs.promises.unlink(tmpArchive);
    } catch {
      // ignore
    }
    throw err;
  }

  await fs.promises.rm(dir, { recursive: true, force: true });
}

async function extractArchive(webFolder: string, discId: string): Promise<void> {
  var archive = archivePath(webFolder, discId);
  var staging = stagingPath(webFolder, discId);
  var dest = discDirPath(webFolder, discId);

  await fs.promises.rm(staging, { recursive: true, force: true });
  await fs.promises.mkdir(staging, { recursive: true });

  try {
    await execFile('tar', ['-xzf', archive, '-C', staging]);
    var extracted = path.join(staging, discId);
    if (!fs.existsSync(path.join(extracted, 'metadata.json'))) {
      throw new Error(
        'Archive ' + path.basename(archive) + ' did not contain metadata.json',
      );
    }
    await fs.promises.rm(dest, { recursive: true, force: true });
    await fs.promises.rename(extracted, dest);
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true });
  }

  touchAccess(webFolder, discId);
}

/**
 * Ensure the disc folder is available. Starts extraction in the background when
 * only the archive exists; concurrent callers share one in-flight job.
 */
export function ensureDiscReady(
  webFolder: string,
  discId: string,
): DiscReadyStatus {
  if (!isSafeDiscId(discId)) {
    return 'missing';
  }

  if (isDiscReady(webFolder, discId)) {
    touchAccess(webFolder, discId);
    return 'ready';
  }

  if (!hasArchive(webFolder, discId)) {
    return 'missing';
  }

  if (!inflight.has(discId)) {
    var job = extractArchive(webFolder, discId).finally(function () {
      inflight.delete(discId);
    });
    inflight.set(discId, job);
  }

  return 'decompressing';
}

/** Await a ready disc (used by convert --vm-only). */
export async function waitUntilDiscReady(
  webFolder: string,
  discId: string,
): Promise<DiscReadyStatus> {
  var status = ensureDiscReady(webFolder, discId);
  if (status !== 'decompressing') {
    return status;
  }
  var job = inflight.get(discId);
  if (job) {
    await job;
  }
  return isDiscReady(webFolder, discId) ? 'ready' : 'missing';
}

/**
 * Remove decompressed folders older than CACHE_TTL_MS when an archive exists.
 * Unpacked-only discs (no .tar.gz) are never evicted.
 */
export function evictExpiredDiscCache(webFolder: string): string[] {
  var removed: string[] = [];
  if (!fs.existsSync(webFolder)) {
    return removed;
  }

  var entries = fs.readdirSync(webFolder);
  var now = Date.now();

  for (var i = 0; i < entries.length; i++) {
    var name = entries[i];
    if (!isSafeDiscId(name)) {
      continue;
    }
    var dir = path.join(webFolder, name);
    var st: fs.Stats;
    try {
      st = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) {
      continue;
    }
    if (!hasArchive(webFolder, name)) {
      continue;
    }
    if (!isDiscReady(webFolder, name)) {
      continue;
    }
    if (inflight.has(name)) {
      continue;
    }
    if (now - lastAccessMs(webFolder, name) < CACHE_TTL_MS) {
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    removed.push(name);
  }

  return removed;
}

/** Start periodic eviction (no-op if interval already running in this process). */
var evictionTimer: ReturnType<typeof setInterval> | null = null;

export function startDiscCacheEviction(
  webFolder: string,
  intervalMs: number = 5 * 60 * 1000,
): void {
  if (evictionTimer) {
    return;
  }
  evictionTimer = setInterval(function () {
    try {
      var removed = evictExpiredDiscCache(webFolder);
      if (removed.length) {
        console.log(
          'Disc cache evicted (archive kept): ' + removed.join(', '),
        );
      }
    } catch (err) {
      console.error('Disc cache eviction failed', err);
    }
  }, intervalMs);
  // Do not keep the process alive solely for eviction.
  if (typeof evictionTimer.unref === 'function') {
    evictionTimer.unref();
  }
}
