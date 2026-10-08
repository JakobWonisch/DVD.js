/**
 * Interactive TMDB identify for webFolder discs.
 *
 * Searches movies + TV. For TV picks, prompts for an optional season
 * (e.g. Avatar: The Last Airbender → Season 1). Optional disc comment
 * (Vol. 1, Extra Material, …). Existing matches can keep title and only
 * edit the comment.
 */

'use strict';

import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import appConfig from '../../loadAppConfig.js';
import {
  discIdToSeasonHint,
  discIdToTmdbQuery,
  fetchTmdbPosterForDisc,
  fetchTmdbTvSeason,
  hitToIdentity,
  searchTmdbMulti,
  type TmdbMediaHit,
} from './fetchTmdbPoster.js';
import generateCatalogue from './generateCatalogue.js';
import {
  identityDisplayName,
  readTmdbIdentity,
  writeTmdbIdentity,
  type TmdbIdentity,
} from './tmdbIdentity.js';
import {
  listPosterDiscIds,
  resolvePosterDiscIds,
} from './postersOnly.js';

function formatHitLine(index: number, hit: TmdbMediaHit): string {
  var year = hit.release_date ? hit.release_date.slice(0, 4) : '????';
  var title = hit.title || hit.originalTitle || '(untitled)';
  var id = hit.id != null ? String(hit.id) : '?';
  var kind = hit.mediaType === 'tv' ? 'tv' : 'movie';
  return (
    '  ' +
    String(index).padStart(2, ' ') +
    ') [' +
    kind +
    '] ' +
    title +
    ' (' +
    year +
    ')  [tmdb:' +
    id +
    ']'
  );
}

async function promptChoice(
  rl: readline.Interface,
  message: string,
): Promise<string> {
  var answer = await rl.question(message);
  return String(answer || '').trim();
}

/**
 * Prompt for optional disc comment (Vol. 1, Extra Material, …).
 * - blank: keep `current` when set, else no comment
 * - `-` / `clear`: remove comment
 */
async function promptDiscComment(
  rl: readline.Interface,
  current?: string,
): Promise<string | undefined> {
  var cur = current && String(current).trim() ? String(current).trim() : '';
  var hint = cur
    ? 'current "' + cur + '"; Enter=keep, -=clear'
    : 'optional; Enter=none';
  var answer = await promptChoice(rl, '  Comment (' + hint + '): ');
  if (answer === '') {
    return cur || undefined;
  }
  var lower = answer.toLowerCase();
  if (lower === '-' || lower === 'clear' || lower === 'none') {
    return undefined;
  }
  return answer;
}

/**
 * After picking a TV series, ask for season (Enter = series-level poster).
 */
async function promptTvSeason(
  rl: readline.Interface,
  hit: TmdbMediaHit,
  seasonHint: number | undefined,
  deps: { apiKey: string; fetchFn?: typeof fetch },
): Promise<{ season?: number; hit: TmdbMediaHit } | 'cancel'> {
  var hintText =
    seasonHint != null ? ' [Enter=' + seasonHint + ' from folder]' : '';
  var answer = await promptChoice(
    rl,
    '  TV series — season number (blank' +
      (seasonHint != null ? '=' + seasonHint : '=series poster') +
      ', or [c]ancel)' +
      hintText +
      ': ',
  );
  var lower = answer.toLowerCase();
  if (lower === 'c' || lower === 'cancel') {
    return 'cancel';
  }
  var season: number | undefined;
  if (answer === '' && seasonHint != null) {
    season = seasonHint;
  } else if (answer === '') {
    season = undefined;
  } else {
    var n = Number(answer);
    if (!Number.isInteger(n) || n < 1) {
      process.stdout.write('  Invalid season.\n');
      return 'cancel';
    }
    season = n;
  }
  if (season == null) {
    return { hit: hit };
  }
  try {
    var seasonHit = await fetchTmdbTvSeason(hit.id!, season, {
      apiKey: deps.apiKey,
      fetchFn: deps.fetchFn,
    });
    if (!seasonHit) {
      process.stdout.write(
        '  Season ' + season + ' not found on TMDB; using series.\n',
      );
      return { hit: hit, season: season };
    }
    return { hit: seasonHit, season: season };
  } catch (err) {
    console.warn(
      '  Season lookup failed: ' +
        (err instanceof Error ? err.message : String(err)),
    );
    return { hit: hit, season: season };
  }
}

/**
 * One disc identify loop.
 */
export async function identifyOneDisc(
  webFolder: string,
  discId: string,
  deps: {
    apiKey: string;
    rl: readline.Interface;
    fetchFn?: typeof fetch;
  },
): Promise<'ok' | 'skip' | 'quit'> {
  var existing = readTmdbIdentity(webFolder, discId);
  var defaultQuery = discIdToTmdbQuery(discId);
  var seasonHint = discIdToSeasonHint(discId);

  process.stdout.write('\n── ' + discId + ' ──\n');
  if (existing) {
    process.stdout.write(
      '  Currently: ' +
        identityDisplayName(existing) +
        ' [' +
        existing.mediaType +
        ':' +
        existing.tmdbId +
        ']\n',
    );
    if (existing.comment) {
      process.stdout.write('  Comment: ' + existing.comment + '\n');
    }
    var keep = await promptChoice(
      deps.rl,
      '  [Y]es keep / [c]omment only / [r]e-identify / [s]kip / [q]uit: ',
    );
    var keepLower = keep.toLowerCase();
    if (keepLower === 'q' || keepLower === 'quit') {
      return 'quit';
    }
    if (keepLower === 's' || keepLower === 'skip') {
      return 'skip';
    }
    if (keepLower === '' || keepLower === 'y' || keepLower === 'yes') {
      return 'ok';
    }
    if (keepLower === 'c' || keepLower === 'comment') {
      var editedComment = await promptDiscComment(deps.rl, existing.comment);
      var updated: TmdbIdentity = {
        tmdbId: existing.tmdbId,
        mediaType: existing.mediaType,
        title: existing.title,
        identifiedAt: existing.identifiedAt || new Date().toISOString(),
      };
      if (existing.originalTitle) {
        updated.originalTitle = existing.originalTitle;
      }
      if (existing.year != null) {
        updated.year = existing.year;
      }
      if (existing.season != null) {
        updated.season = existing.season;
      }
      if (existing.posterPath !== undefined) {
        updated.posterPath = existing.posterPath;
      }
      if (editedComment) {
        updated.comment = editedComment;
      }
      writeTmdbIdentity(webFolder, discId, updated);
      process.stdout.write(
        '  Saved ' + identityDisplayName(updated) + ' (title unchanged)\n',
      );
      return 'ok';
    }
    // re-identify continues (r or anything else that isn't keep/skip/quit/comment)
  }

  var query = defaultQuery;
  if (!query) {
    query = await promptChoice(
      deps.rl,
      '  No query from folder name. Enter search: ',
    );
    if (!query) {
      return 'skip';
    }
  }

  while (true) {
    process.stdout.write(
      '  Searching TMDB (movies + TV) for "' + query + '"…\n',
    );
    var results: TmdbMediaHit[];
    try {
      results = await searchTmdbMulti(
        query,
        { apiKey: deps.apiKey, fetchFn: deps.fetchFn },
        10,
      );
    } catch (err) {
      console.error(
        '  Search failed: ' +
          (err instanceof Error ? err.message : String(err)),
      );
      var again = await promptChoice(
        deps.rl,
        '  [Enter] new search / [s]kip / [q]uit: ',
      );
      if (again.toLowerCase() === 'q' || again.toLowerCase() === 'quit') {
        return 'quit';
      }
      if (again.toLowerCase() === 's' || again.toLowerCase() === 'skip') {
        return 'skip';
      }
      if (again) {
        query = again;
        continue;
      }
      query = await promptChoice(deps.rl, '  Search: ');
      if (!query) {
        return 'skip';
      }
      continue;
    }

    if (!results.length) {
      process.stdout.write('  No results.\n');
      var empty = await promptChoice(
        deps.rl,
        '  Enter new search (or [s]kip / [q]uit): ',
      );
      if (empty.toLowerCase() === 'q' || empty.toLowerCase() === 'quit') {
        return 'quit';
      }
      if (empty.toLowerCase() === 's' || empty.toLowerCase() === 'skip') {
        return 'skip';
      }
      if (!empty) {
        return 'skip';
      }
      query = empty;
      continue;
    }

    for (var i = 0; i < results.length; i++) {
      process.stdout.write(formatHitLine(i + 1, results[i]) + '\n');
    }
    process.stdout.write(
      '  Pick 1-' +
        results.length +
        ', or [n]ew search / [s]kip / [q]uit\n',
    );
    var choice = await promptChoice(deps.rl, '  > ');
    var lower = choice.toLowerCase();
    if (lower === 'q' || lower === 'quit') {
      return 'quit';
    }
    if (lower === 's' || lower === 'skip') {
      return 'skip';
    }
    if (lower === 'n' || lower === 'new' || lower === 'search') {
      var custom = await promptChoice(deps.rl, '  Search: ');
      if (!custom) {
        continue;
      }
      query = custom;
      continue;
    }

    var num = Number(choice);
    if (!Number.isInteger(num) || num < 1 || num > results.length) {
      process.stdout.write('  Invalid choice.\n');
      continue;
    }

    var hit = results[num - 1];
    var season: number | undefined;
    if (hit.mediaType === 'tv') {
      var seasonPick = await promptTvSeason(deps.rl, hit, seasonHint, {
        apiKey: deps.apiKey,
        fetchFn: deps.fetchFn,
      });
      if (seasonPick === 'cancel') {
        continue;
      }
      hit = seasonPick.hit;
      season = seasonPick.season;
    }

    var identity = hitToIdentity(hit, season);
    if (!identity) {
      process.stdout.write('  Selected hit is missing id/title.\n');
      continue;
    }
    var comment = await promptDiscComment(
      deps.rl,
      existing && existing.comment,
    );
    if (comment) {
      identity.comment = comment;
    }
    writeTmdbIdentity(webFolder, discId, identity);
    process.stdout.write('  Saved ' + identityDisplayName(identity) + '\n');

    var posterResult = await fetchTmdbPosterForDisc(webFolder, discId, {
      apiKey: deps.apiKey,
      fetchFn: deps.fetchFn,
    });
    if (posterResult.ok) {
      process.stdout.write('  ' + posterResult.message + '\n');
    } else {
      console.warn('  Poster: ' + posterResult.message);
    }
    return 'ok';
  }
}

export function resolveIdentifyDiscIds(
  webFolder: string,
  positionals: string[],
): string[] {
  return resolvePosterDiscIds(webFolder, positionals);
}

export function listIdentifyDiscIds(webFolder: string): string[] {
  return listPosterDiscIds(webFolder);
}

/**
 * Interactive identify for each disc, then regenerate dvds.json.
 * Entry point: pnpm identify (src/server/identify.ts).
 */
export async function identifyDiscs(
  webFolder: string,
  discIds: string[],
): Promise<void> {
  var apiKey = appConfig.tmdbApiKey;
  if (!apiKey) {
    console.error(
      'No TMDB API key. Set tmdbApiKey in config/app.json or ' +
        'DVD_MENU_ARCHIVE_TMDB_API_KEY.',
    );
    process.exit(1);
  }
  if (!discIds.length) {
    console.error('No discs found under ' + webFolder);
    process.exit(1);
  }
  if (!input.isTTY || !output.isTTY) {
    console.error('pnpm identify requires an interactive terminal (TTY).');
    process.exit(1);
  }

  process.stdout.write(
    '\nIdentify discs (' +
      discIds.length +
      ') — pick TMDB movie/TV matches for catalogue names + posters\n',
  );

  var rl = readline.createInterface({ input: input, output: output });
  var okCount = 0;
  var skipCount = 0;
  try {
    for (var i = 0; i < discIds.length; i++) {
      var discId = discIds[i];
      process.stdout.write(
        '\n[' + (i + 1) + '/' + discIds.length + ']\n',
      );
      var result = await identifyOneDisc(webFolder, discId, {
        apiKey: apiKey,
        rl: rl,
      });
      if (result === 'quit') {
        process.stdout.write('\nStopped early.\n');
        break;
      }
      if (result === 'ok') {
        okCount++;
      } else {
        skipCount++;
      }
    }
  } finally {
    rl.close();
  }

  await new Promise<void>(function (resolve) {
    generateCatalogue(function () {
      resolve();
    });
  });
  process.stdout.write(
    '\nIdentify: ' +
      okCount +
      ' kept/saved, ' +
      skipCount +
      ' skipped\n',
  );
  console.log("That's all folks!");
}
