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
import ripDisc from '../server/convert/ripDisc.js';
import uploadConvertedPackage from '../server/convert/upload.js';
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
  /** Rip/decrypt only; leave VIDEO_TS under workDir (stub). */
  ripOnly: boolean;
  /** After convert, keep the decrypted rip under workDir (stub). */
  keepRip: boolean;
  /** Writable dir for decrypted VIDEO_TS when ripping (stub). */
  workDir: string | null;
  /** After convert, upload package to media server (stub). */
  upload: boolean;
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
  },
});

const inputPath = positionals[0];
const options: ConvertOptions = {
  full: Boolean(values.full || values.titles),
  vmOnly: Boolean(values['vm-only']),
  web: Boolean(values.web),
  ripOnly: Boolean(values['rip-only']),
  keepRip: Boolean(values['keep-rip']),
  workDir: values['work-dir'] ? String(values['work-dir']) : null,
  upload: Boolean(values.upload),
};

if (values.help || !inputPath) {
  console.log(`Convert a DVD for the web (Linux-first standalone CLI).

Usage:
  pnpm convert -- path/to/DVD/root
  pnpm convert -- --full path/to/DVD/root
  pnpm convert -- --vm-only path/to/DVD/root
  pnpm convert -- --vm-only --web lotr1_part1
  pnpm convert -- --vm-only --web /path/to/webFolder/lotr1_part1

Default: convert a readable VIDEO_TS tree to the web package (menus only).
Pass --full (or --titles) to also encode title content (feature, extras).

--vm-only regenerates vm.js only from existing converted JSON under webFolder
(IFO JSON, NAV JSON, metadata.json). No ffmpeg / stills / SPU re-extract.
With --web, the positional is a disc folder name (or path) under webFolder —
the original VIDEO_TS tree is not required.

Planned (stubs today — see AGENTS.md):
  --rip-only --work-dir DIR   Decrypt/copy disc or ISO to DIR and stop
  --keep-rip --work-dir DIR   Convert, but leave the decrypted rip in DIR
  --upload                    Upload converted menu package to media server`);
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

async function runStubFlags(dvdPathArg: string, opts: ConvertOptions) {
  if (opts.upload && opts.ripOnly) {
    console.error('--upload does not apply with --rip-only (nothing converted yet).');
    process.exit(1);
  }

  if (opts.ripOnly || opts.keepRip) {
    var workDir = opts.workDir || path.join(appConfig.webFolder, '.rip-work');
    var rip = await ripDisc({
      source: dvdPathArg,
      workDir: workDir,
      menusOnly: !opts.full,
    });
    console.error(rip.message);
    if (opts.ripOnly) {
      process.exit(rip.ok ? 0 : 1);
    }
    // keepRip: fall through to convert once ripDisc is implemented.
    if (!rip.ok) {
      process.exit(1);
    }
  }
}

function convertDVD(dvdPathArg: string, options: ConvertOptions) {
  var dvdPath = resolveDvdPath(dvdPathArg, options);

  if (options.ripOnly || options.keepRip || options.upload) {
    runStubFlags(dvdPathArg, options).then(function () {
      if (options.ripOnly) {
        return;
      }
      continueConvert(dvdPath, options);
    });
    return;
  }

  continueConvert(dvdPath, options);
}

function continueConvert(dvdPath: string, options: ConvertOptions) {
  if (options.vmOnly) {
    assertVmInputs(dvdPath);
    process.stdout.write(
      '\nConvert mode: vm-only (regenerate vm.js from existing JSON)\n'
    );
    process.stdout.write('  web path: ' + serverUtils.getWebPath(dvdPath) + '\n');
    generateJavaScript(dvdPath, function () {
      afterConvertHooks(dvdPath, options);
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

  function afterChapters(next) {
    if (!options.full) {
      // Title WebVTTs are useless without title video in menu-only mode.
      next();
      return;
    }
    generateChapters(dvdPath, next);
  }
}

function afterConvertHooks(dvdPath: string, opts: ConvertOptions) {
  if (!opts.upload) {
    console.log("That's all folks!");
    return;
  }
  var packagePath = serverUtils.getWebPath(dvdPath);
  uploadConvertedPackage({ packagePath: packagePath }).then(function (result) {
    console.error(result.message);
    console.log("That's all folks!");
    if (!result.ok) {
      process.exitCode = 1;
    }
  });
}

convertDVD(inputPath, options);
