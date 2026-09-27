import { describe, expect, it } from 'vitest';
import {
  sanitizeTitleName,
  resolveRipInput,
  sourceNeedsRip,
  listOpticalDrives,
  pickDefaultDvdSource,
} from '../../src/server/convert/ripDisc.js';

describe('sourceNeedsRip', () => {
  it('detects optical device paths', () => {
    expect(sourceNeedsRip('/dev/sr0')).toBe(true);
    expect(sourceNeedsRip('/dev/cdrom')).toBe(true);
  });

  it('detects ISO files by extension', () => {
    expect(sourceNeedsRip('/tmp/disc.iso')).toBe(true);
    expect(sourceNeedsRip('/tmp/disc.ISO')).toBe(true);
  });

  it('does not flag plain directories', () => {
    expect(sourceNeedsRip('/tmp')).toBe(false);
  });
});

describe('pickDefaultDvdSource', () => {
  it('errors when no drives are present', () => {
    var result = pickDefaultDvdSource([]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/No optical disk drive found/);
      expect(result.message).toMatch(/Pass a path/);
    }
  });

  it('errors when multiple drives are present', () => {
    var result = pickDefaultDvdSource(['/dev/sr0', '/dev/sr1']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/Multiple optical disk drives found/);
      expect(result.message).toContain('/dev/sr0');
      expect(result.message).toContain('/dev/sr1');
      expect(result.message).toMatch(/Pass a path/);
    }
  });

  it('returns the sole drive', () => {
    var result = pickDefaultDvdSource(['/dev/sr0']);
    expect(result).toEqual({ ok: true, path: '/dev/sr0' });
  });
});

describe('listOpticalDrives', () => {
  it('returns only /dev paths when present', () => {
    var drives = listOpticalDrives();
    for (var i = 0; i < drives.length; i++) {
      expect(drives[i]).toMatch(/^\/dev\//);
    }
  });
});

describe('sanitizeTitleName', () => {
  it('keeps volume-like names', () => {
    expect(sanitizeTitleName('AVATAR_BK1_VOL1_EUR')).toBe('AVATAR_BK1_VOL1_EUR');
  });

  it('replaces spaces and truncates', () => {
    expect(sanitizeTitleName('My Disc Name!!')).toBe('My_Disc_Name');
    expect(sanitizeTitleName('a'.repeat(40)).length).toBe(32);
  });
});

describe('resolveRipInput', () => {
  it('requires -n title for directory sources', () => {
    var resolved = resolveRipInput('/tmp');
    expect(resolved.titleName).toBe('tmp');
    expect(resolved.input.length).toBeGreaterThan(0);
  });

  it('sets title for ISO paths', () => {
    var resolved = resolveRipInput('/data/films/Avatar.iso');
    expect(resolved.input).toBe('/data/films/Avatar.iso');
    expect(resolved.titleName).toBe('Avatar.iso');
  });
});
