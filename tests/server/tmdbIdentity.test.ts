import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  identityDisplayName,
  readTmdbIdentity,
  writeTmdbIdentity,
  yearFromReleaseDate,
} from '../../src/server/convert/tmdbIdentity.js';

describe('tmdbIdentity', () => {
  it('round-trips sidecar JSON', () => {
    var webFolder = fs.mkdtempSync(
      path.join(os.tmpdir(), 'dvd-menu-archive-tmdb-id-'),
    );
    writeTmdbIdentity(webFolder, 'Shrek', {
      tmdbId: 808,
      mediaType: 'movie',
      title: 'Shrek',
      year: 2001,
      posterPath: '/x.jpg',
    });
    var got = readTmdbIdentity(webFolder, 'Shrek');
    expect(got).toMatchObject({
      tmdbId: 808,
      mediaType: 'movie',
      title: 'Shrek',
      year: 2001,
      posterPath: '/x.jpg',
    });
    expect(identityDisplayName(got!)).toBe('Shrek (2001)');
    fs.rmSync(webFolder, { recursive: true, force: true });
  });

  it('formats TV season display names', () => {
    expect(
      identityDisplayName({
        tmdbId: 246,
        mediaType: 'tv',
        title: 'Avatar: The Last Airbender',
        year: 2005,
        season: 1,
      }),
    ).toBe('Avatar: The Last Airbender — Season 1 (2005)');
  });

  it('includes optional comment in display name and round-trips', () => {
    var webFolder = fs.mkdtempSync(
      path.join(os.tmpdir(), 'dvd-menu-archive-tmdb-comment-'),
    );
    writeTmdbIdentity(webFolder, 'Avatar_S1', {
      tmdbId: 246,
      mediaType: 'tv',
      title: 'Avatar: The Last Airbender',
      year: 2005,
      season: 1,
      comment: 'Vol. 1',
    });
    var got = readTmdbIdentity(webFolder, 'Avatar_S1');
    expect(got?.comment).toBe('Vol. 1');
    expect(identityDisplayName(got!)).toBe(
      'Avatar: The Last Airbender — Season 1 — Vol. 1 (2005)',
    );
    expect(
      identityDisplayName({
        tmdbId: 1,
        mediaType: 'movie',
        title: 'The Lord of the Rings',
        year: 2001,
        comment: 'Extra Material',
      }),
    ).toBe('The Lord of the Rings — Extra Material (2001)');
    fs.rmSync(webFolder, { recursive: true, force: true });
  });

  it('defaults legacy sidecars without mediaType to movie', () => {
    var webFolder = fs.mkdtempSync(
      path.join(os.tmpdir(), 'dvd-menu-archive-tmdb-legacy-'),
    );
    fs.writeFileSync(
      path.join(webFolder, 'Old.tmdb.json'),
      JSON.stringify({ tmdbId: 1, title: 'Old' }),
    );
    expect(readTmdbIdentity(webFolder, 'Old')?.mediaType).toBe('movie');
    fs.rmSync(webFolder, { recursive: true, force: true });
  });

  it('parses year from release date', () => {
    expect(yearFromReleaseDate('2001-05-18')).toBe(2001);
    expect(yearFromReleaseDate('')).toBeUndefined();
  });
});
