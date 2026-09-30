/**
 * Compressed-at-rest disc packages with a short-lived decompressed cache.
 *
 * At rest: webFolder/<discId>.tar.gz (+ optional <discId>.cover.jpg).
 * On first access: extract to webFolder/<discId>/.
 * If the archive is replaced (mtime newer than the mtime recorded at extract),
 * the next ensureDiscReady reextracts over the stale folder.
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

/** Marker file written inside a decompressed disc folder (last access). */
const ACCESS_MARKER = '.dvdjs-accessed';

/**
 * Marker written at extract time: archive mtimeMs when this folder was unpacked.
 * Used to detect reconverted / replaced .tar.gz files.
 */
const ARCHIVE_MTIME_MARKER = '.dvdjs-archive-mtime';

/** Safe disc folder / archive stem (no path separators or spaces). */
const DISC_ID_RE = /^[A-Za-z0-9._-]+$/;

/** Max length for archive stems / dvdbackup `-n` titles. */
const DISC_ID_MAX_LEN = 32;

const inflight = new Map<string, Promise<void>>();

export type DiscReadyStatus = 'ready' | 'decompressing' | 'missing';

/**
 * Turn a source folder / volume name into a safe disc id
 * (`[A-Za-z0-9._-]`, max 32). Spaces and other punctuation become `_`.
 */
export function sanitizeDiscId(name: string): string {
  var cleaned = String(name || '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleaned) {
    cleaned = 'DVD';
  }
  return cleaned.slice(0, DISC_ID_MAX_LEN);
}

export function isSafeDiscId(discId: string): boolean {
  return DISC_ID_RE.test(discId);
}

/**
 * Rename webFolder/<raw name with spaces>/ → <sanitized id>/ and rewrite
 * `/raw/` path prefixes inside metadata.json / vm.js. No-op when already safe
 * or the legacy folder is missing.
 */
export function migrateLegacyDiscDir(
  webFolder: string,
  dvdPath: string,
): string | null {
  var rawName = path.basename(String(dvdPath || '').replace(/[/\\]+$/, ''));
  var discId = sanitizeDiscId(rawName);
  if (!rawName || rawName === discId) {
    return null;
  }

  var rawPath = path.join(webFolder, rawName);
  var safePath = path.join(webFolder, discId);
  if (!fs.existsSync(rawPath) || fs.existsSync(safePath)) {
    return null;
  }
  if (!fs.existsSync(path.join(rawPath, 'metadata.json'))) {
    return null;
  }

  var fromPrefix = '/' + rawName + '/';
  var toPrefix = '/' + discId + '/';
  for (var file of ['metadata.json', 'vm.js']) {
    var filePath = path.join(rawPath, file);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    var text = fs.readFileSync(filePath, 'utf8');
    if (text.includes(fromPrefix)) {
      fs.writeFileSync(filePath, text.split(fromPrefix).join(toPrefix));
    }
  }

  fs.renameSync(rawPath, safePath);
  return discId;
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

function archiveMtimeMarkerPath(webFolder: string, discId: string): string {
  return path.join(discDirPath(webFolder, discId), ARCHIVE_MTIME_MARKER);
}

function stagingPath(webFolder: string, discId: string): string {
  return path.join(webFolder, '.' + discId + '.extracting');
}

function archiveMtimeMs(webFolder: string, discId: string): number {
  try {
    return fs.statSync(archivePath(webFolder, discId)).mtimeMs;
  } catch {
    return 0;
  }
}

function recordedArchiveMtimeMs(
  webFolder: string,
  discId: string,
): number | null {
  try {
    var raw = fs.readFileSync(archiveMtimeMarkerPath(webFolder, discId), 'utf8').trim();
    var n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  } catch {
    // missing or unreadable
  }
  return null;
}

function writeArchiveMtimeMarker(
  webFolder: string,
  discId: string,
  mtimeMs: number,
): void {
  var dir = discDirPath(webFolder, discId);
  if (!fs.existsSync(dir)) {
    return;
  }
  try {
    fs.writeFileSync(
      archiveMtimeMarkerPath(webFolder, discId),
      String(mtimeMs) + '\n',
    );
  } catch (err) {
    // Read-only bind mounts (Docker uid mismatch) must still serve the disc.
    var code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: string }).code)
        : '';
    if (code !== 'EACCES' && code !== 'EROFS' && code !== 'EPERM') {
      throw err;
    }
  }
}

/**
 * True when a .tar.gz exists and is newer than the archive we last extracted.
 * Folders extracted before this marker existed adopt the current archive mtime
 * (no forced reextract) so first access after upgrade stays fast.
 */
function isExtractStale(webFolder: string, discId: string): boolean {
  if (!hasArchive(webFolder, discId)) {
    return false;
  }
  var current = archiveMtimeMs(webFolder, discId);
  if (!(current > 0)) {
    return false;
  }
  var recorded = recordedArchiveMtimeMs(webFolder, discId);
  if (recorded === null) {
    writeArchiveMtimeMarker(webFolder, discId, current);
    return false;
  }
  return current > recorded;
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
  try {
    fs.writeFileSync(marker, String(Date.now()) + '\n');
  } catch (err) {
    // Ignore read-only volumes so ensure/static serve still works.
    var code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: string }).code)
        : '';
    if (code !== 'EACCES' && code !== 'EROFS' && code !== 'EPERM') {
      throw err;
    }
  }
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

  // Drop cache markers so they are not archived.
  for (var marker of [ACCESS_MARKER, ARCHIVE_MTIME_MARKER]) {
    try {
      await fs.promises.unlink(path.join(dir, marker));
    } catch {
      // ignore
    }
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
  // Capture before extract; rename/touch must not race a mid-flight replace.
  var sourceMtime = archiveMtimeMs(webFolder, discId);

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

  writeArchiveMtimeMarker(webFolder, discId, sourceMtime);
  touchAccess(webFolder, discId);
}

/**
 * Ensure the disc folder is available. Starts extraction in the background when
 * only the archive exists, or when the archive is newer than the last extract.
 * Concurrent callers share one in-flight job.
 */
export function ensureDiscReady(
  webFolder: string,
  discId: string,
): DiscReadyStatus {
  if (!isSafeDiscId(discId)) {
    return 'missing';
  }

  if (isDiscReady(webFolder, discId) && !isExtractStale(webFolder, discId)) {
    touchAccess(webFolder, discId);
    return 'ready';
  }

  if (!hasArchive(webFolder, discId)) {
    // Unpacked-only, or archive vanished mid-check: serve the folder if present.
    if (isDiscReady(webFolder, discId)) {
      touchAccess(webFolder, discId);
      return 'ready';
    }
    return 'missing';
  }

  if (!isWebFolderWritable(webFolder)) {
    warnIfWebFolderNotWritable(webFolder);
    return 'missing';
  }

  if (!inflight.has(discId)) {
    var job = extractArchive(webFolder, discId)
      .catch(function (err) {
        console.error(
          'Failed to extract ' + discId + ' into ' + webFolder + ':',
          err instanceof Error ? err.message : err,
        );
      })
      .finally(function () {
        inflight.delete(discId);
      });
    inflight.set(discId, job);
  }

  return 'decompressing';
}

/**
 * True when the process can create files under webFolder (needed to extract
 * archives and write cache markers). Logs a warning once when false.
 */
var webFolderWritableLogged = false;

export function isWebFolderWritable(webFolder: string): boolean {
  try {
    fs.accessSync(webFolder, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function warnIfWebFolderNotWritable(webFolder: string): void {
  if (webFolderWritableLogged || isWebFolderWritable(webFolder)) {
    return;
  }
  webFolderWritableLogged = true;
  console.warn(
    'webFolder is not writable (' +
      webFolder +
      '). Archives cannot be extracted. In Docker, set DVDJS_UID/DVDJS_GID to the host owner of the volume (id -u / id -g).',
  );
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
