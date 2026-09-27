// Convert a DVD to a web suitable format.

'use strict';

import * as path from 'node:path';
import { parseArgs } from 'node:util';

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

/** Options for a convert run. */
export type ConvertOptions = {
  /** When true, encode title VOBs (feature/extras) as well as menus. Default: menus only. */
  full: boolean;
};

const { values, positionals } = parseArgs({
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
  },
});

const dvdPath = positionals[0];
const options: ConvertOptions = {
  full: Boolean(values.full || values.titles),
};

if (values.help || !dvdPath) {
  console.log(`Convert a DVD for the web.

Usage:
  pnpm convert -- path/to/DVD/root
  pnpm convert -- --full path/to/DVD/root

By default only menu VOBs are encoded (VIDEO_TS.VOB, VTS_*_0.VOB).
Pass --full (or --titles) to also encode title content (feature, extras).`);
  process.exit(0);
}

function convertDVD(dvdPathArg: string, options: ConvertOptions) {
  var dvdPathParts = dvdPathArg.split(path.sep);

  // We remove the trailing /.
  var part = dvdPathParts.pop();
  if (part !== '') {
    dvdPathParts.push(part);
  }
  var dvdPath = dvdPathParts.join(path.sep);

  process.stdout.write(
    options.full
      ? '\nConvert mode: full (menus + titles)\n'
      : '\nConvert mode: menus only (pass --full for title video)\n'
  );

  // Create an empty directory if not already there.
  createDir(dvdPath, function() {
    // Convert IFO files.
    convertIfo(dvdPath, function() {
      afterChapters(function() {
        // Extract NAV packets.
        extractNavPackets(dvdPath, function() {
          // Menu maps + stills + buttons before VM JS (needs cell/btn metadata).
          extractMenu(dvdPath, function() {
            generateMenuCellTable(dvdPath, function() {
              generateCover(dvdPath, function() {
                generateButtons(dvdPath, function() {
                  extractSpu(dvdPath, function() {
                    generateJavaScript(dvdPath, function() {
                      encodeVideo(dvdPath, options, function() {
                        generateCatalogue(function() {
                          console.log('That\'s all folks!');
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

convertDVD(dvdPath, options);
