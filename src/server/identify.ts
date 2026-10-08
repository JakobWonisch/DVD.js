/**
 * Interactive TMDB identify CLI for catalogue discs.
 *
 * Usage:
 *   pnpm identify
 *   pnpm identify -- Shrek Avatar
 *   pnpm identify -- --help
 */

'use strict';

import { parseArgs } from 'node:util';

import appConfig from '../loadAppConfig.js';
import {
  identifyDiscs,
  resolveIdentifyDiscIds,
} from './convert/identifyDiscs.js';

const argv = process.argv.slice(2);
while (argv[0] === '--') {
  argv.shift();
}

const { values, positionals } = parseArgs({
  args: argv,
  allowPositionals: true,
  options: {
    help: {
      type: 'boolean',
      short: 'h',
    },
  },
});

if (values.help) {
  console.log(`Identify converted discs against TMDB (interactive).

Usage:
  pnpm identify
  pnpm identify -- Shrek Avatar
  pnpm identify -- --help

For each disc under webFolder: search TMDB movies + TV by folder name, show
the top 10 matches (TV listed first), and let you pick one (or enter a custom
search). For TV picks you can choose a season (e.g. Avatar: The Last Airbender
Season 1). You can add an optional comment (Vol. 1, Extra Material, …) shown
in the catalogue. Already-identified discs: keep as-is, edit comment only, or
re-identify. Writes <discId>.tmdb.json, fetches posters on re-identify, and
regenerates dvds.json.

Requires:
  - tmdbApiKey in config/app.json (or DVD_MENU_ARCHIVE_TMDB_API_KEY)
  - an interactive terminal (TTY)

With no disc names: walk every archive / unpacked disc under webFolder.
After identify, posters can be refreshed with:
  pnpm convert -- --posters-only`);
  process.exit(0);
}

var discIds = resolveIdentifyDiscIds(appConfig.webFolder, positionals);
identifyDiscs(appConfig.webFolder, discIds).catch(function (err) {
  console.error(err);
  process.exit(1);
});
