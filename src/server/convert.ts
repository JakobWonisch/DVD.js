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
import generateJavaScript from '../server/convert/generateJavaScript.js';
import encodeVideo from '../server/convert/encodeVideo.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: {
      type: 'boolean',
      short: 'h',
    },
  },
});

const dvdPath = positionals[0];

if (values.help || !dvdPath) {
  console.log('Convert a DVD for the web.\nUsage: pnpm convert -- path/to/DVD/root');
  process.exit(0);
}

function convertDVD(dvdPath) {
  dvdPath = dvdPath.split(path.sep);

  // We remove the trailing /.
  var part = dvdPath.pop();
  if (part !== '') {
    dvdPath.push(part);
  }
  dvdPath = dvdPath.join(path.sep);

  // Create an empty directory if not already there.
  createDir(dvdPath, function() {
    // Convert IFO files.
    convertIfo(dvdPath, function() {
      // Generate WebVTT files with video chapters.
      generateChapters(dvdPath, function() {
        // Extract NAV packets.
        extractNavPackets(dvdPath, function() {
          // Generate JavaScript from VM instructions.
          generateJavaScript(dvdPath, function() {
            // Extract menu still frames.
            extractMenu(dvdPath, function() {
              // Generate menu cell table.
              generateMenuCellTable(dvdPath, function() {
                // Generate buttons for menu UI.
                generateButtons(dvdPath, function() {
                  // Convert video.
                  encodeVideo(dvdPath, function() {
                    // Regenerate the list of DVD.
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
}

convertDVD(dvdPath);
