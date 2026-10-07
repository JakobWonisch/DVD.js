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
import * as os from 'node:os';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import { promisify } from 'node:util';
import { MARKER } from '../projectId.js';

const execFile = promisify(child_process.execFile);

/** How long a decompressed disc stays on disk after last access. */
export const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Convert markers older than this are treated as crashed converts and cleared
 * so ensure/PlayDisc are not stuck forever. Full --full encodes of large discs
 * can take hours — keep this well above a worst-case overnight encode.
 */
export const CONVERTING_STALE_MS = 12 * 60 * 60 * 1000;

/** Marker file written inside a decompressed disc folder (last access). */
const ACCESS_MARKER = MARKER.accessed;
const ACCESS_MARKER_LEGACY = MARKER.accessedLegacy;

/**
 * Marker written at extract time: archive mtimeMs when this folder was unpacked.
 * Used to detect reconverted / replaced .tar.gz files.
 */
const ARCHIVE_MTIME_MARKER = MARKER.archiveMtime;
const ARCHIVE_MTIME_MARKER_LEGACY = MARKER.archiveMtimeLegacy;

/**
 * Convert-in-progress marker. While present, ensure/extract must not rm the
 * disc folder (that raced with pack and produced archives missing metadata.json
 * — metadata is packed late in directory order).
 */
const CONVERTING_MARKER = MARKER.converting;
const CONVERTING_MARKER_LEGACY = MARKER.convertingLegacy;

/** Safe disc folder / archive stem (no path separators or spaces). */
const DISC_ID_RE = /^[A-Za-z0-9._-]+$/;

/** Max length for archive stems / dvdbackup `-n` titles. */
const DISC_ID_MAX_LEN = 32;

/** Large enough for `tar -tzf` listings of per-cell menu packages. */
const TAR_MAX_BUFFER = 64 * 1024 * 1024;

const inflight = new Map<string, Promise<void>>();

/** Serialize pack + extract per discId so neither rm's the other's tree. */
const discLocks = new Map<string, Promise<unknown>>();

function withDiscLock<T>(discId: string, fn: () => Promise<T>): Promise<T> {
  var prev = discLocks.get(discId) || Promise.resolve();
  var run = prev.catch(function () {}).then(fn);
  discLocks.set(
    discId,
    run.then(
      function () {},
      function () {},
    ),
  );
  return run;
}

function convertingMarkerPath(webFolder: string, discId: string): string {
  return path.join(discDirPath(webFolder, discId), CONVERTING_MARKER);
}

function convertingMarkerPathLegacy(webFolder: string, discId: string): string {
  return path.join(discDirPath(webFolder, discId), CONVERTING_MARKER_LEGACY);
}

/** Path of an existing converting marker (modern or legacy), or null. */
function findConvertingMarker(
  webFolder: string,
  discId: string,
): string | null {
  var modern = convertingMarkerPath(webFolder, discId);
  if (fs.existsSync(modern)) {
    return modern;
  }
  var legacy = convertingMarkerPathLegacy(webFolder, discId);
  return fs.existsSync(legacy) ? legacy : null;
}

/** True while convert owns this disc folder (do not extract over it). */
export function isDiscConverting(webFolder: string, discId: string): boolean {
  clearStaleConvertingMarker(webFolder, discId);
  return findConvertingMarker(webFolder, discId) != null;
}

/**
 * If the converting marker is older than CONVERTING_STALE_MS, clear it.
 * Crash / kill mid-convert otherwise leaves ensure stuck on decompressing.
 */
export function clearStaleConvertingMarker(
  webFolder: string,
  discId: string,
): boolean {
  var marker = findConvertingMarker(webFolder, discId);
  if (!marker) {
    return false;
  }
  var started = NaN;
  try {
    var raw = fs.readFileSync(marker, 'utf8').trim();
    started = parseInt(raw, 10);
  } catch {
    started = NaN;
  }
  if (!Number.isFinite(started)) {
    try {
      started = fs.statSync(marker).mtimeMs;
    } catch {
      return false;
    }
  }
  if (Date.now() - started < CONVERTING_STALE_MS) {
    return false;
  }
  endDiscConvert(webFolder, discId);
  return true;
}

/**
 * Mark a disc folder as owned by convert. Call at pipeline start; clear via
 * endDiscConvert after pack (success or failure).
 */
export function beginDiscConvert(webFolder: string, discId: string): void {
  if (!isSafeDiscId(discId)) {
    throw new Error('Invalid disc id: ' + discId);
  }
  var dir = discDirPath(webFolder, discId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    convertingMarkerPath(webFolder, discId),
    String(Date.now()) + '\n',
  );
}

/** Clear the convert-in-progress marker (idempotent; modern + legacy names). */
export function endDiscConvert(webFolder: string, discId: string): void {
  for (var marker of [
    convertingMarkerPath(webFolder, discId),
    convertingMarkerPathLegacy(webFolder, discId),
  ]) {
    try {
      fs.unlinkSync(marker);
    } catch {
      // ignore
    }
  }
}

async function runTar(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFile('tar', args, { maxBuffer: TAR_MAX_BUFFER });
}

/**
 * List archive members and require discId/metadata.json (and vm.js when present
 * in the source folder). Used before deleting the unpacked convert tree.
 */
export async function archiveHasRequiredFiles(
  archive: string,
  discId: string,
  opts?: { requireVm?: boolean },
): Promise<boolean> {
  var listed = await runTar(['-tzf', archive]);
  var lines = listed.stdout.split(/\r?\n/);
  var meta = discId + '/metadata.json';
  var hasMeta = false;
  var hasVm = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/^\.?\//, '');
    if (line === meta || line === meta + '/') {
      hasMeta = true;
    }
    if (line === discId + '/vm.js') {
      hasVm = true;
    }
  }
  if (!hasMeta) {
    return false;
  }
  if (opts && opts.requireVm && !hasVm) {
    return false;
  }
  return true;
}

/**
 * Build an ordered file list so metadata.json / vm.js are archived first.
 * Truncated packs then still extract far enough to be usable / diagnosable.
 */
/**
 * IFO / NAV sector JSON written during convert. Needed for --vm-only /
 * reconvert on the unpacked tree, but not for playback — omit from .tar.gz.
 */
export function isConvertScratchJson(name: string): boolean {
  return /^(VIDEO_TS|VTS_\d{2}_\d+)(-0x[0-9A-Fa-f]+)?\.json$/i.test(name);
}

function writeOrderedTarFileList(webFolder: string, discId: string): string {
  var dir = discDirPath(webFolder, discId);
  var names = fs.readdirSync(dir).filter(function (name) {
    return (
      name !== ACCESS_MARKER &&
      name !== ACCESS_MARKER_LEGACY &&
      name !== ARCHIVE_MTIME_MARKER &&
      name !== ARCHIVE_MTIME_MARKER_LEGACY &&
      name !== CONVERTING_MARKER &&
      name !== CONVERTING_MARKER_LEGACY &&
      !isConvertScratchJson(name)
    );
  });
  var priority = ['metadata.json', 'vm.js', 'cover.jpg'];
  var ordered: string[] = [];
  for (var p = 0; p < priority.length; p++) {
    var hit = priority[p];
    if (names.indexOf(hit) !== -1) {
      ordered.push(hit);
    }
  }
  names.sort();
  for (var i = 0; i < names.length; i++) {
    if (ordered.indexOf(names[i]) === -1) {
      ordered.push(names[i]);
    }
  }
  var listPath = path.join(
    os.tmpdir(),
    'dvd-menu-archive-pack-' + discId + '-' + process.pid + '.txt',
  );
  fs.writeFileSync(
    listPath,
    ordered.map(function (n) {
      return discId + '/' + n;
    }).join('\n') + '\n',
  );
  return listPath;
}

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

function findAccessMarker(webFolder: string, discId: string): string | null {
  var modern = accessMarkerPath(webFolder, discId);
  if (fs.existsSync(modern)) {
    return modern;
  }
  var legacy = path.join(discDirPath(webFolder, discId), ACCESS_MARKER_LEGACY);
  return fs.existsSync(legacy) ? legacy : null;
}

function archiveMtimeMarkerPath(webFolder: string, discId: string): string {
  return path.join(discDirPath(webFolder, discId), ARCHIVE_MTIME_MARKER);
}

function findArchiveMtimeMarker(
  webFolder: string,
  discId: string,
): string | null {
  var modern = archiveMtimeMarkerPath(webFolder, discId);
  if (fs.existsSync(modern)) {
    return modern;
  }
  var legacy = path.join(
    discDirPath(webFolder, discId),
    ARCHIVE_MTIME_MARKER_LEGACY,
  );
  return fs.existsSync(legacy) ? legacy : null;
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
  var marker = findArchiveMtimeMarker(webFolder, discId);
  if (!marker) {
    return null;
  }
  try {
    var raw = fs.readFileSync(marker, 'utf8').trim();
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
    try {
      fs.unlinkSync(path.join(dir, ARCHIVE_MTIME_MARKER_LEGACY));
    } catch {
      // ignore
    }
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
    // Drop legacy name once we can write the modern marker.
    try {
      fs.unlinkSync(path.join(dir, ACCESS_MARKER_LEGACY));
    } catch {
      // ignore
    }
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
  var marker = findAccessMarker(webFolder, discId);
  if (marker) {
    try {
      var raw = fs.readFileSync(marker, 'utf8').trim();
      var n = Number(raw);
      if (Number.isFinite(n) && n > 0) {
        return n;
      }
    } catch {
      // fall through to directory mtime
    }
  }
  try {
    return fs.statSync(discDirPath(webFolder, discId)).mtimeMs;
  } catch {
    return 0;
  }
}

export type PackDiscArchiveOptions = {
  /**
   * When true (local/dev: `evictDiscCache: false`), leave the convert tree on
   * disk after packing so IFO/NAV JSON remain for `--vm-only` / iteration.
   * Stamp archive-mtime so ensure will not re-extract over that tree.
   * When false (production: `evictDiscCache: true`), delete the folder after
   * a successful pack (archive-only at rest).
   */
  keepUnpacked?: boolean;
};

/**
 * Pack a converted disc folder into <discId>.tar.gz and keep cover.jpg as a
 * sidecar. By default removes the folder; pass `keepUnpacked: true` for dev.
 */
export async function packDiscArchive(
  webFolder: string,
  discId: string,
  opts?: PackDiscArchiveOptions,
): Promise<void> {
  if (!isSafeDiscId(discId)) {
    throw new Error('Invalid disc id: ' + discId);
  }
  var keepUnpacked = !!(opts && opts.keepUnpacked);
  return withDiscLock(discId, async function () {
    var dir = discDirPath(webFolder, discId);
    if (!fs.existsSync(path.join(dir, 'metadata.json'))) {
      throw new Error('Cannot pack ' + discId + ': missing metadata.json');
    }
    var requireVm = fs.existsSync(path.join(dir, 'vm.js'));

    var coverSrc = path.join(dir, 'cover.jpg');
    var coverDst = coverSidecarPath(webFolder, discId);
    if (fs.existsSync(coverSrc)) {
      await fs.promises.copyFile(coverSrc, coverDst);
    }

    // Drop cache markers so they are not archived (converting cleared after pack).
    for (var marker of [
      ACCESS_MARKER,
      ACCESS_MARKER_LEGACY,
      ARCHIVE_MTIME_MARKER,
      ARCHIVE_MTIME_MARKER_LEGACY,
    ]) {
      try {
        await fs.promises.unlink(path.join(dir, marker));
      } catch {
        // ignore
      }
    }

    var outArchive = archivePath(webFolder, discId);
    var tmpArchive = outArchive + '.partial';
    var listPath = writeOrderedTarFileList(webFolder, discId);
    try {
      await runTar([
        '-czf',
        tmpArchive,
        '-C',
        webFolder,
        '--files-from',
        listPath,
      ]);
      var ok = await archiveHasRequiredFiles(tmpArchive, discId, {
        requireVm: requireVm,
      });
      if (!ok) {
        throw new Error(
          'Pack of ' +
            discId +
            ' produced an archive missing metadata.json' +
            (requireVm ? ' or vm.js' : '') +
            ' — leaving unpacked folder in place',
        );
      }
      await fs.promises.rename(tmpArchive, outArchive);
    } catch (err) {
      try {
        await fs.promises.unlink(tmpArchive);
      } catch {
        // ignore
      }
      throw err;
    } finally {
      try {
        await fs.promises.unlink(listPath);
      } catch {
        // ignore
      }
    }

    if (keepUnpacked) {
      // Dev: keep convert tree (scratch JSON + media). Mark it current so the
      // next ensureDiscReady does not re-extract the JSON-less archive over it.
      endDiscConvert(webFolder, discId);
      var packedMtime = archiveMtimeMs(webFolder, discId);
      if (packedMtime > 0) {
        writeArchiveMtimeMarker(webFolder, discId, packedMtime);
      }
      touchAccess(webFolder, discId);
      return;
    }

    // Rename away first so ensure cannot report ready on a folder we are about
    // to delete (marker lives inside the dir and goes with it). Concurrent
    // extract waits on the same disc lock.
    var removing = dir + '.removing';
    try {
      await fs.promises.rename(dir, removing);
    } catch (err) {
      // Folder vanished or rename failed — still try to clear a leftover marker.
      endDiscConvert(webFolder, discId);
      throw err;
    }
    try {
      await fs.promises.rm(removing, { recursive: true, force: true });
    } catch (err) {
      // Leave .removing for manual cleanup; convert marker is gone with rename.
      throw err;
    }
  });
}

async function extractArchive(webFolder: string, discId: string): Promise<void> {
  return withDiscLock(discId, async function () {
    // Convert owns this tree — never rm over a live convert/pack.
    if (isDiscConverting(webFolder, discId)) {
      return;
    }
    // Another pack/extract may have made the folder ready while we waited.
    if (isDiscReady(webFolder, discId) && !isExtractStale(webFolder, discId)) {
      touchAccess(webFolder, discId);
      return;
    }

    var archive = archivePath(webFolder, discId);
    var staging = stagingPath(webFolder, discId);
    var dest = discDirPath(webFolder, discId);
    // Capture before extract; rename/touch must not race a mid-flight replace.
    var sourceMtime = archiveMtimeMs(webFolder, discId);

    await fs.promises.rm(staging, { recursive: true, force: true });
    await fs.promises.mkdir(staging, { recursive: true });

    try {
      await runTar(['-xzf', archive, '-C', staging]);
      var extracted = path.join(staging, discId);
      if (!fs.existsSync(path.join(extracted, 'metadata.json'))) {
        var hint = '';
        try {
          var stagingEntries = fs.readdirSync(staging);
          hint =
            ' (staging had: ' +
            (stagingEntries.length
              ? stagingEntries.slice(0, 8).join(', ')
              : 'empty') +
            ')';
          if (fs.existsSync(extracted)) {
            var top = fs.readdirSync(extracted).slice(0, 12);
            hint +=
              '; ' +
              discId +
              '/ had: ' +
              (top.length ? top.join(', ') : 'empty');
          }
        } catch {
          // ignore listing failures
        }
        throw new Error(
          'Archive ' +
            path.basename(archive) +
            ' did not contain metadata.json' +
            hint,
        );
      }
      if (isDiscConverting(webFolder, discId)) {
        // Convert started while we extracted — discard staging, keep convert tree.
        return;
      }
      await fs.promises.rm(dest, { recursive: true, force: true });
      await fs.promises.rename(extracted, dest);
    } finally {
      await fs.promises.rm(staging, { recursive: true, force: true });
    }

    writeArchiveMtimeMarker(webFolder, discId, sourceMtime);
    touchAccess(webFolder, discId);
  });
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

  // Convert owns the folder: never extract/rm over it.
  if (isDiscConverting(webFolder, discId)) {
    if (isDiscReady(webFolder, discId)) {
      touchAccess(webFolder, discId);
      return 'ready';
    }
    // Wait for convert to write metadata — do not unpack the previous archive.
    return 'decompressing';
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
      '). Archives cannot be extracted. In Docker, set DVD_MENU_ARCHIVE_UID/DVD_MENU_ARCHIVE_GID to the host owner of the volume (id -u / id -g).',
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
  // Convert-in-progress without metadata: poll briefly rather than hang forever.
  if (isDiscConverting(webFolder, discId) && !inflight.has(discId)) {
    var deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (isDiscReady(webFolder, discId)) {
        touchAccess(webFolder, discId);
        return 'ready';
      }
      if (!isDiscConverting(webFolder, discId)) {
        break;
      }
      await new Promise(function (r) {
        setTimeout(r, 250);
      });
    }
    return isDiscReady(webFolder, discId) ? 'ready' : 'missing';
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
    if (isDiscConverting(webFolder, name)) {
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
