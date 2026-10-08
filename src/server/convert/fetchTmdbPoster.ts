/**
 * Fetch a TMDB poster for a disc id and write catalogue sidecars.
 * Prefers a stored identity (`<discId>.tmdb.json`) over title search.
 * Supports movies and TV (optional season).
 */

'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';

import { formatTitle } from '../../utils.js';
import {
  discDirPath,
  isDiscReady,
  posterSidecarPath,
} from '../discCache.js';
import {
  readTmdbIdentity,
  yearFromReleaseDate,
  type TmdbIdentity,
  type TmdbMediaType,
} from './tmdbIdentity.js';

const TMDB_SEARCH_MOVIE = 'https://api.themoviedb.org/3/search/movie';
const TMDB_SEARCH_TV = 'https://api.themoviedb.org/3/search/tv';
const TMDB_MOVIE = 'https://api.themoviedb.org/3/movie/';
const TMDB_TV = 'https://api.themoviedb.org/3/tv/';
const TMDB_IMAGE = 'https://image.tmdb.org/t/p/w500';

/** Unified search / detail hit (movie or TV). */
export type TmdbMediaHit = {
  id?: number;
  mediaType: TmdbMediaType;
  /** Display title (movie title or TV name). */
  title?: string;
  originalTitle?: string;
  poster_path?: string | null;
  /** release_date or first_air_date */
  release_date?: string;
  /** Present after season detail fetch. */
  season?: number;
};

/** @deprecated Use TmdbMediaHit */
export type TmdbMovieHit = TmdbMediaHit;

export type FetchTmdbPosterResult = {
  ok: boolean;
  discId: string;
  query: string;
  poster?: string;
  tmdbId?: number;
  matchedTitle?: string;
  message: string;
};

export type FetchTmdbPosterDeps = {
  fetchFn?: typeof fetch;
  apiKey: string;
};

/**
 * Guess a season number from a disc folder id (Season_1, S01, Staffel 2, …).
 */
export function discIdToSeasonHint(discId: string): number | undefined {
  var s = String(discId || '').replace(/_/g, ' ');
  var m =
    s.match(/\b(?:season|staffel|series|saison)\s*0*(\d+)\b/i) ||
    s.match(/\bs\s*0*(\d+)\b/i);
  if (!m) {
    return undefined;
  }
  var n = Number(m[1]);
  return Number.isFinite(n) && n >= 1 ? n : undefined;
}

/**
 * Turn a disc folder id into a TMDB search query: humanize underscores,
 * strip trailing disc/part/season tags.
 */
export function discIdToTmdbQuery(discId: string): string {
  var title = formatTitle(String(discId || ''));
  title = title
    .replace(
      /\s+(?:(?:special\s+)?(?:edition|features?)|extended|unrated|directors?\s+cut)\s*$/i,
      '',
    )
    .replace(
      /\s+(?:season|staffel|series|saison)\s*\d+\s*$/i,
      '',
    )
    .replace(/\s+s\d+\s*$/i, '')
    .replace(
      /\s+(?:disc|disk|dvd|bluray|blu[\s-]?ray|part|pt|d)\s*\d+\s*$/i,
      '',
    )
    .replace(/\s+d\d+\s*$/i, '')
    .replace(/\s+see\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return title;
}

/** Lowercase alphanumeric compare for title matching. */
export function normalizeTitleKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Pick the best TMDB search hit for a query. Prefer exact/near title match
 * with a poster; else first result that has poster_path.
 */
export function pickTmdbMovieHit(
  query: string,
  results: TmdbMediaHit[],
): TmdbMediaHit | null {
  if (!results || !results.length) {
    return null;
  }
  var qKey = normalizeTitleKey(query);
  var withPoster = results.filter(function (r) {
    return r && r.poster_path;
  });
  var pool = withPoster.length ? withPoster : results;

  for (var i = 0; i < pool.length; i++) {
    var hit = pool[i];
    var keys = [hit.title, hit.originalTitle]
      .filter(Boolean)
      .map(function (t) {
        return normalizeTitleKey(String(t));
      });
    if (keys.indexOf(qKey) !== -1) {
      return hit;
    }
  }
  for (var j = 0; j < pool.length; j++) {
    var h = pool[j];
    var tKey = normalizeTitleKey(String(h.title || h.originalTitle || ''));
    if (
      tKey &&
      qKey &&
      (tKey.indexOf(qKey) === 0 || qKey.indexOf(tKey) === 0)
    ) {
      return h;
    }
  }
  return pool[0] || null;
}

function apiUrl(base: string, apiKey: string, extraQuery?: string): string {
  var url =
    base +
    (base.indexOf('?') === -1 ? '?' : '&') +
    'api_key=' +
    encodeURIComponent(apiKey);
  if (extraQuery) {
    url += '&' + extraQuery;
  }
  return url;
}

function normalizeMovieResult(raw: Record<string, unknown>): TmdbMediaHit {
  return {
    id: Number(raw.id) || undefined,
    mediaType: 'movie',
    title: raw.title != null ? String(raw.title) : undefined,
    originalTitle:
      raw.original_title != null ? String(raw.original_title) : undefined,
    poster_path: (raw.poster_path as string | null | undefined) ?? null,
    release_date:
      raw.release_date != null ? String(raw.release_date) : undefined,
  };
}

function normalizeTvResult(raw: Record<string, unknown>): TmdbMediaHit {
  return {
    id: Number(raw.id) || undefined,
    mediaType: 'tv',
    title: raw.name != null ? String(raw.name) : undefined,
    originalTitle:
      raw.original_name != null ? String(raw.original_name) : undefined,
    poster_path: (raw.poster_path as string | null | undefined) ?? null,
    release_date:
      raw.first_air_date != null ? String(raw.first_air_date) : undefined,
  };
}

/**
 * Search TMDB movies; returns up to `limit` results (default 10).
 */
export async function searchTmdbMovies(
  query: string,
  deps: FetchTmdbPosterDeps,
  limit: number = 10,
): Promise<TmdbMediaHit[]> {
  var q = String(query || '').trim();
  if (!q || !deps.apiKey) {
    return [];
  }
  var fetchFn = deps.fetchFn || fetch;
  var url = apiUrl(
    TMDB_SEARCH_MOVIE,
    deps.apiKey,
    'query=' + encodeURIComponent(q),
  );
  var res = await fetchFn(url);
  if (!res.ok) {
    throw new Error('TMDB movie search HTTP ' + res.status);
  }
  var body = (await res.json()) as { results?: Record<string, unknown>[] };
  return (body.results || [])
    .slice(0, Math.max(1, limit))
    .map(normalizeMovieResult);
}

/**
 * Search TMDB TV shows; returns up to `limit` results.
 */
export async function searchTmdbTv(
  query: string,
  deps: FetchTmdbPosterDeps,
  limit: number = 10,
): Promise<TmdbMediaHit[]> {
  var q = String(query || '').trim();
  if (!q || !deps.apiKey) {
    return [];
  }
  var fetchFn = deps.fetchFn || fetch;
  var url = apiUrl(
    TMDB_SEARCH_TV,
    deps.apiKey,
    'query=' + encodeURIComponent(q),
  );
  var res = await fetchFn(url);
  if (!res.ok) {
    throw new Error('TMDB TV search HTTP ' + res.status);
  }
  var body = (await res.json()) as { results?: Record<string, unknown>[] };
  return (body.results || [])
    .slice(0, Math.max(1, limit))
    .map(normalizeTvResult);
}

/**
 * Search movies + TV and interleave into a single top-N list (TV first when
 * titles are close — DVD menus are often TV seasons). Dedupes by mediaType+id.
 */
export async function searchTmdbMulti(
  query: string,
  deps: FetchTmdbPosterDeps,
  limit: number = 10,
): Promise<TmdbMediaHit[]> {
  var [movies, shows] = await Promise.all([
    searchTmdbMovies(query, deps, limit),
    searchTmdbTv(query, deps, limit),
  ]);
  // Interleave TV then movie so series like Avatar surface above the film.
  var out: TmdbMediaHit[] = [];
  var seen = new Set<string>();
  var max = Math.max(movies.length, shows.length);
  for (var i = 0; i < max && out.length < limit; i++) {
    if (i < shows.length) {
      var tv = shows[i];
      var tvKey = 'tv:' + tv.id;
      if (tv.id && !seen.has(tvKey)) {
        seen.add(tvKey);
        out.push(tv);
      }
    }
    if (out.length >= limit) {
      break;
    }
    if (i < movies.length) {
      var mov = movies[i];
      var movKey = 'movie:' + mov.id;
      if (mov.id && !seen.has(movKey)) {
        seen.add(movKey);
        out.push(mov);
      }
    }
  }
  return out;
}

export async function fetchTmdbMovieById(
  tmdbId: number,
  deps: FetchTmdbPosterDeps,
): Promise<TmdbMediaHit | null> {
  if (!deps.apiKey || !tmdbId) {
    return null;
  }
  var fetchFn = deps.fetchFn || fetch;
  var url = apiUrl(TMDB_MOVIE + String(tmdbId), deps.apiKey);
  var res = await fetchFn(url);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error('TMDB movie HTTP ' + res.status);
  }
  return normalizeMovieResult((await res.json()) as Record<string, unknown>);
}

export async function fetchTmdbTvById(
  tmdbId: number,
  deps: FetchTmdbPosterDeps,
): Promise<TmdbMediaHit | null> {
  if (!deps.apiKey || !tmdbId) {
    return null;
  }
  var fetchFn = deps.fetchFn || fetch;
  var url = apiUrl(TMDB_TV + String(tmdbId), deps.apiKey);
  var res = await fetchFn(url);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error('TMDB TV HTTP ' + res.status);
  }
  return normalizeTvResult((await res.json()) as Record<string, unknown>);
}

/**
 * Load a TV season; uses season poster when present, else series poster.
 */
export async function fetchTmdbTvSeason(
  tmdbId: number,
  season: number,
  deps: FetchTmdbPosterDeps,
): Promise<TmdbMediaHit | null> {
  if (!deps.apiKey || !tmdbId || season < 1) {
    return null;
  }
  var fetchFn = deps.fetchFn || fetch;
  var seasonUrl = apiUrl(
    TMDB_TV + String(tmdbId) + '/season/' + String(season),
    deps.apiKey,
  );
  var seasonRes = await fetchFn(seasonUrl);
  if (seasonRes.status === 404) {
    return null;
  }
  if (!seasonRes.ok) {
    throw new Error('TMDB TV season HTTP ' + seasonRes.status);
  }
  var seasonBody = (await seasonRes.json()) as Record<string, unknown>;
  var series = await fetchTmdbTvById(tmdbId, deps);
  if (!series) {
    return null;
  }
  var airDate =
    seasonBody.air_date != null
      ? String(seasonBody.air_date)
      : series.release_date;
  return {
    id: tmdbId,
    mediaType: 'tv',
    title: series.title,
    originalTitle: series.originalTitle,
    poster_path:
      (seasonBody.poster_path as string | null | undefined) ||
      series.poster_path ||
      null,
    release_date: airDate,
    season: season,
  };
}

export function hitToIdentity(
  hit: TmdbMediaHit,
  season?: number,
): TmdbIdentity | null {
  var id = Number(hit.id);
  if (!Number.isFinite(id) || id <= 0 || !hit.title) {
    return null;
  }
  var mediaType: TmdbMediaType = hit.mediaType === 'tv' ? 'tv' : 'movie';
  var identity: TmdbIdentity = {
    tmdbId: id,
    mediaType: mediaType,
    title: String(hit.title),
    identifiedAt: new Date().toISOString(),
  };
  if (hit.originalTitle) {
    identity.originalTitle = String(hit.originalTitle);
  }
  var year = yearFromReleaseDate(hit.release_date);
  if (year) {
    identity.year = year;
  }
  var seasonNum = season != null ? season : hit.season;
  if (mediaType === 'tv' && seasonNum != null && seasonNum >= 1) {
    identity.season = seasonNum;
  }
  if (hit.poster_path !== undefined) {
    identity.posterPath = hit.poster_path;
  }
  return identity;
}

async function downloadPosterJpeg(
  posterPath: string,
  deps: FetchTmdbPosterDeps,
): Promise<Buffer> {
  var fetchFn = deps.fetchFn || fetch;
  var posterUrl = TMDB_IMAGE + posterPath;
  var imgRes = await fetchFn(posterUrl);
  if (!imgRes.ok) {
    throw new Error('Poster download HTTP ' + imgRes.status);
  }
  var buf = Buffer.from(await imgRes.arrayBuffer());
  if (buf.length < 100) {
    throw new Error('Poster download too small (' + buf.length + ' bytes)');
  }
  return buf;
}

async function writePosterFiles(
  webFolder: string,
  discId: string,
  buf: Buffer,
): Promise<string> {
  var sidecar = posterSidecarPath(webFolder, discId);
  await fs.promises.writeFile(sidecar, buf);
  if (isDiscReady(webFolder, discId)) {
    var inFolder = path.join(discDirPath(webFolder, discId), 'poster.jpg');
    try {
      await fs.promises.writeFile(inFolder, buf);
    } catch {
      // Sidecar is enough for catalogue.
    }
  }
  return path.basename(sidecar);
}

export async function writePosterFromHit(
  webFolder: string,
  discId: string,
  hit: TmdbMediaHit,
  deps: FetchTmdbPosterDeps,
): Promise<FetchTmdbPosterResult> {
  var query = discIdToTmdbQuery(discId);
  if (!hit.poster_path) {
    return {
      ok: false,
      discId: discId,
      query: query,
      tmdbId: hit.id,
      matchedTitle: hit.title,
      message: 'TMDB entry has no poster',
    };
  }
  try {
    var buf = await downloadPosterJpeg(hit.poster_path, deps);
    var poster = await writePosterFiles(webFolder, discId, buf);
    return {
      ok: true,
      discId: discId,
      query: query,
      poster: poster,
      tmdbId: hit.id,
      matchedTitle: hit.title,
      message: 'Wrote ' + poster + ' (' + (hit.title || query) + ')',
    };
  } catch (err) {
    return {
      ok: false,
      discId: discId,
      query: query,
      tmdbId: hit.id,
      matchedTitle: hit.title,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function resolveHitFromIdentity(
  identity: TmdbIdentity,
  deps: FetchTmdbPosterDeps,
): Promise<TmdbMediaHit | null> {
  if (identity.mediaType === 'tv') {
    if (identity.season != null && identity.season >= 1) {
      return await fetchTmdbTvSeason(identity.tmdbId, identity.season, deps);
    }
    return await fetchTmdbTvById(identity.tmdbId, deps);
  }
  return await fetchTmdbMovieById(identity.tmdbId, deps);
}

/**
 * Fetch poster for one disc. Uses stored `.tmdb.json` when present;
 * otherwise falls back to multi (movie+TV) title search + auto-pick.
 */
export async function fetchTmdbPosterForDisc(
  webFolder: string,
  discId: string,
  deps: FetchTmdbPosterDeps,
): Promise<FetchTmdbPosterResult> {
  var query = discIdToTmdbQuery(discId);
  if (!deps.apiKey) {
    return {
      ok: false,
      discId: discId,
      query: query,
      message: 'No TMDB API key configured',
    };
  }

  var identity = readTmdbIdentity(webFolder, discId);
  if (identity) {
    try {
      var byId = await resolveHitFromIdentity(identity, deps);
      if (!byId) {
        return {
          ok: false,
          discId: discId,
          query: query,
          tmdbId: identity.tmdbId,
          matchedTitle: identity.title,
          message:
            'TMDB ' +
            identity.mediaType +
            ' id ' +
            identity.tmdbId +
            (identity.season != null ? ' S' + identity.season : '') +
            ' not found',
        };
      }
      if (!byId.poster_path && identity.posterPath) {
        byId.poster_path = identity.posterPath;
      }
      return await writePosterFromHit(webFolder, discId, byId, deps);
    } catch (err) {
      return {
        ok: false,
        discId: discId,
        query: query,
        tmdbId: identity.tmdbId,
        matchedTitle: identity.title,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (!query) {
    return {
      ok: false,
      discId: discId,
      query: query,
      message: 'Empty search query from disc id (run pnpm identify first)',
    };
  }

  try {
    var results = await searchTmdbMulti(query, deps, 10);
    var hit = pickTmdbMovieHit(query, results);
    if (!hit || !hit.poster_path) {
      return {
        ok: false,
        discId: discId,
        query: query,
        message:
          'No TMDB poster match for "' +
          query +
          '" (run pnpm identify to pick a title)',
      };
    }
    return await writePosterFromHit(webFolder, discId, hit, deps);
  } catch (err) {
    return {
      ok: false,
      discId: discId,
      query: query,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
