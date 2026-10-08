// Convert a DVD to a web suitable format.

'use strict';

import ripDisc, {
  listOpticalDrives,
  pickDefaultDvdSource,
  sourceNeedsRip,
} from '../server/convert/ripDisc.js';
import uploadConvertedPackage from '../server/convert/upload.js';
import * as serverUtils from '../server/utils/index.js';
import { probeDvdSource } from '../server/utils/probeDvdSource.js';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';

import appConfig from '../loadAppConfig.js';
import generateCatalogue from '../server/convert/generateCatalogue.js';
import createDir from '../server/convert/createDir.js';
import convertIfo from '../server/convert/convertIfo.js';
import generateChapters from '../server/convert/generateChapters.js';
import extractNavPackets from '../server/convert/extractNavPackets.js';
import extractMenu from '../server/convert/extractMenu.js';
import generateMenuCellTable from '../server/convert/generateMenuCellTable.js';
import generateButtons from '../server/convert/generateButtons.js';
import generateCover from '../server/convert/generateCover.js';
import { fetchTmdbPosterForDisc } from '../server/convert/fetchTmdbPoster.js';
import extractSpu from '../server/convert/extractSpu.js';
import generateTitleStubs from '../server/convert/generateTitleStubs.js';
import generateJavaScript from '../server/convert/generateJavaScript.js';
import encodeVideo from '../server/convert/encodeVideo.js';
import packConvertedDisc from '../server/convert/packDiscArchive.js';
import {
  packDiscFolders,
  resolvePackDiscIds,
} from '../server/convert/packOnly.js';
import {
  fetchPostersForDiscs,
  resolvePosterDiscIds,
} from '../server/convert/postersOnly.js';
import { readTmdbIdentity } from '../server/convert/tmdbIdentity.js';
import { TITLE_INCLUDE_MAX_SEC } from '../server/convert/titleIncludePolicy.js';
import { beginDiscConvert, waitUntilDiscReady } from '../server/discCache.js';

/** Options for a convert run. */
export type ConvertOptions = {
  /**
   * When true, encode all title VOBs. Default: menus + title cells whose
   * VOB NAV PTS duration is ≤ TITLE_INCLUDE_MAX_SEC when the whole PGC is short.
   */
  full: boolean;
  /**
   * Only regenerate vm.js from existing web JSON (IFO/NAV/metadata).
   * Skips IFO parse, stills, SPU, encode, etc.
   */
  vmOnly: boolean;
  /**
   * Only rewrite .tar.gz from existing unpacked webFolder discs (no ffmpeg).
   */
  packOnly: boolean;
  /**
   * Only fetch TMDB posters for existing webFolder discs (no convert).
   */
  postersOnly: boolean;
  /**
   * Treat the positional as a disc name (or path) under webFolder
   * instead of a source VIDEO_TS tree.
   */
  web: boolean;
  /** Decrypt/copy via dvdbackup before convert (temp work dir unless --work-dir). */
  rip: boolean;
  /** Rip/decrypt only; leave VIDEO_TS under workDir. */
  ripOnly: boolean;
  /** After convert, keep the decrypted rip under workDir. */
  keepRip: boolean;
  /** Writable dir for decrypted VIDEO_TS when ripping. */
  workDir: string | null;
  /** After convert, upload package to media server (stub). */
  upload: boolean;
  /** Show full ffmpeg stderr (DTS/libvorbis chatter, etc.). Default: quiet. */
  verbose: boolean;
};

// pnpm often invokes as `node bin/convert.js -- --vm-only …`; drop leading `--` separators.
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
    full: {
      type: 'boolean',
      default: false,
    },
    titles: {
      type: 'boolean',
      default: false,
    },
    'vm-only': {
      type: 'boolean',
      default: false,
    },
    'pack-only': {
      type: 'boolean',
      default: false,
    },
    'posters-only': {
      type: 'boolean',
      default: false,
    },
    web: {
      type: 'boolean',
      default: false,
    },
    rip: {
      type: 'boolean',
      default: false,
    },
    'rip-only': {
      type: 'boolean',
      default: false,
    },
    'keep-rip': {
      type: 'boolean',
      default: false,
    },
    'work-dir': {
      type: 'string',
    },
    upload: {
      type: 'boolean',
      default: false,
    },
    verbose: {
      type: 'boolean',
      short: 'v',
      default: false,
    },
  },
});

const options: ConvertOptions = {
  full: Boolean(values.full || values.titles),
  vmOnly: Boolean(values['vm-only']),
  packOnly: Boolean(values['pack-only']),
  postersOnly: Boolean(values['posters-only']),
  web: Boolean(values.web),
  rip: Boolean(values.rip),
  ripOnly: Boolean(values['rip-only']),
  keepRip: Boolean(values['keep-rip']),
  workDir: values['work-dir'] ? String(values['work-dir']) : null,
  upload: Boolean(values.upload),
  verbose: Boolean(values.verbose),
};

if (values.help) {
  console.log(`Convert a DVD for the web (Linux-first standalone CLI).

Usage:
  pnpm convert --
  pnpm convert -- path/to/DVD/root
  pnpm convert -- --full path/to/DVD/root
  pnpm convert -- --vm-only path/to/DVD/root
  pnpm convert -- --vm-only --web lotr1_part1
  pnpm convert -- --vm-only --web /path/to/webFolder/lotr1_part1
  pnpm convert -- --pack-only
  pnpm convert -- --pack-only Shrek Harry_Potter_Philosophers_Ston
  pnpm convert -- --posters-only
  pnpm convert -- --posters-only Shrek Avatar
  pnpm pack-discs

With no path: use the sole optical drive (/dev/sr0, …). Errors if none or
several drives are present — pass an explicit path in those cases.

Default: convert a readable VIDEO_TS tree (or mounted disc) in place — no copy.
Optical devices and ISOs are ripped via dvdbackup first. Default also encodes
title cells whose VOB NAV PTS duration is ≤ ${TITLE_INCLUDE_MAX_SEC}s when the
whole title PGC is short (games / interactive). Pass --full (or --titles) for
all title content (feature, extras).

--vm-only regenerates vm.js only from existing converted JSON under webFolder
(IFO JSON, NAV JSON, metadata.json). No ffmpeg / stills / SPU re-extract.
With --web, the positional is a disc folder name (or path) under webFolder —
the original VIDEO_TS tree is not required.

--pack-only rewrites <disc>.tar.gz from existing unpacked webFolder discs
(no ffmpeg / stills / encode). Omits convert scratch JSON from the archive.
With no names: pack every folder that has metadata.json. Does not convert
PNG→WebP or drop still-only WebMs — that needs a full reconvert.

--posters-only fetches TMDB posters for existing webFolder discs (archives
and/or unpacked folders). Prefers <discId>.tmdb.json from pnpm identify
(GET /movie/{id}); otherwise title-search fallback. Writes <discId>.poster.jpg
and regenerates dvds.json. Requires tmdbApiKey / DVD_MENU_ARCHIVE_TMDB_API_KEY.
Use pnpm identify to interactively match discs to TMDB titles first.

Rip (dvdbackup + libdvdcss):
  --rip [--work-dir DIR]      Decrypt/copy then convert (temp dir if no --work-dir)
  --rip-only --work-dir DIR   Decrypt/copy to DIR and stop
  --keep-rip --work-dir DIR   Convert, leave the decrypted rip in DIR
  --upload                    Upload converted menu package to media server (stub)
  --verbose / -v              Show full ffmpeg stderr (non-monotonic DTS, etc.)

Convert always packs webFolder/<disc>.tar.gz (+ cover/poster sidecars) at the end.
With evictDiscCache=false (local/dev default), the unpacked folder is kept for
--vm-only; with true, pack deletes it (archive-only at rest).
By default ffmpeg encode logs are quiet (errors + progress only).

Use nix develop so ffmpeg-full + dvdbackup + libdvdcss are on PATH.`);
  process.exit(0);
}

if (options.packOnly && options.postersOnly) {
  console.error('--pack-only and --posters-only cannot be combined.');
  process.exit(1);
}

if (options.packOnly) {
  if (options.vmOnly || options.full || options.rip || options.ripOnly) {
    console.error('--pack-only cannot be combined with convert/rip flags.');
    process.exit(1);
  }
  var packIds = resolvePackDiscIds(appConfig.webFolder, positionals);
  packDiscFolders(appConfig.webFolder, packIds).catch(function (err) {
    console.error(err);
    process.exit(1);
  });
} else if (options.postersOnly) {
  if (options.vmOnly || options.full || options.rip || options.ripOnly) {
    console.error('--posters-only cannot be combined with convert/rip flags.');
    process.exit(1);
  }
  var posterIds = resolvePosterDiscIds(appConfig.webFolder, positionals);
  fetchPostersForDiscs(appConfig.webFolder, posterIds).catch(function (err) {
    console.error(err);
    process.exit(1);
  });
} else {
  convertDVD(resolveInputPath(positionals[0], options), options);
}

/**
 * Resolve the convert source: explicit positional, or the sole optical drive.
 */
function resolveInputPath(
  positional: string | undefined,
  opts: ConvertOptions,
): string {
  if (positional) {
    return positional;
  }
  if (opts.vmOnly || opts.web) {
    console.error(
      'Missing path. Pass a disc folder' +
        (opts.web ? ' name under webFolder' : '') +
        ', e.g.:\n  pnpm convert -- --vm-only --web <discName>',
    );
    process.exit(1);
  }

  var picked = pickDefaultDvdSource(listOpticalDrives());
  if (picked.ok) {
    console.error('Using optical drive ' + picked.path);
    return picked.path;
  }
  console.error('message' in picked ? picked.message : 'No optical drive available.');
  process.exit(1);
}

/**
 * Normalize trailing slashes from a path argument.
 */
function normalizePathArg(pathArg: string): string {
  var parts = pathArg.split(path.sep);
  var part = parts.pop();
  if (part !== '') {
    parts.push(part);
  }
  return parts.join(path.sep);
}

/**
 * Resolve the path passed to convert helpers.
 * generateJavaScript uses getWebPath(dvdPath) = webFolder/<basename>.
 */
function resolveDvdPath(pathArg: string, opts: ConvertOptions): string {
  var normalized = normalizePathArg(pathArg);
  if (!opts.web) {
    return normalized;
  }

  // Absolute/relative path that already points at the web disc folder.
  if (
    path.isAbsolute(normalized) ||
    normalized.includes(path.sep) ||
    fs.existsSync(normalized)
  ) {
    var abs = path.resolve(normalized);
    if (fs.existsSync(path.join(abs, 'metadata.json'))) {
      return abs;
    }
  }

  // Disc name under webFolder.
  return path.join(appConfig.webFolder, path.basename(normalized));
}

async function assertVmInputs(dvdPath: string) {
  var webPath = serverUtils.getWebPath(dvdPath);
  var discId = path.basename(webPath);
  var webFolder = path.dirname(webPath);
  var status = await waitUntilDiscReady(webFolder, discId);
  var metadataPath = path.join(webPath, 'metadata.json');
  if (status !== 'ready' || !fs.existsSync(metadataPath)) {
    console.error(
      'Missing ' +
        metadataPath +
        '\nRun a full convert first, or pass --web <discName> for an existing webFolder entry.'
    );
    process.exit(1);
  }
}

async function runRipIfNeeded(
  dvdPathArg: string,
  opts: ConvertOptions,
): Promise<string | null> {
  if (opts.upload && opts.ripOnly) {
    console.error('--upload does not apply with --rip-only (nothing converted yet).');
    process.exit(1);
  }

  var mustRip =
    opts.rip ||
    opts.ripOnly ||
    opts.keepRip ||
    sourceNeedsRip(dvdPathArg);
  if (!mustRip) {
    return null;
  }

  var workDir =
    opts.workDir ||
    (opts.keepRip || opts.ripOnly
      ? path.join(appConfig.webFolder, '.rip-work')
      : fs.mkdtempSync(path.join(os.tmpdir(), 'dvd-menu-archive-rip-')));

  var rip = await ripDisc({
    source: dvdPathArg,
    workDir: workDir,
    menusOnly: !opts.full,
  });
  console.error(rip.message);
  if (!rip.ok || !rip.dvdPath) {
    process.exit(1);
  }
  if (opts.ripOnly) {
    process.exit(0);
  }
  return rip.dvdPath;
}

function convertDVD(dvdPathArg: string, options: ConvertOptions) {
  var dvdPath = resolveDvdPath(dvdPathArg, options);

  runRipIfNeeded(dvdPathArg, options).then(function (rippedPath) {
    if (rippedPath) {
      continueConvert(rippedPath, options);
      return;
    }
    continueConvert(dvdPath, options);
  });
}

function continueConvert(dvdPath: string, options: ConvertOptions) {
  if (options.vmOnly) {
    assertVmInputs(dvdPath).then(function () {
      process.stdout.write(
        '\nConvert mode: vm-only (regenerate vm.js from existing JSON)\n'
      );
      var webPath = serverUtils.getWebPath(dvdPath);
      process.stdout.write('  web path: ' + webPath + '\n');
      beginDiscConvert(path.dirname(webPath), path.basename(webPath));
      generateJavaScript(dvdPath, function () {
        packConvertedDisc(dvdPath, function () {
          generateCatalogue(function () {
            afterConvertHooks(dvdPath, options);
          });
        });
      });
    });
    return;
  }

  process.stdout.write(
    options.full
      ? '\nConvert mode: full (menus + titles)\n'
      : '\nConvert mode: menus + short title cells ≤ ' +
          TITLE_INCLUDE_MAX_SEC +
          's (pass --full for all title video)\n'
  );

  // In-place convert cannot decrypt CSS; fail early instead of EIO/corrupt MPEG noise.
  probeDvdSource(dvdPath).then(function (probe) {
    if (!probe.ok) {
      console.error('\n' + (probe.message || 'Source VOBs are unreadable.'));
      process.exit(1);
    }
    startConvertPipeline(dvdPath, options);
  });
}

function startConvertPipeline(dvdPath: string, options: ConvertOptions) {
  // Create an empty directory if not already there.
  createDir(dvdPath, function () {
    // Convert IFO files.
    convertIfo(dvdPath, function () {
      afterChapters(function () {
        // Extract NAV packets.
        extractNavPackets(dvdPath, function () {
          // Menu maps + stills + buttons before VM JS (needs cell/btn metadata).
          extractMenu(dvdPath, function () {
            generateMenuCellTable(dvdPath, function () {
              generateCover(dvdPath, function () {
                maybeFetchTmdbPoster(dvdPath, function () {
                  generateButtons(dvdPath, function () {
                    extractSpu(dvdPath, function () {
                      generateTitleStubs(dvdPath, options, function () {
                        generateJavaScript(dvdPath, function () {
                          encodeVideo(dvdPath, options, function () {
                            // Re-emit vm.js so playMenuCell gets menuCell.video URLs.
                            generateJavaScript(dvdPath, function () {
                              packConvertedDisc(dvdPath, function () {
                                generateCatalogue(function () {
                                  afterConvertHooks(dvdPath, options);
                                });
                              });
                            });
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  function afterChapters(next) {
    if (!options.full) {
      // Title WebVTTs are useless without title video in menu-only mode.
      next();
      return;
    }
    generateChapters(dvdPath, next);
  }
}

/**
 * Soft-fail TMDB poster fetch during convert when the disc was identified
 * (pnpm identify) and a TMDB API key is configured.
 */
function maybeFetchTmdbPoster(dvdPath: string, next: () => void): void {
  var apiKey = appConfig.tmdbApiKey;
  if (!apiKey) {
    next();
    return;
  }
  var webPath = serverUtils.getWebPath(dvdPath);
  var webFolder = path.dirname(webPath);
  var discId = path.basename(webPath);
  if (!readTmdbIdentity(webFolder, discId)) {
    next();
    return;
  }
  process.stdout.write('\nFetching TMDB poster:\n');
  fetchTmdbPosterForDisc(webFolder, discId, { apiKey: apiKey })
    .then(function (result) {
      if (result.ok) {
        process.stdout.write('  ' + result.message + '\n');
      } else {
        console.warn('  ' + result.message);
      }
      next();
    })
    .catch(function (err) {
      console.warn(
        '  TMDB poster fetch failed: ' +
          (err instanceof Error ? err.message : String(err)),
      );
      next();
    });
}

function afterConvertHooks(dvdPath: string, opts: ConvertOptions) {
  if (!opts.upload) {
    console.log("That's all folks!");
    return;
  }
  var webPath = serverUtils.getWebPath(dvdPath);
  var discId = path.basename(webPath);
  var archive = path.join(path.dirname(webPath), discId + '.tar.gz');
  var packagePath = fs.existsSync(archive) ? archive : webPath;
  uploadConvertedPackage({ packagePath: packagePath }).then(function (result) {
    console.error(result.message);
    console.log("That's all folks!");
    if (!result.ok) {
      process.exitCode = 1;
    }
  });
}

