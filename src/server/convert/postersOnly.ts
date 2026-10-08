/**
 * Fetch TMDB posters for existing webFolder discs without reconverting.
 */

'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';

import appConfig from '../../loadAppConfig.js';
import {
  hasArchive,
  isDiscReady,
  isSafeDiscId,
} from '../discCache.js';
import { fetchTmdbPosterForDisc } from './fetchTmdbPoster.js';
import generateCatalogue from './generateCatalogue.js';

/**
 * Disc ids under webFolder that have an archive and/or ready unpack.
 */
export function listPosterDiscIds(webFolder: string): string[] {
  var names: string[] = [];
  try {
    names = fs.readdirSync(webFolder);
  } catch {
    return [];
  }
  var seen = new Set<string>();
  var out: string[] = [];
  for (var i = 0; i < names.length; i++) {
    var file = names[i];
    var discId: string | null = null;
    if (file.endsWith('.tar.gz')) {
      discId = file.slice(0, -'.tar.gz'.length);
    } else if (file.endsWith('.cover.jpg') || file.endsWith('.poster.jpg')) {
      continue;
    } else {
      var dir = path.join(webFolder, file);
      var st: fs.Stats;
      try {
        st = fs.statSync(dir);
      } catch {
        continue;
      }
      if (st.isDirectory() && isDiscReady(webFolder, file)) {
        discId = file;
      }
    }
    if (!discId || !isSafeDiscId(discId) || seen.has(discId)) {
      continue;
    }
    if (!hasArchive(webFolder, discId) && !isDiscReady(webFolder, discId)) {
      continue;
    }
    seen.add(discId);
    out.push(discId);
  }
  out.sort(function (a, b) {
    return a.localeCompare(b);
  });
  return out;
}

/**
 * Resolve CLI positionals to disc ids (names under webFolder, or paths).
 */
export function resolvePosterDiscIds(
  webFolder: string,
  positionals: string[],
): string[] {
  if (!positionals.length) {
    return listPosterDiscIds(webFolder);
  }
  var out: string[] = [];
  var seen = new Set<string>();
  for (var i = 0; i < positionals.length; i++) {
    var raw = String(positionals[i] || '').replace(/[/\\]+$/, '');
    if (!raw) {
      continue;
    }
    var base = path.basename(raw.replace(/\.tar\.gz$/i, ''));
    var discId: string | null = null;
    if (isSafeDiscId(base) && (hasArchive(webFolder, base) || isDiscReady(webFolder, base))) {
      discId = base;
    } else {
      var abs = path.isAbsolute(raw) ? raw : path.resolve(raw);
      var absBase = path.basename(abs);
      if (
        isSafeDiscId(absBase) &&
        (hasArchive(webFolder, absBase) || isDiscReady(webFolder, absBase))
      ) {
        discId = absBase;
      }
    }
    if (!discId) {
      console.error('Not a known disc under webFolder: ' + raw);
      process.exit(1);
    }
    if (!seen.has(discId)) {
      seen.add(discId);
      out.push(discId);
    }
  }
  return out;
}

/**
 * Fetch posters for each disc, then regenerate dvds.json.
 * Requires appConfig.tmdbApiKey.
 */
export async function fetchPostersForDiscs(
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

  process.stdout.write(
    '\nPosters-only (' +
      discIds.length +
      ' disc(s); prefers .tmdb.json from pnpm identify):\n',
  );

  var okCount = 0;
  var failCount = 0;
  for (var i = 0; i < discIds.length; i++) {
    var discId = discIds[i];
    process.stdout.write(
      '\n[' + (i + 1) + '/' + discIds.length + '] ' + discId + '\n',
    );
    var result = await fetchTmdbPosterForDisc(webFolder, discId, {
      apiKey: apiKey,
    });
    if (result.ok) {
      okCount++;
      process.stdout.write('  ' + result.message + '\n');
    } else {
      failCount++;
      console.warn('  ' + result.message);
    }
  }

  await new Promise<void>(function (resolve) {
    generateCatalogue(function () {
      resolve();
    });
  });
  process.stdout.write(
    '\nPosters: ' + okCount + ' ok, ' + failCount + ' skipped/failed\n',
  );
  console.log("That's all folks!");
  if (okCount === 0 && failCount > 0) {
    process.exitCode = 1;
  }
}
