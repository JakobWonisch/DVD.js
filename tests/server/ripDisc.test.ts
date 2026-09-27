import { describe, expect, it } from 'vitest';
import {
  sanitizeTitleName,
  resolveRipInput,
  sourceNeedsRip,
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
