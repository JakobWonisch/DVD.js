/**
 * Per-disc TMDB identity sidecars (`<discId>.tmdb.json`).
 * Supports movies and TV series (optional season).
 */

'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';

export type TmdbMediaType = 'movie' | 'tv';

export type TmdbIdentity = {
  tmdbId: number;
  /** Defaults to movie when missing (legacy sidecars). */
  mediaType: TmdbMediaType;
  title: string;
  originalTitle?: string;
  /** Release / first-air year when known. */
  year?: number;
  /** TV season number (1-based). Omit for series-level / movies. */
  season?: number;
  /**
   * Optional disc label shown in the catalogue (e.g. "Vol. 1",
   * "Extra Material"). Does not change the TMDB match.
   */
  comment?: string;
  posterPath?: string | null;
  identifiedAt?: string;
};

export function tmdbIdentityPath(webFolder: string, discId: string): string {
  return path.join(webFolder, discId + '.tmdb.json');
}

export function readTmdbIdentity(
  webFolder: string,
  discId: string,
): TmdbIdentity | null {
  var file = tmdbIdentityPath(webFolder, discId);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    var raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<TmdbIdentity> & {
      mediaType?: string;
    };
    var id = Number(raw.tmdbId);
    if (!Number.isFinite(id) || id <= 0 || !raw.title) {
      return null;
    }
    var mediaType: TmdbMediaType =
      raw.mediaType === 'tv' ? 'tv' : 'movie';
    var out: TmdbIdentity = {
      tmdbId: id,
      mediaType: mediaType,
      title: String(raw.title),
    };
    if (raw.originalTitle) {
      out.originalTitle = String(raw.originalTitle);
    }
    if (raw.year != null && Number.isFinite(Number(raw.year))) {
      out.year = Number(raw.year);
    }
    if (raw.season != null && Number.isFinite(Number(raw.season))) {
      var season = Number(raw.season);
      if (season >= 1) {
        out.season = season;
      }
    }
    if (raw.comment != null && String(raw.comment).trim()) {
      out.comment = String(raw.comment).trim();
    }
    if (raw.posterPath !== undefined) {
      out.posterPath = raw.posterPath;
    }
    if (raw.identifiedAt) {
      out.identifiedAt = String(raw.identifiedAt);
    }
    return out;
  } catch {
    return null;
  }
}

export function writeTmdbIdentity(
  webFolder: string,
  discId: string,
  identity: TmdbIdentity,
): void {
  var file = tmdbIdentityPath(webFolder, discId);
  var body: TmdbIdentity = {
    tmdbId: identity.tmdbId,
    mediaType: identity.mediaType === 'tv' ? 'tv' : 'movie',
    title: identity.title,
    identifiedAt: identity.identifiedAt || new Date().toISOString(),
  };
  if (identity.originalTitle) {
    body.originalTitle = identity.originalTitle;
  }
  if (identity.year != null) {
    body.year = identity.year;
  }
  if (identity.season != null && identity.season >= 1) {
    body.season = identity.season;
  }
  if (identity.comment != null && String(identity.comment).trim()) {
    body.comment = String(identity.comment).trim();
  }
  if (identity.posterPath !== undefined) {
    body.posterPath = identity.posterPath;
  }
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n');
}

/**
 * Catalogue display name, e.g.
 * "Avatar: The Last Airbender — Season 1 — Vol. 1 (2005)".
 */
export function identityDisplayName(identity: TmdbIdentity): string {
  var name = identity.title;
  if (identity.mediaType === 'tv' && identity.season != null) {
    name = name + ' — Season ' + identity.season;
  }
  if (identity.comment && String(identity.comment).trim()) {
    name = name + ' — ' + String(identity.comment).trim();
  }
  if (identity.year) {
    return name + ' (' + identity.year + ')';
  }
  return name;
}

export function yearFromReleaseDate(releaseDate?: string): number | undefined {
  if (!releaseDate || releaseDate.length < 4) {
    return undefined;
  }
  var y = Number(releaseDate.slice(0, 4));
  return Number.isFinite(y) && y > 1800 ? y : undefined;
}
