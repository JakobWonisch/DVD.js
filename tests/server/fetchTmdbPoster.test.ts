import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  discIdToSeasonHint,
  discIdToTmdbQuery,
  fetchTmdbPosterForDisc,
  normalizeTitleKey,
  pickTmdbMovieHit,
  searchTmdbMulti,
} from '../../src/server/convert/fetchTmdbPoster.js';
import { writeTmdbIdentity } from '../../src/server/convert/tmdbIdentity.js';
import { posterSidecarPath } from '../../src/server/discCache.js';

describe('discIdToTmdbQuery', () => {
  it('humanizes underscores and strips disc suffixes', () => {
    expect(discIdToTmdbQuery('Shrek')).toBe('Shrek');
    expect(discIdToTmdbQuery('Harry_Potter')).toBe('Harry Potter');
    expect(discIdToTmdbQuery('Lotr_See_D4')).toBe('Lotr');
    expect(discIdToTmdbQuery('Avatar_Disc_2')).toBe('Avatar');
    expect(discIdToTmdbQuery('Film_Part_1')).toBe('Film');
    expect(discIdToTmdbQuery('Avatar_Season_1')).toBe('Avatar');
  });
});

describe('discIdToSeasonHint', () => {
  it('parses season / staffel / sNN from disc ids', () => {
    expect(discIdToSeasonHint('Avatar_Season_1')).toBe(1);
    expect(discIdToSeasonHint('Avatar_Staffel_2')).toBe(2);
    expect(discIdToSeasonHint('Show_S03')).toBe(3);
    expect(discIdToSeasonHint('Shrek')).toBeUndefined();
  });
});

describe('normalizeTitleKey / pickTmdbMovieHit', () => {
  it('normalizes punctuation for compare', () => {
    expect(normalizeTitleKey("Harry Potter")).toBe('harrypotter');
    expect(normalizeTitleKey('Harry-Potter!')).toBe('harrypotter');
  });

  it('prefers exact title with poster', () => {
    var hit = pickTmdbMovieHit('Shrek', [
      { id: 1, mediaType: 'movie', title: 'Shrek 2', poster_path: '/a.jpg' },
      { id: 2, mediaType: 'movie', title: 'Shrek', poster_path: '/b.jpg' },
    ]);
    expect(hit?.id).toBe(2);
  });

  it('falls back to first result with poster', () => {
    var hit = pickTmdbMovieHit('Unknown Film', [
      {
        id: 9,
        mediaType: 'movie',
        title: 'Something Else',
        poster_path: null,
      },
      {
        id: 10,
        mediaType: 'movie',
        title: 'Close Enough',
        poster_path: '/c.jpg',
      },
    ]);
    expect(hit?.id).toBe(10);
  });

  it('returns null on empty results', () => {
    expect(pickTmdbMovieHit('x', [])).toBeNull();
  });
});

describe('fetchTmdbPosterForDisc', () => {
  it('writes poster sidecar from mocked TMDB responses', async () => {
    var webFolder = fs.mkdtempSync(
      path.join(os.tmpdir(), 'dvd-menu-archive-poster-'),
    );
    var discId = 'Shrek';
    var jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ...Array(200).fill(0),
      0xff, 0xd9,
    ]);

    var fetchFn = (async (input: RequestInfo | URL) => {
      var url = String(input);
      if (url.includes('search/movie')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 808,
                title: 'Shrek',
                poster_path: '/shrek.jpg',
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('search/tv')) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      if (url.includes('image.tmdb.org')) {
        return new Response(jpeg, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    var result = await fetchTmdbPosterForDisc(webFolder, discId, {
      apiKey: 'test-key',
      fetchFn: fetchFn,
    });

    expect(result.ok).toBe(true);
    expect(result.poster).toBe('Shrek.poster.jpg');
    expect(fs.existsSync(posterSidecarPath(webFolder, discId))).toBe(true);
    expect(fs.statSync(posterSidecarPath(webFolder, discId)).size).toBeGreaterThan(
      100,
    );

    fs.rmSync(webFolder, { recursive: true, force: true });
  });

  it('fails soft without api key', async () => {
    var result = await fetchTmdbPosterForDisc('/tmp', 'Shrek', {
      apiKey: '',
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/API key/i);
  });

  it('prefers stored .tmdb.json id over title search', async () => {
    var webFolder = fs.mkdtempSync(
      path.join(os.tmpdir(), 'dvd-menu-archive-poster-id-'),
    );
    var discId = 'Weird_Folder_Name';
    writeTmdbIdentity(webFolder, discId, {
      tmdbId: 808,
      mediaType: 'movie',
      title: 'Shrek',
      year: 2001,
      posterPath: '/old.jpg',
    });
    var jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ...Array(200).fill(0),
      0xff, 0xd9,
    ]);
    var sawSearch = false;
    var fetchFn = (async (input: RequestInfo | URL) => {
      var url = String(input);
      if (url.includes('search/movie') || url.includes('search/tv')) {
        sawSearch = true;
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      if (url.includes('/movie/808')) {
        return new Response(
          JSON.stringify({
            id: 808,
            title: 'Shrek',
            poster_path: '/shrek.jpg',
            release_date: '2001-05-18',
          }),
          { status: 200 },
        );
      }
      if (url.includes('image.tmdb.org')) {
        return new Response(jpeg, { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    var result = await fetchTmdbPosterForDisc(webFolder, discId, {
      apiKey: 'test-key',
      fetchFn: fetchFn,
    });

    expect(sawSearch).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.tmdbId).toBe(808);
    expect(result.poster).toBe('Weird_Folder_Name.poster.jpg');

    fs.rmSync(webFolder, { recursive: true, force: true });
  });

  it('fetches TV season poster from stored identity', async () => {
    var webFolder = fs.mkdtempSync(
      path.join(os.tmpdir(), 'dvd-menu-archive-poster-tv-'),
    );
    var discId = 'Avatar_S1';
    writeTmdbIdentity(webFolder, discId, {
      tmdbId: 246,
      mediaType: 'tv',
      title: 'Avatar: The Last Airbender',
      year: 2005,
      season: 1,
    });
    var jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ...Array(200).fill(0),
      0xff, 0xd9,
    ]);
    var fetchFn = (async (input: RequestInfo | URL) => {
      var url = String(input);
      if (url.includes('/tv/246/season/1')) {
        return new Response(
          JSON.stringify({
            name: 'Book One: Water',
            air_date: '2005-02-21',
            poster_path: '/season1.jpg',
          }),
          { status: 200 },
        );
      }
      if (url.includes('/tv/246') && !url.includes('/season/')) {
        return new Response(
          JSON.stringify({
            id: 246,
            name: 'Avatar: The Last Airbender',
            original_name: 'Avatar: The Last Airbender',
            poster_path: '/series.jpg',
            first_air_date: '2005-02-21',
          }),
          { status: 200 },
        );
      }
      if (url.includes('image.tmdb.org') && url.includes('season1.jpg')) {
        return new Response(jpeg, { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    var result = await fetchTmdbPosterForDisc(webFolder, discId, {
      apiKey: 'test-key',
      fetchFn: fetchFn,
    });

    expect(result.ok).toBe(true);
    expect(result.tmdbId).toBe(246);
    expect(result.poster).toBe('Avatar_S1.poster.jpg');

    fs.rmSync(webFolder, { recursive: true, force: true });
  });

  it('searchTmdbMulti interleaves TV before movies', async () => {
    var fetchFn = (async (input: RequestInfo | URL) => {
      var url = String(input);
      if (url.includes('search/movie')) {
        return new Response(
          JSON.stringify({
            results: [
              { id: 19995, title: 'Avatar', poster_path: '/m.jpg' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('search/tv')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 246,
                name: 'Avatar: The Last Airbender',
                poster_path: '/t.jpg',
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    var hits = await searchTmdbMulti('Avatar', {
      apiKey: 'k',
      fetchFn: fetchFn,
    });
    expect(hits[0]?.mediaType).toBe('tv');
    expect(hits[0]?.id).toBe(246);
    expect(hits[1]?.mediaType).toBe('movie');
  });
});
