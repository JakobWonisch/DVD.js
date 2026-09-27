import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  CACHE_TTL_MS,
  archivePath,
  coverSidecarPath,
  ensureDiscReady,
  evictExpiredDiscCache,
  hasArchive,
  isDiscReady,
  packDiscArchive,
  waitUntilDiscReady,
} from '../../src/server/discCache.js';

function makeTempWebFolder(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dvdjs-cache-'));
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

describe('packDiscArchive', () => {
  it('creates tar.gz + cover sidecar and removes the folder', async () => {
    var webFolder = makeTempWebFolder();
    var discId = 'TestDisc';
    seedDisc(webFolder, discId);

    await packDiscArchive(webFolder, discId);

    expect(hasArchive(webFolder, discId)).toBe(true);
    expect(fs.existsSync(coverSidecarPath(webFolder, discId))).toBe(true);
    expect(isDiscReady(webFolder, discId)).toBe(false);
    expect(fs.existsSync(path.join(webFolder, discId))).toBe(false);

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

  it('returns missing when neither folder nor archive exists', () => {
    var webFolder = makeTempWebFolder();
    expect(ensureDiscReady(webFolder, 'Nope')).toBe('missing');
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

    var marker = path.join(webFolder, discId, '.dvdjs-accessed');
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
    var marker = path.join(webFolder, discId, '.dvdjs-accessed');
    fs.writeFileSync(marker, String(Date.now() - CACHE_TTL_MS - 1000) + '\n');

    expect(evictExpiredDiscCache(webFolder)).toEqual([]);
    expect(isDiscReady(webFolder, discId)).toBe(true);

    fs.rmSync(webFolder, { recursive: true, force: true });
  });
});
