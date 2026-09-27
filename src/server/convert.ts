// Convert a DVD to a web suitable format.

'use strict';

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
import extractSpu from '../server/convert/extractSpu.js';
import generateJavaScript from '../server/convert/generateJavaScript.js';
import encodeVideo from '../server/convert/encodeVideo.js';
import * as serverUtils from '../server/utils/index.js';

/** Options for a convert run. */
export type ConvertOptions = {
  /** When true, encode title VOBs (feature/extras) as well as menus. Default: menus only. */
  full: boolean;
  /**
   * Only regenerate vm.js from existing web JSON (IFO/NAV/metadata).
   * Skips IFO parse, stills, SPU, encode, etc.
   */
  vmOnly: boolean;
  /**
   * Treat the positional as a disc name (or path) under webFolder
   * instead of a source VIDEO_TS tree.
   */
  web: boolean;
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
    web: {
      type: 'boolean',
      default: false,
    },
  },
});

const inputPath = positionals[0];
const options: ConvertOptions = {
  full: Boolean(values.full || values.titles),
  vmOnly: Boolean(values['vm-only']),
  web: Boolean(values.web),
};

if (values.help || !inputPath) {
  console.log(`Convert a DVD for the web.

Usage:
  pnpm convert -- path/to/DVD/root
  pnpm convert -- --full path/to/DVD/root
  pnpm convert -- --vm-only path/to/DVD/root
  pnpm convert -- --vm-only --web lotr1_part1
  pnpm convert -- --vm-only --web /path/to/webFolder/lotr1_part1

By default only menu VOBs are encoded (VIDEO_TS.VOB, VTS_*_0.VOB).
Pass --full (or --titles) to also encode title content (feature, extras).

--vm-only regenerates vm.js only from existing converted JSON under webFolder
(IFO JSON, NAV JSON, metadata.json). No ffmpeg / stills / SPU re-extract.
With --web, the positional is a disc folder name (or path) under webFolder —
the original VIDEO_TS tree is not required.`);
  process.exit(0);
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

function assertVmInputs(dvdPath: string) {
  var webPath = serverUtils.getWebPath(dvdPath);
  var metadataPath = path.join(webPath, 'metadata.json');
  if (!fs.existsSync(metadataPath)) {
    console.error(
      'Missing ' +
        metadataPath +
        '\nRun a full convert first, or pass --web <discName> for an existing webFolder entry.'
    );
    process.exit(1);
  }
}

function convertDVD(dvdPathArg: string, options: ConvertOptions) {
  var dvdPath = resolveDvdPath(dvdPathArg, options);

  if (options.vmOnly) {
    assertVmInputs(dvdPath);
    process.stdout.write(
      '\nConvert mode: vm-only (regenerate vm.js from existing JSON)\n'
    );
    process.stdout.write('  web path: ' + serverUtils.getWebPath(dvdPath) + '\n');
    generateJavaScript(dvdPath, function () {
      console.log("That's all folks!");
    });
    return;
  }

  process.stdout.write(
    options.full
      ? '\nConvert mode: full (menus + titles)\n'
      : '\nConvert mode: menus only (pass --full for title video)\n'
  );

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
                generateButtons(dvdPath, function () {
                  extractSpu(dvdPath, function () {
                    generateJavaScript(dvdPath, function () {
                      encodeVideo(dvdPath, options, function () {
                        generateCatalogue(function () {
                          console.log("That's all folks!");
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

convertDVD(inputPath, options);
