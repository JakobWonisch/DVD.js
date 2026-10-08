import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import { promisify } from 'node:util';

import {
  CACHE_TTL_MS,
  CONVERTING_STALE_MS,
  archiveHasRequiredFiles,
  archivePath,
  beginDiscConvert,
  clearStaleConvertingMarker,
  coverSidecarPath,
  endDiscConvert,
  ensureDiscReady,
  evictExpiredDiscCache,
  hasArchive,
  isConvertScratchJson,
  isDiscConverting,
  isDiscReady,
  isSafeDiscId,
  migrateLegacyDiscDir,
  packDiscArchive,
  posterSidecarPath,
  sanitizeDiscId,
  waitUntilDiscReady,
} from '../../src/server/discCache.js';

const execFile = promisify(child_process.execFile);

function makeTempWebFolder(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dvd-menu-archive-cache-'));
}

function seedDisc(webFolder: string, discId: string): string {
  var dir = path.join(webFolder, discId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'), '[]\n');
  fs.writeFileSync(path.join(dir, 'cover.jpg'), 'fake-jpg');
  fs.writeFileSync(path.join(dir, 'vm.js'), '// vm\n');
  return dir;
}

afterEach(function () {
  vi.useRealTimers();
});

describe('isConvertScratchJson', () => {
  it('matches IFO and NAV dumps, not metadata', () => {
    expect(isConvertScratchJson('metadata.json')).toBe(false);
    expect(isConvertScratchJson('VIDEO_TS.json')).toBe(true);
    expect(isConvertScratchJson('VTS_01_0.json')).toBe(true);
    expect(isConvertScratchJson('VIDEO_TS-0x01000F.json')).toBe(true);
    expect(isConvertScratchJson('VTS_02_0-0x00.json')).toBe(true);
    expect(isConvertScratchJson('menu-0-1-1.webp')).toBe(false);
  });
});

describe('packDiscArchive', () => {
  it('creates tar.gz + cover sidecar and removes the folder', async () => {
    var webFolder = makeTempWebFolder();
    var discId = 'TestDisc';
    var dir = seedDisc(webFolder, discId);
    fs.writeFileSync(path.join(dir, 'poster.jpg'), 'fake-poster');
    beginDiscConvert(webFolder, discId);

    await packDiscArchive(webFolder, discId);

    expect(hasArchive(webFolder, discId)).toBe(true);
    expect(fs.existsSync(coverSidecarPath(webFolder, discId))).toBe(true);
    expect(fs.existsSync(posterSidecarPath(webFolder, discId))).toBe(true);
    expect(isDiscReady(webFolder, discId)).toBe(false);
    expect(fs.existsSync(path.join(webFolder, discId))).toBe(false);
    expect(await archiveHasRequiredFiles(archivePath(webFolder, discId), discId, {
      requireVm: true,
    })).toBe(true);
    // Critical files first so truncated packs still have metadata.
    var { stdout } = await execFile('tar', [
      '-tzf',
      archivePath(webFolder, discId),
    ]);
    var members = stdout.split(/\r?\n/).filter(Boolean);
    expect(members[0]).toBe(discId + '/metadata.json');
    expect(members[1]).toBe(discId + '/vm.js');

    fs.rmSync(webFolder, { recursive: true, force: true });
  });

  it('omits convert IFO/NAV JSON from the archive', async () => {
    var webFolder = makeTempWebFolder();
    var discId = 'ScratchJson';
    var dir = seedDisc(webFolder, discId);
    fs.writeFileSync(path.join(dir, 'VIDEO_TS.json'), '{}');
    fs.writeFileSync(path.join(dir, 'VTS_01_0.json'), '{}');
    fs.writeFileSync(path.join(dir, 'VIDEO_TS-0x01.json'), '{}');
    fs.writeFileSync(path.join(dir, 'menu-0-1-1.webp'), 'fake-webp');
    beginDiscConvert(webFolder, discId);

    await packDiscArchive(webFolder, discId);

    var { stdout } = await execFile('tar', [
      '-tzf',
      archivePath(webFolder, discId),
    ]);
    var members = stdout.split(/\r?\n/).filter(Boolean);
    expect(members).toContain(discId + '/metadata.json');
    expect(members).toContain(discId + '/menu-0-1-1.webp');
    expect(members).not.toContain(discId + '/VIDEO_TS.json');
    expect(members).not.toContain(discId + '/VTS_01_0.json');
    expect(members).not.toContain(discId + '/VIDEO_TS-0x01.json');

    fs.rmSync(webFolder, { recursive: true, force: true });
  });

  it('keepUnpacked leaves the convert tree and does not re-extract over it', async () => {
    var webFolder = makeTempWebFolder();
    var discId = 'KeepUnpack';
    var dir = seedDisc(webFolder, discId);
    fs.writeFileSync(path.join(dir, 'VIDEO_TS.json'), '{"vm":true}');
    beginDiscConvert(webFolder, discId);

    await packDiscArchive(webFolder, discId, { keepUnpacked: true });

    expect(hasArchive(webFolder, discId)).toBe(true);
    expect(isDiscReady(webFolder, discId)).toBe(true);
    expect(isDiscConverting(webFolder, discId)).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'VIDEO_TS.json'), 'utf8')).toBe(
      '{"vm":true}',
    );

    // ensure must not replace the kept tree with a JSON-less extract.
    await ensureDiscReady(webFolder, discId);
    expect(fs.existsSync(path.join(dir, 'VIDEO_TS.json'))).toBe(true);

    fs.rmSync(webFolder, { recursive: true, force: true });
  });

  it('refuses to delete the folder when the archive lacks metadata', async () => {
    var webFolder = makeTempWebFolder();
    var discId = 'BadPack';
    seedDisc(webFolder, discId);
    beginDiscConvert(webFolder, discId);

    var archive = archivePath(webFolder, discId);
    // Pretend a prior broken pack left a bad archive; spy by replacing tar via
    // writing a junk archive after a normal pack of a sibling, then packing with
    // a folder whose metadata is removed mid-flight is hard — instead pack a
    // folder, strip metadata from the archive, and re-run verify path by packing
    // an empty-named decoy. Simpler: pack then replace archive with one that
    // omits metadata and assert ensure fails; for pack itself, remove metadata
    // before pack should throw before delete.
    fs.unlinkSync(path.join(webFolder, discId, 'metadata.json'));
    await expect(packDiscArchive(webFolder, discId)).rejects.toThrow(
      /missing metadata\.json/,
    );
    expect(fs.existsSync(path.join(webFolder, discId))).toBe(true);
    expect(fs.existsSync(archive)).toBe(false);
    endDiscConvert(webFolder, discId);

    fs.rmSync(webFolder, { recursive: true, force: true });
  });
});

describe('convert-in-progress guard', () => {
  it('does not extract over a converting folder without metadata', async () => {
    var webFolder = makeTempWebFolder();
    var discId = 'LiveConvert';
    seedDisc(webFolder, discId);
    await packDiscArchive(webFolder, discId);
    expect(isDiscReady(webFolder, discId)).toBe(false);

    // Convert starts: empty folder + marker, no metadata yet.
    beginDiscConvert(webFolder, discId);
    expect(isDiscConverting(webFolder, discId)).toBe(true);
    expect(ensureDiscReady(webFolder, discId)).toBe('decompressing');
    // Give any accidental extract a moment; folder must stay convert-owned.
    await new Promise(function (r) {
      setTimeout(r, 100);
    });
    expect(fs.existsSync(path.join(webFolder, discId, 'metadata.json'))).toBe(
      false,
    );
    expect(isDiscConverting(webFolder, discId)).toBe(true);

    endDiscConvert(webFolder, discId);
    fs.rmSync(webFolder, { recursive: true, force: true });
  });

  it('serves metadata while converting and skips eviction', async () => {
    var webFolder = makeTempWebFolder();
    var discId = 'ConvertReady';
    seedDisc(webFolder, discId);
    // Keep a stale archive so eviction would otherwise be allowed.
    await packDiscArchive(webFolder, discId);
    await waitUntilDiscReady(webFolder, discId);
    beginDiscConvert(webFolder, discId);
    expect(ensureDiscReady(webFolder, discId)).toBe('ready');

    var marker = path.join(webFolder, discId, '.dvd-menu-archive-accessed');
    fs.writeFileSync(marker, String(Date.now() - CACHE_TTL_MS - 1000) + '\n');
    expect(evictExpiredDiscCache(webFolder)).toEqual([]);
    expect(isDiscReady(webFolder, discId)).toBe(true);

    endDiscConvert(webFolder, discId);
    fs.rmSync(webFolder, { recursive: true, force: true });
  });

  it('clears a stale converting marker so ensure can extract again', async () => {
    var webFolder = makeTempWebFolder();
    var discId = 'StaleConvert';
    seedDisc(webFolder, discId);
    await packDiscArchive(webFolder, discId);
    beginDiscConvert(webFolder, discId);
    var marker = path.join(webFolder, discId, '.dvd-menu-archive-converting');
    fs.writeFileSync(
      marker,
      String(Date.now() - CONVERTING_STALE_MS - 1000) + '\n',
    );
    expect(clearStaleConvertingMarker(webFolder, discId)).toBe(true);
    expect(isDiscConverting(webFolder, discId)).toBe(false);
    expect(ensureDiscReady(webFolder, discId)).toBe('decompressing');
    expect(await waitUntilDiscReady(webFolder, discId)).toBe('ready');

    fs.rmSync(webFolder, { recursive: true, force: true });
  });
});

describe('ensureDiscReady', () => {
  it('extracts archive on first access and reports ready after wait', async () => {
    var webFolder = makeTempWebFolder();
    var discId = 'MenuDisc';
    seedDisc(webFolder, discId);
    await packDiscArchive(webFolder, discId);

    expect(ensureDiscReady(webFolder, discId)).toBe('decompressing');
    var status = await waitUntilDiscReady(webFolder, discId);
    expect(status).toBe('ready');
    expect(isDiscReady(webFolder, discId)).toBe(true);
    expect(fs.existsSync(archivePath(webFolder, discId))).toBe(true);
    expect(fs.readFileSync(path.join(webFolder, discId, 'vm.js'), 'utf8')).toBe(
      '// vm\n',
    );

    // Second call is ready immediately.
    expect(ensureDiscReady(webFolder, discId)).toBe('ready');

    fs.rmSync(webFolder, { recursive: true, force: true });
  });

  it('reextracts when the archive is newer than the last extract', async () => {
    var webFolder = makeTempWebFolder();
    var discId = 'Reconvert';
    seedDisc(webFolder, discId);
    await packDiscArchive(webFolder, discId);
    await waitUntilDiscReady(webFolder, discId);
    expect(fs.readFileSync(path.join(webFolder, discId, 'vm.js'), 'utf8')).toBe(
      '// vm\n',
    );

    // Replace .tar.gz with a newer archive while the extracted folder remains.
    var rebuildRoot = path.join(webFolder, '_rebuild');
    seedDisc(rebuildRoot, discId);
    fs.writeFileSync(path.join(rebuildRoot, discId, 'vm.js'), '// reconverted\n');
    var archive = archivePath(webFolder, discId);
    var previousMtime = fs.statSync(archive).mtimeMs;
    await execFile('tar', ['-czf', archive, '-C', rebuildRoot, discId]);
    fs.rmSync(rebuildRoot, { recursive: true, force: true });
    // Ensure mtime is strictly newer than the recorded extract mtime.
    var newer = Math.max(Date.now(), previousMtime + 1000) / 1000;
    fs.utimesSync(archive, newer, newer);

    expect(ensureDiscReady(webFolder, discId)).toBe('decompressing');
    expect(await waitUntilDiscReady(webFolder, discId)).toBe('ready');
    expect(fs.readFileSync(path.join(webFolder, discId, 'vm.js'), 'utf8')).toBe(
      '// reconverted\n',
    );
    // Stable after reextract.
    expect(ensureDiscReady(webFolder, discId)).toBe('ready');

    fs.rmSync(webFolder, { recursive: true, force: true });
  });

  it('adopts archive mtime for legacy extracts without a marker', async () => {
    var webFolder = makeTempWebFolder();
    var discId = 'LegacyExtract';
    seedDisc(webFolder, discId);
    await packDiscArchive(webFolder, discId);
    await waitUntilDiscReady(webFolder, discId);
    fs.unlinkSync(path.join(webFolder, discId, '.dvd-menu-archive-archive-mtime'));

    expect(ensureDiscReady(webFolder, discId)).toBe('ready');
    expect(
      fs.existsSync(path.join(webFolder, discId, '.dvd-menu-archive-archive-mtime')),
    ).toBe(true);
    expect(fs.readFileSync(path.join(webFolder, discId, 'vm.js'), 'utf8')).toBe(
      '// vm\n',
    );

    fs.rmSync(webFolder, { recursive: true, force: true });
  });

  it('returns missing when neither folder nor archive exists', () => {
    var webFolder = makeTempWebFolder();
    expect(ensureDiscReady(webFolder, 'Nope')).toBe('missing');
    fs.rmSync(webFolder, { recursive: true, force: true });
  });

  it('still reports ready when access markers cannot be written', async () => {
    var webFolder = makeTempWebFolder();
    var discId = 'ReadOnlyReady';
    seedDisc(webFolder, discId);
    await packDiscArchive(webFolder, discId);
    await waitUntilDiscReady(webFolder, discId);

    // Drop write bits on the extracted folder (owner still readable).
    var dir = path.join(webFolder, discId);
    fs.unlinkSync(path.join(dir, '.dvd-menu-archive-accessed'));
    fs.chmodSync(dir, 0o555);

    expect(ensureDiscReady(webFolder, discId)).toBe('ready');
    expect(isDiscReady(webFolder, discId)).toBe(true);

    fs.chmodSync(dir, 0o755);
    fs.rmSync(webFolder, { recursive: true, force: true });
  });
});

describe('evictExpiredDiscCache', () => {
  it('removes decompressed folder after TTL when archive remains', async () => {
    var webFolder = makeTempWebFolder();
    var discId = 'TTLDisc';
    seedDisc(webFolder, discId);
    await packDiscArchive(webFolder, discId);
    await waitUntilDiscReady(webFolder, discId);

    var marker = path.join(webFolder, discId, '.dvd-menu-archive-accessed');
    fs.writeFileSync(marker, String(Date.now() - CACHE_TTL_MS - 1000) + '\n');

    var removed = evictExpiredDiscCache(webFolder);
    expect(removed).toEqual([discId]);
    expect(isDiscReady(webFolder, discId)).toBe(false);
    expect(hasArchive(webFolder, discId)).toBe(true);

    fs.rmSync(webFolder, { recursive: true, force: true });
  });

  it('does not evict unpacked-only discs without an archive', () => {
    var webFolder = makeTempWebFolder();
    var discId = 'Legacy';
    seedDisc(webFolder, discId);
    var marker = path.join(webFolder, discId, '.dvd-menu-archive-accessed');
    fs.writeFileSync(marker, String(Date.now() - CACHE_TTL_MS - 1000) + '\n');

    expect(evictExpiredDiscCache(webFolder)).toEqual([]);
    expect(isDiscReady(webFolder, discId)).toBe(true);

    fs.rmSync(webFolder, { recursive: true, force: true });
  });
});

describe('sanitizeDiscId', () => {
  it('replaces spaces and rejects unsafe ids until sanitized', () => {
    expect(sanitizeDiscId('Harry Potter Philosophers Ston')).toBe(
      'Harry_Potter_Philosophers_Ston',
    );
    expect(isSafeDiscId('Harry Potter Philosophers Ston')).toBe(false);
    expect(isSafeDiscId(sanitizeDiscId('Harry Potter Philosophers Ston'))).toBe(
      true,
    );
    expect(sanitizeDiscId('My Disc Name!!')).toBe('My_Disc_Name');
    expect(sanitizeDiscId('a'.repeat(40)).length).toBe(32);
  });
});

describe('migrateLegacyDiscDir', () => {
  it('renames spaced folders and rewrites path prefixes', () => {
    var webFolder = makeTempWebFolder();
    var rawName = 'Harry Potter Philosophers Ston';
    var discId = 'Harry_Potter_Philosophers_Ston';
    var rawDir = path.join(webFolder, rawName);
    fs.mkdirSync(rawDir, { recursive: true });
    fs.writeFileSync(
      path.join(rawDir, 'metadata.json'),
      JSON.stringify([{ ifo: '/' + rawName + '/VIDEO_TS.json' }]) + '\n',
    );
    fs.writeFileSync(
      path.join(rawDir, 'vm.js'),
      'spuSelect:["/' + rawName + '/menu.png"]\n',
    );

    expect(migrateLegacyDiscDir(webFolder, path.join('/dvds', rawName))).toBe(
      discId,
    );
    expect(fs.existsSync(path.join(webFolder, rawName))).toBe(false);
    expect(fs.existsSync(path.join(webFolder, discId, 'metadata.json'))).toBe(
      true,
    );
    expect(
      fs.readFileSync(path.join(webFolder, discId, 'metadata.json'), 'utf8'),
    ).toContain('/' + discId + '/VIDEO_TS.json');
    expect(
      fs.readFileSync(path.join(webFolder, discId, 'vm.js'), 'utf8'),
    ).toContain('/' + discId + '/menu.png');

    fs.rmSync(webFolder, { recursive: true, force: true });
  });
});
