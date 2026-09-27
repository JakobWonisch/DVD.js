// Extract NAV packets from VOB files.

'use strict';


import * as fs from 'node:fs';
import * as path from 'node:path';
import jDataView from 'jdataview';

import Stream from '../../server/utils/stream.js';
import decodePacket from '../../server/utils/decode_packet.js';
import * as navRead from '../../dvdread/nav_read.js';
import * as serverUtils from '../../server/utils/index.js';
import * as utils from '../../utils.js';
import { globFiles } from '../../server/utils/globFiles.js';

/**
 * The length of one Logical Block of a DVD.
 * From dvdread/index.ts.
 * @const
 */
var DVD_VIDEO_LB_LEN = 2048;

export default extractNav;

/**
 * Extract NAV packets from the VOB files located in a folder.
 *
 * @param {string} dvdPath
 * @param {function} callback
 */
function extractNav(dvdPath: string, callback) {
  process.stdout.write('\nExtracting NAV packets:\n');

  var webPath = serverUtils.getWebPath(dvdPath);

  var vobPath = path.join(dvdPath, 'VIDEO_TS', '*.VOB');
  globFiles(vobPath, function(err, vobFiles) {
    if (err) {
      console.error(err);
    }

    // Filter out non-menu VOB files as we only use these NAV packets for generating UI buttons.
    vobFiles = vobFiles.filter(serverUtils.isMenuVob);

    if (!vobFiles.length) {
      // Some DVD don't have menu at all.
      callback();
      return;
    }

    var pointer = 0;

    next(vobFiles[pointer]);

    // There are better ways to do async...
    function next(vobFile: string) {
      var name = path.basename(vobFile);

      fs.readFile(vobFile, function(err, data) {
        if (err) {
          console.error(err);
          if (err.code === 'EIO' || err.code === 'EACCES' || err.code === 'EPERM') {
            console.error(
              'Aborting NAV extract: cannot read ' +
                name +
                ' (' +
                err.code +
                '). CSS-protected discs need --rip (dvdbackup), e.g.:\n' +
                '  pnpm convert -- --rip --work-dir ~/dvd/work <source>'
            );
            process.exit(1);
          }
          advanceFile();
          return;
        }

        // Empty / stub menu VOBs (common on multi-title extras discs).
        if (!data || data.length < DVD_VIDEO_LB_LEN) {
          console.warn(
            'Skipping empty/invalid menu VOB:',
            name,
            '(' + (data ? data.length : 0) + ' bytes)'
          );
          advanceFile();
          return;
        }

        var p = new Stream(data);
        var lastSector = Math.floor(data.length / DVD_VIDEO_LB_LEN);

        extractFromSector(0x00);

        function extractFromSector(sector) {
          if (sector < 0 || sector >= lastSector) {
            advanceFile();
            return;
          }

          try {
            p.seek(sector * DVD_VIDEO_LB_LEN);
            var navPackets = decodePacket(p);

            if (!navPackets.pci || !navPackets.dsi) {
              console.warn(
                'No NAV packet at sector',
                utils.toHex(sector),
                'in',
                name,
                '— stopping this VOB'
              );
              advanceFile();
              return;
            }

            var json = {
              pci: navRead.parsePCI(new jDataView(navPackets.pci, undefined, undefined, false)),
              dsi: navRead.parseDSI(new jDataView(navPackets.dsi, undefined, undefined, false))
            };

            if (
              !json.dsi ||
              !json.dsi.dsi_gi ||
              json.dsi.dsi_gi.nv_pck_lbn == null ||
              json.dsi.dsi_gi.vobu_ea == null
            ) {
              console.warn('Incomplete DSI at sector', utils.toHex(sector), 'in', name);
              advanceFile();
              return;
            }

            var jsonPath = getNavFilename(name, sector);
            fs.writeFile(jsonPath, JSON.stringify(json), function(writeErr) {
              if (writeErr) {
                console.error(writeErr);
              }

              process.stdout.write('.');

              // Extract the next NAV packets recursively.
              var nextSector =
                json.dsi.dsi_gi.nv_pck_lbn + json.dsi.dsi_gi.vobu_ea + 1;

              if (
                nextSector > sector &&
                nextSector < lastSector
              ) {
                setTimeout(function() {
                  extractFromSector(nextSector);
                }, 0);
              } else {
                advanceFile();
              }
            });
          } catch (parseErr) {
            console.warn(
              'Failed NAV extract at sector',
              utils.toHex(sector),
              'in',
              name + ':',
              parseErr && (parseErr as Error).message
                ? (parseErr as Error).message
                : parseErr
            );
            advanceFile();
          }
        }
      });
    }

    function advanceFile() {
      pointer++;
      if (pointer < vobFiles.length) {
        setTimeout(function() {
          next(vobFiles[pointer]);
        }, 0);
      } else {
        callback();
      }
    }
  });

  /**
   * Return the file path for the web given a file.
   * Used for naming both the NAV packet files and the metadata file.
   *
   * @param {string} name A file name.
   * @param {number} sector A file name.
   * @return {string}
   */
  function getNavFilename(name: string, sector: number): string {
    return path.join(webPath, getJsonFileName(name, sector));
  }
}

/**
 * Transform the file name of a JSON file.
 *
 * @param {string} name A file name.
 * @param {number} sector A file name.
 * @return {string}
 */
function getJsonFileName(name: string, sector: number): string {
  return name.replace(/\.VOB$/i, '') + '-' + utils.toHex(sector) + '.json';
}
